import React from 'react';
import {
  Map,
  MapMarker,
  CustomOverlayMap,
  Polyline,
  Circle,
  useKakaoLoader,
} from 'react-kakao-maps-sdk';
import { AlertCircle, Check, Crosshair, Star, Sliders, Waves as WavesIcon, Map as MapIcon, Satellite, Moon, Sun, LocateFixed, ChevronUp, Plus, Minus } from 'lucide-react';
import { MaterialSpotMarker } from './MaterialSpotMarker';
import type { FishingSpot, WeatherData, MarineData, WindUnit, CurrentUnit, TideDayInfo, SweetSpot } from '../types';
import type { AuthUser } from './LoginModal';
import { isUserAdmin } from '../services/oauthService';
import {
  formatWindSpeed,
  formatCurrentVelocity,
  getWindDirectionKor,
  getWindFlowDescKor,
  getCurrentDirectionKor,
} from '../utils/weatherApi';
import { KOREA_DEPTH_CONTOURS, estimateDepthAtPoint } from '../data/depthContours';
import { generateDynamicBathymetryContours } from '../utils/dynamicBathymetryEngine';
import {
  getSavedTackleConfig,
  saveTackleConfig,
  calculateSinkingPhysics,
  calculateAerodynamicCastingDrift,
  ROD_POWER_SPECS,
  RodPower,
  RodType,
  TackleRigConfig,
  SURF_ROD_LENGTHS_M,
  WEIGHT_PRESETS,
  WeightCategory,
  getWeightDescription,
  BaitType,
  LureShape,
  LURE_SHAPE_NAMES,
  getBaitSpecs,
} from '../utils/tackleCalibration';
import {
  getNativeLocation,
  setScreenKeepAwake,
  triggerHaptic,
  setupVolumeZoomListener,
} from '../utils/nativeBridge';

// 카카오 디벨로퍼스 JavaScript 앱 키
const KAKAO_APP_KEY = '61ebf0b7a0daf24cba357d92677c8d8a';

// 8방위 문자열을 방위각(도) 및 한글 라벨로 변환
const CASTING_BEARINGS: Record<string, { deg: number; label: string }> = {
  N: { deg: 0, label: '북(N)' },
  NE: { deg: 45, label: '북동(NE)' },
  E: { deg: 90, label: '동(E)' },
  SE: { deg: 135, label: '남동(SE)' },
  S: { deg: 180, label: '남(S)' },
  SW: { deg: 225, label: '남서(SW)' },
  W: { deg: 270, label: '서(W)' },
  NW: { deg: 315, label: '북서(NW)' },
};

// 대권 항로 공식에 따른 목표 좌표(위도, 경도) 계산 (비거리 distanceMeters 지점)
function calculateDestinationPoint(
  lat: number,
  lng: number,
  bearingDeg: number,
  distanceMeters: number
): [number, number] {
  const R = 6378137; // 지구 반지름 (m)
  const d = distanceMeters;
  const bearing = (bearingDeg * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;

  const endLatRad = Math.asin(
    Math.sin(latRad) * Math.cos(d / R) +
    Math.cos(latRad) * Math.sin(d / R) * Math.cos(bearing)
  );
  const endLngRad = lngRad + Math.atan2(
    Math.sin(bearing) * Math.sin(d / R) * Math.cos(latRad),
    Math.cos(d / R) - Math.sin(latRad) * Math.sin(endLatRad)
  );

  return [(endLatRad * 180) / Math.PI, (endLngRad * 180) / Math.PI];
}

// 두 위경도 좌표 간의 방위각 (0~359°) 및 거리(미터) 계산
function calculateDistanceAndBearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): { distance: number; bearing: number } {
  const R = 6378137;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const rLat1 = (lat1 * Math.PI) / 180;
  const rLat2 = (lat2 * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = Math.round(R * c);

  const y = Math.sin(dLng) * Math.cos(rLat2);
  const x =
    Math.cos(rLat1) * Math.sin(rLat2) -
    Math.sin(rLat1) * Math.cos(rLat2) * Math.cos(dLng);
  let bearing = Math.round((Math.atan2(y, x) * 180) / Math.PI);
  if (bearing < 0) bearing += 360;
  bearing = bearing % 360;

  return { distance, bearing };
}

type MapMode = 'ROADMAP' | 'HYBRID' | 'DARK';

interface MapViewProps {
  spots: FishingSpot[];
  selectedSpot: FishingSpot | null;
  onSelectSpot: (spot: FishingSpot) => void;
  onMapClickForNewSpot: (lat: number, lng: number) => void;
  weather: WeatherData | null;
  marine: MarineData | null;
  tide: TideDayInfo | null;
  windUnit: WindUnit;
  currentUnit: CurrentUnit;
  recenterTarget?: { lat: number; lng: number; zoom?: number } | null;
  isMobileDrawerOpen?: boolean;
  microAdjustSpot?: FishingSpot | null;
  onCancelMicroAdjust?: () => void;
  onConfirmMicroAdjust?: (spotId: string, newLat: number, newLng: number) => void;
  currentUser?: AuthUser | null;
  onStartMicroAdjust?: (spot: FishingSpot) => void;
  onOpenDetail?: (spot: FishingSpot) => void;
  onEditSpot?: (spot: FishingSpot) => void;
  onUpdateSpot?: (updatedSpot: FishingSpot) => Promise<void> | void;
  favoriteSpotIds?: string[];
  onToggleFavorite?: (spotId: string) => void;
  isSunMode?: boolean;
  onToggleSunMode?: () => void;
}

export const MapView: React.FC<MapViewProps> = ({
  spots,
  selectedSpot,
  onSelectSpot,
  onMapClickForNewSpot,
  weather,
  marine,
  tide,
  windUnit,
  currentUnit,
  recenterTarget,
  isMobileDrawerOpen = false,
  microAdjustSpot = null,
  onCancelMicroAdjust,
  onConfirmMicroAdjust,
  currentUser = null,
  onStartMicroAdjust,
  onOpenDetail,
  onEditSpot,
  onUpdateSpot,
  favoriteSpotIds: externalFavoriteSpotIds,
  onToggleFavorite: externalOnToggleFavorite,
  isSunMode = false,
  onToggleSunMode,
}) => {
  const isAdmin = isUserAdmin(currentUser);

  // 카카오 지도 SDK 동적 로더
  const [loading, error] = useKakaoLoader({
    appkey: KAKAO_APP_KEY,
    libraries: ['services', 'clusterer'],
  });

  // 지도 중심 및 줌 레벨 (카카오맵: 숫자가 작을수록 확대, 1=20m, 3=50m, 12=전국)
  const [center, setCenter] = React.useState<{ lat: number; lng: number }>({
    lat: 36.3,
    lng: 127.8,
  });
  const [level, setLevel] = React.useState<number>(12);

  // 지도 뷰 모드 (일반 로드맵 / 고해상도 스카이뷰 / 야간 다크 모드)
  const [mapMode, setMapMode] = React.useState<MapMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('exfish_map_mode');
      if (saved === 'HYBRID' || saved === 'DARK') return saved;
    }
    return 'ROADMAP';
  });

  // 내 현재 GPS 위치 및 추적 상태 (GPS 수평 오차 반경 원 포함)
  const [myLocation, setMyLocation] = React.useState<{ lat: number; lng: number } | null>(null);
  const [gpsAccuracy, setGpsAccuracy] = React.useState<number | null>(null);
  const [isLocating, setIsLocating] = React.useState(false);

  // 클릭 이벤트 관통 방지 이중 락 레퍼런스
  const isMarkerClickRef = React.useRef(false);

  // 실수 터치 방지: 지도 빈 자리 클릭 시 임시 핀 & 미니 확인 팝업 상태
  const [pendingNewSpot, setPendingNewSpot] = React.useState<{ lat: number; lng: number } | null>(null);

  // [요구사항 1] 카카오 기본 줌(Level 1)을 초과하는 2단계 추가 디지털 줌 (1.0x -> 1.8x -> 3.0x)
  const [digitalZoom, setDigitalZoom] = React.useState<number>(1.0);

  // 카카오 맵 인스턴스 참조
  const mapRef = React.useRef<any>(null);

  // [요구사항 4] 지도 최상위 뷰포트 컨테이너 ref
  const mapContainerRef = React.useRef<HTMLDivElement>(null);



  // [요구사항 4] 포인트 더블클릭/롱클릭 컨텍스트 메뉴 상태
  const [contextMenuSpot, setContextMenuSpot] = React.useState<FishingSpot | null>(null);
  const longPressTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressTriggeredRef = React.useRef(false);

  // [요구사항 4] 컨텍스트 메뉴 열기 헬퍼 (디지털 줌 상태에서는 시야가 튀지 않도록 유지, 일반 상태에서는 중앙 배치)
  const handleOpenContextMenu = React.useCallback((spot: FishingSpot) => {
    setContextMenuSpot(spot);
    if (digitalZoom <= 1.0 && mapRef.current && (window as any).kakao?.maps?.LatLng) {
      try {
        const targetLatLng = new (window as any).kakao.maps.LatLng(spot.lat, spot.lng);
        mapRef.current.panTo(targetLatLng);
      } catch {}
    }
  }, [digitalZoom]);

  // [요구사항 4-3] 캐스팅 방향 전용 설정 모드 상태
  const [castingConfigSpot, setCastingConfigSpot] = React.useState<FishingSpot | null>(null);
  const [tempCastingEnabled, setTempCastingEnabled] = React.useState(true);
  const [tempStartDeg, setTempStartDeg] = React.useState(45);
  const [tempEndDeg, setTempEndDeg] = React.useState(135);

  // [요구사항 4-4] 스윗 스폿 전용 설정 모드 상태
  const [sweetSpotConfigSpot, setSweetSpotConfigSpot] = React.useState<FishingSpot | null>(null);
  const [tempUseSweetSpot, setTempUseSweetSpot] = React.useState(true);
  const [tempSweetSpots, setTempSweetSpots] = React.useState<SweetSpot[]>([]);
  const [isAddingSweetSpot, setIsAddingSweetSpot] = React.useState(false);
  const [selectedNewRadius, setSelectedNewRadius] = React.useState<number>(10);
  // [요구사항 2-1-6] 추가 중인 스윗 스팟 초안 (위치/반지름/노트는 '추가' 승인 전까지 자유롭게 변경)
  const [draftSweetPos, setDraftSweetPos] = React.useState<{ lat: number; lng: number } | null>(null);
  const [draftSweetNote, setDraftSweetNote] = React.useState('');
  // [요구사항 2-1-5] 삭제 확인용 인앱 다이얼로그 (네이티브 confirm 중복/도메인 표기 제거)
  const [pendingDeleteSweetIdx, setPendingDeleteSweetIdx] = React.useState<number | null>(null);
  // [요구사항 2-2] 노트 전체 보기 (클릭/hover)
  const [expandedSweetId, setExpandedSweetId] = React.useState<string | null>(null);

  // [요구사항 1-1, 1-2] 멀티터치(핀치 줌) 및 클릭 분기용 Ref
  const activeTouchCountRef = React.useRef(0);
  const lastMultiTouchAtRef = React.useRef(0);
  const pressStartPosRef = React.useRef<{ x: number; y: number } | null>(null);
  const skipAutoRecenterRef = React.useRef(false);
  const isCoarsePointer = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  // 나만의 즐겨찾기(찜한 포인트) 목록
  const [internalFavoriteSpotIds, setInternalFavoriteSpotIds] = React.useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('exfish_favorite_spot_ids');
        if (raw) return JSON.parse(raw);
      } catch {}
    }
    return [];
  });
  const favoriteSpotIds = externalFavoriteSpotIds || internalFavoriteSpotIds;
  const [viewOnlyFavorites, setViewOnlyFavorites] = React.useState(false);

  const toggleFavorite = (spotId: string) => {
    if (externalOnToggleFavorite) {
      externalOnToggleFavorite(spotId);
      return;
    }
    setInternalFavoriteSpotIds((prev) => {
      const next = prev.includes(spotId) ? prev.filter((id) => id !== spotId) : [...prev, spotId];
      if (typeof window !== 'undefined') {
        localStorage.setItem('exfish_favorite_spot_ids', JSON.stringify(next));
      }
      return next;
    });
  };

  // KHOA 국가해양격자 수심 등심선 오버레이 표시 여부
  const [showDepthContours, setShowDepthContours] = React.useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('exfish_show_depth_contours') === 'true';
    }
    return false;
  });

  const toggleDepthContours = () => {
    setShowDepthContours((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem('exfish_show_depth_contours', String(next));
      }
      return next;
    });
  };

  // 150m 격자수심 + 국립해양조사원(KHOA) 실시간 조위 합성 동적 등심선 (5~30m)
  const currentHour = new Date().getHours();
  const currentTideHeightCm = tide?.hourlyCurve?.find((c) => c.isCurrent || c.hour === currentHour)?.height;

  const dynamicBathymetry = React.useMemo(() => {
    if (!showDepthContours) return null;
    const targetLat = selectedSpot ? selectedSpot.lat : center.lat;
    const targetLng = selectedSpot ? selectedSpot.lng : center.lng;
    return generateDynamicBathymetryContours(
      targetLat,
      targetLng,
      currentTideHeightCm,
      18, // 반경 18km
      [5, 10, 15, 20, 25, 30] // 5m ~ 30m 등심선
    );
  }, [showDepthContours, selectedSpot?.lat, selectedSpot?.lng, center.lat, center.lng, currentTideHeightCm]);

  // 공기역학 채비 캘리브레이션 (루어 무게 g & PE 라인 호수)
  const [tackleConfig, setTackleConfig] = React.useState<TackleRigConfig>(() => getSavedTackleConfig());
  const [isTacklePopoverOpen, setIsTacklePopoverOpen] = React.useState(false);
  const [selectedWeightCategory, setSelectedWeightCategory] = React.useState<WeightCategory>(() => {
    const current = getSavedTackleConfig();
    if (current.rodType === 'SURF' || current.weightGrams >= 30) return 'SURF';
    if (current.weightGrams >= 11 && current.weightGrams <= 27) return 'JUKKUMI';
    return 'JIG';
  });

  React.useEffect(() => {
    const handleTackleUpdate = () => {
      setTackleConfig(getSavedTackleConfig());
    };
    window.addEventListener('exfish_tackle_updated', handleTackleUpdate);
    return () => window.removeEventListener('exfish_tackle_updated', handleTackleUpdate);
  }, []);

  // 모드 변경 시 localStorage 영구 저장
  const handleModeChange = (mode: MapMode) => {
    setMapMode(mode);
    if (typeof window !== 'undefined') {
      localStorage.setItem('exfish_map_mode', mode);
      document.documentElement.setAttribute('data-map-mode', mode);
    }
  };

  React.useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-map-mode', mapMode);
    }
  }, [mapMode]);



  // [요구사항 4] 화면 클릭/터치 좌표 추적 (디지털 줌 역산 좌표 계산용)
  const lastClientPosRef = React.useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // [요구사항 4] 위치 조정(미세 조정) 핀 드래그 추적 플래그
  const isDraggingAdjustMarkerRef = React.useRef<boolean>(false);

  // [요구사항 4] 디지털 줌 상태(CSS scale)에서 브라우저 화면 좌표(clientX, clientY)를 정확한 카카오 LatLng로 역산
  const getCorrectLatLngFromClient = React.useCallback(
    (clientX: number, clientY: number): { lat: number; lng: number } | null => {
      if (!mapRef.current) return null;
      const map = mapRef.current;
      const proj = map.getProjection ? map.getProjection() : null;
      if (!proj || !(window as any).kakao?.maps?.Point) return null;

      const container = map.getNode ? map.getNode() : null;
      if (!container) return null;

      const rect = container.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;

      if (digitalZoom <= 1.0) {
        const point = new (window as any).kakao.maps.Point(clientX - rect.left, clientY - rect.top);
        const coords = proj.coordsFromContainerPoint(point);
        if (!coords) return null;
        return { lat: coords.getLat(), lng: coords.getLng() };
      }

      // transform: scale(digitalZoom) 적용 시 화면 중심 기준 역산
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const unscaledW = rect.width / digitalZoom;
      const unscaledH = rect.height / digitalZoom;

      const unscaledX = unscaledW / 2 + (clientX - cx) / digitalZoom;
      const unscaledY = unscaledH / 2 + (clientY - cy) / digitalZoom;

      const point = new (window as any).kakao.maps.Point(unscaledX, unscaledY);
      const coords = proj.coordsFromContainerPoint(point);
      if (!coords) return null;
      return { lat: coords.getLat(), lng: coords.getLng() };
    },
    [digitalZoom]
  );

  // [요구사항 4] 지도 좌표(LatLng)를 뷰포트(mapContainerRef) 기준의 정확한 스크린 픽셀 좌표(x, y)로 변환
  const getScreenPosFromLatLng = React.useCallback(
    (lat: number, lng: number): { x: number; y: number } | null => {
      if (!mapRef.current) return null;
      const map = mapRef.current;
      const proj = map.getProjection ? map.getProjection() : null;
      if (!proj || !(window as any).kakao?.maps?.LatLng) return null;

      const container = map.getNode ? map.getNode() : null;
      if (!container) return null;
      const rect = container.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;

      const latLng = new (window as any).kakao.maps.LatLng(lat, lng);
      const containerPoint = proj.containerPointFromCoords(latLng);
      if (!containerPoint) return null;

      const rootRect = mapContainerRef.current ? mapContainerRef.current.getBoundingClientRect() : rect;

      if (digitalZoom <= 1.0) {
        return {
          x: rect.left - rootRect.left + containerPoint.x,
          y: rect.top - rootRect.top + containerPoint.y,
        };
      }

      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const unscaledW = rect.width / digitalZoom;
      const unscaledH = rect.height / digitalZoom;

      const screenX = cx + (containerPoint.x - unscaledW / 2) * digitalZoom;
      const screenY = cy + (containerPoint.y - unscaledH / 2) * digitalZoom;

      return {
        x: screenX - rootRect.left,
        y: screenY - rootRect.top,
      };
    },
    [digitalZoom]
  );

  // [요구사항 2, 4, 5] 디지털 슈퍼 줌(1.8x, 3.0x) 상태에서 픽셀 드래그 오차 100% 정밀 보정
  const dragTrackerRef = React.useRef<{
    isDragging: boolean;
    lastX: number;
    lastY: number;
    totalDist: number;
  }>({
    isDragging: false,
    lastX: 0,
    lastY: 0,
    totalDist: 0,
  });

  const handlePointerDown = (clientX: number, clientY: number) => {
    lastClientPosRef.current = { x: clientX, y: clientY };
    if (digitalZoom <= 1.0) return;
    dragTrackerRef.current = {
      isDragging: true,
      lastX: clientX,
      lastY: clientY,
      totalDist: 0,
    };
  };

  const handlePointerMove = (clientX: number, clientY: number) => {
    lastClientPosRef.current = { x: clientX, y: clientY };

    // [요구사항 4] 위치 조정 핀 드래그 중인 경우: 지도 이동 대신 핀 위치를 손가락/마우스 위치로 정밀 이동
    if (isDraggingAdjustMarkerRef.current) {
      const corrected = getCorrectLatLngFromClient(clientX, clientY);
      if (corrected) {
        setAdjustedPos(corrected);
      }
      return;
    }

    if (digitalZoom <= 1.0 || !dragTrackerRef.current.isDragging || !mapRef.current) return;
    const dx = clientX - dragTrackerRef.current.lastX;
    const dy = clientY - dragTrackerRef.current.lastY;
    dragTrackerRef.current.totalDist += Math.hypot(dx, dy);
    dragTrackerRef.current.lastX = clientX;
    dragTrackerRef.current.lastY = clientY;

    // 드래그 거리가 생기면 롱프레스 취소 및 열려있는 팝업/컨텍스트 메뉴 닫기 (지도 이동 방해 방지)
    if (dragTrackerRef.current.totalDist > 8) {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      if (contextMenuSpot) setContextMenuSpot(null);
      if (pendingNewSpot) setPendingNewSpot(null);
    }

    try {
      const map = mapRef.current;
      // [요구사항 5] 애니메이션 지연 없는 즉시 좌표 이동(setCenter)으로 60fps 마우스/터치 드래그 추종
      const proj = map.getProjection ? map.getProjection() : null;
      if (proj && (window as any).kakao?.maps?.Point) {
        const curCenter = map.getCenter();
        const curPoint = proj.pointFromCoords(curCenter);
        const newPoint = new (window as any).kakao.maps.Point(
          curPoint.x - dx / digitalZoom,
          curPoint.y - dy / digitalZoom
        );
        const newCenter = proj.coordsFromPoint(newPoint);
        map.setCenter(newCenter);
      }
    } catch (err) {
      console.warn('Superzoom drag pan error:', err);
    }
  };

  const handlePointerUp = () => {
    if (isDraggingAdjustMarkerRef.current) {
      isDraggingAdjustMarkerRef.current = false;
    }
    if (dragTrackerRef.current.isDragging) {
      dragTrackerRef.current.isDragging = false;
      if (mapRef.current) {
        try {
          const c = mapRef.current.getCenter();
          setCenter({ lat: c.getLat(), lng: c.getLng() });
        } catch {}
      }
    }
  };

  const handleZoomIn = () => {
    if (level > 1) {
      setLevel((prev) => Math.max(1, prev - 1));
    } else {
      setDigitalZoom((prev) => {
        if (prev < 1.5) return 1.8;
        return 3.0;
      });
      setVolumeToast('🔍 디지털 슈퍼 줌 (확대)');
    }
  };

  const handleZoomOut = () => {
    if (digitalZoom > 1.0) {
      setDigitalZoom((prev) => {
        if (prev > 2.0) return 1.8;
        return 1.0;
      });
    } else {
      setLevel((prev) => Math.min(14, prev + 1));
    }
  };

  // 볼륨 키 줌 안내 토스트 상태 (Phase 2 하드웨어 연동)
  const [volumeToast, setVolumeToast] = React.useState<string | null>(null);

  // 하드웨어 볼륨 키 지도 줌 인/아웃 리스너 (Android Phase 2)
  React.useEffect(() => {
    const cleanup = setupVolumeZoomListener((dir) => {
      if (dir === 'in') {
        handleZoomIn();
        setVolumeToast(level === 1 ? '🔍 디지털 줌인 (볼륨+)' : '🔍 지도 확대 (볼륨+)');
      } else {
        handleZoomOut();
        setVolumeToast('🔍 지도 축소 (볼륨-)');
      }
    });
    return cleanup;
  }, [level, digitalZoom]);

  React.useEffect(() => {
    if (volumeToast) {
      const timer = setTimeout(() => setVolumeToast(null), 1500);
      return () => clearTimeout(timer);
    }
  }, [volumeToast]);

  // [요구사항 4-3] 캐스팅 방향 전용 설정 모드 열기/저장
  const handleOpenCastingConfig = (spot: FishingSpot) => {
    setCastingConfigSpot(spot);
    setSweetSpotConfigSpot(null);
    setContextMenuSpot(null);
    setCenter({ lat: spot.lat, lng: spot.lng });
    setLevel(2); // 적어도 맵 거리 200m까지 확대
    setTempCastingEnabled(spot.casting_start_deg !== undefined && spot.casting_end_deg !== undefined);
    setTempStartDeg(spot.casting_start_deg ?? 45);
    setTempEndDeg(spot.casting_end_deg ?? 135);
  };

  const handleSaveCastingConfig = async () => {
    if (!castingConfigSpot || !onUpdateSpot) return;
    await onUpdateSpot({
      ...castingConfigSpot,
      casting_start_deg: tempCastingEnabled ? Math.round(tempStartDeg) % 360 : undefined,
      casting_end_deg: tempCastingEnabled ? Math.round(tempEndDeg) % 360 : undefined,
    });
    setCastingConfigSpot(null);
  };

  // [요구사항 4-4] 스윗 스폿 전용 설정 모드 열기/저장
  const handleOpenSweetSpotConfig = (spot: FishingSpot) => {
    setSweetSpotConfigSpot(spot);
    setCastingConfigSpot(null);
    setContextMenuSpot(null);
    setCenter({ lat: spot.lat, lng: spot.lng });
    setLevel(2); // 적어도 맵 거리 200m까지 확대
    setTempUseSweetSpot(spot.use_sweet_spot ?? true);
    setTempSweetSpots(spot.sweet_spots || []);
    setIsAddingSweetSpot(false);
    setSelectedNewRadius(10);
    setDraftSweetPos(null);
    setDraftSweetNote('');
    setPendingDeleteSweetIdx(null);
  };

  // [요구사항 2-1-6] 스윗 스팟 변경 시 즉시 DB 반영
  const persistSweetSpots = async (nextSpots: SweetSpot[], nextUse: boolean) => {
    setTempSweetSpots(nextSpots);
    setTempUseSweetSpot(nextUse);
    if (!sweetSpotConfigSpot || !onUpdateSpot) return;
    const updated: FishingSpot = {
      ...sweetSpotConfigSpot,
      use_sweet_spot: nextUse,
      sweet_spots: nextSpots,
    };
    setSweetSpotConfigSpot(updated);
    await onUpdateSpot(updated);
  };

  const handleStartAddSweetSpot = () => {
    if (tempSweetSpots.length >= 3) return;
    setIsAddingSweetSpot(true);
    setDraftSweetPos(null);
    setDraftSweetNote('');
    setSelectedNewRadius(10);
  };

  const handleCancelAddSweetSpot = () => {
    setIsAddingSweetSpot(false);
    setDraftSweetPos(null);
    setDraftSweetNote('');
  };

  const handleConfirmAddSweetSpot = async () => {
    if (!sweetSpotConfigSpot || !draftSweetPos || tempSweetSpots.length >= 3) return;
    const { distance, bearing } = calculateDistanceAndBearing(
      sweetSpotConfigSpot.lat,
      sweetSpotConfigSpot.lng,
      draftSweetPos.lat,
      draftSweetPos.lng
    );
    const newSpotItem: SweetSpot = {
      id: `ss-${Date.now()}`,
      direction: bearing,
      distance: Math.min(200, Math.max(1, distance)),
      radius: selectedNewRadius,
      memo: draftSweetNote.trim(),
    };
    handleCancelAddSweetSpot();
    await persistSweetSpots([...tempSweetSpots, newSpotItem], true);
  };

  const handleCloseSweetSpotConfig = () => {
    handleCancelAddSweetSpot();
    setPendingDeleteSweetIdx(null);
    setSweetSpotConfigSpot(null);
  };

  const handleSaveSweetSpotConfig = async () => {
    if (!sweetSpotConfigSpot || !onUpdateSpot) return;
    await onUpdateSpot({
      ...sweetSpotConfigSpot,
      use_sweet_spot: tempUseSweetSpot,
      sweet_spots: tempSweetSpots,
    });
    setSweetSpotConfigSpot(null);
    setIsAddingSweetSpot(false);
  };

  const handleDeleteTempSweetSpot = async (idx: number) => {
    setPendingDeleteSweetIdx(null);
    await persistSweetSpots(tempSweetSpots.filter((_, i) => i !== idx), tempUseSweetSpot);
  };

  // 현재 GPS 위치 가져오기 핸들러 (네이티브 FusedLocation & 브라우저 통합)
  const handleLocateMe = async () => {
    setIsLocating(true);
    try {
      const pos = await getNativeLocation();
      setIsLocating(false);
      const userPos = { lat: pos.lat, lng: pos.lng };
      setMyLocation(userPos);
      setGpsAccuracy(pos.accuracy || 10);
      setCenter(userPos);
      setLevel(2); // 상세 약 30m 레벨
      triggerHaptic('success');
    } catch (err) {
      setIsLocating(false);
      console.warn('Geolocation error:', err);
      alert('현재 위치 정보를 가져올 수 없습니다. GPS 및 위치 권한을 확인해 주세요.');
    }
  };

  // 초기 진입 시 사용자 위치 자동 이동 보장을 위한 플래그
  const hasAutoLocatedRef = React.useRef(false);

  React.useEffect(() => {
    if (!hasAutoLocatedRef.current) {
      hasAutoLocatedRef.current = true;
      setIsLocating(true);
      getNativeLocation()
        .then((pos) => {
          setIsLocating(false);
          const userPos = { lat: pos.lat, lng: pos.lng };
          setMyLocation(userPos);
          setGpsAccuracy(pos.accuracy || 12);
          if (spots && spots.length > 0) {
            let nearest = spots[0];
            let minDist = Infinity;
            for (const s of spots) {
              const dLat = s.lat - pos.lat;
              const dLng = (s.lng - pos.lng) * Math.cos(pos.lat * Math.PI / 180);
              const distSq = dLat * dLat + dLng * dLng;
              if (distSq < minDist) {
                minDist = distSq;
                nearest = s;
              }
            }
            setCenter({ lat: nearest.lat, lng: nearest.lng });
            setLevel(2); // 최근접 포인트 상세 레벨
          } else {
            setCenter(userPos);
            setLevel(4); // 약 100m~250m 상세 레벨
          }
        })
        .catch((err) => {
          setIsLocating(false);
          console.warn('Initial geolocation failed or denied:', err);
        });
    }
  }, []);

  // 최근 선택 타겟 또는 포인트 이동 감지
  React.useEffect(() => {
    if (recenterTarget) {
      setCenter({ lat: recenterTarget.lat, lng: recenterTarget.lng });
      if (recenterTarget.zoom) {
        const kakaoLevel = Math.max(1, Math.min(14, 18 - recenterTarget.zoom));
        setLevel(kakaoLevel);
      } else {
        setLevel(2); // 포인트 선택 시 줌 레벨 한 단계 더 확대 (레벨 2: 약 30m)
      }
    }
  }, [recenterTarget]);

  // 선택된 포인트 변경 시 센터 자동 동기화 (초기 자동 위치 이동과 충돌 방지)
  const isInitialMount = React.useRef(true);
  React.useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    if (selectedSpot && !microAdjustSpot) {
      if (skipAutoRecenterRef.current) {
        skipAutoRecenterRef.current = false;
        return;
      }
      setCenter({ lat: selectedSpot.lat, lng: selectedSpot.lng });
      setLevel(2); // 포인트 클릭 시 줌 레벨 한 단계 더 확대 (레벨 2)
      setPendingNewSpot(null);
    }
  }, [selectedSpot?.id, microAdjustSpot]);

  // 위치 미세 조정 좌표 상태 (2D 평면 드래깅 및 1m 넛지 연동)
  const [adjustedPos, setAdjustedPos] = React.useState<{ lat: number; lng: number }>({ lat: 0, lng: 0 });

  // 위치 미세 조정 모드 활성화 시 위성 스카이뷰(HYBRID) 전환, 최고 배율 줌(Level 1), 드래깅 마커 좌표 초기화
  React.useEffect(() => {
    if (microAdjustSpot) {
      setMapMode('HYBRID');
      try {
        localStorage.setItem('exfish_map_mode', 'HYBRID');
      } catch (e) {
        // ignore
      }
      setCenter({ lat: microAdjustSpot.lat, lng: microAdjustSpot.lng });
      setAdjustedPos({ lat: microAdjustSpot.lat, lng: microAdjustSpot.lng });
      setLevel(1);
      setPendingNewSpot(null);
    }
  }, [microAdjustSpot]);

  const handleNudge = (deltaLat: number, deltaLng: number) => {
    triggerHaptic('light');
    setAdjustedPos((prev) => {
      const next = {
        lat: Number((prev.lat + deltaLat).toFixed(7)),
        lng: Number((prev.lng + deltaLng).toFixed(7)),
      };
      setCenter(next);
      return next;
    });
  };

  // 원본 위치 대비 이동 거리(미터) 계산
  const distMeters = microAdjustSpot
    ? Math.hypot(
        (adjustedPos.lat - microAdjustSpot.lat) * 111000,
        (adjustedPos.lng - microAdjustSpot.lng) * 88800
      )
    : 0;

  // 카카오맵 기준 고배율 줌 레벨 (level 1, 2, 3, 4 = 현장 20m~100m 상세도)에서만 캐스팅 화살표 표시
  const showCastingArrows = level <= 4;

  // 찜한 포인트 필터 적용 목록
  const displayedSpots = viewOnlyFavorites
    ? spots.filter((s) => favoriteSpotIds.includes(s.id))
    : spots;

  if (loading) {
    return (
      <div className="w-full h-full bg-slate-950 flex flex-col items-center justify-center text-slate-300 gap-3">
        <div className="w-8 h-8 border-3 border-cyan-400 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-semibold">카카오 맵 고해상도 해양 지도를 불러오는 중...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full bg-slate-950 flex flex-col items-center justify-center p-6 text-center text-rose-300 gap-3">
        <div className="w-12 h-12 rounded-full bg-red-600 border-2 border-white shadow-xl shadow-red-600/50 flex items-center justify-center text-white font-black text-2xl animate-pulse">
          !
        </div>
        <h3 className="text-base font-bold text-white">카카오 맵 API 활성화 안내</h3>
        <div className="text-xs text-slate-300 max-w-lg leading-relaxed bg-slate-900 border border-slate-800 p-4 rounded-xl text-left space-y-2 shadow-xl">
          <p className="font-semibold text-amber-300">
            ⚠️ 카카오 개발자 콘솔에서 <strong>[지도/로컬]</strong> 서비스 활성화가 필요합니다:
          </p>
          <ol className="list-decimal list-inside space-y-1.5 text-slate-300">
            <li>
              <a
                href="https://developers.kakao.com/console/app"
                target="_blank"
                rel="noreferrer"
                className="text-cyan-400 underline font-bold"
              >
                developers.kakao.com
              </a>{' '}
              접속 → <strong>ExFish</strong> 애플리케이션 선택
            </li>
            <li>
              좌측 사이드바 <strong>[제품 설정] → [지도/로컬]</strong> 메뉴 이동
            </li>
            <li>
              <strong>[활성화 설정]</strong> 토글을 <strong>[ON (활성화)]</strong>으로 켜기
            </li>
            <li>
              <strong>[앱 설정] → [플랫폼] → [Web 플랫폼]</strong> 사이트 도메인에 아래 4개 주소 등록:
              <div className="mt-1.5 grid grid-cols-1 gap-1 text-[11px] font-mono bg-slate-950 p-2.5 rounded border border-slate-800">
                <span className="text-amber-200">https://localhost</span>
                <span className="text-amber-200">http://localhost</span>
                <span className="text-cyan-300">https://tlogger.github.io</span>
                <span className="text-cyan-300">http://localhost:5173</span>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                * 안드로이드 앱(웹뷰)은 <code className="text-amber-300">https://localhost</code> 도메인으로 카카오 인증을 요청하므로 필수 등록해야 합니다.
              </p>
            </li>
          </ol>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-bold transition shadow mt-1"
        >
          설정 완료 후 새로고침 (다시 시도)
        </button>
      </div>
    );
  }

  // 실제 카카오 맵 mapTypeId (스카이뷰 또는 하이브리드)
  const kakaoMapTypeId = mapMode === 'HYBRID' ? 'HYBRID' : 'ROADMAP';
  const isDarkMode = mapMode === 'DARK';

  return (
    <div
      ref={mapContainerRef}
      data-digital-zoom={digitalZoom.toFixed(1)}
      className={`relative w-full h-full bg-slate-950 overflow-hidden kakao-map-container ${
        isDarkMode ? 'kakao-dark-mode' : ''
      } ${isSunMode ? 'exfish-sun-mode' : ''}`}
    >
      {/* [요구사항 1, 2, 5] Level 1 상태에서 2단계 추가 디지털 줌 (1.8x, 3.0x) 지원 래퍼 및 픽셀 드래그 오차 100% 정밀 보정 */}
      <div
        className="w-full h-full transition-transform duration-200 origin-center select-none"
        style={{
          transform: digitalZoom > 1.0 ? `scale(${digitalZoom})` : 'none',
          transformOrigin: 'center center',
          touchAction: digitalZoom > 1.0 ? 'none' : 'auto',
          cursor: digitalZoom > 1.0 ? (dragTrackerRef.current.isDragging ? 'grabbing' : 'grab') : 'default',
        }}
        onDragStart={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (e.button !== 0 && e.pointerType === 'mouse') return;
          if (digitalZoom > 1.0) {
            try {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            } catch {}
          }
          handlePointerDown(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          handlePointerMove(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          try {
            if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
              (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
            }
          } catch {}
          handlePointerUp();
        }}
        onPointerCancel={(e) => {
          try {
            if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
              (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
            }
          } catch {}
          handlePointerUp();
        }}
        onTouchStart={(e) => {
          activeTouchCountRef.current = e.touches.length;
          if (e.touches.length > 1) {
            lastMultiTouchAtRef.current = Date.now();
            if (longPressTimerRef.current) {
              clearTimeout(longPressTimerRef.current);
              longPressTimerRef.current = null;
            }
          }
          if (e.touches.length === 1) {
            handlePointerDown(e.touches[0].clientX, e.touches[0].clientY);
          }
        }}
        onTouchMove={(e) => {
          activeTouchCountRef.current = e.touches.length;
          if (e.touches.length > 1) {
            lastMultiTouchAtRef.current = Date.now();
            if (longPressTimerRef.current) {
              clearTimeout(longPressTimerRef.current);
              longPressTimerRef.current = null;
            }
          }
          if (e.touches.length === 1) {
            handlePointerMove(e.touches[0].clientX, e.touches[0].clientY);
          }
        }}
        onTouchEnd={(e) => {
          activeTouchCountRef.current = e.touches.length;
          if (e.touches.length > 0) {
            lastMultiTouchAtRef.current = Date.now();
          }
          handlePointerUp();
        }}
        onTouchCancel={() => {
          activeTouchCountRef.current = 0;
          lastMultiTouchAtRef.current = Date.now();
          handlePointerUp();
        }}
        onWheel={(e) => {
          if (level === 1) {
            if (e.deltaY < 0 && digitalZoom < 3.0) {
              handleZoomIn();
            } else if (e.deltaY > 0 && digitalZoom > 1.0) {
              handleZoomOut();
            }
          }
        }}
      >
        <Map
          onCreate={(map) => {
            mapRef.current = map;
          }}
          draggable={digitalZoom === 1.0}
          center={center}
          level={level}
          mapTypeId={kakaoMapTypeId}
          style={{ width: '100%', height: '100%' }}
          onClick={(_target, mouseEvent) => {
            // 마커나 팝업 클릭 시 지도 클릭 핸들러가 발화되는 관통 현상 원천 차단
            if (isMarkerClickRef.current) {
              isMarkerClickRef.current = false;
              return;
            }
            // 디지털 줌 드래그 중 실수 클릭 차단
            if (dragTrackerRef.current.totalDist > 6) {
              dragTrackerRef.current.totalDist = 0;
              return;
            }

            const latLng = mouseEvent.latLng;
            let clickedLat = latLng.getLat();
            let clickedLng = latLng.getLng();

            // [요구사항 4] 디지털 줌 상태에서는 CSS scale 역산을 통해 실제 클릭/터치한 정확한 위경도 산출
            if (digitalZoom > 1.0) {
              const domEv = (mouseEvent as any).domEvent;
              const clickX = domEv?.clientX ?? lastClientPosRef.current.x;
              const clickY = domEv?.clientY ?? lastClientPosRef.current.y;
              if (clickX > 0) {
                const corrected = getCorrectLatLngFromClient(clickX, clickY);
                if (corrected) {
                  clickedLat = corrected.lat;
                  clickedLng = corrected.lng;
                }
              }
            }

            // [요구사항 2-1-6] 스윗 스팟 추가 모드: 지도를 누를 때마다 초안 위치 변경 ('추가' 버튼으로 최종 승인)
            if (sweetSpotConfigSpot && isAddingSweetSpot) {
              setDraftSweetPos({ lat: clickedLat, lng: clickedLng });
              return;
            }

            // 컨텍스트 메뉴 닫기
            if (contextMenuSpot) {
              setContextMenuSpot(null);
            }

            // 캐스팅/스윗스팟 설정 모드 중에는 새 포인트 등록 핀 방지
            if (castingConfigSpot || sweetSpotConfigSpot) {
              return;
            }

            // 지도 빈 공간 클릭 시 바로 모달을 열지 않고 '미니 확인 팝업'을 띄워 실수 터치 방지
            setPendingNewSpot({ lat: clickedLat, lng: clickedLng });
          }}
        onZoomChanged={(target) => {
          setLevel(target.getLevel());
        }}
        onCenterChanged={(target) => {
          const latLng = target.getCenter();
          setCenter({ lat: latLng.getLat(), lng: latLng.getLng() });
        }}
      >
        {/* [요구사항 4] 조위합성 등고선 표시 기능 당분간 중단 및 렌더링 비활성화 */}
        {null}

        {/* 선택된 포인트의 캐스팅 비거리 동심원 눈금 링 및 유효 공략 부채꼴 섹터 (채비 캘리브레이션 거리 반영) */}
        {showCastingArrows && (selectedSpot || castingConfigSpot) && (() => {
          const targetSpot = castingConfigSpot || selectedSpot;
          if (!targetSpot) return null;

          let startDeg = targetSpot.casting_start_deg;
          let endDeg = targetSpot.casting_end_deg;

          // [요구사항 4-3] 캐스팅 방향 설정 모드 실시간 각도 반영
          if (castingConfigSpot) {
            if (!tempCastingEnabled) return null;
            startDeg = tempStartDeg;
            endDeg = tempEndDeg;
          } else {
            // 레거시 하위 호환 매핑
            if (startDeg === undefined || endDeg === undefined) {
              const dirs = targetSpot.casting_directions || [];
              if (dirs.length > 0 && !dirs.includes('ALL')) {
                const info = CASTING_BEARINGS[dirs[0]];
                if (info) {
                  startDeg = (info.deg - 30 + 360) % 360;
                  endDeg = (info.deg + 30) % 360;
                }
              }
            }
          }

          if (startDeg === undefined || endDeg === undefined) {
            return null;
          }

          const span = endDeg >= startDeg ? endDeg - startDeg : 360 - startDeg + endDeg;
          const centerBearing = (startDeg + span / 2) % 360;
          const radii = tackleConfig.radii;
          const maxRadius = radii[2];

          // 좌우 유효 경계선 (최대 비거리 지점까지 뻗어나가는 레이더 가이드 선)
          const leftEdge = calculateDestinationPoint(targetSpot.lat, targetSpot.lng, startDeg, maxRadius);
          const rightEdge = calculateDestinationPoint(targetSpot.lat, targetSpot.lng, endDeg, maxRadius);

          // [요구사항 4-3, 4-4] 설정 모드 중에는 비거리/풍속/조류 HUD를 숨김
          const isSpecialMode = Boolean(castingConfigSpot || sweetSpotConfigSpot);

          return (
            <React.Fragment key={`range-sector-${targetSpot.id}`}>
              {/* 시작각 경계선 */}
              <Polyline
                path={[
                  { lat: targetSpot.lat, lng: targetSpot.lng },
                  { lat: leftEdge[0], lng: leftEdge[1] },
                ]}
                strokeWeight={1.5}
                strokeColor="#10b981"
                strokeOpacity={0.65}
                strokeStyle="dash"
                zIndex={28}
              />

              {/* 종료각 경계선 */}
              <Polyline
                path={[
                  { lat: targetSpot.lat, lng: targetSpot.lng },
                  { lat: rightEdge[0], lng: rightEdge[1] },
                ]}
                strokeWeight={1.5}
                strokeColor="#06b6d4"
                strokeOpacity={0.65}
                strokeStyle="dash"
                zIndex={28}
              />

              {/* 거리(30m / 60m / 100m)별 부채꼴 호 및 거리 라벨 오버레이 */}
              {radii.map((r, rIdx) => {
                const step = Math.max(1, Math.min(3, Math.round(span / 25)));
                const arcPoints: { lat: number; lng: number }[] = [];
                for (let offset = 0; offset <= span; offset += step) {
                  const b = (startDeg! + offset) % 360;
                  const [pLat, pLng] = calculateDestinationPoint(targetSpot.lat, targetSpot.lng, b, r);
                  arcPoints.push({ lat: pLat, lng: pLng });
                }
                const [endLat, endLng] = calculateDestinationPoint(targetSpot.lat, targetSpot.lng, endDeg!, r);
                arcPoints.push({ lat: endLat, lng: endLng });

                // 호 중심 지점에 거리 m 표기 오버레이
                const [labelLat, labelLng] = calculateDestinationPoint(targetSpot.lat, targetSpot.lng, centerBearing, r);

                return (
                  <React.Fragment key={`arc-r-${targetSpot.id}-${r}`}>
                    <Polyline
                      path={arcPoints}
                      strokeWeight={rIdx === 0 ? 2 : 1.5}
                      strokeColor="#06b6d4"
                      strokeOpacity={rIdx === 0 ? 0.85 : rIdx === 1 ? 0.6 : 0.4}
                      strokeStyle="dash"
                      zIndex={30}
                    />
                    <CustomOverlayMap
                      position={{ lat: labelLat, lng: labelLng }}
                      yAnchor={0.5}
                      xAnchor={0.5}
                      zIndex={35}
                      clickable={false}
                    >
                      <div className="px-1.5 py-0.5 rounded-full bg-slate-950/90 text-cyan-300 border border-cyan-400/60 text-[9px] font-bold font-mono shadow-md backdrop-blur-xs select-none pointer-events-none kakao-invert-restore whitespace-nowrap">
                        {r}m
                      </div>
                    </CustomOverlayMap>
                  </React.Fragment>
                );
              })}
            </React.Fragment>
          );
        })()}

        {/* 선택된 포인트의 파란색 캐스팅 방향 화살표 + 실시간 바람·조류 상호작용 HUD (설정 모드 시 비거리/풍속/조류 HUD 제거) */}
        {showCastingArrows && selectedSpot && !castingConfigSpot && !sweetSpotConfigSpot && (() => {
          let startDeg = selectedSpot.casting_start_deg;
          let endDeg = selectedSpot.casting_end_deg;

          // 레거시 하위 호환 매핑
          if (startDeg === undefined || endDeg === undefined) {
            const dirs = selectedSpot.casting_directions || [];
            if (dirs.length > 0 && !dirs.includes('ALL')) {
              const info = CASTING_BEARINGS[dirs[0]];
              if (info) {
                startDeg = (info.deg - 30 + 360) % 360;
                endDeg = (info.deg + 30) % 360;
              }
            }
          }

          // [요구사항 2-4] 캐스팅 방향이 없으면(보이지 않으면) 예상 비거리 관련 표시 생략, 풍향·풍속·조류는 유지
          const hasCasting = startDeg !== undefined && endDeg !== undefined;

          if (startDeg === undefined || endDeg === undefined) {
            startDeg = 45;
            endDeg = 135;
          }

          const span = endDeg >= startDeg ? endDeg - startDeg : 360 - startDeg + endDeg;
          const bearing = (startDeg + span / 2) % 360; // 중심 방위각

          const baseDist = tackleConfig.calibratedDistanceMeters;
          const tipDist = Math.max(20, Math.round(baseDist * 0.9));
          const tip = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, bearing, tipDist);
          const badgePos = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, bearing, tipDist + 4);

          // 착수 지점 수심 선형 추정 (KHOA 국가해양격자 수심 모델 기반)
          const landingDepth = estimateDepthAtPoint(
            selectedSpot.lat,
            selectedSpot.lng,
            tip[0],
            tip[1],
            selectedSpot.spot_type
          );

          // 수중 침강 물리 및 조류 연동 바닥 안착 소요 시간/흘림 계산
          const currentVel = marine?.currentVelocity ?? 0.3;
          const sinkPhysics = calculateSinkingPhysics(tackleConfig.weightGrams, landingDepth, currentVel);

          const castingLines = (
            <React.Fragment key={`selected-casting-${selectedSpot.id}`}>
              <Polyline
                path={[
                  { lat: selectedSpot.lat, lng: selectedSpot.lng },
                  { lat: tip[0], lng: tip[1] },
                ]}
                endArrow={true}
                strokeWeight={4.5}
                strokeColor="#2563eb"
                strokeOpacity={0.95}
                zIndex={50}
              />
              <CustomOverlayMap
                position={{ lat: badgePos[0], lng: badgePos[1] }}
                yAnchor={0.5}
                xAnchor={0.5}
                zIndex={55}
                clickable={false}
              >
                <div className="flex flex-col items-center gap-1 pointer-events-none kakao-invert-restore select-none whitespace-nowrap">
                  <div className="px-2 py-0.5 rounded-full bg-slate-950/95 text-cyan-300 border border-cyan-500/80 text-[9px] sm:text-[10px] font-mono font-bold shadow-lg flex items-center gap-1.5">
                    <span>🌊 착수수심: -{landingDepth}m</span>
                    <span className="text-slate-500">|</span>
                    <span className="text-amber-300">⏱️ 바닥 안착: 약 {sinkPhysics.fallTimeSec}초</span>
                    {sinkPhysics.driftDistanceM > 0.3 && (
                      <>
                        <span className="text-slate-500">|</span>
                        <span className="text-emerald-300">조류 흘림 +{sinkPhysics.driftDistanceM}m</span>
                      </>
                    )}
                  </div>
                </div>
              </CustomOverlayMap>
            </React.Fragment>
          );

          // 2. 실시간 풍향·풍속 및 합사줄(PE) 길이/두께 + 지그헤드/2인치 쉐드 웜 채비 공기역학 편류(밀림) 오렌지 라인
          // weather.windDirection: 바람이 불어오는 방위 (From)
          // windVectorDeg: 바람이 불어가는 진행 방위 (To) = (windDirection + 180) % 360
          let windElements = null;
          if (weather) {
            const windVectorDeg = (weather.windDirection + 180) % 360;
            const rigWeight = tackleConfig.weightGrams;
            const peLine = tackleConfig.peLineSize;

            // 공략각 시점, 중간, 종점 3개 포인트에 대한 정밀 편류(Drift) 물리 계산
            const midDeg = (startDeg + span / 2) % 360;
            const driftStart = calculateAerodynamicCastingDrift(startDeg, baseDist, weather.windSpeed, weather.windDirection, rigWeight, peLine, 2.0);
            const driftMid = calculateAerodynamicCastingDrift(midDeg, baseDist, weather.windSpeed, weather.windDirection, rigWeight, peLine, 2.0);
            const driftEnd = calculateAerodynamicCastingDrift(endDeg, baseDist, weather.windSpeed, weather.windDirection, rigWeight, peLine, 2.0);

            // 공략각 시점~종점 전체 구간에서 바람/합사줄에 의해 밀린 실제 착수 지점들을 이은 오렌지색 arc 폴리라인 생성
            const orangeArcPts: { lat: number; lng: number }[] = [];
            const targetArcPts: { lat: number; lng: number }[] = [];
            const arcStep = Math.max(1, Math.min(3, Math.round(span / 30)));
            for (let offset = 0; offset <= span; offset += arcStep) {
              const b = (startDeg + offset) % 360;
              const dRes = calculateAerodynamicCastingDrift(b, baseDist, weather.windSpeed, weather.windDirection, rigWeight, peLine, 2.0);
              // 실제 밀린 착수 좌표
              const [pActualLat, pActualLng] = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, dRes.actualBearingDeg, dRes.actualDistanceM);
              orangeArcPts.push({ lat: pActualLat, lng: pActualLng });
              // 원래 목표했던 착수 좌표 (보조 기준선)
              const [pTargetLat, pTargetLng] = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, b, dRes.targetDistanceM);
              targetArcPts.push({ lat: pTargetLat, lng: pTargetLng });
            }
            // 종점 마무리 포인트
            const [pEndActualLat, pEndActualLng] = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, driftEnd.actualBearingDeg, driftEnd.actualDistanceM);
            orangeArcPts.push({ lat: pEndActualLat, lng: pEndActualLng });
            const [pEndTargetLat, pEndTargetLng] = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, endDeg, driftEnd.targetDistanceM);
            targetArcPts.push({ lat: pEndTargetLat, lng: pEndTargetLng });

            // 3개 포인트의 실제 밀린 착수 좌표 (오렌지 라인 위에 위치)
            const ptStartActual = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, driftStart.actualBearingDeg, driftStart.actualDistanceM);
            const ptMidActual = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, driftMid.actualBearingDeg, driftMid.actualDistanceM);
            const ptEndActual = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, driftEnd.actualBearingDeg, driftEnd.actualDistanceM);

            // 3개 포인트의 원래 목표 좌표
            const ptStartTarget = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, startDeg, driftStart.targetDistanceM);
            const ptMidTarget = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, midDeg, driftMid.targetDistanceM);
            const ptEndTarget = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, endDeg, driftEnd.targetDistanceM);

            // 바람 진행 벡터 화살표 (바람이 불어가는 방향으로 45m 뻗어감)
            const windTip = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, windVectorDeg, 45);
            const windBadgePos = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, windVectorDeg, 48);

            windElements = (
              <React.Fragment key={`wind-physics-${selectedSpot.id}`}>
                {/* 1. 바람 진행 벡터 화살표 ([요구사항 7] 바람 화살표 두께 축소 3.5 -> 2.2) */}
                <Polyline
                  path={[
                    { lat: selectedSpot.lat, lng: selectedSpot.lng },
                    { lat: windTip[0], lng: windTip[1] },
                  ]}
                  endArrow={true}
                  strokeWeight={2.2}
                  strokeColor="#38bdf8"
                  strokeOpacity={0.9}
                  zIndex={45}
                />
                <CustomOverlayMap
                  position={{ lat: windBadgePos[0], lng: windBadgePos[1] }}
                  yAnchor={0.5}
                  xAnchor={0.5}
                  zIndex={55}
                  clickable={false}
                >
                  <div className="px-2 py-0.5 rounded-full text-[9px] font-bold font-mono shadow-xl border pointer-events-none kakao-invert-restore select-none whitespace-nowrap flex items-center gap-1 bg-slate-950/95 text-cyan-300 border-cyan-400/80">
                    <span>💨 {getWindDirectionKor(weather.windDirection)}({getWindFlowDescKor(weather.windDirection)}) {formatWindSpeed(weather.windSpeed, windUnit)}</span>
                  </div>
                </CustomOverlayMap>

                {hasCasting && (<>
                {/* 2. 바람 없을 때의 원래 목표 호선 (은은한 점선 기준선) */}
                <Polyline
                  path={targetArcPts}
                  strokeWeight={1.5}
                  strokeColor="#94a3b8"
                  strokeOpacity={0.35}
                  strokeStyle="dashed"
                  zIndex={41}
                />

                {/* 3. 목표 지점 -> 실제 착수 지점 사이의 밀림 편류 가이드 선 (밀림 1m 이상 시 표시) */}
                {[
                  { target: ptStartTarget, actual: ptStartActual, drift: driftStart },
                  { target: ptMidTarget, actual: ptMidActual, drift: driftMid },
                  { target: ptEndTarget, actual: ptEndActual, drift: driftEnd },
                ].map((item, idx) =>
                  item.drift.driftDistanceM >= 1.0 ? (
                    <Polyline
                      key={`drift-offset-${idx}`}
                      path={[
                        { lat: item.target[0], lng: item.target[1] },
                        { lat: item.actual[0], lng: item.actual[1] },
                      ]}
                      strokeWeight={1.5}
                      strokeColor="#fbbf24"
                      strokeOpacity={0.7}
                      strokeStyle="dashed"
                      zIndex={43}
                    />
                  ) : null
                )}

                {/* 4. 풍향·풍속 및 합사/채비 공기역학으로 밀린 실제 착수 오렌지색 arc */}
                <Polyline
                  path={orangeArcPts}
                  strokeWeight={3.5}
                  strokeColor="#f97316"
                  strokeOpacity={0.95}
                  zIndex={42}
                />

                {/* 5. 시점 착수점 배지 (오렌지 라인 위에 정확히 표시) */}
                <CustomOverlayMap
                  position={{ lat: ptStartActual[0], lng: ptStartActual[1] }}
                  yAnchor={0.5}
                  xAnchor={0.5}
                  zIndex={48}
                  clickable={false}
                >
                  <div className="px-2.5 py-1 rounded-full bg-slate-950/95 text-orange-400 border border-orange-500 font-extrabold font-mono text-xs sm:text-sm shadow-xl pointer-events-none kakao-invert-restore select-none whitespace-nowrap flex items-center gap-1.5">
                    <span>{driftStart.actualDistanceM}m</span>
                    {driftStart.driftDistanceM >= 1.0 && (
                      <span className="text-[10.5px] text-amber-300 font-semibold">
                        ({driftStart.driftAngleDeg > 0 ? '우' : '좌'} {driftStart.driftDistanceM}m)
                      </span>
                    )}
                  </div>
                </CustomOverlayMap>

                {/* 6. 중간 착수점 배지 */}
                <CustomOverlayMap
                  position={{ lat: ptMidActual[0], lng: ptMidActual[1] }}
                  yAnchor={0.5}
                  xAnchor={0.5}
                  zIndex={48}
                  clickable={false}
                >
                  <div className="px-2.5 py-1 rounded-full bg-slate-950/95 text-orange-400 border border-orange-500 font-extrabold font-mono text-xs sm:text-sm shadow-xl pointer-events-none kakao-invert-restore select-none whitespace-nowrap flex items-center gap-1.5">
                    <span>{driftMid.actualDistanceM}m</span>
                    {driftMid.driftDistanceM >= 1.0 && (
                      <span className="text-[10.5px] text-amber-300 font-semibold">
                        ({driftMid.driftAngleDeg > 0 ? '우' : '좌'} {driftMid.driftDistanceM}m)
                      </span>
                    )}
                  </div>
                </CustomOverlayMap>

                {/* 7. 종점 착수점 배지 */}
                <CustomOverlayMap
                  position={{ lat: ptEndActual[0], lng: ptEndActual[1] }}
                  yAnchor={0.5}
                  xAnchor={0.5}
                  zIndex={48}
                  clickable={false}
                >
                  <div className="px-2.5 py-1 rounded-full bg-slate-950/95 text-orange-400 border border-orange-500 font-extrabold font-mono text-xs sm:text-sm shadow-xl pointer-events-none kakao-invert-restore select-none whitespace-nowrap flex items-center gap-1.5">
                    <span>{driftEnd.actualDistanceM}m</span>
                    {driftEnd.driftDistanceM >= 1.0 && (
                      <span className="text-[10.5px] text-amber-300 font-semibold">
                        ({driftEnd.driftAngleDeg > 0 ? '우' : '좌'} {driftEnd.driftDistanceM}m)
                      </span>
                    )}
                  </div>
                </CustomOverlayMap>
                </>)}
              </React.Fragment>
            );
          }

          // 3. 실시간 조류 흘림선 (Drift Path)
          // [요구사항 6] 조류 흘림은 바람 화살표 끝(windTip)에서 합성 벡터로 이어서 표시
          let currentElements = null;
          if (marine && (marine.currentVelocity ?? 0) > 0.05) {
            let driftStartPt: [number, number];
            if (weather) {
              const wDeg = (weather.windDirection + 180) % 360;
              driftStartPt = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, wDeg, 45);
            } else {
              driftStartPt = [selectedSpot.lat, selectedSpot.lng];
            }

            const driftDist = Math.max(18, Math.min(45, (marine.currentVelocity ?? 0.3) * 65));
            const driftEnd = calculateDestinationPoint(driftStartPt[0], driftStartPt[1], marine.currentDirection, driftDist);
            const driftMid = calculateDestinationPoint(driftStartPt[0], driftStartPt[1], marine.currentDirection, driftDist * 0.5);

            currentElements = (
              <React.Fragment key={`drift-path-${selectedSpot.id}`}>
                <Polyline
                  path={[
                    { lat: driftStartPt[0], lng: driftStartPt[1] },
                    { lat: driftEnd[0], lng: driftEnd[1] },
                  ]}
                  endArrow={true}
                  strokeWeight={2.2}
                  strokeColor="#06b6d4"
                  strokeOpacity={0.9}
                  strokeStyle="shortdash"
                  zIndex={46}
                />
                <CustomOverlayMap
                  position={{ lat: driftMid[0], lng: driftMid[1] }}
                  yAnchor={0.5}
                  xAnchor={0.5}
                  zIndex={56}
                  clickable={false}
                >
                  <div className="px-1.5 py-0.5 rounded-full bg-slate-950/95 text-cyan-300 border border-cyan-500/70 text-[9px] font-bold shadow-md pointer-events-none kakao-invert-restore select-none whitespace-nowrap">
                    🌊 조류 ({formatCurrentVelocity(marine.currentVelocity, currentUnit)}, {getCurrentDirectionKor(marine.currentDirection)})
                  </div>
                </CustomOverlayMap>
              </React.Fragment>
            );
          }

          return (
            <React.Fragment key={`selected-hud-${selectedSpot.id}`}>
              {hasCasting && castingLines}
              {windElements}
              {currentElements}
            </React.Fragment>
          );
        })()}

        {/* 🎯 스위트 스팟 (Sweet Spot) 오버레이 렌더링 (요구사항 4-4 및 5-7-4) */}
        {(() => {
          const isConfig = !!sweetSpotConfigSpot;
          const target = sweetSpotConfigSpot || selectedSpot;
          if (!target) return null;
          const isEnabled = isConfig ? tempUseSweetSpot : (target.use_sweet_spot ?? false);
          const spots = isConfig ? tempSweetSpots : (target.sweet_spots || []);
          if (!isEnabled || spots.length === 0) return null;

          return (
            <React.Fragment key={`sweet-spots-group-${target.id}-${isConfig ? 'cfg' : 'view'}`}>
              {spots.map((ss, idx) => {
                const [targetLat, targetLng] = calculateDestinationPoint(
                  target.lat,
                  target.lng,
                  ss.direction,
                  ss.distance
                );

                return (
                  <React.Fragment key={`sweet-spot-${target.id}-${ss.id || idx}`}>
                    {/* 스위트 스팟 반경 원 */}
                    <Circle
                      center={{ lat: targetLat, lng: targetLng }}
                      radius={ss.radius}
                      strokeWeight={2}
                      strokeColor="#f59e0b"
                      strokeOpacity={0.9}
                      strokeStyle="solid"
                      fillColor="#f59e0b"
                      fillOpacity={0.35}
                      zIndex={38}
                    />

                    {/* 포인트 -> 스위트스팟 연결 점선 */}
                    <Polyline
                      path={[
                        { lat: target.lat, lng: target.lng },
                        { lat: targetLat, lng: targetLng },
                      ]}
                      strokeWeight={1.5}
                      strokeColor="#f59e0b"
                      strokeOpacity={0.65}
                      strokeStyle="dash"
                      zIndex={37}
                    />

                    {/* 스위트 스팟 번호 & 거리 & 반경 배지 오버레이 (설정 모드 시 삭제 아이콘 포함) */}
                    <CustomOverlayMap
                      position={{ lat: targetLat, lng: targetLng }}
                      yAnchor={0.5}
                      xAnchor={0.5}
                      zIndex={40}
                      clickable={true}
                    >
                      {(() => {
                        const ssKey = ss.id || `idx-${idx}`;
                        const isExpanded = expandedSweetId === ssKey;
                        const memo = ss.memo || '';
                        const shortMemo = memo.length > 10 ? `${memo.slice(0, 10)}…` : memo;
                        return (
                          <div
                            className="flex flex-col items-center select-none kakao-invert-restore whitespace-nowrap animate-in fade-in zoom-in-75 duration-200 cursor-pointer"
                            onMouseEnter={() => setExpandedSweetId(ssKey)}
                            onMouseLeave={() => setExpandedSweetId((prev) => (prev === ssKey ? null : prev))}
                            onClick={(e) => {
                              e.stopPropagation();
                              isMarkerClickRef.current = true;
                              setExpandedSweetId((prev) => (prev === ssKey ? null : ssKey));
                            }}
                          >
                            <div className="px-1.5 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black shadow-lg border border-white/80 flex items-center gap-1.5">
                              <span>{ss.distance}m</span>
                              {shortMemo && !isExpanded && <span className="font-semibold">{shortMemo}</span>}
                              {isConfig && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    isMarkerClickRef.current = true;
                                    setPendingDeleteSweetIdx(idx);
                                  }}
                                  className="ml-0.5 px-1 py-0.2 rounded bg-rose-600 hover:bg-rose-700 text-white font-bold text-[9px] shadow active:scale-95 transition pointer-events-auto cursor-pointer"
                                  title="스윗 스팟 삭제"
                                >
                                  ✕ 삭제
                                </button>
                              )}
                            </div>
                            {isExpanded && memo && (
                              <div className="mt-0.5 px-2 py-1 rounded-lg bg-slate-950/95 text-amber-200 border border-amber-500/60 text-[10px] font-medium shadow-lg max-w-[200px] whitespace-normal break-words text-center">
                                {memo}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </CustomOverlayMap>
                  </React.Fragment>
                );
              })}
            </React.Fragment>
          );
        })()}

        {/* [요구사항 2-1-6] 추가 중인 스윗 스팟 초안 미리보기 (지도를 누를 때마다 위치 갱신) */}
        {sweetSpotConfigSpot && isAddingSweetSpot && draftSweetPos && (
          <React.Fragment key="sweet-spot-draft">
            <Circle
              center={draftSweetPos}
              radius={selectedNewRadius}
              strokeWeight={2.5}
              strokeColor="#fde047"
              strokeOpacity={1}
              strokeStyle="dash"
              fillColor="#fde047"
              fillOpacity={0.3}
              zIndex={39}
            />
            <Polyline
              path={[{ lat: sweetSpotConfigSpot.lat, lng: sweetSpotConfigSpot.lng }, draftSweetPos]}
              strokeWeight={1.5}
              strokeColor="#fde047"
              strokeOpacity={0.8}
              strokeStyle="dash"
              zIndex={37}
            />
            <CustomOverlayMap position={draftSweetPos} yAnchor={0.5} xAnchor={0.5} zIndex={41} clickable={false}>
              <div className="px-1.5 py-0.5 rounded-full bg-yellow-300 text-slate-950 text-[10px] font-black shadow-lg border border-white pointer-events-none kakao-invert-restore whitespace-nowrap">
                {calculateDistanceAndBearing(sweetSpotConfigSpot.lat, sweetSpotConfigSpot.lng, draftSweetPos.lat, draftSweetPos.lng).distance}m
              </div>
            </CustomOverlayMap>
          </React.Fragment>
        )}

        {/* 내 현재 GPS 위치 마커 & 수평 오차 반경 원 (Virtual Crosshair Accuracy Circle) */}
        {myLocation && (
          <React.Fragment key="my-location-group">
            {gpsAccuracy && gpsAccuracy > 0 && (
              <Circle
                center={myLocation}
                radius={gpsAccuracy}
                strokeWeight={1}
                strokeColor="#06b6d4"
                strokeOpacity={0.8}
                strokeStyle="dash"
                fillColor="#06b6d4"
                fillOpacity={0.12}
                zIndex={85}
              />
            )}
            <CustomOverlayMap
              position={{ lat: myLocation.lat, lng: myLocation.lng }}
              yAnchor={0.5}
              xAnchor={0.5}
              zIndex={90}
              clickable={true}
            >
              <div
                className="relative flex items-center justify-center kakao-invert-restore cursor-pointer"
                title={`현재 내 위치 (GPS 오차 반경 약 ±${Math.round(gpsAccuracy || 10)}m)`}
              >
                <div className="w-6 h-6 rounded-full bg-blue-500/30 animate-ping absolute" />
                <div className="w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow-lg" />
              </div>
            </CustomOverlayMap>
          </React.Fragment>
        )}

        {/* 지도 빈 공간 클릭 시: 새 포인트 등록 위치 표시 핑 마커 */}
        {pendingNewSpot && (
          <CustomOverlayMap
            position={pendingNewSpot}
            yAnchor={0.5}
            xAnchor={0.5}
            zIndex={290}
            clickable={false}
          >
            <div className="relative flex items-center justify-center pointer-events-none kakao-invert-restore">
              <div className="w-9 h-9 rounded-full bg-cyan-400/40 animate-ping absolute" />
              <div className="w-7 h-7 rounded-full bg-cyan-500 border-2 border-white shadow-2xl flex items-center justify-center text-sm">
                📍
              </div>
            </div>
          </CustomOverlayMap>
        )}

        {/* 등록된 포인트 커스텀 핀 오버레이 (요구사항: 아이콘 하단 미세조정/상세보기 아이콘 제거, 짧은클릭=상세보기, 더블/롱클릭=컨텍스트메뉴) */}
        {displayedSpots.map((spot) => {
          // 미세 조정 대상 포인트는 드래깅 전용 MapMarker로 별도 렌더링
          if (microAdjustSpot?.id === spot.id) return null;

          const isSelected = selectedSpot?.id === spot.id;
          const isFavorited = favoriteSpotIds.includes(spot.id);

          return (
            <React.Fragment key={`spot-group-${spot.id}`}>
              <CustomOverlayMap
                position={{ lat: spot.lat, lng: spot.lng }}
                xAnchor={0.5}
                yAnchor={0.5}
                zIndex={isSelected ? 100 : 20}
                clickable={true}
              >
                <div
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    isLongPressTriggeredRef.current = false;
                    // [요구사항 1-2] 핀치 줌(멀티터치) 중에는 롱프레스 메뉴 비활성화
                    if (activeTouchCountRef.current > 1 || Date.now() - lastMultiTouchAtRef.current < 600) {
                      return;
                    }
                    pressStartPosRef.current = { x: e.clientX, y: e.clientY };
                    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                    longPressTimerRef.current = setTimeout(() => {
                      longPressTimerRef.current = null;
                      if (activeTouchCountRef.current > 1 || Date.now() - lastMultiTouchAtRef.current < 600) return;
                      isLongPressTriggeredRef.current = true;
                      isMarkerClickRef.current = true;
                      handleOpenContextMenu(spot);
                      triggerHaptic('medium');
                    }, 500);
                  }}
                  onPointerMove={(e) => {
                    const start = pressStartPosRef.current;
                    if (start && longPressTimerRef.current && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) {
                      clearTimeout(longPressTimerRef.current);
                      longPressTimerRef.current = null;
                    }
                  }}
                  onPointerUp={() => {
                    if (longPressTimerRef.current) {
                      clearTimeout(longPressTimerRef.current);
                      longPressTimerRef.current = null;
                    }
                  }}
                  onPointerCancel={() => {
                    if (longPressTimerRef.current) {
                      clearTimeout(longPressTimerRef.current);
                      longPressTimerRef.current = null;
                    }
                  }}
                  onPointerLeave={() => {
                    if (longPressTimerRef.current) {
                      clearTimeout(longPressTimerRef.current);
                      longPressTimerRef.current = null;
                    }
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    // [요구사항 1-2] 터치 기기(모바일)는 더블클릭 대신 롱프레스만 사용 → 핀치 줌 오작동 방지
                    if (isCoarsePointer) return;
                    isMarkerClickRef.current = true;
                    handleOpenContextMenu(spot);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    isMarkerClickRef.current = true;
                    if (isLongPressTriggeredRef.current) {
                      isLongPressTriggeredRef.current = false;
                      return;
                    }
                    if (Date.now() - lastMultiTouchAtRef.current < 600) return;
                    setPendingNewSpot(null);
                    setContextMenuSpot(null);
                    // [요구사항 1-1] 짧게 클릭: 뷰 리셋/재정렬 없이 상세보기 표시
                    skipAutoRecenterRef.current = true;
                    if (onOpenDetail) {
                      onOpenDetail(spot);
                    } else {
                      onSelectSpot(spot);
                    }
                  }}
                  className="relative flex items-center justify-center cursor-pointer group kakao-invert-restore"
                  title={`${spot.name} (클릭: 선택/상세, 길게 누르거나 더블클릭: 메뉴)`}
                >
                  {/* [요구사항 4] 아이콘 정중앙이 캐스팅 반원의 중심 좌표(spot.lat, spot.lng)에 정확히 위치 */}
                  <MaterialSpotMarker
                    methods={spot.fishing_methods}
                    isSelected={isSelected}
                    isFavorited={isFavorited}
                  />

                  {/* 포인트 이름 텍스트 (아이콘 바로 아래에 매달림 - 하단 미세조정/상세보기 아이콘은 전면 제거) */}
                  <div className="absolute top-full mt-1.5 flex flex-col items-center pointer-events-auto">
                    <span className="px-2 py-0.5 rounded-lg bg-slate-950/95 border border-slate-700/80 text-[11px] sm:text-xs text-white font-bold whitespace-nowrap shadow-xl">
                      {spot.name}
                    </span>
                  </div>
                </div>
              </CustomOverlayMap>
            </React.Fragment>
          );
        })}



        {/* [요구사항 2] 위성지도 기반 2D 평면 포인트 마커 드래깅 미세조정 */}
        {microAdjustSpot && (
          <React.Fragment key="micro-adjust-marker-group">
            {/* 기존 등록 위치 옅은 고스트 마커 */}
            <CustomOverlayMap
              position={{ lat: microAdjustSpot.lat, lng: microAdjustSpot.lng }}
              yAnchor={1}
              zIndex={40}
            >
              <div className="flex flex-col items-center opacity-60 pointer-events-none">
                <div className="w-7 h-7 rounded-full border-2 border-dashed border-rose-400 bg-rose-500/20 flex items-center justify-center text-[10px] text-rose-300 font-bold shadow">
                  기존
                </div>
                <div className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[6px] border-t-rose-400" />
                <span className="text-[10px] text-rose-300 font-mono bg-slate-900/90 px-1 rounded border border-rose-500/30">
                  이전 위치
                </span>
              </div>
            </CustomOverlayMap>

            {/* 기존 위치에서 새 위치로의 이동 궤적 점선 */}
            {distMeters > 0.1 && (
              <Polyline
                path={[
                  { lat: microAdjustSpot.lat, lng: microAdjustSpot.lng },
                  { lat: adjustedPos.lat, lng: adjustedPos.lng },
                ]}
                strokeWeight={3}
                strokeColor="#10b981"
                strokeOpacity={0.9}
                strokeStyle="shortdash"
                zIndex={45}
              />
            )}

            {/* 2차원 평면 드래그 가능한 마커 (사용자가 위성지도에서 마우스/터치로 직접 발판으로 드래깅) */}
            <MapMarker
              position={adjustedPos}
              draggable={digitalZoom === 1.0}
              onDragEnd={(marker) => {
                if (digitalZoom === 1.0) {
                  const pos = marker.getPosition();
                  setAdjustedPos({ lat: pos.getLat(), lng: pos.getLng() });
                }
              }}
              zIndex={150}
            />

            {/* [요구사항 4] 디지털 줌 상태에서도 1:1 오차 없이 드래깅 가능한 커스텀 오버레이 핸들러 */}
            <CustomOverlayMap
              position={adjustedPos}
              yAnchor={1.0}
              xAnchor={0.5}
              zIndex={155}
            >
              <div
                onMouseDown={(e) => {
                  e.stopPropagation();
                  isMarkerClickRef.current = true;
                  isDraggingAdjustMarkerRef.current = true;
                  lastClientPosRef.current = { x: e.clientX, y: e.clientY };
                }}
                onTouchStart={(e) => {
                  e.stopPropagation();
                  isMarkerClickRef.current = true;
                  isDraggingAdjustMarkerRef.current = true;
                  if (e.touches.length > 0) {
                    lastClientPosRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                  }
                }}
                className="w-10 h-10 -m-5 flex items-center justify-center cursor-grab active:cursor-grabbing select-none"
                title="발판 위치로 드래그"
              >
                <div className="w-5 h-5 rounded-full bg-emerald-400 border-2 border-white shadow-xl flex items-center justify-center text-[10px] animate-pulse">
                  🎯
                </div>
              </div>
            </CustomOverlayMap>

            {/* 마커 상단 드래그 가이드 툴팁 배지 */}
            <CustomOverlayMap
              position={adjustedPos}
              yAnchor={2.3}
              zIndex={160}
            >
              <div className="px-3 py-1 rounded-full bg-slate-950/95 border-2 border-emerald-400 text-emerald-300 font-bold text-xs shadow-2xl flex items-center gap-1.5 whitespace-nowrap animate-pulse pointer-events-none">
                <span>👆 핀을 드래그하여 정확한 발판으로 옮기세요</span>
              </div>
            </CustomOverlayMap>
          </React.Fragment>
        )}
      </Map>
      </div>

      {/* [요구사항 4] 새 포인트 등록 확인 미니 팝업 (디지털 줌 왜곡 방지를 위해 비스케일 뷰포트 레이어에서 정확한 1:1 픽셀 배치) */}
      {pendingNewSpot && (() => {
        const pos = getScreenPosFromLatLng(pendingNewSpot.lat, pendingNewSpot.lng);
        if (!pos) return null;
        const rootW = mapContainerRef.current?.offsetWidth || (typeof window !== 'undefined' ? window.innerWidth : 400);
        const clampedX = Math.max(115, Math.min(rootW - 115, pos.x));
        const isNearTop = pos.y < 220;
        const transform = isNearTop ? 'translate(-50%, 20px)' : 'translate(-50%, -115%)';

        return (
          <div
            style={{
              position: 'absolute',
              left: `${clampedX}px`,
              top: `${pos.y}px`,
              transform,
              zIndex: 35,
            }}
            onClick={(e) => {
              e.stopPropagation();
              isMarkerClickRef.current = true;
            }}
            className="p-3 bg-slate-900/95 backdrop-blur-md border border-cyan-500/60 rounded-xl shadow-2xl text-white text-xs font-sans space-y-2 animate-in fade-in zoom-in-95 duration-150 min-w-[210px] pointer-events-auto select-none"
          >
            <div className="flex items-center gap-1.5 font-bold text-cyan-300">
              <span>📍 새 포인트 등록</span>
            </div>
            <div className="text-[11px] text-slate-300 font-mono">
              위도 {pendingNewSpot.lat.toFixed(4)}, 경도 {pendingNewSpot.lng.toFixed(4)}
            </div>
            <p className="text-[10px] text-slate-400">
              이 해안/갯바위 위치를 새 낚시 포인트로 등록하시겠습니까?
            </p>
            <div className="flex items-center gap-1.5 pt-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  isMarkerClickRef.current = true;
                  setPendingNewSpot(null);
                }}
                className="flex-1 py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition text-[11px] cursor-pointer"
              >
                취소
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  isMarkerClickRef.current = true;
                  onMapClickForNewSpot(pendingNewSpot.lat, pendingNewSpot.lng);
                  setPendingNewSpot(null);
                }}
                className="flex-1 py-1.5 px-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold transition shadow text-[11px] cursor-pointer"
              >
                포인트 등록
              </button>
            </div>
          </div>
        );
      })()}

      {/* [요구사항 4] 포인트 더블클릭/롱클릭 컨텍스트 메뉴 (디지털 줌 상태에서도 100% 정상 크기와 클릭한 핀 바로 위에 밀착 배치) */}
      {contextMenuSpot && (() => {
        const pos = getScreenPosFromLatLng(contextMenuSpot.lat, contextMenuSpot.lng);
        if (!pos) return null;
        const rootW = mapContainerRef.current?.offsetWidth || (typeof window !== 'undefined' ? window.innerWidth : 400);
        const clampedX = Math.max(105, Math.min(rootW - 105, pos.x));
        const isNearTop = pos.y < 230;
        const transform = isNearTop ? 'translate(-50%, 20px)' : 'translate(-50%, -105%)';

        return (
          <div
            style={{
              position: 'absolute',
              left: `${clampedX}px`,
              top: `${pos.y}px`,
              transform,
              zIndex: 36,
            }}
            onClick={(e) => {
              e.stopPropagation();
              isMarkerClickRef.current = true;
            }}
            className="p-2.5 bg-slate-900/95 backdrop-blur-md border border-cyan-500/70 rounded-2xl shadow-2xl text-white text-xs font-sans space-y-1.5 animate-in fade-in zoom-in-95 duration-150 min-w-[190px] select-none pointer-events-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 px-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-bold text-cyan-300 text-xs truncate max-w-[130px]">
                  {contextMenuSpot.name}
                </span>
                {isAdmin && (
                  <span className="text-[10px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/60 font-bold flex-shrink-0">
                    👑 관리자
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setContextMenuSpot(null)}
                className="text-slate-400 hover:text-white text-xs p-0.5 rounded cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-1 pt-0.5">
              {onStartMicroAdjust && (
                <button
                  type="button"
                  onClick={() => {
                    onStartMicroAdjust(contextMenuSpot);
                    setContextMenuSpot(null);
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-slate-200 hover:text-emerald-300 transition flex items-center gap-2 cursor-pointer text-xs font-medium"
                >
                  <span>🎯</span>
                  <span>위치 조정</span>
                </button>
              )}

              {onEditSpot && (
                <button
                  type="button"
                  onClick={() => {
                    onEditSpot(contextMenuSpot);
                    setContextMenuSpot(null);
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-slate-200 hover:text-amber-300 transition flex items-center gap-2 cursor-pointer text-xs font-medium"
                >
                  <span>✏️</span>
                  <span>포인트 수정</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => handleOpenCastingConfig(contextMenuSpot)}
                className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-cyan-950/60 text-cyan-300 border border-cyan-800/40 transition flex items-center gap-2 cursor-pointer text-xs font-bold"
              >
                <span>📐</span>
                <span>캐스팅 방향 설정</span>
              </button>

              <button
                type="button"
                onClick={() => handleOpenSweetSpotConfig(contextMenuSpot)}
                className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-amber-950/60 text-amber-300 border border-amber-800/40 transition flex items-center gap-2 cursor-pointer text-xs font-bold"
              >
                <span>🎯</span>
                <span>스윗 스폿 설정</span>
              </button>
            </div>
          </div>
        );
      })()}

      {/* 지도 우상단 플로팅 컨트롤: 모드 3단 전환 & 찜한 포인트 필터 & GPS 내 위치 (모바일 드로어 열림 시에만 모바일에서 숨김, PC는 상시 flex 유지) */}
      <div
        className={`absolute top-4 right-4 z-20 flex-col items-end gap-2 ${
          isMobileDrawerOpen ? 'hidden md:flex' : 'flex'
        }`}
      >
        {/* 일반 지도 / 스카이뷰(항공사진) / 야간 다크 모드 / 고대비 모드 아이콘 전용 탭 */}
        <div className="flex items-center bg-slate-900/95 border border-slate-700/80 rounded-xl p-1 shadow-2xl backdrop-blur gap-0.5">
          <button
            onClick={() => handleModeChange('ROADMAP')}
            className={`p-2 rounded-lg transition flex items-center justify-center ${
              mapMode === 'ROADMAP'
                ? 'bg-cyan-600 text-white shadow'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title="일반 도로 지도"
            aria-label="일반 지도"
          >
            <MapIcon size={16} />
          </button>
          <button
            onClick={() => handleModeChange('HYBRID')}
            className={`p-2 rounded-lg transition flex items-center justify-center ${
              mapMode === 'HYBRID'
                ? 'bg-cyan-600 text-white shadow'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title="갯바위·방파제 고해상도 실사 항공 스카이뷰"
            aria-label="스카이뷰"
          >
            <Satellite size={16} />
          </button>
          <button
            onClick={() => handleModeChange('DARK')}
            className={`p-2 rounded-lg transition flex items-center justify-center ${
              mapMode === 'DARK'
                ? 'bg-amber-600 text-white shadow'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title="야간 낚시 다크 모드 (눈부심 방지)"
            aria-label="야간 다크"
          >
            <Moon size={16} />
          </button>
          {onToggleSunMode && (
            <button
              onClick={onToggleSunMode}
              className={`p-2 rounded-lg transition flex items-center justify-center border-l border-slate-800 ml-0.5 pl-1.5 ${
                isSunMode
                  ? 'bg-yellow-400 text-black font-bold shadow-yellow-500/30'
                  : 'text-yellow-400/90 hover:text-yellow-300 hover:bg-slate-800'
              }`}
              title={isSunMode ? '아웃도어 초고대비 모드 끄기' : '아웃도어 초고대비 모드 켜기 (한낮 직사광선용)'}
              aria-label="고대비 모드"
            >
              <Sun size={16} className={isSunMode ? 'text-black' : 'text-yellow-400'} />
            </button>
          )}
        </div>

        {/* 보조 액션 단일 머티리얼 툴바 패널 (채비 캘리브레이션 & 찜한 포인트 필터 & 화면 켜짐 & GPS 내 위치) */}
        <div className="flex items-center bg-slate-900/90 backdrop-blur-md border border-slate-700/80 rounded-2xl p-1 shadow-2xl divide-x divide-slate-800/80">
          <div className="flex items-center gap-0.5 pr-1">
            {/* 공기역학 채비 비거리 예측 버튼 */}
            <button
              onClick={() => setIsTacklePopoverOpen(!isTacklePopoverOpen)}
              className={`p-2 rounded-xl flex items-center justify-center transition active:scale-95 ${
                isTacklePopoverOpen
                  ? 'bg-cyan-600 text-white shadow-md shadow-cyan-500/30'
                  : 'hover:bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
              title="채비 비거리 예측 (루어 무게 & PE 라인 호수 설정)"
            >
              <Sliders size={17} className={isTacklePopoverOpen ? 'text-white' : 'text-slate-400'} />
            </button>

            {/* 찜한 포인트만 보기 필터 */}
            <button
              onClick={() => setViewOnlyFavorites(!viewOnlyFavorites)}
              className={`p-2 rounded-xl flex items-center justify-center transition active:scale-95 ${
                viewOnlyFavorites
                  ? 'bg-amber-500/20 text-amber-300 shadow-md shadow-amber-500/20'
                  : 'hover:bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
              title={viewOnlyFavorites ? '전체 포인트 보기' : '내가 찜한 포인트만 보기'}
            >
              <Star size={17} className={viewOnlyFavorites ? 'fill-amber-400 text-amber-400' : ''} />
            </button>
          </div>

          <div className="pl-1">
            {/* GPS 내 위치 바로가기 버튼 (간결하고 직관적인 Material Locate 아이콘) */}
            <button
              onClick={handleLocateMe}
              disabled={isLocating}
              title="내 현재 GPS 위치 찾기 (고정밀 GPS)"
              className="p-2 hover:bg-slate-800 text-cyan-400 rounded-xl flex items-center justify-center transition active:scale-95"
            >
              {isLocating ? (
                <div className="w-5 h-5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <LocateFixed size={18} className="text-cyan-400" />
              )}
            </button>
          </div>

          <div className="pl-1 flex items-center gap-0.5">
            {/* [요구사항 1] 지도 확대 (카카오 기본 레벨1 초과 시 2단계 추가 디지털 줌) */}
            <button
              onClick={handleZoomIn}
              className="p-2 hover:bg-slate-800 text-slate-200 hover:text-cyan-300 rounded-xl flex items-center justify-center transition active:scale-95"
              title={level === 1 ? '디지털 슈퍼 줌인 (2단계 추가 확대)' : '지도 확대'}
              aria-label="확대"
            >
              <Plus size={16} />
            </button>
            {digitalZoom > 1.0 && (
              <span className="text-[10px] font-black font-mono text-cyan-300 px-1 py-0.5 rounded bg-cyan-950/90 border border-cyan-500/60 shadow-sm animate-pulse">
                {digitalZoom.toFixed(1)}x
              </span>
            )}
            <button
              onClick={handleZoomOut}
              className="p-2 hover:bg-slate-800 text-slate-200 hover:text-cyan-300 rounded-xl flex items-center justify-center transition active:scale-95"
              title="지도 축소"
              aria-label="축소"
            >
              <Minus size={16} />
            </button>
          </div>
        </div>

        {/* [요구사항 2-6] 비거리 예측 팝오버 (상단 고정 예측치 + 하단 스크롤 설정) */}
        {isTacklePopoverOpen && (
          <div className="w-84 sm:w-96 max-w-[95vw] max-h-[85vh] supports-[height:100dvh]:max-h-[85dvh] bg-slate-950/95 border border-cyan-500/60 rounded-2xl shadow-2xl backdrop-blur text-white flex flex-col animate-fade-in text-sm pointer-events-auto overflow-hidden">
            {/* [요구사항 2-6-10] 상단 고정 헤더: 타이틀, 닫기 버튼, 예상 비거리, 예상 바닥 안착 카운트 */}
            <div className="p-3 border-b border-slate-800 bg-slate-900/90 flex flex-col gap-2 shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-bold text-cyan-300 text-sm sm:text-base">
                  <Sliders size={16} className="text-cyan-400" />
                  <span>채비 비거리 예측</span>
                </div>
                <button
                  onClick={() => setIsTacklePopoverOpen(false)}
                  className="text-slate-400 hover:text-white text-xs px-2.5 py-1 rounded-md bg-slate-800 transition active:scale-95"
                >
                  닫기
                </button>
              </div>

              {/* [요구사항 2-6-8, 2-6-10, 2-6-11] 예상 비거리 및 수심별 바닥 안착 카운트 고정 표시 */}
              <div className="bg-slate-950/80 rounded-xl p-2.5 border border-cyan-500/30 space-y-2">
                <div className="flex justify-between items-baseline">
                  <span className="text-xs text-slate-300 font-medium">예상 비거리</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-xl font-bold font-mono text-cyan-300 tracking-tight">
                      {tackleConfig.calibratedDistanceMeters}m
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      (총 {tackleConfig.totalWeightGrams ?? tackleConfig.weightGrams}g)
                    </span>
                  </div>
                </div>

                {/* [요구사항 2-6-8, 2-6-11] 예상 바닥 안착 카운트 (3m, 5m, 10m, 20m, 모바일에서는 '수심' 생략) */}
                <div className="pt-1.5 border-t border-slate-800/80">
                  <div className="text-[11px] text-slate-400 mb-1 flex items-center justify-between">
                    <span>예상 바닥 안착 카운트</span>
                    <span className="text-[10px] text-emerald-400/80 font-mono">
                      (유속 {marine?.currentVelocity ?? 0.3}m/s)
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1 text-center font-mono">
                    {[3, 5, 10, 20].map((d) => {
                      const sinkRes = calculateSinkingPhysics(
                        tackleConfig.weightGrams,
                        d,
                        marine?.currentVelocity ?? 0.3,
                        tackleConfig.baitConfig
                      );
                      return (
                        <div key={d} className="bg-slate-900/90 py-1 px-0.5 rounded border border-slate-800/80">
                          <div className="text-[10px] text-slate-400">
                            {isCoarsePointer ? `${d}m` : `수심 ${d}m`}
                          </div>
                          <div className="text-xs font-bold text-emerald-300">
                            {sinkRes.fallTimeSec}초
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* [요구사항 2-6-9, 1] 스크롤 가능한 상세 설정 영역 (flex-1 min-h-0으로 상단 고정 헤더 제외 남은 전체 높이 활용 및 하단 여백 확보) */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 pb-6 space-y-3.5 divide-y divide-slate-800/60">
              {/* 1. 로드 구분 (루어대 vs 원투대) */}
              <div className="space-y-1.5 pt-1">
                <div className="flex rounded-lg bg-slate-900 p-0.5 border border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      const newPower: RodPower = 'ML';
                      const newLenM = 2.6;
                      const updated = saveTackleConfig(
                        tackleConfig.weightGrams,
                        tackleConfig.peLineSize,
                        newPower,
                        newLenM,
                        tackleConfig.baitConfig?.type,
                        tackleConfig.baitConfig?.lengthInches,
                        tackleConfig.baitConfig?.shape
                      );
                      setTackleConfig(updated);
                    }}
                    className={`flex-1 py-1.5 text-center text-xs sm:text-sm font-bold rounded-md transition ${
                      tackleConfig.rodType === 'LURE'
                        ? 'bg-cyan-500 text-slate-950 shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    🎣 루어대
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const newPower: RodPower = 'SURF';
                      const newLenM = 4.2;
                      const newW = tackleConfig.weightGrams < 20 ? 93.8 : tackleConfig.weightGrams;
                      const updated = saveTackleConfig(
                        newW,
                        tackleConfig.peLineSize,
                        newPower,
                        newLenM,
                        tackleConfig.baitConfig?.type,
                        tackleConfig.baitConfig?.lengthInches,
                        tackleConfig.baitConfig?.shape
                      );
                      setTackleConfig(updated);
                      setSelectedWeightCategory('SURF');
                    }}
                    className={`flex-1 py-1.5 text-center text-xs sm:text-sm font-bold rounded-md transition ${
                      tackleConfig.rodType === 'SURF'
                        ? 'bg-amber-500 text-slate-950 shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    🌊 원투대
                  </button>
                </div>

                {/* 루어대: 파워 등급 & 1.6~3.0m 전장 */}
                {tackleConfig.rodType === 'LURE' ? (
                  <div className="space-y-2 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">
                    <div className="flex justify-between items-center text-xs sm:text-sm">
                      <span className="text-slate-300">루어대 파워 등급:</span>
                      <span className="font-mono font-bold text-cyan-300">
                        {tackleConfig.rodPower} (최적 {ROD_POWER_SPECS[tackleConfig.rodPower]?.optWeightG}g)
                      </span>
                    </div>
                    <div className="grid grid-cols-6 gap-1">
                      {(['UL', 'L', 'ML', 'M', 'MH', 'H'] as RodPower[]).map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => {
                            const updated = saveTackleConfig(
                              tackleConfig.weightGrams,
                              tackleConfig.peLineSize,
                              p,
                              tackleConfig.rodLengthM,
                              tackleConfig.baitConfig?.type,
                              tackleConfig.baitConfig?.lengthInches,
                              tackleConfig.baitConfig?.shape
                            );
                            setTackleConfig(updated);
                          }}
                          className={`py-1.5 rounded text-xs font-bold font-mono transition ${
                            tackleConfig.rodPower === p
                              ? 'bg-cyan-500 text-slate-950 shadow ring-1 ring-cyan-300'
                              : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800'
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                    <div className="text-[10.5px] sm:text-xs text-cyan-400/90 leading-tight">
                      * {ROD_POWER_SPECS[tackleConfig.rodPower]?.description}
                    </div>

                    {/* [요구사항 2-6-4] 루어대 전장 버튼에 feet 표기 생략 (m만 표기) */}
                    <div className="space-y-1.5 pt-1.5 border-t border-slate-800/80">
                      <div className="flex justify-between items-center text-xs sm:text-sm">
                        <span className="text-slate-300">루어대 전장:</span>
                        <span className="font-mono font-bold text-cyan-300">
                          {tackleConfig.rodLengthM.toFixed(1)}m
                        </span>
                      </div>
                      <div className="px-1">
                        <input
                          type="range"
                          min={1.6}
                          max={3.0}
                          step={0.1}
                          value={tackleConfig.rodLengthM}
                          onChange={(e) => {
                            const lenM = Number(e.target.value);
                            const updated = saveTackleConfig(
                              tackleConfig.weightGrams,
                              tackleConfig.peLineSize,
                              tackleConfig.rodPower,
                              lenM,
                              tackleConfig.baitConfig?.type,
                              tackleConfig.baitConfig?.lengthInches,
                              tackleConfig.baitConfig?.shape
                            );
                            setTackleConfig(updated);
                          }}
                          className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                        />
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {[1.8, 2.1, 2.4, 2.6, 3.0].map((mVal) => (
                          <button
                            key={mVal}
                            type="button"
                            onClick={() => {
                              const updated = saveTackleConfig(
                                tackleConfig.weightGrams,
                                tackleConfig.peLineSize,
                                tackleConfig.rodPower,
                                mVal,
                                tackleConfig.baitConfig?.type,
                                tackleConfig.baitConfig?.lengthInches,
                                tackleConfig.baitConfig?.shape
                              );
                              setTackleConfig(updated);
                            }}
                            className={`px-2.5 py-1 rounded text-xs font-mono transition ${
                              Math.abs(tackleConfig.rodLengthM - mVal) < 0.05
                                ? 'bg-cyan-500/30 text-cyan-200 border border-cyan-400/80 font-bold'
                                : 'bg-slate-900/90 text-slate-400 hover:text-slate-200 border border-slate-800'
                            }`}
                          >
                            {mVal.toFixed(1)}m
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* [요구사항 2-6-2] 원투대: 고정 규격 전장 (각 버튼의 밑줄 feet 표기 생략) */
                  <div className="space-y-2 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">
                    <div className="flex justify-between items-center text-xs sm:text-sm">
                      <span className="text-slate-300">원투대 규격 전장:</span>
                      <span className="font-mono font-bold text-amber-300">
                        {tackleConfig.rodLengthM.toFixed(1)}m
                      </span>
                    </div>
                    <div className="grid grid-cols-5 gap-1">
                      {[2.7, 3.3, 4.2, 4.5, 5.4].map((mVal) => (
                        <button
                          key={mVal}
                          type="button"
                          onClick={() => {
                            const updated = saveTackleConfig(
                              tackleConfig.weightGrams,
                              tackleConfig.peLineSize,
                              'SURF',
                              mVal,
                              tackleConfig.baitConfig?.type,
                              tackleConfig.baitConfig?.lengthInches,
                              tackleConfig.baitConfig?.shape
                            );
                            setTackleConfig(updated);
                          }}
                          className={`py-2 px-1 rounded flex items-center justify-center transition ${
                            Math.abs(tackleConfig.rodLengthM - mVal) < 0.05
                              ? 'bg-amber-500 text-slate-950 font-bold shadow ring-1 ring-amber-300'
                              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
                          }`}
                        >
                          <span className="text-xs font-mono font-bold">{mVal.toFixed(1)}m</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* [요구사항 2-6-12] 미끼 선택 섹션 (생미끼, 루어: 길이 1~4인치 및 형상 선택) */}
              <div className="space-y-2 pt-3">
                <div className="flex justify-between items-center text-xs sm:text-sm">
                  <span className="text-slate-300 font-medium">미끼 (Lure / Bait):</span>
                  <span className="font-mono text-cyan-300 text-xs font-semibold">
                    {tackleConfig.baitConfig?.type === 'LIVE'
                      ? '생미끼 (2인치 그럽웜 가정)'
                      : `${tackleConfig.baitConfig?.lengthInches}인치 ${LURE_SHAPE_NAMES[tackleConfig.baitConfig?.shape ?? 'GRUB']}`}
                    <span className="text-slate-400 ml-1">
                      (+{tackleConfig.baitConfig?.weightGrams ?? 2.5}g)
                    </span>
                  </span>
                </div>

                {/* [요구사항 4] 미끼 종류 탭 (생미끼 vs 루어 vs 메탈) */}
                <div className="flex rounded-lg bg-slate-900 p-0.5 border border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      const updated = saveTackleConfig(
                        tackleConfig.weightGrams,
                        tackleConfig.peLineSize,
                        tackleConfig.rodPower,
                        tackleConfig.rodLengthM,
                        'LIVE',
                        2,
                        'GRUB'
                      );
                      setTackleConfig(updated);
                    }}
                    className={`flex-1 py-1.5 text-center text-xs font-bold rounded-md transition ${
                      tackleConfig.baitConfig?.type === 'LIVE'
                        ? 'bg-cyan-500 text-slate-950 shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    🪱 생미끼
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const updated = saveTackleConfig(
                        tackleConfig.weightGrams,
                        tackleConfig.peLineSize,
                        tackleConfig.rodPower,
                        tackleConfig.rodLengthM,
                        'LURE',
                        tackleConfig.baitConfig?.lengthInches || 2,
                        tackleConfig.baitConfig?.shape || 'GRUB'
                      );
                      setTackleConfig(updated);
                    }}
                    className={`flex-1 py-1.5 text-center text-xs font-bold rounded-md transition ${
                      tackleConfig.baitConfig?.type === 'LURE'
                        ? 'bg-cyan-500 text-slate-950 shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    🐟 루어
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const updated = saveTackleConfig(
                        tackleConfig.weightGrams,
                        tackleConfig.peLineSize,
                        tackleConfig.rodPower,
                        tackleConfig.rodLengthM,
                        'METAL',
                        undefined,
                        undefined,
                        tackleConfig.baitConfig?.lengthCm || 6.0
                      );
                      setTackleConfig(updated);
                    }}
                    className={`flex-1 py-1.5 text-center text-xs font-bold rounded-md transition ${
                      tackleConfig.baitConfig?.type === 'METAL'
                        ? 'bg-cyan-500 text-slate-950 shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    ⚡ 메탈
                  </button>
                </div>

                {/* 루어 선택 시: 길이(1~4인치) 및 형상(그럽웜/쉐드웜/스트레이트/미노우) */}
                {tackleConfig.baitConfig?.type === 'LURE' && (
                  <div className="p-2.5 bg-slate-900/60 rounded-xl border border-slate-800 space-y-2">
                    <div>
                      <div className="text-[11px] text-slate-400 mb-1">루어 길이:</div>
                      <div className="grid grid-cols-4 gap-1">
                        {[1, 2, 3, 4].map((len) => (
                          <button
                            key={len}
                            type="button"
                            onClick={() => {
                              const updated = saveTackleConfig(
                                tackleConfig.weightGrams,
                                tackleConfig.peLineSize,
                                tackleConfig.rodPower,
                                tackleConfig.rodLengthM,
                                'LURE',
                                len,
                                tackleConfig.baitConfig?.shape || 'GRUB'
                              );
                              setTackleConfig(updated);
                            }}
                            className={`py-1 rounded text-xs font-mono transition ${
                              tackleConfig.baitConfig?.lengthInches === len
                                ? 'bg-cyan-500 text-slate-950 font-bold shadow'
                                : 'bg-slate-900 text-slate-400 border border-slate-800'
                            }`}
                          >
                            {len}인치
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] text-slate-400 mb-1">루어 형상:</div>
                      <div className="grid grid-cols-4 gap-1">
                        {(['GRUB', 'SHAD', 'STRAIGHT', 'MINNOW'] as LureShape[]).map((shp) => (
                          <button
                            key={shp}
                            type="button"
                            onClick={() => {
                              const updated = saveTackleConfig(
                                tackleConfig.weightGrams,
                                tackleConfig.peLineSize,
                                tackleConfig.rodPower,
                                tackleConfig.rodLengthM,
                                'LURE',
                                tackleConfig.baitConfig?.lengthInches || 2,
                                shp
                              );
                              setTackleConfig(updated);
                            }}
                            className={`py-1 rounded text-[11px] font-medium transition ${
                              tackleConfig.baitConfig?.shape === shp
                                ? 'bg-cyan-500 text-slate-950 font-bold shadow'
                                : 'bg-slate-900 text-slate-400 border border-slate-800'
                            }`}
                          >
                            {LURE_SHAPE_NAMES[shp]}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* [요구사항 4] 메탈 선택 시: 형상 없이 길이(2.5cm ~ 16cm)만 지정 */}
                {tackleConfig.baitConfig?.type === 'METAL' && (
                  <div className="p-2.5 bg-slate-900/60 rounded-xl border border-slate-800 space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">메탈 지그 길이:</span>
                      <span className="font-mono font-bold text-cyan-300">
                        {(tackleConfig.baitConfig.lengthCm ?? 6.0).toFixed(1)}cm
                        <span className="text-[11px] text-slate-400 font-normal ml-1">
                          (자중 약 {tackleConfig.baitConfig.weightGrams}g)
                        </span>
                      </span>
                    </div>
                    <input
                      type="range"
                      min={2.5}
                      max={16.0}
                      step={0.5}
                      value={tackleConfig.baitConfig.lengthCm ?? 6.0}
                      onChange={(e) => {
                        const lenCm = parseFloat(e.target.value);
                        const updated = saveTackleConfig(
                          tackleConfig.weightGrams,
                          tackleConfig.peLineSize,
                          tackleConfig.rodPower,
                          tackleConfig.rodLengthM,
                          'METAL',
                          undefined,
                          undefined,
                          lenCm
                        );
                        setTackleConfig(updated);
                      }}
                      className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                    />
                    <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                      <span>2.5cm</span>
                      <span>6.0cm (표준)</span>
                      <span>10.0cm</span>
                      <span>16.0cm</span>
                    </div>
                  </div>
                )}
              </div>

              {/* 2. 추 / 봉돌 무게 선택 (지그헤드->그램, 온스, 주꾸미, 원투봉돌) */}
              <div className="space-y-1.5 pt-3">
                <div className="flex justify-between items-center text-xs sm:text-sm">
                  <span className="text-slate-300 font-medium">추/봉돌 무게:</span>
                  <span className="font-mono font-bold text-cyan-300">
                    {tackleConfig.weightGrams}g
                    <span className="text-[10.5px] sm:text-xs text-slate-400 font-normal ml-1">
                      ({getWeightDescription(tackleConfig.weightGrams)})
                    </span>
                  </span>
                </div>

                {/* [요구사항 2-6-5] 카테고리 탭: '지그헤드' -> '그램' */}
                <div className="grid grid-cols-4 gap-1 p-0.5 bg-slate-900 rounded-lg border border-slate-800">
                  {[
                    { cat: 'JIG' as WeightCategory, label: '그램', desc: '1~5g' },
                    { cat: 'OZ' as WeightCategory, label: '온스(oz)', desc: '1/32~2oz' },
                    { cat: 'JUKKUMI' as WeightCategory, label: '주꾸미', desc: '3~7호' },
                    { cat: 'SURF' as WeightCategory, label: '원투봉돌', desc: '16~40호' },
                  ].map((tab) => (
                    <button
                      key={tab.cat}
                      type="button"
                      onClick={() => setSelectedWeightCategory(tab.cat)}
                      className={`py-1.5 rounded text-center transition ${
                        selectedWeightCategory === tab.cat
                          ? 'bg-slate-800 text-cyan-300 font-bold border border-cyan-500/50 shadow-xs'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div className="text-xs leading-tight">{tab.label}</div>
                      <div className="text-[9.5px] opacity-75 font-mono leading-tight">{tab.desc}</div>
                    </button>
                  ))}
                </div>

                {/* [요구사항 2-6-6, 2-6-7] 프리셋 버튼 목록: 온스는 oz만, 주꾸미는 호수만 표기 */}
                <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto p-1.5 bg-slate-900/70 rounded-lg border border-slate-800">
                  {WEIGHT_PRESETS.filter((p) => p.category === selectedWeightCategory).map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => {
                        const updated = saveTackleConfig(
                          preset.weightGrams,
                          tackleConfig.peLineSize,
                          tackleConfig.rodPower,
                          tackleConfig.rodLengthM,
                          tackleConfig.baitConfig?.type,
                          tackleConfig.baitConfig?.lengthInches,
                          tackleConfig.baitConfig?.shape
                        );
                        setTackleConfig(updated);
                      }}
                      className={`px-2.5 py-1 rounded text-xs font-mono flex items-center gap-0.5 transition ${
                        Math.abs(tackleConfig.weightGrams - preset.weightGrams) < 0.15
                          ? 'bg-cyan-500 text-slate-950 font-bold shadow'
                          : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
                      }`}
                    >
                      <span>{preset.label}</span>
                      {/* 그램 탭이나 원투일 때만 부가 레이블 표시, 온스와 주꾸미는 그램 표기 생략 */}
                      {selectedWeightCategory !== 'OZ' && selectedWeightCategory !== 'JUKKUMI' && (
                        <span className="text-[9.5px] opacity-75">({preset.subLabel})</span>
                      )}
                    </button>
                  ))}
                </div>

                {/* [요구사항 10-1] 모바일 앱 스크롤 간섭 방지를 위해 슬라이더 안쪽 패딩 적용 */}
                <div className="px-1 pt-1">
                  <input
                    type="range"
                    min={1}
                    max={150}
                    step={1}
                    value={Math.round(tackleConfig.weightGrams)}
                    onChange={(e) => {
                      const w = Number(e.target.value);
                      const updated = saveTackleConfig(
                        w,
                        tackleConfig.peLineSize,
                        tackleConfig.rodPower,
                        tackleConfig.rodLengthM,
                        tackleConfig.baitConfig?.type,
                        tackleConfig.baitConfig?.lengthInches,
                        tackleConfig.baitConfig?.shape
                      );
                      setTackleConfig(updated);
                    }}
                    className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                  <div className="flex justify-between text-[10px] sm:text-[11px] text-slate-400 font-mono mt-0.5">
                    <span>1g</span>
                    <span>28g(1oz)</span>
                    <span>75g(20호)</span>
                    <span>150g(40호)</span>
                  </div>
                </div>
              </div>

              {/* 3. 합사 라인 호수 슬라이더 (0.4~3.0호) */}
              <div className="space-y-1.5 pt-3">
                <div className="flex justify-between items-center text-xs sm:text-sm">
                  <span className="text-slate-300 font-medium">원줄 합사 (PE):</span>
                  <span className="font-mono font-bold text-cyan-300">{tackleConfig.peLineSize.toFixed(1)}호</span>
                </div>
                <div className="px-1">
                  <input
                    type="range"
                    min={0.4}
                    max={3.0}
                    step={0.1}
                    value={tackleConfig.peLineSize}
                    onChange={(e) => {
                      const pe = Number(e.target.value);
                      const updated = saveTackleConfig(
                        tackleConfig.weightGrams,
                        pe,
                        tackleConfig.rodPower,
                        tackleConfig.rodLengthM,
                        tackleConfig.baitConfig?.type,
                        tackleConfig.baitConfig?.lengthInches,
                        tackleConfig.baitConfig?.shape
                      );
                      setTackleConfig(updated);
                    }}
                    className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                  <div className="flex justify-between text-[10px] sm:text-[11px] text-slate-400 font-mono mt-0.5">
                    <span>0.4호 (아징)</span>
                    <span>1.0호 (에깅)</span>
                    <span>2.0호 (원투)</span>
                    <span>3.0호 (대물)</span>
                  </div>
                </div>
              </div>

              {/* [요구사항 1] 원줄 합사 슬라이더 하단 여백 및 안전 마진 spacer */}
              <div className="pt-3 pb-8 flex flex-col items-center justify-center gap-1.5 text-[11px] text-slate-400 border-none">
                <span className="text-slate-500 text-[10.5px]">─── 채비 세부 설정 끝 ───</span>
                <span className="text-slate-400 text-center text-[10.5px] leading-tight">
                  💡 변경된 채비 스펙은 자동 저장되며 지도의 비거리 링 및 비행 편류에 즉시 반영됩니다.
                </span>
                <div className="h-6 shrink-0" aria-hidden="true" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 물리 볼륨 키 줌 안내 플로팅 토스트 (Phase 2) */}
      {volumeToast && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 bg-slate-950/90 text-cyan-300 border border-cyan-500/70 rounded-full px-4 py-1.5 text-xs font-bold shadow-2xl backdrop-blur animate-fade-in pointer-events-none flex items-center gap-1.5">
          <span>{volumeToast}</span>
        </div>
      )}

      {/* [요구사항 10.3] 미니멀 위치 조정 컴팩트 패널 (상/하/좌/우 버튼 제거, 저장 앞 불필요 텍스트 제거) */}
      {microAdjustSpot && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 bg-slate-900/95 border border-emerald-500/60 rounded-xl p-2 shadow-2xl backdrop-blur text-white flex items-center gap-2 animate-fade-in text-xs">
          {distMeters > 0.05 && (
            <span className="text-[11px] text-emerald-400 font-mono font-semibold px-1">
              +{distMeters.toFixed(1)}m
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              triggerHaptic('success');
              onConfirmMicroAdjust && onConfirmMicroAdjust(microAdjustSpot.id, adjustedPos.lat, adjustedPos.lng);
            }}
            className="py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md shadow-emerald-500/20 transition active:scale-95 flex items-center gap-1 cursor-pointer"
            title="조정 위치 저장"
          >
            <Check size={14} />
            <span>저장</span>
          </button>
          <button
            type="button"
            onClick={onCancelMicroAdjust}
            className="py-1.5 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs transition cursor-pointer"
            title="조정 취소"
          >
            취소
          </button>
        </div>
      )}

      {/* [요구사항 2-3-1] 캐스팅 방향 실시간 지도 설정 바텀 메뉴 (포인트 이름 제거, '보기'로 변경) */}
      {castingConfigSpot && (
        <div className="fixed bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 backdrop-blur-md border border-cyan-500/60 rounded-2xl shadow-2xl p-4 w-[92vw] max-w-lg text-slate-100 animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-cyan-400">🎯 캐스팅 방향 설정</span>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={tempCastingEnabled}
                onChange={(e) => setTempCastingEnabled(e.target.checked)}
                className="w-4 h-4 rounded text-cyan-500 bg-slate-800 border-slate-700 focus:ring-cyan-500"
              />
              <span>보기</span>
            </label>
          </div>

          {tempCastingEnabled ? (
            <div className="space-y-2 py-2.5">
              <div className="flex items-center gap-2 text-xs">
                <span className="w-8 shrink-0 text-slate-300 font-medium">시작</span>
                <input
                  type="range"
                  min="0"
                  max="359"
                  value={tempStartDeg}
                  onChange={(e) => setTempStartDeg(Number(e.target.value))}
                  className="flex-1 accent-cyan-500 cursor-pointer h-2 bg-slate-800 rounded-lg"
                />
                <span className="w-10 text-right font-mono font-bold text-cyan-400 shrink-0">{Math.round(tempStartDeg)}°</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="w-8 shrink-0 text-slate-300 font-medium">끝</span>
                <input
                  type="range"
                  min="0"
                  max="359"
                  value={tempEndDeg}
                  onChange={(e) => setTempEndDeg(Number(e.target.value))}
                  className="flex-1 accent-cyan-500 cursor-pointer h-2 bg-slate-800 rounded-lg"
                />
                <span className="w-10 text-right font-mono font-bold text-cyan-400 shrink-0">{Math.round(tempEndDeg)}°</span>
              </div>
            </div>
          ) : (
            <div className="py-4 text-center text-xs text-slate-400">
              캐스팅 방향 보기가 꺼져 있습니다. (전방위 캐스팅)
            </div>
          )}

          <div className="flex gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setCastingConfigSpot(null)}
              className="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition active:scale-95"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleSaveCastingConfig}
              className="flex-1 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition active:scale-95 shadow-lg shadow-cyan-600/30"
            >
              저장
            </button>
          </div>
        </div>
      )}

      {/* [요구사항 2-1] 스윗 스폿 실시간 지도 설정 바텀 메뉴 (포인트명 제거, '보기' 표기, 취소/저장 대신 '닫기', 스팟 추가 시 노트+반지름+위치+취소+추가) */}
      {sweetSpotConfigSpot && (
        <div className="fixed bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 backdrop-blur-md border border-amber-500/60 rounded-2xl shadow-2xl p-4 w-[92vw] max-w-lg text-slate-100 animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-amber-400">🎯 스윗 스팟 설정</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold">
                {tempSweetSpots.length}/3개
              </span>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={tempUseSweetSpot}
                onChange={(e) => persistSweetSpots(tempSweetSpots, e.target.checked)}
                className="w-4 h-4 rounded text-amber-500 bg-slate-800 border-slate-700 focus:ring-amber-500"
              />
              <span>보기</span>
            </label>
          </div>

          <div className="py-3 space-y-2.5">
            {isAddingSweetSpot ? (
              <div className="p-3 bg-amber-950/40 border border-amber-500/50 rounded-xl space-y-2.5">
                <div className="text-xs text-amber-300 font-bold flex items-center justify-between">
                  <span>지도 클릭하여 입질 위치 지정</span>
                  {draftSweetPos && (
                    <span className="text-[10px] text-emerald-400 font-mono">
                      선택됨 ({calculateDistanceAndBearing(sweetSpotConfigSpot.lat, sweetSpotConfigSpot.lng, draftSweetPos.lat, draftSweetPos.lng).distance}m)
                    </span>
                  )}
                </div>

                {/* [요구사항 2-1-1] 노트 입력 */}
                <div>
                  <input
                    type="text"
                    value={draftSweetNote}
                    onChange={(e) => setDraftSweetNote(e.target.value)}
                    placeholder="노트 입력 (예: 간출여 입질, 수중 턱 등)"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                    maxLength={30}
                  />
                </div>

                {/* [요구사항 10.6] 반지름 선택 (반지름 문구 삭제) */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {[10, 15, 20].map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setSelectedNewRadius(r)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition active:scale-95 ${
                          selectedNewRadius === r
                            ? 'bg-amber-500 text-slate-950 shadow-md font-black'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        {r}m
                      </button>
                    ))}
                  </div>

                  {/* [요구사항 2-1-6] 취소 / 추가 버튼 */}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleCancelAddSweetSpot}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      disabled={!draftSweetPos}
                      onClick={handleConfirmAddSweetSpot}
                      className={`px-3 py-1 rounded-lg text-xs font-black transition shadow ${
                        draftSweetPos
                          ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 active:scale-95'
                          : 'bg-slate-800 text-slate-600 cursor-not-allowed'
                      }`}
                    >
                      추가
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  {tempSweetSpots.length >= 3
                    ? '최대 개수(3개)에 도달했습니다. 핀의 삭제를 눌러 교체하세요.'
                    : '스팟 추가를 누른 후 지도를 클릭하여 입질 스팟을 등록하세요.'}
                </span>
                <button
                  type="button"
                  disabled={tempSweetSpots.length >= 3}
                  onClick={handleStartAddSweetSpot}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition shrink-0 ${
                    tempSweetSpots.length >= 3
                      ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                      : 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-black active:scale-95 shadow-md shadow-amber-500/20'
                  }`}
                >
                  + 스팟 추가
                </button>
              </div>
            )}
          </div>

          {/* [요구사항 2-1-2] 취소, 저장 제거하고 '닫기' 버튼만 배치 */}
          <div className="pt-2 border-t border-slate-800 flex justify-end">
            <button
              type="button"
              onClick={handleCloseSweetSpotConfig}
              className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition active:scale-95"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {/* [요구사항 2-1-5] 인앱 커스텀 스윗 스팟 삭제 확인 모달 (네이티브 alert/confirm 중복 및 localhost 도메인 표기 제거) */}
      {pendingDeleteSweetIdx !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4 max-w-xs w-full shadow-2xl text-center space-y-3">
            <div className="text-sm font-bold text-slate-100">
              스윗 스팟 삭제
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              선택한 스윗 스팟을 삭제하시겠습니까?
            </p>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPendingDeleteSweetIdx(null)}
                className="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition active:scale-95"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => handleDeleteTempSweetSpot(pendingDeleteSweetIdx)}
                className="flex-1 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition active:scale-95 shadow-lg shadow-rose-600/30"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* [요구사항 2] 지도 좌측 상단 날씨·기온 & 수온·물때 미니 표시 (우하단 그림자, 글자 1pt 확대, '수온' 텍스트 제거) */}
      {!contextMenuSpot && (weather || marine || tide) && (
        <div className="absolute top-2.5 left-3 z-20 flex flex-col gap-0.5 select-none pointer-events-none [text-shadow:_1.5px_1.5px_0_#000]">
          {/* 1행: 날씨 아이콘 + 기온 + 풍향/풍속 */}
          {weather && (
            <div className="flex items-center gap-1.5 leading-none font-bold">
              <span className="text-sm leading-none" title={weather.weatherText}>
                {weather.weatherCode <= 1
                  ? '☀️'
                  : weather.weatherCode <= 3
                  ? '⛅'
                  : weather.weatherCode >= 51 && weather.weatherCode <= 67
                  ? '🌧️'
                  : '☁️'}
              </span>

              <span className="font-mono font-bold text-amber-300 text-[13px] leading-none">
                {weather.temp.toFixed(1)}°
              </span>

              <div className="flex items-center gap-0.5 text-cyan-300 leading-none font-bold" title={`풍향 ${Math.round(weather.windDirection)}°`}>
                <div
                  className="w-3.5 h-3.5 flex items-center justify-center text-[10px] font-bold"
                  style={{ transform: `rotate(${weather.windDirection}deg)` }}
                >
                  ↓
                </div>
                <span className="font-mono font-bold text-[11px] leading-none">
                  {formatWindSpeed(weather.windSpeed, windUnit)}
                </span>
              </div>
            </div>
          )}

          {/* 2행: 수온 + 물때 (1pt 확대한 12px, 수온 텍스트 제거, 우하단 그림자) */}
          {(marine?.seaSurfaceTemp !== undefined || tide?.mulText) && (
            <div className="flex items-center gap-1.5 leading-none mt-0.5 font-bold">
              {marine?.seaSurfaceTemp !== undefined && (
                <span className="text-[12px] font-mono text-rose-300 font-bold leading-none flex items-center gap-0.5">
                  <span className="text-[11px]">🌡️</span>
                  <span>{marine.seaSurfaceTemp.toFixed(1)}°</span>
                </span>
              )}

              {tide?.mulText && (
                <span className="text-[12px] font-bold text-cyan-200 leading-none">
                  {marine?.seaSurfaceTemp !== undefined ? `· ${tide.mulText}` : tide.mulText}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* [요구사항 10.1] 지도 좌하단 포인트 조작 안내 칩 (맵을 가리지 않는 반투명 컴팩트 표시) */}
      <div className="absolute bottom-3 left-3 z-20 bg-slate-950/80 backdrop-blur-sm border border-slate-800/90 rounded-full px-2.5 py-1 text-[10px] text-slate-300 flex items-center gap-1.5 shadow-md select-none pointer-events-none">
        <span>포인트 클릭=보기, 길게 클릭=메뉴</span>
      </div>
    </div>
  );
};
