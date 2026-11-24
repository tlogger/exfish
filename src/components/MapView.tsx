import React from 'react';
import { useKakaoLoader } from 'react-kakao-maps-sdk';
import { Check, LocateFixed, Plus, Minus, Layers, ShieldAlert, PenTool, Sliders } from 'lucide-react';
import { KakaoMapCanvas } from './KakaoMapCanvas';
import { VWorldMapCanvas } from './VWorldMapCanvas';
import type { MapCanvasBridge, MapMode, SharedMapCanvasProps } from './mapCanvasTypes';
import { computeApproxViewportBounds, normalizeWgs84Center } from '../utils/mapCoordSync';
import { loadZonesForBounds } from '../utils/zoneCache';
import { findZoneHitsAtPoint } from '../utils/zoneSpatial';
import type { ProhibitedZoneFeature } from '../types/prohibitedZone';
import type { FishingSpot, FishingShop, WeatherData, MarineData, WindUnit, CurrentUnit, TideDayInfo, SweetSpot, MapProvider } from '../types';
import type { AuthUser } from './LoginModal';
import { isUserAdmin, isStrictPaedrosAdmin } from '../services/oauthService';
import {
  formatWindSpeed,
  formatCurrentVelocity,
} from '../utils/weatherApi';
import { resolveUnifiedWaterDepth } from '../utils/depthSinkEngine';
import { computeCastingLandingPoint, useLandingKhoaDepth } from '../utils/castingLanding';
import { findNearestKhoaStation } from '../utils/tideService';
import {
  getSavedTackleConfig,
  saveTackleConfig,
  getTackleShortLabel,
  calculateSinkingPhysics,
  calculateAerodynamicCastingDrift,
  solveLeadCastAimPoint,
  RodPower,
  TackleRigConfig,
  WEIGHT_PRESETS,
  getWeightDescription,
  LureSubMode,
  LURE_SHAPES,
  LURE_SHAPE_NAMES,
  JIGHEAD_PRESETS,
  METAL_WEIGHT_PRESETS,
  EGI_WEIGHT_PRESETS,
  JUKKUMI_SINKER_PRESETS,
  VARIANT_FLOAT_HO_PRESETS,
  getVariantFloatWeightByHo,
  REAL_CASTING_BALL_PRESETS,
  TackleUpdateParams,
} from '../utils/tackleCalibration';
import {
  getNativeLocation,
  triggerHaptic,
  setupVolumeZoomListener,
} from '../utils/nativeBridge';

// 카카오 디벨로퍼스 JavaScript 앱 키
const KAKAO_APP_KEY = import.meta.env.VITE_KAKAO_MAP_API_KEY || '61ebf0b7a0daf24cba357d92677c8d8a';

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

export type { MapMode } from './mapCanvasTypes';

interface MapViewProps {
  spots: FishingSpot[];
  selectedSpot: FishingSpot | null;
  onSelectSpot: (spot: FishingSpot) => void;
  onMapClickForNewSpot: (lat: number, lng: number) => void;
  shops?: FishingShop[];
  selectedShop?: FishingShop | null;
  onSelectShop?: (shop: FishingShop) => void;
  onMapClickForNewShop?: (lat: number, lng: number) => void;
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
  mapMode?: MapMode;
  onChangeMapMode?: (mode: MapMode) => void;
  mapProvider?: MapProvider;
  viewOnlyFavorites?: boolean;
  isTacklePopoverOpen?: boolean;
  onToggleTacklePopover?: (open: boolean) => void;
  userCoords?: { lat: number; lng: number } | null;
}

export const MapView: React.FC<MapViewProps> = ({
  spots,
  selectedSpot,
  onSelectSpot,
  onMapClickForNewSpot,
  shops = [],
  selectedShop = null,
  onSelectShop,
  onMapClickForNewShop,
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
  onToggleFavorite: _onToggleFavorite,
  isSunMode = false,
  mapMode: externalMapMode,
  onChangeMapMode,
  mapProvider = 'vworld',
  viewOnlyFavorites: externalViewOnlyFavorites,
  isTacklePopoverOpen: externalIsTacklePopoverOpen,
  onToggleTacklePopover,
  userCoords = null,
}) => {
  const isAdmin = isUserAdmin(currentUser);
  const isStrictAdmin = isStrictPaedrosAdmin(currentUser);
  const [showHaeroadEnc, setShowHaeroadEnc] = React.useState(false);
  const [prohibitedZones, setProhibitedZones] = React.useState<ProhibitedZoneFeature[]>([]);
  const [zoneReloadTick, setZoneReloadTick] = React.useState(0);
  const [isDigitizingZones, setIsDigitizingZones] = React.useState(false);
  const [digitizerPoints, setDigitizerPoints] = React.useState<Array<{ lat: number; lng: number }>>([]);
  const prevMapModeBeforeDigitizeRef = React.useRef<MapMode | null>(null);

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
  const [internalMapMode, setInternalMapMode] = React.useState<MapMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('exfish_map_mode');
      if (saved === 'HYBRID' || saved === 'DARK') return saved;
    }
    return 'ROADMAP';
  });
  const mapMode = externalMapMode ?? internalMapMode;
  const setMapMode = React.useCallback(
    (mode: MapMode) => {
      setInternalMapMode(mode);
      onChangeMapMode?.(mode);
    },
    [onChangeMapMode]
  );

  React.useEffect(() => {
    if (level > 6) {
      setProhibitedZones([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      const b = computeApproxViewportBounds(center, level);
      const list = await loadZonesForBounds(b.minLat, b.minLng, b.maxLat, b.maxLng);
      setProhibitedZones(list);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [level, center.lat, center.lng, zoneReloadTick]);

  const startZoneDigitizing = React.useCallback(() => {
    if (!currentUser) {
      window.alert('금지구역 작도는 로그인 후 이용할 수 있습니다.');
      return;
    }
    prevMapModeBeforeDigitizeRef.current = mapMode;
    if (mapMode !== 'HYBRID') {
      setMapMode('HYBRID');
    }
    setDigitizerPoints([]);
    setIsDigitizingZones(true);
  }, [currentUser, mapMode, setMapMode]);

  const exitZoneDigitizing = React.useCallback(() => {
    setIsDigitizingZones(false);
    setDigitizerPoints([]);
    if (prevMapModeBeforeDigitizeRef.current && prevMapModeBeforeDigitizeRef.current !== 'HYBRID') {
      setMapMode(prevMapModeBeforeDigitizeRef.current);
    }
    prevMapModeBeforeDigitizeRef.current = null;
  }, [setMapMode]);

  // 내 현재 GPS 위치 및 추적 상태 (GPS 수평 오차 반경 원 포함)
  const [myLocation, setMyLocation] = React.useState<{ lat: number; lng: number } | null>(null);
  const [gpsAccuracy, setGpsAccuracy] = React.useState<number | null>(null);
  const [isLocating, setIsLocating] = React.useState(false);

  // 클릭 이벤트 관통 방지 이중 락 레퍼런스
  const isMarkerClickRef = React.useRef(false);

  // 실수 터치 방지: 지도 빈 자리 클릭 시 임시 핀 & 미니 확인 팝업 상태
  const [pendingNewSpot, setPendingNewSpot] = React.useState<{ lat: number; lng: number } | null>(null);

  // [요구사항 1] 기본 줌(Level 1)을 초과하는 2단계 추가 디지털 줌 (1.0x -> 2.0x -> 3.0x)
  const [digitalZoom, setDigitalZoom] = React.useState<number>(1.0);

  // 지도 엔진 브릿지 (Kakao / VWorld 공용 좌표 변환·팬)
  const bridgeRef = React.useRef<MapCanvasBridge | null>(null);

  // [요구사항 4] 지도 최상위 뷰포트 컨테이너 ref
  const mapContainerRef = React.useRef<HTMLDivElement>(null);

  // [요구사항 4] 포인트 더블클릭/롱클릭 컨텍스트 메뉴 상태
  const [contextMenuSpot, setContextMenuSpot] = React.useState<FishingSpot | null>(null);
  const longPressTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressTriggeredRef = React.useRef(false);

  // [요구사항 4] 컨텍스트 메뉴 열기 헬퍼 (디지털 줌 상태에서는 시야가 튀지 않도록 유지, 일반 상태에서는 중앙 배치)
  const handleOpenContextMenu = React.useCallback((spot: FishingSpot) => {
    setContextMenuSpot(spot);
    if (digitalZoom <= 1.0) {
      setCenter(normalizeWgs84Center({ lat: spot.lat, lng: spot.lng }));
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
  const [internalFavoriteSpotIds] = React.useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('exfish_favorite_spot_ids');
        if (raw) return JSON.parse(raw);
      } catch {}
    }
    return [];
  });
  const favoriteSpotIds = externalFavoriteSpotIds || internalFavoriteSpotIds;
  const [internalViewOnlyFavorites] = React.useState(false);
  const viewOnlyFavorites = externalViewOnlyFavorites ?? internalViewOnlyFavorites;

  // 공기역학 채비 캘리브레이션 (루어 무게 g & PE 라인 호수)
  const [tackleConfig, setTackleConfig] = React.useState<TackleRigConfig>(() => getSavedTackleConfig());
  const { landingPoint, khoaDepthRecord: landingKhoaDepth } = useLandingKhoaDepth(
    selectedSpot,
    tackleConfig.calibratedDistanceMeters
  );

  const selectedSpotZoneHits = React.useMemo(() => {
    if (!selectedSpot || !prohibitedZones.length) return [];
    const spotHits = findZoneHitsAtPoint(selectedSpot.lat, selectedSpot.lng, prohibitedZones);
    const landingHits =
      landingPoint?.hasCasting
        ? findZoneHitsAtPoint(landingPoint.lat, landingPoint.lng, prohibitedZones)
        : [];
    const merged = new globalThis.Map<string, (typeof spotHits)[number]>();
    for (const h of [...spotHits, ...landingHits]) {
      if (!merged.has(h.feature.properties.zone_id)) {
        merged.set(h.feature.properties.zone_id, h);
      }
    }
    return Array.from(merged.values());
  }, [selectedSpot, landingPoint, prohibitedZones]);
  const [internalTacklePopoverOpen, setInternalTacklePopoverOpen] = React.useState(false);
  const isTacklePopoverOpen = externalIsTacklePopoverOpen ?? internalTacklePopoverOpen;
  const setIsTacklePopoverOpen = React.useCallback(
    (open: boolean) => {
      setInternalTacklePopoverOpen(open);
      onToggleTacklePopover?.(open);
    },
    [onToggleTacklePopover]
  );
  const [jigheadUnit, setJigheadUnit] = React.useState<'g' | 'oz'>('g');

  const updateTackle = React.useCallback(
    (updates: TackleUpdateParams) => {
      const updated = saveTackleConfig(updates);
      setTackleConfig(updated);
    },
    []
  );

  React.useEffect(() => {
    const handleTackleUpdate = () => {
      setTackleConfig(getSavedTackleConfig());
    };
    window.addEventListener('exfish_tackle_updated', handleTackleUpdate);
    return () => window.removeEventListener('exfish_tackle_updated', handleTackleUpdate);
  }, []);

  React.useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-map-mode', mapMode);
    }
  }, [mapMode]);



  // [요구사항 4] 화면 클릭/터치 좌표 추적 (디지털 줌 역산 좌표 계산용)
  const lastClientPosRef = React.useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // [요구사항 4] 위치 조정(미세 조정) 핀 드래그 추적 플래그
  const isDraggingAdjustMarkerRef = React.useRef<boolean>(false);

  const getCorrectLatLngFromClient = React.useCallback(
    (clientX: number, clientY: number): { lat: number; lng: number } | null => {
      return bridgeRef.current ? bridgeRef.current.screenToLatLng(clientX, clientY) : null;
    },
    []
  );

  const getScreenPosFromLatLng = React.useCallback(
    (lat: number, lng: number): { x: number; y: number } | null => {
      return bridgeRef.current ? bridgeRef.current.latLngToScreen(lat, lng) : null;
    },
    []
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

    if (digitalZoom <= 1.0 || !dragTrackerRef.current.isDragging) return;
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
      bridgeRef.current?.panByPixels(dx, dy);
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
    }
  };

  const handleZoomIn = () => {
    if (level > 1) {
      setLevel((prev) => Math.max(1, prev - 1));
    } else {
      setDigitalZoom((prev) => {
        if (prev < 1.5) return 2.0;
        return 3.0;
      });
      setVolumeToast('🔍 디지털 슈퍼 줌 (확대)');
    }
  };

  const handleZoomOut = () => {
    if (digitalZoom > 1.0) {
      setDigitalZoom((prev) => {
        if (prev > 2.5) return 2.0;
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
    if (level > 1 && digitalZoom > 1.0) {
      setDigitalZoom(1.0);
    }
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

  // 초기 진입 시 App.tsx에서 전달받은 userCoords를 재사용하여 중복 GPS 요청 없이 내 위치 및 최근접 포인트 이동
  const hasAutoLocatedRef = React.useRef(false);

  React.useEffect(() => {
    if (!userCoords || hasAutoLocatedRef.current) return;
    hasAutoLocatedRef.current = true;
    setMyLocation(userCoords);
    setGpsAccuracy(12);
    if (spots && spots.length > 0) {
      let nearest = spots[0];
      let minDist = Infinity;
      for (const s of spots) {
        const dLat = s.lat - userCoords.lat;
        const dLng = (s.lng - userCoords.lng) * Math.cos(userCoords.lat * Math.PI / 180);
        const distSq = dLat * dLat + dLng * dLng;
        if (distSq < minDist) {
          minDist = distSq;
          nearest = s;
        }
      }
      setCenter({ lat: nearest.lat, lng: nearest.lng });
      setLevel(2);
    } else {
      setCenter(userCoords);
      setLevel(4);
    }
  }, [userCoords, spots]);

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
      } catch {
        // ignore
      }
      setCenter({ lat: microAdjustSpot.lat, lng: microAdjustSpot.lng });
      setAdjustedPos({ lat: microAdjustSpot.lat, lng: microAdjustSpot.lng });
      setLevel(1);
      setPendingNewSpot(null);
    }
  }, [microAdjustSpot]);

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
                <span className="text-cyan-300">https://exfish.vercel.app</span>
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
      {(() => {
        const sharedCanvasProps: SharedMapCanvasProps = {
          center,
          level,
          digitalZoom,
          mapMode,
          isDarkMode,
          isSunMode,
          onCenterChange: setCenter,
          onLevelChange: setLevel,
          onWheelDigitalZoom: (deltaY: number) => {
            if (deltaY < 0 && digitalZoom < 3.0) {
              handleZoomIn();
            } else if (deltaY > 0 && digitalZoom > 1.0) {
              handleZoomOut();
            }
          },
          bridgeRef,
          mapContainerRef,
          displayedSpots,
          selectedSpot,
          favoriteSpotIds,
          shops,
          selectedShop,
          onSelectSpot,
          onSelectShop,
          pendingNewSpot,
          setPendingNewSpot,
          contextMenuSpot,
          setContextMenuSpot,
          onOpenContextMenu: handleOpenContextMenu,
          microAdjustSpot,
          adjustedPos,
          setAdjustedPos: (pos) => {
            if (pos) setAdjustedPos(pos);
          },
          isDraggingAdjustMarkerRef,
          castingConfigSpot,
          tempCastingEnabled,
          tempStartDeg,
          tempEndDeg,
          sweetSpotConfigSpot,
          tempUseSweetSpot,
          tempSweetSpots,
          isAddingSweetSpot,
          draftSweetPos,
          setDraftSweetPos,
          showCastingArrows,
          tackleConfig,
          weather,
          marine,
          tide,
          windUnit,
          currentUnit,
          landingPoint,
          landingKhoaDepth,
          myLocation,
          gpsAccuracy,
          expandedSweetId,
          setExpandedSweetId,
          setPendingDeleteSweetIdx,
          selectedNewRadius,
          pressStartPosRef,
          isCoarsePointer,
          skipAutoRecenterRef,
          onOpenDetail,
          prohibitedZones,
          currentUser,
          onZonesMutated: () => setZoneReloadTick((t) => t + 1),
          isDigitizingZones,
          digitizerPoints,
          setDigitizerPoints,
          onUndoDigitize: () => setDigitizerPoints((prev) => prev.slice(0, -1)),
          onResetDigitize: () => setDigitizerPoints([]),
          onCancelDigitize: exitZoneDigitizing,
          onSuccessDigitize: () => {
            exitZoneDigitizing();
            setZoneReloadTick((t) => t + 1);
          },
          isStrictAdmin,
          showHaeroadEnc,
          isMarkerClickRef,
          lastClientPosRef,
          longPressTimerRef,
          isLongPressTriggeredRef,
          activeTouchCountRef,
          lastMultiTouchAtRef,
          dragTrackerRef,
          handlePointerDown,
          handlePointerMove,
          handlePointerUp,
        };
        return mapProvider === 'vworld' ? (
          <VWorldMapCanvas {...sharedCanvasProps} />
        ) : (
          <KakaoMapCanvas {...sharedCanvasProps} />
        );
      })()}

      {selectedSpot && selectedSpotZoneHits.length > 0 && (
        <div className="fixed left-1/2 top-16 z-[55] w-[calc(100%-24px)] max-w-md -translate-x-1/2 rounded-xl border border-red-500/50 bg-red-950/90 px-3.5 py-2.5 text-xs text-red-100 shadow-xl backdrop-blur-md">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <div>
              <div className="font-bold text-red-200">
                {selectedSpotZoneHits[0].tier === 'confirmed_polygon'
                  ? '낚시금지/통제구역 경고 (공공 고시)'
                  : selectedSpotZoneHits[0].tier === 'community_reported'
                  ? '사용자 제보 금지구역 (공식 고시 미확인)'
                  : `인근 통제구역 주의 (${selectedSpotZoneHits[0].distanceM ?? ''}m 이내)`}
              </div>
              <div className="mt-0.5 text-[11px] text-red-200/90">
                {selectedSpotZoneHits[0].feature.properties.zone_name} — {selectedSpotZoneHits[0].feature.properties.reason}
              </div>
            </div>
          </div>
        </div>
      )}

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
              {isStrictAdmin && onMapClickForNewShop && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    isMarkerClickRef.current = true;
                    onMapClickForNewShop(pendingNewSpot.lat, pendingNewSpot.lng);
                    setPendingNewSpot(null);
                  }}
                  className="flex-1 py-1.5 px-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold transition shadow text-[11px] cursor-pointer"
                >
                  낚시점 등록
                </button>
              )}
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

      {/* 지도 우상단 플로팅 컨트롤: 보조 툴바 패널 & 비거리 예측 팝오버 (모바일 드로어 열림 시에만 모바일에서 숨김, PC는 상시 flex 유지) */}
      <div
        className={`absolute top-4 right-4 z-40 flex-col items-end gap-2 pointer-events-auto ${
          isMobileDrawerOpen ? 'hidden md:flex' : 'flex'
        }`}
      >
        {/* 보조 액션 단일 머티리얼 툴바 패널 (순수 지도 관련 아이콘만 유지) */}
        <div className="flex items-center bg-slate-900/90 backdrop-blur-md border border-slate-700/80 rounded-2xl p-0.5 shadow-2xl divide-x divide-slate-800/80">
          <div className="flex items-center gap-0 pr-0.5">
            {/* 연안 낚시금지구역 작도 */}
            <button
              onClick={() => (isDigitizingZones ? exitZoneDigitizing() : startZoneDigitizing())}
              className={`p-1.5 rounded-xl flex items-center justify-center transition active:scale-95 ${
                isDigitizingZones
                  ? 'bg-orange-600 text-white shadow-md shadow-orange-500/30'
                  : 'hover:bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
              title="낚시금지구역 직접 작도하기"
            >
              <PenTool size={15} />
            </button>

            {/* paedros@gmail.com 개인 실험용 해로드 ENC 오버레이 토글 */}
            {isStrictAdmin && (
              <button
                onClick={() => setShowHaeroadEnc((v) => !v)}
                className={`p-1.5 rounded-xl flex items-center justify-center transition active:scale-95 ${
                  showHaeroadEnc
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-500/30'
                    : 'hover:bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
                title="해로드 ENC 지형 오버레이 (paedros@gmail.com 실험용)"
              >
                <Layers size={16} />
              </button>
            )}
          </div>

          <div className="px-0.5">
            {/* GPS 내 위치 바로가기 버튼 (간결하고 직관적인 Material Locate 아이콘) */}
            <button
              onClick={handleLocateMe}
              disabled={isLocating}
              title="내 현재 GPS 위치 찾기 (고정밀 GPS)"
              className="p-1.5 hover:bg-slate-800 text-cyan-400 rounded-xl flex items-center justify-center transition active:scale-95"
            >
              {isLocating ? (
                <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <LocateFixed size={17} className="text-cyan-400" />
              )}
            </button>
          </div>

          <div className="pl-0.5 flex items-center gap-0">
            {/* [요구사항 1] 지도 확대 (카카오 기본 레벨1 초과 시 2단계 추가 디지털 줌) */}
            <button
              onClick={handleZoomIn}
              className="p-1.5 hover:bg-slate-800 text-slate-200 hover:text-cyan-300 rounded-xl flex items-center justify-center transition active:scale-95"
              title={level === 1 ? '디지털 슈퍼 줌인 (2단계 추가 확대)' : '지도 확대'}
              aria-label="확대"
            >
              <Plus size={15} />
            </button>
            {digitalZoom > 1.0 && (
              <span className="text-[10px] font-black font-mono text-cyan-300 px-1 py-0.5 rounded bg-cyan-950/90 border border-cyan-500/60 shadow-sm animate-pulse">
                {Math.round(digitalZoom)}x
              </span>
            )}
            <button
              onClick={handleZoomOut}
              className="p-1.5 hover:bg-slate-800 text-slate-200 hover:text-cyan-300 rounded-xl flex items-center justify-center transition active:scale-95"
              title="지도 축소"
              aria-label="축소"
            >
              <Minus size={15} />
            </button>
          </div>
        </div>

        {/* [요구사항 2-6] 비거리 예측 팝오버 (상단 고정 예측치 + 하단 스크롤 설정) */}
        {isTacklePopoverOpen && (
          <div
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            className="w-84 sm:w-96 max-w-[95vw] max-h-[85vh] supports-[height:100dvh]:max-h-[85dvh] bg-slate-950/95 border border-cyan-500/60 rounded-2xl shadow-2xl backdrop-blur text-white flex flex-col animate-fade-in text-sm pointer-events-auto overflow-hidden"
          >
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

              {/* [요구사항 1] 현재 선택 채비 기준 비거리·수심·유속·바닥안착·하강속도·흘림(증량권고) 단순 표기 */}
              {(() => {
                const currentVel = marine?.currentVelocity ?? 0.3;
                let depthM = 5.0;
                let isExposed = false;
                let bearingDeg: number | undefined;
                if (selectedSpot) {
                  const landingPt = computeCastingLandingPoint(selectedSpot, tackleConfig.calibratedDistanceMeters);
                  bearingDeg = landingPt.bearingDeg;
                  const curHr = new Date().getHours();
                  const tidePt =
                    tide?.hourlyCurve?.find((c) => c.isCurrent || c.hour === curHr) ||
                    tide?.hourlyCurve?.[0];
                  const nearestSt = findNearestKhoaStation(selectedSpot.lat, selectedSpot.lng);
                  const dInfo = resolveUnifiedWaterDepth({
                    spotLat: selectedSpot.lat,
                    spotLng: selectedSpot.lng,
                    targetLat: landingPt.lat,
                    targetLng: landingPt.lng,
                    spotType: selectedSpot.spot_type,
                    khoaDpwt: landingKhoaDepth?.dpwt ?? null,
                    khoaDpwtIsAtTarget: true,
                    datumZ0: nearestSt.station.datumZ0,
                    tideHeightCm: tidePt?.height,
                    pressureHpa: weather?.pressureHpa,
                    isPredictedTide: true,
                  });
                  depthM = dInfo.realDepthM;
                  isExposed = dInfo.isExposed;
                }
                const sinkRes = calculateSinkingPhysics(
                  tackleConfig.weightGrams,
                  depthM,
                  currentVel,
                  tackleConfig.baitConfig,
                  {
                    castBearingDeg: bearingDeg,
                    currentDirectionDeg: marine?.currentDirection,
                    peLineSize: tackleConfig.peLineSize,
                    honorFloatLayer: true,
                  }
                );
                const sinkCmPerSec = Math.round(sinkRes.effSinkSpeedMps * 100);
                return (
                  <div className="bg-slate-950/80 rounded-xl px-2.5 py-2 border border-cyan-500/30 space-y-1 text-[11px] font-mono">
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
                      <span className="text-slate-300">
                        비거리 <strong className="text-cyan-300 text-xs">{tackleConfig.calibratedDistanceMeters}m</strong>
                        <span className="text-slate-500 text-[10px]"> ({tackleConfig.totalWeightGrams ?? tackleConfig.weightGrams}g)</span>
                      </span>
                      <span className="text-slate-300">
                        수심 <strong className="text-sky-300">{isExposed ? '간출(0m)' : `${depthM.toFixed(1)}m`}</strong>
                      </span>
                      <span className="text-slate-300">
                        유속 <strong className="text-emerald-300">{currentVel.toFixed(1)}m/s</strong>
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 pt-1 border-t border-slate-800/80">
                      <span className="text-slate-300">
                        바닥안착 <strong className="text-amber-300">{sinkRes.fallTimeSec}초</strong>
                      </span>
                      <span className="text-slate-300">
                        하강속도 <strong className="text-cyan-200">{sinkCmPerSec}cm/s</strong>
                      </span>
                      {sinkRes.driftDistanceM > 0.3 && (
                        <span className="text-slate-300">
                          흘림 <strong className="text-emerald-300">+{sinkRes.driftDistanceM}m</strong>
                        </span>
                      )}
                    </div>
                    {sinkRes.canReachBottom === false && (
                      <div className="text-[10px] text-rose-400 font-semibold pt-0.5">
                        흘림 과도 · {sinkRes.recommendedMinWeightG}g+ 증량 권장
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* [요구사항 2-6-9, 1] 스크롤 가능한 상세 설정 영역 (flex-1 min-h-0으로 상단 고정 헤더 제외 남은 전체 높이 활용 및 하단 여백 확보) */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 pb-6 space-y-3.5 divide-y divide-slate-800/60">
              {/* 1. 로드 구분 (루어대 vs 원투대) */}
              <div className="space-y-1.5 pt-1">
                <div className="flex rounded-lg bg-slate-900 p-0.5 border border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      const newPower: RodPower = tackleConfig.rodPower === 'SURF' ? 'ML' : tackleConfig.rodPower;
                      const newLenM = tackleConfig.rodType === 'SURF' ? 2.6 : tackleConfig.rodLengthM;
                      const nextBaitType = tackleConfig.baitConfig?.type === 'LIVE' ? 'LURE' : (tackleConfig.baitConfig?.type || 'LURE');
                      updateTackle({
                        rodPower: newPower,
                        rodLengthM: newLenM,
                        baitType: nextBaitType,
                      });
                    }}
                    className={`flex-1 py-1.5 text-center text-xs sm:text-sm font-bold rounded-md transition cursor-pointer ${
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
                      const newLenM = [2.7, 3.3, 4.2, 4.5, 5.4].includes(tackleConfig.rodLengthM as any) ? tackleConfig.rodLengthM : 4.2;
                      const newW = tackleConfig.weightGrams < 30 ? 93.8 : tackleConfig.weightGrams;
                      updateTackle({
                        weightGrams: newW,
                        rodPower: 'SURF',
                        rodLengthM: newLenM,
                        baitType: 'LIVE',
                      });
                    }}
                    className={`flex-1 py-1.5 text-center text-xs sm:text-sm font-bold rounded-md transition cursor-pointer ${
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
                    <div className="grid grid-cols-6 gap-1">
                      {(['UL', 'L', 'ML', 'M', 'MH', 'H'] as RodPower[]).map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => updateTackle({ rodPower: p })}
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

                    {/* 루어대 전장 버튼 (m 단위) */}
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
                          onChange={(e) => updateTackle({ rodLengthM: Number(e.target.value) })}
                          className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                        />
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {[1.8, 2.1, 2.4, 2.6, 3.0].map((mVal) => (
                          <button
                            key={mVal}
                            type="button"
                            onClick={() => updateTackle({ rodLengthM: mVal })}
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
                  /* 원투대: 고정 규격 전장 */
                  <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">
                    <div className="grid grid-cols-5 gap-1">
                      {[2.7, 3.3, 4.2, 4.5, 5.4].map((mVal) => (
                        <button
                          key={mVal}
                          type="button"
                          onClick={() => updateTackle({ rodPower: 'SURF', rodLengthM: mVal })}
                          className={`py-2 px-1 rounded flex items-center justify-center transition cursor-pointer ${
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

              {/* 루어대 선택 시: 미끼 종류 (루어 / 캐스팅볼 / 메탈) 상세 설정 */}
              {tackleConfig.rodType === 'LURE' ? (
                <div className="space-y-3 pt-3">
                  <div className="flex justify-between items-center text-xs sm:text-sm">
                    <span className="text-slate-300 font-medium">미끼 종류:</span>
                    <span className="font-mono text-cyan-300 text-xs font-semibold">
                      {tackleConfig.baitConfig?.type === 'CASTING_BALL' ? (
                        tackleConfig.baitConfig.castingBallSubMode === 'VARIANT_FLOAT' ? (
                          `구멍찌 ${tackleConfig.baitConfig.castingBallHo ?? 1.0}호(${tackleConfig.baitConfig.castingBallWeightGrams ?? getVariantFloatWeightByHo(tackleConfig.baitConfig.castingBallHo ?? 1.0)}g) + 지그헤드 ${tackleConfig.baitConfig.jigheadWeightGrams ?? 1.0}g`
                        ) : (
                          `던질찌 ${tackleConfig.baitConfig.castingBallWeightGrams ?? 10.0}g + 지그헤드 ${tackleConfig.baitConfig.jigheadWeightGrams ?? 1.0}g`
                        )
                      ) : tackleConfig.baitConfig?.type === 'METAL' ? (
                        `메탈 ${tackleConfig.baitConfig.metalWeightGrams ?? 20}g`
                      ) : tackleConfig.baitConfig?.lureSubMode === 'JUKKUMI' ? (
                        (tackleConfig.baitConfig.sinkerWeightGrams ?? 0) === 0
                          ? `에기 ${tackleConfig.baitConfig.egiWeightGrams ?? 15}g (0g)`
                          : `에기 ${tackleConfig.baitConfig.egiWeightGrams ?? 15}g + 봉돌 ${tackleConfig.baitConfig.sinkerWeightGrams}g`
                      ) : (
                        `${tackleConfig.baitConfig?.lengthInches ?? 2}인치 ${LURE_SHAPE_NAMES[tackleConfig.baitConfig?.shape ?? 'GRUB']} (${tackleConfig.weightGrams}g)`
                      )}
                    </span>
                  </div>

                  {/* 미끼 종류 3개 탭: 루어 vs 캐스팅볼 vs 메탈 */}
                  <div className="flex rounded-lg bg-slate-900 p-0.5 border border-slate-800">
                    <button
                      type="button"
                      onClick={() => updateTackle({ baitType: 'LURE' })}
                      className={`flex-1 py-1.5 text-center text-xs font-bold rounded-md transition cursor-pointer ${
                        tackleConfig.baitConfig?.type === 'LURE' || !tackleConfig.baitConfig?.type
                          ? 'bg-cyan-500 text-slate-950 shadow'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      🐟 루어
                    </button>
                    <button
                      type="button"
                      onClick={() => updateTackle({ baitType: 'CASTING_BALL' })}
                      className={`flex-1 py-1.5 text-center text-xs font-bold rounded-md transition cursor-pointer ${
                        tackleConfig.baitConfig?.type === 'CASTING_BALL'
                          ? 'bg-cyan-500 text-slate-950 shadow'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      ⚪ 캐스팅볼
                    </button>
                    <button
                      type="button"
                      onClick={() => updateTackle({ baitType: 'METAL' })}
                      className={`flex-1 py-1.5 text-center text-xs font-bold rounded-md transition cursor-pointer ${
                        tackleConfig.baitConfig?.type === 'METAL'
                          ? 'bg-cyan-500 text-slate-950 shadow'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      ⚡ 메탈
                    </button>
                  </div>

                  {/* 1) 루어 선택 시: 추/봉돌 무게(그램, 온스, 주꾸미/애기) + 루어 길이 + 루어 형상 */}
                  {(tackleConfig.baitConfig?.type === 'LURE' || !tackleConfig.baitConfig?.type) && (
                    <div className="space-y-3 p-2.5 bg-slate-900/60 rounded-xl border border-slate-800">
                      {/* 카테고리 탭 (그램, 온스, 주꾸미/애기) */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-300 font-medium">루어 세부 분류:</span>
                          <span className="font-mono font-bold text-cyan-300">
                            {tackleConfig.baitConfig?.lureSubMode === 'JUKKUMI' ? (
                              (tackleConfig.baitConfig.sinkerWeightGrams ?? 0) === 0
                                ? `총 ${(tackleConfig.baitConfig.egiWeightGrams ?? 15)}g (0g)`
                                : `총 ${(tackleConfig.baitConfig.egiWeightGrams ?? 15) + (tackleConfig.baitConfig.sinkerWeightGrams ?? 0)}g`
                            ) : (
                              `${tackleConfig.weightGrams}g (${getWeightDescription(tackleConfig.weightGrams, tackleConfig.baitConfig)})`
                            )}
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-1 p-0.5 bg-slate-900 rounded-lg border border-slate-800">
                          {[
                            { cat: 'JIG' as LureSubMode, label: '그램(JIG)', desc: '1~5g' },
                            { cat: 'OZ' as LureSubMode, label: '온스(OZ)', desc: '1/32~2oz' },
                            { cat: 'JUKKUMI' as LureSubMode, label: '주꾸미/애기', desc: '에기+봉돌(0g~)' },
                          ].map((tab) => {
                            const isCurrent = (tackleConfig.baitConfig?.lureSubMode || 'OZ') === tab.cat;
                            return (
                              <button
                                key={tab.cat}
                                type="button"
                                onClick={() => updateTackle({ lureSubMode: tab.cat })}
                                className={`py-1.5 rounded text-center transition cursor-pointer ${
                                  isCurrent
                                    ? 'bg-slate-800 text-cyan-300 font-bold border border-cyan-500/50 shadow-xs'
                                    : 'text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                <div className="text-xs leading-tight">{tab.label}</div>
                                <div className="text-[9.5px] opacity-75 font-mono leading-tight">{tab.desc}</div>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* 1.2 주꾸미/에기 선택 시: 에기 무게 + 추 무게 (0g 노싱커 포함), 루어 길이 및 형상은 숨김 */}
                      {tackleConfig.baitConfig?.lureSubMode === 'JUKKUMI' ? (
                        <div className="space-y-3 pt-1 border-t border-slate-800/80">
                          {/* 에기(애기) 무게 */}
                          <div className="space-y-1.5">
                            <div className="flex justify-between items-center text-xs">
                              <span className="text-slate-300 font-medium">에기(애기) 무게:</span>
                              <span className="font-mono font-bold text-cyan-300">
                                {tackleConfig.baitConfig.egiWeightGrams ?? 15}g
                              </span>
                            </div>
                            <div className="grid grid-cols-5 gap-1">
                              {EGI_WEIGHT_PRESETS.map((preset) => (
                                <button
                                  key={preset.ho}
                                  type="button"
                                  onClick={() => updateTackle({ egiWeightGrams: preset.weightGrams })}
                                  className={`py-1 rounded text-xs font-mono transition text-center ${
                                    Math.abs((tackleConfig.baitConfig?.egiWeightGrams ?? 15) - preset.weightGrams) < 0.2
                                      ? 'bg-cyan-500 text-slate-950 font-bold shadow'
                                      : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
                                  }`}
                                >
                                  <div className="font-bold">{preset.label}</div>
                                  <div className="text-[9.5px] opacity-75">{preset.weightGrams}g</div>
                                </button>
                              ))}
                            </div>
                            <div className="px-1 pt-0.5">
                              <input
                                type="range"
                                min={5}
                                max={35}
                                step={0.5}
                                value={tackleConfig.baitConfig.egiWeightGrams ?? 15}
                                onChange={(e) => updateTackle({ egiWeightGrams: parseFloat(e.target.value) })}
                                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                              />
                              <div className="flex justify-between text-[10px] text-slate-400 font-mono mt-0.5">
                                <span>2.0호(6.5g)</span>
                                <span>2.5호(10g)</span>
                                <span>3.0호(15g)</span>
                                <span>3.5호(20g)</span>
                                <span>4.0호(25g)</span>
                              </div>
                            </div>
                          </div>

                          {/* 추(봉돌) 무게: 0g ~ 6호(22.5g) */}
                          <div className="space-y-1.5 pt-1.5 border-t border-slate-800/80">
                            <div className="flex justify-between items-center text-xs">
                              <span className="text-slate-300 font-medium">추/봉돌 무게:</span>
                              <span className="font-mono font-bold text-cyan-300">
                                {(tackleConfig.baitConfig.sinkerWeightGrams ?? 0) === 0 ? (
                                  <span className="text-emerald-400">0g</span>
                                ) : (
                                  `${tackleConfig.baitConfig.sinkerWeightGrams ?? 0}g (약 ${Math.round(((tackleConfig.baitConfig.sinkerWeightGrams ?? 0) / 3.75) * 10) / 10}호)`
                                )}
                              </span>
                            </div>
                            <div className="grid grid-cols-5 gap-1">
                              {JUKKUMI_SINKER_PRESETS.map((preset) => (
                                <button
                                  key={preset.ho}
                                  type="button"
                                  onClick={() => updateTackle({ sinkerWeightGrams: preset.weightGrams })}
                                  className={`py-1 rounded text-xs font-mono transition text-center ${
                                    Math.abs((tackleConfig.baitConfig?.sinkerWeightGrams ?? 0) - preset.weightGrams) < 0.2
                                      ? 'bg-cyan-500 text-slate-950 font-bold shadow'
                                      : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
                                  }`}
                                >
                                  <div className="font-bold">{preset.label}</div>
                                  {preset.ho > 0 && (
                                    <div className="text-[9.5px] opacity-75">{preset.weightGrams}g</div>
                                  )}
                                </button>
                              ))}
                            </div>
                            <div className="px-1 pt-0.5">
                              <input
                                type="range"
                                min={0}
                                max={22.5}
                                step={0.5}
                                value={Math.min(22.5, tackleConfig.baitConfig.sinkerWeightGrams ?? 0)}
                                onChange={(e) => updateTackle({ sinkerWeightGrams: parseFloat(e.target.value) })}
                                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                              />
                              <div className="flex justify-between text-[10px] text-slate-400 font-mono mt-0.5">
                                <span className="text-emerald-400">0g</span>
                                <span>11.3g(3호)</span>
                                <span>15g(4호)</span>
                                <span>18.8g(5호)</span>
                                <span>22.5g(6호)</span>
                              </div>
                            </div>
                          </div>

                          <div className="text-[10.5px] text-cyan-400/80 leading-tight">
                            * 주꾸미·갑오징어는 봉돌(3~6호), 무늬오징어·한치는 0g(에기 단독) 채비로 캐스팅 비거리와 침강 속도가 계산됩니다.
                          </div>
                        </div>
                      ) : (
                        /* 그램 / 온스 선택 시: 추/봉돌 프리셋 + 슬라이더 + 루어 길이 + 루어 형상 */
                        <div className="space-y-3 pt-1 border-t border-slate-800/80">
                          {/* 프리셋 버튼 목록 */}
                          <div className="space-y-1.5">
                            <div className="text-[11px] text-slate-400">봉돌 / 지그헤드 프리셋:</div>
                            <div className="flex flex-wrap gap-1 p-1.5 bg-slate-900/70 rounded-lg border border-slate-800">
                              {WEIGHT_PRESETS.filter(
                                (p) => p.category === (tackleConfig.baitConfig?.lureSubMode || 'OZ')
                              ).map((preset) => (
                                <button
                                  key={preset.id}
                                  type="button"
                                  onClick={() => updateTackle({ weightGrams: preset.weightGrams })}
                                  className={`px-2.5 py-1 rounded text-xs font-mono flex items-center gap-0.5 transition ${
                                    Math.abs(tackleConfig.weightGrams - preset.weightGrams) < 0.15
                                      ? 'bg-cyan-500 text-slate-950 font-bold shadow'
                                      : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
                                  }`}
                                >
                                  <span>{preset.label}</span>
                                  {tackleConfig.baitConfig?.lureSubMode === 'JIG' && (
                                    <span className="text-[9.5px] opacity-75">({preset.subLabel})</span>
                                  )}
                                </button>
                              ))}
                            </div>

                            {/* 슬라이더 */}
                            <div className="px-1 pt-0.5">
                              <input
                                type="range"
                                min={1}
                                max={60}
                                step={1}
                                value={Math.min(60, Math.round(tackleConfig.weightGrams))}
                                onChange={(e) => updateTackle({ weightGrams: Number(e.target.value) })}
                                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                              />
                              <div className="flex justify-between text-[10px] text-slate-400 font-mono mt-0.5">
                                <span>1g</span>
                                <span>14g(1/2oz)</span>
                                <span>28g(1oz)</span>
                                <span>60g</span>
                              </div>
                            </div>
                          </div>

                          {/* 루어 길이 */}
                          <div className="pt-1.5 border-t border-slate-800/80">
                            <div className="text-[11px] text-slate-400 mb-1">루어 길이:</div>
                            <div className="grid grid-cols-4 gap-1">
                              {[1, 2, 3, 4].map((len) => (
                                <button
                                  key={len}
                                  type="button"
                                  onClick={() => updateTackle({ baitLength: len })}
                                  className={`py-1 rounded text-xs font-mono transition ${
                                    (tackleConfig.baitConfig?.lengthInches || 2) === len
                                      ? 'bg-cyan-500 text-slate-950 font-bold shadow'
                                      : 'bg-slate-900 text-slate-400 border border-slate-800'
                                  }`}
                                >
                                  {len}인치
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* 루어 형상 */}
                          <div>
                            <div className="text-[11px] text-slate-400 mb-1">루어 형상:</div>
                            <div className="grid grid-cols-3 gap-1">
                              {LURE_SHAPES.map((shp) => (
                                <button
                                  key={shp}
                                  type="button"
                                  onClick={() => updateTackle({ baitShape: shp })}
                                  className={`py-1 rounded text-[11px] font-medium transition ${
                                    (tackleConfig.baitConfig?.shape || 'GRUB') === shp
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
                    </div>
                  )}

                  {/* 2) 캐스팅볼 선택 시: 던질찌 vs 구멍찌 선택 + 지그헤드 무게 + 루어 길이 + 루어 형상 */}
                  {tackleConfig.baitConfig?.type === 'CASTING_BALL' && (
                    <div className="space-y-3 p-2.5 bg-slate-900/60 rounded-xl border border-slate-800">
                      {/* 서브모드 탭: 던질찌 vs 구멍찌 */}
                      <div className="flex rounded-lg bg-slate-900 p-0.5 border border-slate-800">
                        <button
                          type="button"
                          onClick={() => updateTackle({ castingBallSubMode: 'REAL_BALL' })}
                          className={`flex-1 py-1.5 text-center text-xs font-bold rounded-md transition ${
                            (tackleConfig.baitConfig.castingBallSubMode || 'REAL_BALL') === 'REAL_BALL'
                              ? 'bg-cyan-500 text-slate-950 shadow'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          ⚪ 던질찌
                        </button>
                        <button
                          type="button"
                          onClick={() => updateTackle({ castingBallSubMode: 'VARIANT_FLOAT' })}
                          className={`flex-1 py-1.5 text-center text-xs font-bold rounded-md transition ${
                            tackleConfig.baitConfig.castingBallSubMode === 'VARIANT_FLOAT'
                              ? 'bg-cyan-500 text-slate-950 shadow'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          🎯 구멍찌
                        </button>
                      </div>

                      {/* 2.1 구멍찌: 규격표 직접 선택 (호수/무게/여부력/추천 지그헤드) + 1~40g 슬라이더 */}
                      {tackleConfig.baitConfig.castingBallSubMode === 'VARIANT_FLOAT' ? (
                        <div className="space-y-2">
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-slate-300 font-medium">구멍찌 규격 / 무게:</span>
                            <span className="font-mono font-bold text-cyan-300">
                              {tackleConfig.baitConfig.castingBallWeightGrams ?? getVariantFloatWeightByHo(tackleConfig.baitConfig.castingBallHo ?? 1.0)}g
                              <span className="text-[10.5px] text-slate-400 font-normal ml-1">
                                ({tackleConfig.baitConfig.castingBallHo ?? 1.0}호)
                              </span>
                            </span>
                          </div>

                          {/* 구멍찌 규격 선택 표 (버튼 없이 표 행 클릭으로 선택) */}
                          <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/70">
                            <table className="w-full text-[11px] font-mono text-center border-collapse">
                              <thead>
                                <tr className="bg-slate-900/90 text-slate-400 border-b border-slate-800">
                                  <th className="py-1.5 px-1.5 font-semibold">호수</th>
                                  <th className="py-1.5 px-1.5 font-semibold">무게</th>
                                  <th className="py-1.5 px-1.5 font-semibold">여부력</th>
                                  <th className="py-1.5 px-1.5 font-semibold">추천 지그헤드</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800/70">
                                {VARIANT_FLOAT_HO_PRESETS.map((row) => {
                                  const isRowSelected =
                                    Math.abs((tackleConfig.baitConfig?.castingBallHo ?? 1.0) - row.ho) < 0.05 &&
                                    Math.abs((tackleConfig.baitConfig?.castingBallWeightGrams ?? row.weightGrams) - row.weightGrams) < 0.1;
                                  return (
                                    <tr
                                      key={row.ho}
                                      role="button"
                                      tabIndex={0}
                                      onClick={() => updateTackle({ castingBallHo: row.ho, castingBallWeightGrams: row.weightGrams })}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                          e.preventDefault();
                                          updateTackle({ castingBallHo: row.ho, castingBallWeightGrams: row.weightGrams });
                                        }
                                      }}
                                      className={`cursor-pointer transition focus:outline-none focus:ring-1 focus:ring-cyan-400 ${
                                        isRowSelected
                                          ? 'bg-cyan-500/25 text-cyan-200 font-bold'
                                          : 'text-slate-300 hover:bg-slate-800/60'
                                      }`}
                                    >
                                      <td className="py-1.5 px-1.5">{row.ho.toFixed(1)}호</td>
                                      <td className="py-1.5 px-1.5">{row.weightGrams}g</td>
                                      <td className="py-1.5 px-1.5">{row.buoyancyG}g</td>
                                      <td className="py-1.5 px-1.5 text-emerald-300">{row.recJighead}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>

                          {/* 무게 슬라이더 (1~40g) */}
                          <div className="px-1 pt-0.5">
                            <input
                              type="range"
                              min={1}
                              max={40}
                              step={0.5}
                              value={Math.max(1, Math.min(40, tackleConfig.baitConfig.castingBallWeightGrams ?? getVariantFloatWeightByHo(tackleConfig.baitConfig.castingBallHo ?? 1.0)))}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                updateTackle({ castingBallWeightGrams: val });
                              }}
                              className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                            />
                            <div className="flex justify-between text-[10px] text-slate-400 font-mono mt-0.5">
                              <span>1g</span>
                              <span>10g</span>
                              <span>20g</span>
                              <span>30g</span>
                              <span>40g</span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* 2.1 던질찌: 버튼 3/5/7/10/20g (호수 미표기) + 슬라이더 1~40g */
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-slate-300 font-medium">던질찌 무게:</span>
                            <span className="font-mono font-bold text-cyan-300">
                              {tackleConfig.baitConfig.castingBallWeightGrams ?? 10.0}g
                            </span>
                          </div>

                          {/* 퀵 프리셋 버튼 */}
                          <div className="grid grid-cols-5 gap-1">
                            {REAL_CASTING_BALL_PRESETS.map((wVal) => (
                              <button
                                key={wVal}
                                type="button"
                                onClick={() => updateTackle({ castingBallWeightGrams: wVal })}
                                className={`py-1.5 rounded text-xs font-mono transition text-center ${
                                  Math.abs((tackleConfig.baitConfig?.castingBallWeightGrams ?? 10.0) - wVal) < 0.2
                                    ? 'bg-cyan-500 text-slate-950 font-bold shadow'
                                    : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
                                }`}
                              >
                                <div className="font-bold">{wVal}g</div>
                              </button>
                            ))}
                          </div>

                          {/* 슬라이더 (1~40g) */}
                          <div className="px-1 pt-0.5">
                            <input
                              type="range"
                              min={1}
                              max={40}
                              step={1}
                              value={Math.max(1, Math.min(40, tackleConfig.baitConfig.castingBallWeightGrams ?? 10.0))}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                updateTackle({ castingBallWeightGrams: val });
                              }}
                              className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                            />
                            <div className="flex justify-between text-[10px] text-slate-400 font-mono mt-0.5">
                              <span>1g</span>
                              <span>10g</span>
                              <span>20g</span>
                              <span>30g</span>
                              <span>40g</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* 지그헤드 무게: 그램, 온스 */}
                      <div className="space-y-1.5 pt-1.5 border-t border-slate-800/80">
                        <div className="flex justify-between items-center text-xs">
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-300 font-medium">지그헤드 무게:</span>
                            <div className="flex rounded bg-slate-900 border border-slate-800 p-0.5">
                              <button
                                type="button"
                                onClick={() => setJigheadUnit('g')}
                                className={`px-1.5 py-0.5 text-[10px] rounded transition ${
                                  jigheadUnit === 'g' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400'
                                }`}
                              >
                                그램
                              </button>
                              <button
                                type="button"
                                onClick={() => setJigheadUnit('oz')}
                                className={`px-1.5 py-0.5 text-[10px] rounded transition ${
                                  jigheadUnit === 'oz' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400'
                                }`}
                              >
                                온스
                              </button>
                            </div>
                          </div>
                          <span className="font-mono font-bold text-cyan-300">
                            {tackleConfig.baitConfig.jigheadWeightGrams ?? 1.0}g
                          </span>
                        </div>

                        {/* 지그헤드 프리셋 버튼 */}
                        <div className={`grid ${jigheadUnit === 'g' ? 'grid-cols-4' : 'grid-cols-5'} gap-1`}>
                          {JIGHEAD_PRESETS.filter((p) => p.type === jigheadUnit).map((preset) => (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => updateTackle({ jigheadWeightGrams: preset.weightGrams })}
                              className={`py-1 rounded text-xs font-mono transition text-center ${
                                Math.abs((tackleConfig.baitConfig?.jigheadWeightGrams ?? 1.0) - preset.weightGrams) < 0.1
                                  ? 'bg-cyan-500 text-slate-950 font-bold shadow'
                                  : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
                              }`}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>

                        {/* 지그헤드 슬라이더 (0.5~20g) */}
                        <div className="px-1 pt-0.5">
                          <input
                            type="range"
                            min={0.5}
                            max={20.0}
                            step={0.5}
                            value={Math.max(0.5, Math.min(20.0, tackleConfig.baitConfig.jigheadWeightGrams ?? 1.0))}
                            onChange={(e) => updateTackle({ jigheadWeightGrams: parseFloat(e.target.value) })}
                            className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                          />
                          <div className="flex justify-between text-[10px] text-slate-400 font-mono mt-0.5">
                            <span>0.5g</span>
                            <span>5g</span>
                            <span>10g</span>
                            <span>15g</span>
                            <span>20g</span>
                          </div>
                        </div>
                      </div>

                      {/* 루어 길이 */}
                      <div className="pt-1.5 border-t border-slate-800/80">
                        <div className="text-[11px] text-slate-400 mb-1">루어 길이:</div>
                        <div className="grid grid-cols-4 gap-1">
                          {[1, 2, 3, 4].map((len) => (
                            <button
                              key={len}
                              type="button"
                              onClick={() => updateTackle({ baitLength: len })}
                              className={`py-1 rounded text-xs font-mono transition ${
                                (tackleConfig.baitConfig?.lengthInches || 2) === len
                                  ? 'bg-cyan-500 text-slate-950 font-bold shadow'
                                  : 'bg-slate-900 text-slate-400 border border-slate-800'
                              }`}
                            >
                              {len}인치
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 루어 형상 */}
                      <div>
                        <div className="text-[11px] text-slate-400 mb-1">루어 형상:</div>
                        <div className="grid grid-cols-3 gap-1">
                          {LURE_SHAPES.map((shp) => (
                            <button
                              key={shp}
                              type="button"
                              onClick={() => updateTackle({ baitShape: shp })}
                              className={`py-1 rounded text-[11px] font-medium transition ${
                                (tackleConfig.baitConfig?.shape || 'GRUB') === shp
                                  ? 'bg-cyan-500 text-slate-950 font-bold shadow'
                                  : 'bg-slate-900 text-slate-400 border border-slate-800'
                              }`}
                            >
                              {LURE_SHAPE_NAMES[shp]}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="text-[10.5px] text-cyan-400/80 leading-tight">
                        * {tackleConfig.baitConfig.castingBallSubMode === 'VARIANT_FLOAT'
                          ? '구멍찌(공기저항계수 Cd 0.52)'
                          : '던질찌(공기저항계수 Cd 0.36)'} + 지그헤드 + 웜 자중이 전체 채비 무게로 합산되어 공기역학적 비거리가 계산됩니다.
                      </div>
                    </div>
                  )}

                  {/* 3) 메탈 선택 시: 메탈 무게 (1~80g) */}
                  {tackleConfig.baitConfig?.type === 'METAL' && (
                    <div className="space-y-3 p-2.5 bg-slate-900/60 rounded-xl border border-slate-800">
                      {/* 메탈 무게: 1~80g */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-300 font-medium">메탈 무게 (1~80g):</span>
                          <span className="font-mono font-bold text-cyan-300">
                            {tackleConfig.baitConfig.metalWeightGrams ?? 20}g
                          </span>
                        </div>

                        {/* 메탈 무게 퀵 프리셋 버튼 (10g~40g) */}
                        <div className="grid grid-cols-4 gap-1">
                          {METAL_WEIGHT_PRESETS.map((wVal) => (
                            <button
                              key={wVal}
                              type="button"
                              onClick={() => updateTackle({ metalWeightGrams: wVal, weightGrams: wVal })}
                              className={`py-1 rounded text-xs font-mono transition text-center ${
                                Math.abs((tackleConfig.baitConfig?.metalWeightGrams ?? 20) - wVal) < 0.2
                                  ? 'bg-cyan-500 text-slate-950 font-bold shadow'
                                  : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
                              }`}
                            >
                              {wVal}g
                            </button>
                          ))}
                        </div>

                        {/* 메탈 무게 슬라이더 (1~80g) */}
                        <div className="px-1 pt-0.5">
                          <input
                            type="range"
                            min={1}
                            max={80}
                            step={1}
                            value={tackleConfig.baitConfig.metalWeightGrams ?? 20}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              updateTackle({ metalWeightGrams: val, weightGrams: val });
                            }}
                            className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                          />
                          <div className="flex justify-between text-[10px] text-slate-400 font-mono mt-0.5">
                            <span>1g</span>
                            <span>20g</span>
                            <span>40g</span>
                            <span>60g</span>
                            <span>80g</span>
                          </div>
                        </div>
                      </div>

                      <div className="text-[10.5px] text-cyan-400/80 leading-tight">
                        * 메탈 지그는 자체 중량과 우수한 공기역학으로 초원거리 캐스팅에 최적화되어 있습니다.
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* 원투대 선택 시: 원투 봉돌 무게 선택 (현행대로) */
                <div className="space-y-2 pt-3">
                  <div className="flex justify-between items-center text-xs sm:text-sm">
                    <span className="text-slate-300 font-medium">원투 봉돌 무게 선택:</span>
                    <span className="font-mono font-bold text-amber-300">
                      {tackleConfig.weightGrams}g
                      <span className="text-[10.5px] text-slate-400 font-normal ml-1">
                        (약 {Math.round((tackleConfig.weightGrams / 3.75) * 10) / 10}호)
                      </span>
                    </span>
                  </div>

                  {/* 원투 봉돌 퀵 프리셋 버튼 (16~40호) */}
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-1 p-1 bg-slate-900/70 rounded-lg border border-slate-800">
                    {WEIGHT_PRESETS.filter((p) => p.category === 'SURF').map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => updateTackle({ weightGrams: preset.weightGrams })}
                        className={`py-1.5 px-1 rounded text-xs font-mono text-center transition ${
                          Math.abs(tackleConfig.weightGrams - preset.weightGrams) < 0.15
                            ? 'bg-amber-500 text-slate-950 font-bold shadow'
                            : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
                        }`}
                      >
                        <div className="font-bold">{preset.label}</div>
                        <div className="text-[9.5px] opacity-75">{preset.subLabel}</div>
                      </button>
                    ))}
                  </div>

                  {/* 원투 봉돌 슬라이더 (10호~40호) */}
                  <div className="px-1 pt-0.5">
                    <input
                      type="range"
                      min={37.5}
                      max={150}
                      step={3.75}
                      value={tackleConfig.weightGrams}
                      onChange={(e) => updateTackle({ weightGrams: Number(e.target.value) })}
                      className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
                    />
                    <div className="flex justify-between text-[10px] text-slate-400 font-mono mt-0.5">
                      <span>10호(38g)</span>
                      <span>20호(75g)</span>
                      <span>30호(113g)</span>
                      <span>40호(150g)</span>
                    </div>
                  </div>
                  <div className="text-[10.5px] text-amber-400/80 leading-tight">
                    * 원투 전용 고중량 봉돌과 표준 생미끼(+2.5g)를 결합하여 비거리를 산출합니다.
                  </div>
                </div>
              )}

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
                    onChange={(e) => updateTackle({ peLineSize: Number(e.target.value) })}
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
              onConfirmMicroAdjust?.(microAdjustSpot.id, adjustedPos.lat, adjustedPos.lng);
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

              <div className="flex items-center gap-1 text-cyan-300 leading-none font-bold" title={`풍향 ${Math.round(weather.windDirection)}°`}>
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

          {/* 2행: 수온 + 물때 + 조류 (1pt 확대한 12px, 수온 텍스트 제거, 우하단 그림자) */}
          {(marine?.seaSurfaceTemp !== undefined || tide?.mulText || (marine?.currentVelocity !== undefined && marine.currentVelocity > 0.05)) && (
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

              {marine?.currentVelocity !== undefined && marine.currentVelocity > 0.05 && (
                <span className="text-[11px] font-bold text-emerald-300 leading-none flex items-center gap-0.5">
                  <span className="text-slate-400">·</span>
                  <div
                    className="w-3.5 h-3.5 flex items-center justify-center text-[9px] font-bold text-emerald-400"
                    style={{ transform: `rotate(${marine.currentDirection}deg)` }}
                  >
                    ↑
                  </div>
                  <span className="font-mono">{formatCurrentVelocity(marine.currentVelocity, currentUnit)}</span>
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* [요구사항 10.1] 지도 좌하단 포인트 조작 안내 칩 (카카오맵 로고·축척 바와 겹치지 않도록 상단 여백 확보) */}
      <div className="absolute bottom-10 left-3 z-20 bg-slate-950/80 backdrop-blur-sm border border-slate-800/90 rounded-full px-2.5 py-1 text-[10px] text-slate-300 flex items-center gap-1.5 shadow-md select-none pointer-events-none">
        <span>포인트 클릭=보기, 길게 클릭=메뉴</span>
      </div>
    </div>
  );
};
