import React from 'react';
import { ChevronUp, Crosshair, Download, Filter, HelpCircle, List, Loader2, LogIn, Map as MapIcon, Moon, Navigation2, Satellite, Search, Sun, User, X } from 'lucide-react';
import { MapView, type MapMode } from './components/MapView';
import { SpotDetailPanel } from './components/SpotDetailPanel';
import { SpotFormModal } from './components/SpotFormModal';
import { CatchLogModal } from './components/CatchLogModal';
import { type AuthUser, getSavedAuthUser, LoginModal } from './components/LoginModal';
import { SpotListModal, type SpotRealtimeSummary } from './components/SpotListModal';
import { BiteScoreHelpModal } from './components/BiteScoreHelpModal';
import { ChecklistModal } from './components/ChecklistModal';
import { SplashScreen } from './components/SplashScreen';
import type {
  BiteScoreBreakdown,
  CatchLog,
  CurrentUnit,
  FishingMethod,
  FishingSpot,
  MarineData,
  TideDayInfo,
  WeatherData,
  WindUnit
} from './types';
import { calculateTideDay, getDistanceKm } from './utils/tideEngine';
import { getKhoaTideForecast } from './utils/tideService';
import type { KhoaSwtcWeeklyResult } from './utils/khoaSwtcApi';
import { fetchMarineData, fetchWeatherData, formatWindSpeed, getCompassDirection, getWeatherText } from './utils/weatherApi';
import { calculateBiteScore } from './utils/biteScore';
import { extractExifFromImage } from './utils/exifExtractor';
import { searchPoi, type PoiSearchResult } from './utils/poiSearch';
import {
  deleteCloudCatchLog,
  deleteCloudSpot,
  fetchCloudLogs,
  fetchCloudSpots,
  getSupabase,
  saveCloudCatchLog,
  saveCloudSpot,
} from './utils/cloudDb';
import { cacheSpotMetadata, getAllCachedSpots, subscribeNetworkStatus } from './utils/offlineStorage';
import { loadLogsFromStorage, saveLogsToStorage } from './utils/storage';
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { setupHardwareBackButtonListener, isNativePlatform, getNativeLocation } from './utils/nativeBridge';
import { parseOAuthCallback, processOAuthCallbackResult, parseAppDeepLink } from './services/oauthService';
import { APP_VERSION } from './version';

export function App() {
  const [spots, setSpots] = React.useState<FishingSpot[]>([]);
  const [catchLogs, setCatchLogs] = React.useState<CatchLog[]>(() => {
    return loadLogsFromStorage();
  });
  const [selectedSpot, setSelectedSpot] = React.useState<FishingSpot | null>(null);
  const [editingSpot, setEditingSpot] = React.useState<FishingSpot | null>(null);
  const [editingCatchLog, setEditingCatchLog] = React.useState<CatchLog | null>(null);

  // 모바일 드로워 표시 상태 (모바일 시작 시 지도 우선 표시 위해 초기값 false, PC는 true)
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = React.useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 768;
    }
    return false;
  });

  // 로그인 상태 관리 (소셜 로그인 및 30일 세션 유지)
  const [currentUser, setCurrentUser] = React.useState<AuthUser | null>(() => getSavedAuthUser());
  const [isLoginModalOpen, setIsLoginModalOpen] = React.useState(false);

  // 네이버, 카카오, 구글 소셜 로그인 콜백 수신 및 자동 처리 (웹 SPA)
  React.useEffect(() => {
    const callbackData = parseOAuthCallback();
    if (callbackData) {
      // URL 해시 및 쿼리 파라미터 안전하게 정리하여 브라우저 재진입 루프 방지
      window.history.replaceState({}, document.title, window.location.pathname);

      processOAuthCallbackResult(callbackData).then((res) => {
        if (res.user) {
          setCurrentUser(res.user);
          if (res.user.windUnit) setWindUnit(res.user.windUnit);
          if (res.user.currentUnit) setCurrentUnit(res.user.currentUnit);
          setIsLoginModalOpen(false);
        }
      });
    }
  }, []);

  // 모바일 앱 딥링크 (com.tlogger.exfish://oauth?...) 리스너 등록
  React.useEffect(() => {
    let sub: any = null;
    try {
      sub = CapApp.addListener('appUrlOpen', async (data) => {
        if (!data || !data.url) return;
        if (data.url.startsWith('com.tlogger.exfish://oauth')) {
          try {
            await Browser.close();
          } catch {}

          const callbackData = parseAppDeepLink(data.url);
          if (callbackData) {
            processOAuthCallbackResult(callbackData).then((res) => {
              if (res.user) {
                setCurrentUser(res.user);
                if (res.user.windUnit) setWindUnit(res.user.windUnit);
                if (res.user.currentUnit) setCurrentUnit(res.user.currentUnit);
                setIsLoginModalOpen(false);
              }
            });
          }
        }
      });
    } catch (e) {
      console.warn('Capacitor App listener not active:', e);
    }

    return () => {
      if (sub && typeof sub.then === 'function') {
        sub.then((s: any) => s.remove && s.remove());
      }
    };
  }, []);

  // 환경 데이터 상태
  const [weather, setWeather] = React.useState<WeatherData | null>(null);
  const [marine, setMarine] = React.useState<MarineData | null>(null);
  const [tide, setTide] = React.useState<TideDayInfo | null>(null);
  const activeSwtcWeeklyRef = React.useRef<KhoaSwtcWeeklyResult | null>(null);
  const [biteScore, setBiteScore] = React.useState<BiteScoreBreakdown | null>(null);

  // 단위 변환 설정 상태 (사용자 프로필 설정과 동기화)
  const [windUnit, setWindUnit] = React.useState<WindUnit>(() => {
    const user = getSavedAuthUser();
    return user?.windUnit || 'ms';
  });
  const [currentUnit, setCurrentUnit] = React.useState<CurrentUnit>(() => {
    const user = getSavedAuthUser();
    return user?.currentUnit || 'ms';
  });

  // 필터 및 검색 상태
  const [searchQuery, setSearchQuery] = React.useState('');
  const [selectedMethodFilter, setSelectedMethodFilter] = React.useState<FishingMethod | 'ALL'>('ALL');
  const [viewOnlyMySpots, setViewOnlyMySpots] = React.useState(false);

  // POI 검색 및 지도 이동 상태
  const [poiResults, setPoiResults] = React.useState<PoiSearchResult[]>([]);
  const [isSearchingPoi, setIsSearchingPoi] = React.useState(false);
  const [showPoiDropdown, setShowPoiDropdown] = React.useState(false);
  const [recenterTarget, setRecenterTarget] = React.useState<{ lat: number; lng: number; zoom?: number } | null>(null);

  // 모달 상태
  const [isSpotModalOpen, setIsSpotModalOpen] = React.useState(false);
  const [isCatchLogModalOpen, setIsCatchLogModalOpen] = React.useState(false);
  const [isSpotListModalOpen, setIsSpotListModalOpen] = React.useState(false);
  const [isHelpModalOpen, setIsHelpModalOpen] = React.useState(false);
  const [isChecklistModalOpen, setIsChecklistModalOpen] = React.useState(false);
  // 모바일 앱 초기 1초 스플래시 스크린 표시 상태 (웹 환경은 스플래시 생략)
  const [showSplash, setShowSplash] = React.useState(() => isNativePlatform());
  const [newSpotLat, setNewSpotLat] = React.useState<number | undefined>();
  const [newSpotLng, setNewSpotLng] = React.useState<number | undefined>();
  const [microAdjustSpot, setMicroAdjustSpot] = React.useState<FishingSpot | null>(null);

  // [요구사항 6] 나만의 즐겨찾기(찜한 포인트) 목록 상태 (로컬 스토리지 및 세션 동기화)
  const [favoriteSpotIds, setFavoriteSpotIds] = React.useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('exfish_favorite_spot_ids');
        if (raw) return JSON.parse(raw);
      } catch {}
    }
    return [];
  });

  const handleToggleFavorite = React.useCallback((spotId: string) => {
    setFavoriteSpotIds((prev) => {
      const next = prev.includes(spotId) ? prev.filter((id) => id !== spotId) : [...prev, spotId];
      if (typeof window !== 'undefined') {
        localStorage.setItem('exfish_favorite_spot_ids', JSON.stringify(next));
      }
      return next;
    });
  }, []);

  // [요구사항 2] Android 하드웨어 백 버튼 리스너 (기본 지도 뷰 복귀 제어)
  React.useEffect(() => {
    const cleanup = setupHardwareBackButtonListener(() => {
      // 1. 모달들이 열려 있으면 최우선으로 닫기
      if (isSpotModalOpen) {
        setIsSpotModalOpen(false);
        return true;
      }
      if (isCatchLogModalOpen) {
        setIsCatchLogModalOpen(false);
        return true;
      }
      if (isSpotListModalOpen) {
        setIsSpotListModalOpen(false);
        return true;
      }
      if (isLoginModalOpen) {
        setIsLoginModalOpen(false);
        return true;
      }
      if (isHelpModalOpen) {
        setIsHelpModalOpen(false);
        return true;
      }
      if (isChecklistModalOpen) {
        setIsChecklistModalOpen(false);
        return true;
      }
      // 2. 미세조정 모드이면 취소
      if (microAdjustSpot) {
        setMicroAdjustSpot(null);
        return true;
      }
      // 3. 모바일 상세 드로어가 열려 있으면 닫고 지도 뷰로
      if (isMobileDrawerOpen) {
        setIsMobileDrawerOpen(false);
        return true;
      }
      // 4. 선택된 포인트가 있으면 선택 해제 (기본 지도 뷰)
      if (selectedSpot) {
        setSelectedSpot(null);
        return true;
      }
      // 5. 기본 지도 뷰 상태: false 반환하여 앱 종료 방지 및 2초 내 더블 클릭 감지
      return false;
    });

    return cleanup;
  }, [
    isSpotModalOpen,
    isCatchLogModalOpen,
    isSpotListModalOpen,
    isLoginModalOpen,
    isHelpModalOpen,
    isChecklistModalOpen,
    microAdjustSpot,
    isMobileDrawerOpen,
    selectedSpot,
  ]);

  // 아웃도어 초고대비 모드 (Sun Mode: WCAG AAA 7:1), 지도 뷰 모드, 오프라인 상태 관리
  const [mapMode, setMapMode] = React.useState<MapMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('exfish_map_mode');
      if (saved === 'HYBRID' || saved === 'DARK') return saved;
    }
    return 'ROADMAP';
  });

  const handleMapModeChange = React.useCallback((mode: MapMode) => {
    setMapMode(mode);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('exfish_map_mode', mode);
        document.documentElement.setAttribute('data-map-mode', mode);
      } catch {
        // ignore
      }
    }
  }, []);

  const [isSunMode, setIsSunMode] = React.useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('exfish_sun_mode') === 'true';
    }
    return false;
  });
  const [isOffline, setIsOffline] = React.useState<boolean>(() => typeof navigator !== 'undefined' && !navigator.onLine);

  React.useEffect(() => {
    if (typeof document !== 'undefined' && isSunMode) {
      document.body.classList.add('sun-mode-active');
    }
    const unsub = subscribeNetworkStatus((online) => {
      setIsOffline(!online);
    });
    return unsub;
  }, [isSunMode]);

  // 포인트별 실시간 환경 요약 캐시 (리스트 보기 전용)
  const [environmentMap, setEnvironmentMap] = React.useState<Record<string, SpotRealtimeSummary>>({});
  const [userLocation, setUserLocation] = React.useState<{ lat: number; lng: number } | null>(null);

  // 기기 로컬 저장소 및 Supabase DB 조과 데이터 로드 (오프라인 시 로컬 캐시 폴백)
  const reloadData = React.useCallback(async () => {
    try {
      const [cSpots, cLogs] = await Promise.all([
        fetchCloudSpots(),
        fetchCloudLogs(),
      ]);
      setSpots(cSpots);
      setCatchLogs(cLogs);
      saveLogsToStorage(cLogs);
      // 오프라인 대비 로컬 캐시 백업
      cSpots.forEach((s) => cacheSpotMetadata(s));
      if (cSpots.length > 0 && !selectedSpot) {
        // [요구사항 6] URL Query Parameter에 ?spot=spotId 가 있는 경우 해당 스팟을 우선 선택 및 중심 이동
        let targetSpot = cSpots[0];
        let shouldCenter = false;
        let hasUrlParam = false;
        if (typeof window !== 'undefined') {
          const params = new URLSearchParams(window.location.search);
          const spotParam = params.get('spot');
          if (spotParam) {
            const found = cSpots.find((s) => s.id === spotParam || s.id === decodeURIComponent(spotParam));
            if (found) {
              targetSpot = found;
              shouldCenter = true;
              hasUrlParam = true;
              setIsMobileDrawerOpen(true);
            }
          }
        }
        // URL 지정 스팟이 없고 사용자 위치가 파악되어 있다면 가장 가까운 포인트로 자동 중심 이동
        if (!hasUrlParam && userLocation) {
          let minDist = Infinity;
          for (const s of cSpots) {
            const d = getDistanceKm(userLocation.lat, userLocation.lng, s.lat, s.lng);
            if (d < minDist) {
              minDist = d;
              targetSpot = s;
            }
          }
          shouldCenter = true;
        }
        handleSelectSpot(targetSpot, shouldCenter);
      }
    } catch (err) {
      console.warn('Supabase 데이터 로드 실패, 오프라인 로컬 캐시 복원 시도:', err);
      const cached = getAllCachedSpots();
      if (cached.length > 0) {
        setSpots(cached);
        if (!selectedSpot) handleSelectSpot(cached[0], false);
      }
      const localLogs = loadLogsFromStorage();
      if (localLogs && localLogs.length > 0) {
        setCatchLogs(localLogs);
      }
    }
  }, [selectedSpot, userLocation]);

  React.useEffect(() => {
    reloadData();
  }, [reloadData]);

  // 사용자 GPS 현재 위치 백그라운드 확인 및 초기 지도 중심을 내 위치에서 가장 가까운 포인트로 이동
  const hasAutoNearestSpotRef = React.useRef(false);

  React.useEffect(() => {
    getNativeLocation()
      .then((pos) => {
        const userPos = { lat: pos.lat, lng: pos.lng };
        setUserLocation(userPos);

        const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
        const hasUrlSpot = Boolean(params && params.get('spot'));

        if (!hasUrlSpot && spots.length > 0 && !hasAutoNearestSpotRef.current) {
          hasAutoNearestSpotRef.current = true;
          let nearestSpot = spots[0];
          let minDist = Infinity;
          for (const s of spots) {
            const d = getDistanceKm(userPos.lat, userPos.lng, s.lat, s.lng);
            if (d < minDist) {
              minDist = d;
              nearestSpot = s;
            }
          }
          handleSelectSpot(nearestSpot, true);
          setRecenterTarget({ lat: nearestSpot.lat, lng: nearestSpot.lng, zoom: 15 });
        }
      })
      .catch((err) => {
        console.warn('Initial geolocation notice:', err);
      });
  }, [spots]);

  // 모든 포인트의 실시간 요약 데이터(환경 & 물때 & 입질지수) 백그라운드 병렬 수집
  React.useEffect(() => {
    if (spots.length === 0) return;

    let isMounted = true;
    const loadSummaries = async () => {
      const now = new Date();
      const currentHour = now.getHours();

      // 주요 포인트별 동시 요청 수 제한(배치 4개씩)을 통한 네트워크 과부하 및 Open-Meteo 429 차단 방지
      const entries: (readonly [string, SpotRealtimeSummary] | null)[] = [];
      const BATCH_SIZE = 4;
      for (let i = 0; i < spots.length; i += BATCH_SIZE) {
        if (!isMounted) break;
        const chunk = spots.slice(i, i + BATCH_SIZE);
        const chunkResults = await Promise.all(
          chunk.map(async (spot) => {
            try {
              const tideData = calculateTideDay(spot.lat, spot.lng, now);
              const currentTide = tideData.hourlyCurve.find((c) => c.hour === currentHour);

              const [w, m] = await Promise.all([
                fetchWeatherData(spot.lat, spot.lng),
                fetchMarineData(spot.lat, spot.lng),
              ]);

              const bScore = calculateBiteScore(spot, w, m, tideData, currentUser?.favoriteSpecies);
              const dist = userLocation
                ? getDistanceKm(userLocation.lat, userLocation.lng, spot.lat, spot.lng)
                : undefined;

              const summary: SpotRealtimeSummary = {
                temp: w.temp,
                weatherText: w.weatherText,
                windSpeed: w.windSpeed,
                windDir: w.windDirection,
                seaTemp: m.seaSurfaceTemp,
                waveHeight: m.waveHeight,
                currentVel: m.currentVelocity,
                currentDir: m.currentDirection,
                mulText: tideData.mulText,
                tideHeight: currentTide?.height ?? 0,
                biteScore: bScore.totalScore,
                distanceKm: dist,
              };
              return [spot.id, summary] as const;
            } catch {
              return null;
            }
          })
        );
        entries.push(...chunkResults);
      }

      if (isMounted) {
        const nextMap: Record<string, SpotRealtimeSummary> = {};
        for (const item of entries) {
          if (item) {
            nextMap[item[0]] = item[1];
          }
        }
        setEnvironmentMap(nextMap);
      }
    };

    loadSummaries();
    return () => {
      isMounted = false;
    };
  }, [spots, userLocation, currentUser?.favoriteSpecies]);

  // Supabase 실시간 동기화 구독 (PC ⇄ 모바일 실시간 전파)
  React.useEffect(() => {
    const client = getSupabase();

    const channel = client
      .channel('espfish_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fishing_spots' }, async () => {
        try {
          const cSpots = await fetchCloudSpots();
          setSpots(cSpots);
        } catch (e) {
          console.error('Realtime spot reload error:', e);
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'catch_logs' }, async () => {
        try {
          const cLogs = await fetchCloudLogs();
          setCatchLogs(cLogs);
        } catch (e) {
          console.error('Realtime log reload error:', e);
        }
      })
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, []);

  // 포인트 선택 시 날씨/해양/물때/입질지수 Fetch & 연산
  const handleSelectSpot = React.useCallback(
    async (spot: FishingSpot, shouldRecenter: boolean = true, openMobileDrawer: boolean = false) => {
      setSelectedSpot(spot);
      if (openMobileDrawer) {
        setIsMobileDrawerOpen(true);
      }
      if (shouldRecenter) {
        // [요구사항 3] 공통: 포인트 클릭 시 캐스팅 비거리가 다 나오도록 최적 스케일 확대 (18 - zoom = kakaoLevel)
        // 원투(SURF): kakaoLevel 4 (zoom 14, 약 150m 반경), 루어/찌: kakaoLevel 3 (zoom 15, 약 70~80m 반경)
        const isSurf = spot.fishing_methods && spot.fishing_methods.includes('SURF');
        setRecenterTarget({ lat: spot.lat, lng: spot.lng, zoom: isSurf ? 14 : 15 });
      }

      activeSwtcWeeklyRef.current = null;
      // 1. 단일 마스터 시계열 조위 엔진 정밀 계산 (곡선 및 시간표 100% 완전 동기화)
      const tideData = calculateTideDay(spot.lat, spot.lng, new Date());
      setTide(tideData);

      // [KHOA 중앙 DB 캐싱 연동] 당일 실측/예측 조위 시계열과 1:1 결합하여 단일 마스터 시계열 캘리브레이션 갱신
      getKhoaTideForecast(spot.lat, spot.lng, new Date())
        .then((kForecast) => {
          if (kForecast?.tideDayInfo) {
            activeSwtcWeeklyRef.current = kForecast.swtcWeekly || null;
            setTide(kForecast.tideDayInfo);
            if (weather && marine) {
              const score = calculateBiteScore(spot, weather, marine, kForecast.tideDayInfo, currentUser?.favoriteSpecies);
              setBiteScore(score);
            }
          }
        })
        .catch(() => {});

      // 2. Open-Meteo Weather & Marine API 병렬 Fetch (48h+ 예보 지원)
      try {
        const [weatherData, marineData] = await Promise.all([
          fetchWeatherData(spot.lat, spot.lng),
          fetchMarineData(spot.lat, spot.lng),
        ]);
        setWeather(weatherData);
        setMarine(marineData);

        // 3. ExFish AI 입질 지수 도출 (로그인 유저의 관심 어종 가중치 자동 반영)
        const score = calculateBiteScore(spot, weatherData, marineData, tideData, currentUser?.favoriteSpecies);
        setBiteScore(score);

        // 4. 오프라인 대비 메타데이터 로컬 캐싱
        cacheSpotMetadata(spot, tideData, weatherData, marineData);
      } catch (err) {
        console.error('Error fetching marine/weather data:', err);
      }
    },
    [currentUser?.favoriteSpecies, weather, marine]
  );

  // 선택된 포인트의 실시간 물때 곡선 및 입질 지수 10초 주기 로컬 갱신 (원격 API 호출 배제, 배터리 절약, KHOA 공식 데이터 보존)
  React.useEffect(() => {
    if (!selectedSpot) return;

    const intervalId = setInterval(() => {
      try {
        const now = new Date();
        // 원격 API 호출 없이 로컬 시계열 재연산 (조위/입질지수/피딩타임 실시간 정밀 동기화, KHOA 공식 SWTC 캐시 보존)
        const tideData = calculateTideDay(selectedSpot.lat, selectedSpot.lng, now, {
          swtcWeekly: activeSwtcWeeklyRef.current,
        });
        setTide(tideData);

        if (weather && marine) {
          const score = calculateBiteScore(selectedSpot, weather, marine, tideData, currentUser?.favoriteSpecies);
          setBiteScore(score);
        }
      } catch (err) {
        console.warn('10초 로컬 조위 동기화 에러 (무시):', err);
      }
    }, 10000);

    return () => clearInterval(intervalId);
  }, [selectedSpot?.id, selectedSpot?.lat, selectedSpot?.lng, weather, marine, currentUser?.favoriteSpecies]);

  // 원격 해양/기상 데이터 15분 주기 배경 갱신 (Open-Meteo 모델 주기와 동기화)
  React.useEffect(() => {
    if (!selectedSpot) return;

    const weatherIntervalId = setInterval(async () => {
      try {
        const [weatherData, marineData] = await Promise.all([
          fetchWeatherData(selectedSpot.lat, selectedSpot.lng),
          fetchMarineData(selectedSpot.lat, selectedSpot.lng),
        ]);
        setWeather(weatherData);
        setMarine(marineData);
      } catch (err) {
        console.warn('15분 원격 기상 갱신 일시 에러 (무시):', err);
      }
    }, 15 * 60 * 1000);

    return () => clearInterval(weatherIntervalId);
  }, [selectedSpot?.id, selectedSpot?.lat, selectedSpot?.lng]);

  // 로그인 유저의 관심 어종(favoriteSpecies) 변경 시, 현재 선택된 포인트의 입질 지수 실시간 재연산
  React.useEffect(() => {
    if (selectedSpot && weather && marine && tide) {
      const score = calculateBiteScore(selectedSpot, weather, marine, tide, currentUser?.favoriteSpecies);
      setBiteScore(score);
    }
  }, [currentUser?.favoriteSpecies]);

  // 지도 클릭을 통한 새 포인트 추가 트리거
  const handleMapClickForNewSpot = (lat: number, lng: number) => {
    // [요구사항 5] 주소 검색한 상태에서 포인트 추가 시 검색 결과 필터를 해제하여 신규 포인트 아이콘이 즉시 정상 노출되도록 보장
    if (searchQuery.trim()) {
      setSearchQuery('');
      setShowPoiDropdown(false);
      setPoiResults([]);
    }
    setEditingSpot(null);
    setNewSpotLat(lat);
    setNewSpotLng(lng);
    setIsSpotModalOpen(true);
  };

  // 새 포인트 저장 및 수정 핸들러 (오직 Supabase DB에 직접 저장)
  const handleSaveSpot = async (spotData: Omit<FishingSpot, 'id' | 'user_id' | 'author_name' | 'created_at'>) => {
    try {
      // 포인트 저장 시에도 검색 필터를 초기화하여 지도에 저장된 포인트가 즉시 표시되도록 보장
      if (searchQuery.trim()) {
        setSearchQuery('');
        setShowPoiDropdown(false);
        setPoiResults([]);
      }
      if (editingSpot) {
        const updatedSpot: FishingSpot = { ...editingSpot, ...spotData };
        await saveCloudSpot(updatedSpot);
        const cSpots = await fetchCloudSpots();
        setSpots(cSpots);
        handleSelectSpot(updatedSpot);
        setEditingSpot(null);
      } else {
        const newSpot: FishingSpot = {
          ...spotData,
          id: `spot-${Date.now()}`,
          user_id: currentUser ? currentUser.id : 'user-me',
          author_name: currentUser ? currentUser.id : '나의 포인트',
          created_at: new Date().toISOString(),
        };
        await saveCloudSpot(newSpot);
        const cSpots = await fetchCloudSpots();
        setSpots(cSpots);
        handleSelectSpot(newSpot);
      }
      setIsSpotModalOpen(false);
      // 신규 등록 후 즉시 최신 데이터 반영 보장
      await reloadData();
    } catch (e: any) {
      console.error('Supabase spot save error:', e);
      alert(`Supabase DB 저장에 실패했습니다: ${e?.message || '연결 또는 권한을 확인하세요.'}`);
    }
  };

  // 포인트 삭제 핸들러 (오직 Supabase DB에서 직접 삭제)
  const handleDeleteSpot = async (spotId: string) => {
    try {
      await deleteCloudSpot(spotId);
      const updated = await fetchCloudSpots();
      setSpots(updated);

      if (selectedSpot?.id === spotId) {
        if (updated.length > 0) {
          handleSelectSpot(updated[0]);
        } else {
          setSelectedSpot(null);
          setIsMobileDrawerOpen(false);
        }
      }
    } catch (e: any) {
      console.error('Supabase spot delete error:', e);
      alert(`Supabase DB 삭제에 실패했습니다: ${e?.message || ''}`);
    }
  };

  // 포인트 수정 모달 열기
  const handleEditSpot = (spot: FishingSpot) => {
    setEditingSpot(spot);
    setIsSpotModalOpen(true);
  };

  // 지도에서 캐스팅 방향/스위트스팟 등 직접 업데이트
  const handleDirectUpdateSpot = async (updatedSpot: FishingSpot) => {
    try {
      await saveCloudSpot(updatedSpot);
      const cSpots = await fetchCloudSpots();
      setSpots(cSpots);
      handleSelectSpot(updatedSpot, false, false);
      await reloadData();
    } catch (e: any) {
      console.error('Failed to update spot directly:', e);
      alert(`포인트 업데이트에 실패했습니다: ${e?.message || ''}`);
    }
  };

  // 위치 미세 조정 모드 시작 (작성자 본인 포인트 전용)
  const handleStartMicroAdjust = (spot: FishingSpot) => {
    setMicroAdjustSpot(spot);
    setIsMobileDrawerOpen(false); // 모바일 드로워를 닫아 지도 전면 확보
  };

  const handleCancelMicroAdjust = () => {
    setMicroAdjustSpot(null);
  };

  const handleConfirmMicroAdjust = async (spotId: string, newLat: number, newLng: number) => {
    try {
      const target = spots.find((s) => s.id === spotId);
      if (!target) return;
      const updated: FishingSpot = { ...target, lat: newLat, lng: newLng };
      await saveCloudSpot(updated);
      const cSpots = await fetchCloudSpots();
      setSpots(cSpots);
      setSelectedSpot(updated);
      setMicroAdjustSpot(null);
    } catch (e: any) {
      alert(`위치 저장 중 오류가 발생했습니다: ${e?.message || ''}`);
    }
  };

  // 조과 기록 생성 및 수정 핸들러 (Supabase 클라우드 DB 및 로컬 스토리지 즉시 동기화)
  const handleSaveCatchLog = async (logData: Omit<CatchLog, 'id' | 'created_at'>) => {
    try {
      let finalLog: CatchLog;
      if (editingCatchLog) {
        finalLog = {
          ...editingCatchLog,
          ...logData,
          photo_url: logData.photo_url || undefined,
        };
        await saveCloudCatchLog(finalLog);
        setEditingCatchLog(null);
      } else {
        finalLog = {
          ...logData,
          id: `log-${Date.now()}`,
          user_id: currentUser ? currentUser.id : (logData.user_id || 'user-me'),
          user_name: currentUser ? (currentUser.customNickname || currentUser.name || currentUser.id) : (logData.user_name || '나의 조과'),
          created_at: new Date().toISOString(),
        };
        await saveCloudCatchLog(finalLog);
      }

      // UI 및 오프라인 캐시 즉시 업데이트
      setCatchLogs((prev) => {
        const next = editingCatchLog
          ? prev.map((l) => (l.id === finalLog.id ? finalLog : l))
          : [finalLog, ...prev.filter((l) => l.id !== finalLog.id)];
        saveLogsToStorage(next);
        return next;
      });

      // 최신 서버 데이터 재동기화 (백그라운드)
      try {
        const cLogs = await fetchCloudLogs();
        setCatchLogs(cLogs);
        saveLogsToStorage(cLogs);
      } catch (syncErr) {
        console.warn('Supabase fetchCloudLogs post-save background sync warning:', syncErr);
      }

      setIsCatchLogModalOpen(false);
    } catch (e: any) {
      console.error('Supabase catch log save error:', e);
      alert(`Supabase DB 조과 저장에 실패했습니다: ${e?.message || ''}`);
    }
  };

  // 조과 기록 삭제 핸들러 (Supabase DB 및 로컬 스토리지 삭제)
  const handleDeleteCatchLog = async (logId: string) => {
    try {
      await deleteCloudCatchLog(logId);
      setCatchLogs((prev) => {
        const next = prev.filter((l) => l.id !== logId);
        saveLogsToStorage(next);
        return next;
      });
      try {
        const cLogs = await fetchCloudLogs();
        setCatchLogs(cLogs);
        saveLogsToStorage(cLogs);
      } catch (syncErr) {}
    } catch (e: any) {
      console.error('Supabase catch log delete error:', e);
      alert(`Supabase DB 조과 삭제에 실패했습니다: ${e?.message || ''}`);
    }
  };

  // POI 장소/항구 검색 트리거 (카카오 로컬 키워드 및 주소 검색)
  const handleExecutePoiSearch = async () => {
    if (!searchQuery || searchQuery.trim().length < 2) return;
    setIsSearchingPoi(true);
    setShowPoiDropdown(true);
    try {
      const results = await searchPoi(searchQuery.trim());
      setPoiResults(results);
    } catch (e) {
      console.error(e);
      setPoiResults([]);
    } finally {
      setIsSearchingPoi(false);
    }
  };

  // 필터링된 포인트 목록
  const filteredSpots = spots.filter((spot) => {
    if (viewOnlyMySpots && spot.user_id !== 'user-me' && spot.user_id !== 'user-esper-1') {
      return false;
    }
    if (selectedMethodFilter !== 'ALL' && !spot.fishing_methods.includes(selectedMethodFilter)) {
      return false;
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const matchName = spot.name.toLowerCase().includes(query);
      const matchSpecies = spot.target_species.some((sp) => sp.toLowerCase().includes(query));
      if (!matchName && !matchSpecies) return false;
    }
    return true;
  });

  // 드롭다운 검색용 매칭 포인트 목록 (어종 또는 포인트명 일치)
  const matchedSpotsInDropdown = React.useMemo(() => {
    if (!searchQuery || searchQuery.trim().length < 1) return [];
    const q = searchQuery.trim().toLowerCase();
    return spots.filter((sp) => {
      const nameMatch = sp.name.toLowerCase().includes(q);
      const speciesMatch = sp.target_species.some((s) => s.toLowerCase().includes(q));
      return nameMatch || speciesMatch;
    }).slice(0, 10);
  }, [spots, searchQuery]);

  const spotLogs = selectedSpot ? catchLogs.filter((log) => log.spot_id === selectedSpot.id) : [];

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* 웹 및 모바일 앱 공통 1초 스플래시 스크린 (시각적 검증 및 브랜딩) */}
      {showSplash && (
        <SplashScreen onFinish={() => setShowSplash(false)} durationMs={1000} />
      )}

      {/* 글로벌 상단 헤더 & 내비게이션 바 */}
      <header className="h-14 bg-slate-900 border-b border-slate-800 px-3 sm:px-4 flex items-center justify-between shrink-0 z-30 shadow-md gap-2">
        {/* 로고 (ExFish 브랜딩 및 버전 정보 표시, 클릭 시 페이지 새로고침) */}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="flex items-center gap-2 shrink-0 text-left hover:opacity-90 active:scale-95 transition cursor-pointer"
          title="ExFish 새로고침"
          aria-label="ExFish 메인 새로고침"
        >
          <div className="w-8 h-8 rounded-lg bg-slate-950 flex items-center justify-center p-0.5 shadow-md shrink-0 border border-cyan-500/30 overflow-hidden">
            <img src={`${import.meta.env.BASE_URL}user-icon.png`} alt="ExFish Logo" className="w-full h-full object-cover rounded-md" />
          </div>
          <div className="flex flex-col">
            <span className="text-base sm:text-lg font-black tracking-tight text-cyan-400 leading-none">
              ExFish
            </span>
            <span className="hidden md:inline-block text-[10px] text-slate-400 font-medium tracking-tight mt-0.5">
              ex-gf, ex-wife, and ex-fish. 떠나버린 물고기를 기리며...
            </span>
          </div>
        </button>

        {/* 검색 및 POI 검색 바 (중앙) */}
        <div className="relative flex items-center gap-1.5 flex-1 max-w-sm sm:max-w-md mx-1 sm:mx-4">
          <div className="relative w-full">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
            <input
              type="text"
              placeholder="포인트, 어종, 강릉시청 등 지명·항구 검색 (Enter)..."
              value={searchQuery}
              onChange={(e) => {
                const val = e.target.value;
                setSearchQuery(val);
                if (val.trim().length >= 1) {
                  setShowPoiDropdown(true);
                } else {
                  setShowPoiDropdown(false);
                }
              }}
              onFocus={() => {
                if (searchQuery.trim().length >= 1) {
                  setShowPoiDropdown(true);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleExecutePoiSearch();
                }
              }}
              className="w-full bg-slate-800/90 border border-slate-700/80 rounded-full pl-8 sm:pl-9 pr-14 sm:pr-16 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-400 transition"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setShowPoiDropdown(false);
                  setPoiResults([]);
                }}
                className="absolute right-20 top-2 text-slate-400 hover:text-slate-200"
              >
                <X size={14} />
              </button>
            )}
            <div className="absolute right-1 top-1 bottom-1 flex items-center gap-1">
              <button
                onClick={handleExecutePoiSearch}
                className="px-2 h-full bg-cyan-600 hover:bg-cyan-500 text-white rounded-full flex items-center justify-center transition shadow"
                title="지도 장소 검색"
              >
                {isSearchingPoi ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
              </button>
              <button
                onClick={() => setIsSpotListModalOpen(true)}
                className="px-2.5 h-full bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white rounded-full text-[11px] font-bold flex items-center gap-1 transition shadow"
                title="전체 포인트 리스트 및 실시간 환경 열람"
              >
                <List size={12} />
                <span className="hidden sm:inline">리스트</span>
              </button>
            </div>
          </div>

            {/* 장소 및 포인트 검색 결과 드롭다운 팝오버 */}
            {showPoiDropdown && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden text-xs max-h-80 overflow-y-auto">
                <div className="px-3 py-1.5 bg-slate-800 text-[11px] text-slate-300 font-semibold flex justify-between items-center border-b border-slate-700">
                  <span className="flex items-center gap-1">
                    🔍 <strong>'{searchQuery}'</strong> 검색 결과
                  </span>
                  <button
                    onClick={() => setShowPoiDropdown(false)}
                    className="text-slate-400 hover:text-white p-0.5 rounded"
                  >
                    <X size={13} />
                  </button>
                </div>

                {/* 1순위: 등록된 낚시 포인트 및 대상어종 일치 결과 */}
                {matchedSpotsInDropdown.length > 0 && (
                  <div>
                    <div className="px-3 py-1 bg-cyan-950/80 border-b border-cyan-800/40 text-[10.5px] font-bold text-cyan-300 flex items-center gap-1">
                      <span>🎣 등록된 낚시 포인트 ({matchedSpotsInDropdown.length}건)</span>
                    </div>
                    {matchedSpotsInDropdown.map((sp) => (
                      <button
                        key={`dropdown-spot-${sp.id}`}
                        onClick={() => {
                          handleSelectSpot(sp, true, false);
                          setShowPoiDropdown(false);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-cyan-950/60 border-b border-slate-800/70 flex items-center justify-between text-slate-200 transition group"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-white group-hover:text-cyan-300 transition truncate flex items-center gap-1.5">
                            <span>📍 {sp.name}</span>
                            {sp.target_species.some(s => s.toLowerCase().includes(searchQuery.trim().toLowerCase())) && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-normal">
                                어종 일치
                              </span>
                            )}
                          </div>
                          <div className="text-[10.5px] text-slate-400 truncate mt-0.5">
                            어종: {sp.target_species.join(', ')} · 장르: {sp.fishing_methods.join(', ')}
                          </div>
                        </div>
                        <span className="text-[11px] text-cyan-400 font-semibold shrink-0 ml-2 group-hover:translate-x-0.5 transition">
                          이동 →
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {/* 2순위: 카카오 전국 지명·항구·주소 검색 결과 */}
                {isSearchingPoi ? (
                  <div className="p-4 text-center text-slate-400 flex items-center justify-center gap-2">
                    <Loader2 size={14} className="animate-spin text-cyan-400" />
                    <span>카카오 전국 지명·항구 검색 중...</span>
                  </div>
                ) : poiResults.length > 0 ? (
                  <div>
                    <div className="px-3 py-1 bg-slate-800/70 border-b border-slate-700/60 text-[10.5px] font-bold text-slate-300 flex items-center gap-1">
                      <span>🌐 카카오 지명·항구·주소 ({poiResults.length}건)</span>
                    </div>
                    {poiResults.map((poi, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          setRecenterTarget({ lat: poi.lat, lng: poi.lng, zoom: 14 });
                          setShowPoiDropdown(false);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-slate-800 border-b border-slate-800/80 flex items-start gap-2.5 text-slate-200 transition group"
                      >
                        <span className="text-cyan-400 mt-0.5 group-hover:scale-110 transition">⚓</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-white group-hover:text-cyan-300 transition truncate">
                            {poi.display_name.split('(')[0]}
                          </div>
                          <div className="text-[11px] text-slate-400 truncate">{poi.display_name}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : matchedSpotsInDropdown.length === 0 ? (
                  <div className="p-4 text-center text-slate-400">
                    일치하는 포인트나 지명을 찾지 못했습니다.
                  </div>
                ) : null}
              </div>
            )}
        </div>

        {/* 툴바: PC 웹 로그인 / 회원 정보 버튼 및 최신 APK 다운로드 버튼 */}
        <div className="flex items-center gap-1.5 shrink-0 text-xs">
          {!isNativePlatform() && (
            <a
              href="./exfish.apk"
              download="exfish.apk"
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/70 border border-emerald-500/40 hover:border-emerald-400 text-emerald-300 hover:text-white font-bold text-xs shadow-sm transition active:scale-95 cursor-pointer"
              title="최신 ExFish Android APK 직접 다운로드"
            >
              <Download size={14} className="text-emerald-400" />
              <span>APK 다운로드</span>
            </a>
          )}

          <button
            onClick={() => setIsLoginModalOpen(true)}
            className={`hidden md:flex items-center justify-center p-2 rounded-lg border text-xs font-semibold transition ${
              currentUser
                ? 'bg-slate-800/90 border-slate-700 text-cyan-300 hover:bg-slate-700 hover:text-white'
                : 'bg-gradient-to-r from-cyan-600/30 to-blue-600/30 border-cyan-500/50 text-cyan-300 hover:bg-cyan-600/40 hover:text-white shadow-sm'
            }`}
            title={currentUser ? `계정 정보: ${currentUser.id}` : '로그인하기 (Email & ID)'}
            aria-label={currentUser ? `계정 정보: ${currentUser.id}` : '로그인하기'}
          >
            {currentUser ? <User size={16} className="text-cyan-400" /> : <LogIn size={16} className="text-cyan-400" />}
          </button>
        </div>
      </header>

      {/* 서브 바: 내 포인트 + 로그인(모바일) + 지도 종류 선택 아이콘바 */}
      <div className="h-10 bg-slate-900/90 border-b border-slate-800 px-3 sm:px-4 flex items-center justify-between text-xs shrink-0 overflow-x-auto gap-2">
        {/* PC 화면 전용 장르 필터 (모바일에서는 완전히 숨김) */}
        <div className="hidden md:flex items-center gap-1.5 shrink-0">
          <span className="text-slate-400 flex items-center gap-1 mr-1">
            <Filter size={12} /> 장르:
          </span>
          {[
            { id: 'ALL', label: '전체' },
            { id: 'LURE', label: '🎣 루어' },
            { id: 'SURF', label: '⚓ 원투' },
            { id: 'FLOAT', label: '🔴 찌낚시' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setSelectedMethodFilter(item.id as FishingMethod | 'ALL')}
              className={`px-2.5 py-1 rounded-full text-xs transition ${
                selectedMethodFilter === item.id
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 font-bold'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* 공통 액션: 내 포인트 + 로그인(모바일) & 지도 종류 선택 아이콘바 */}
        <div className="flex items-center justify-between w-full md:w-auto gap-2">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setViewOnlyMySpots(!viewOnlyMySpots)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs transition ${
                viewOnlyMySpots
                  ? 'bg-cyan-950 border-cyan-600 text-cyan-300 font-bold'
                  : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              <User size={13} />
              <span>내 포인트</span>
            </button>

            {/* 모바일 화면 전용 로그인 버튼 (아이콘 전용) */}
            <button
              onClick={() => setIsLoginModalOpen(true)}
              className={`md:hidden flex items-center justify-center p-1.5 rounded-lg border text-xs font-semibold transition ${
                currentUser
                  ? 'bg-slate-800/90 border-slate-700 text-cyan-300'
                  : 'bg-cyan-600/30 border-cyan-500/50 text-cyan-300'
              }`}
              title={currentUser ? `계정 정보: ${currentUser.id}` : '로그인'}
              aria-label={currentUser ? `계정 정보: ${currentUser.id}` : '로그인'}
            >
              {currentUser ? <User size={14} className="text-cyan-400" /> : <LogIn size={14} className="text-cyan-400" />}
            </button>
          </div>

          {/* 지도 종류 선택 아이콘바 (일반지도 / 스카이뷰 / 다크 / 고대비) */}
          <div className="flex items-center bg-slate-950/90 border border-slate-700/80 rounded-lg p-0.5 gap-0.5 shrink-0">
            <button
              onClick={() => handleMapModeChange('ROADMAP')}
              className={`p-1.5 rounded-md transition flex items-center justify-center ${
                mapMode === 'ROADMAP'
                  ? 'bg-cyan-600 text-white shadow'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
              title="일반 도로 지도"
              aria-label="일반 지도"
            >
              <MapIcon size={15} />
            </button>
            <button
              onClick={() => handleMapModeChange('HYBRID')}
              className={`p-1.5 rounded-md transition flex items-center justify-center ${
                mapMode === 'HYBRID'
                  ? 'bg-cyan-600 text-white shadow'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
              title="갯바위·방파제 고해상도 실사 항공 스카이뷰"
              aria-label="스카이뷰"
            >
              <Satellite size={15} />
            </button>
            <button
              onClick={() => handleMapModeChange('DARK')}
              className={`p-1.5 rounded-md transition flex items-center justify-center ${
                mapMode === 'DARK'
                  ? 'bg-amber-600 text-white shadow'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
              title="야간 낚시 다크 모드 (눈부심 방지)"
              aria-label="야간 다크"
            >
              <Moon size={15} />
            </button>
            <button
              onClick={() => {
                const next = !isSunMode;
                setIsSunMode(next);
                try {
                  localStorage.setItem('exfish_sun_mode', String(next));
                } catch {}
                if (typeof document !== 'undefined') {
                  document.body.classList.toggle('sun-mode-active', next);
                }
              }}
              className={`p-1.5 rounded-md transition flex items-center justify-center border-l border-slate-800 ml-0.5 pl-1.5 ${
                isSunMode
                  ? 'bg-yellow-400 text-black font-bold shadow-yellow-500/30'
                  : 'text-yellow-400/90 hover:text-yellow-300 hover:bg-slate-800'
              }`}
              title={isSunMode ? '아웃도어 초고대비 모드 끄기' : '아웃도어 초고대비 모드 켜기 (한낮 직사광선용)'}
              aria-label="고대비 모드"
            >
              <Sun size={15} className={isSunMode ? 'text-black' : 'text-yellow-400'} />
            </button>
          </div>
        </div>
      </div>

      {/* 오프라인 네트워크 단절 안내 배너 */}
      {isOffline && (
        <div className="bg-amber-500 text-slate-950 font-bold px-4 py-1.5 text-xs text-center flex items-center justify-center gap-2 shadow-md shrink-0">
          <span>📶 오프라인 모드 작동 중: 로컬 캐시된 포인트 및 조위 메타데이터로 작동합니다.</span>
        </div>
      )}

      {/* 메인 2열 분할 레이아웃 (지도 캔버스 + 우측 상세 대시보드 패널) */}
      <main className="flex-1 relative flex flex-col md:flex-row overflow-hidden">
        {/* 좌측(또는 전체 배경) 카카오 지도 영역 (모달 관통 방지를 위해 isolate 적용) */}
        <div className="flex-1 h-full w-full relative isolate">
          <MapView
            spots={filteredSpots}
            selectedSpot={selectedSpot}
            onSelectSpot={(spot) => handleSelectSpot(spot, true, false)}
            onMapClickForNewSpot={handleMapClickForNewSpot}
            weather={weather}
            marine={marine}
            tide={tide}
            windUnit={windUnit}
            currentUnit={currentUnit}
            recenterTarget={recenterTarget}
            isMobileDrawerOpen={Boolean(selectedSpot && isMobileDrawerOpen && (typeof window !== 'undefined' && window.innerWidth < 768))}
            microAdjustSpot={microAdjustSpot}
            onCancelMicroAdjust={handleCancelMicroAdjust}
            onConfirmMicroAdjust={handleConfirmMicroAdjust}
            currentUser={currentUser}
            onStartMicroAdjust={handleStartMicroAdjust}
            onOpenDetail={(spot) => handleSelectSpot(spot, false, true)}
            onEditSpot={handleEditSpot}
            onUpdateSpot={handleDirectUpdateSpot}
            favoriteSpotIds={favoriteSpotIds}
            onToggleFavorite={handleToggleFavorite}
            isSunMode={isSunMode}
            mapMode={mapMode}
            onChangeMapMode={handleMapModeChange}
          />
        </div>

        {/* PC 화면: 우측 사이드바 패널 */}
        {selectedSpot && (
          <aside className="hidden md:block w-[440px] lg:w-[480px] h-full shrink-0 z-20 border-l border-slate-800 shadow-2xl">
            <SpotDetailPanel
              spot={selectedSpot}
              weather={weather}
              marine={marine}
              tide={tide}
              biteScore={biteScore}
              catchLogs={spotLogs}
              favoriteSpecies={currentUser?.favoriteSpecies}
              windUnit={windUnit}
              currentUnit={currentUnit}
              currentUser={currentUser}
              isFavorited={favoriteSpotIds.includes(selectedSpot.id)}
              onToggleFavorite={handleToggleFavorite}
              onStartMicroAdjust={handleStartMicroAdjust}
              onOpenCatchLogModal={() => {
                setEditingCatchLog(null);
                setIsCatchLogModalOpen(true);
              }}
              onEditLog={(log) => {
                setEditingCatchLog(log);
                setIsCatchLogModalOpen(true);
              }}
              onDeleteLog={handleDeleteCatchLog}
              onEditSpot={handleEditSpot}
              onDeleteSpot={handleDeleteSpot}
              onClose={() => setSelectedSpot(null)}
            />
          </aside>
        )}

        {/* 모바일 화면 1: 드로어가 열려 있을 때 화면 전체(100%)를 채움 (z-50으로 지도 컨트롤 완벽 차폐) */}
        {selectedSpot && isMobileDrawerOpen && (
          <div className="md:hidden fixed inset-0 z-50 bg-slate-900 flex flex-col animate-fade-in">
            <SpotDetailPanel
              spot={selectedSpot}
              weather={weather}
              marine={marine}
              tide={tide}
              biteScore={biteScore}
              catchLogs={spotLogs}
              favoriteSpecies={currentUser?.favoriteSpecies}
              windUnit={windUnit}
              currentUnit={currentUnit}
              currentUser={currentUser}
              isFavorited={favoriteSpotIds.includes(selectedSpot.id)}
              onToggleFavorite={handleToggleFavorite}
              onStartMicroAdjust={handleStartMicroAdjust}
              onOpenCatchLogModal={() => {
                setEditingCatchLog(null);
                setIsCatchLogModalOpen(true);
              }}
              onEditLog={(log) => {
                setEditingCatchLog(log);
                setIsCatchLogModalOpen(true);
              }}
              onDeleteLog={handleDeleteCatchLog}
              onEditSpot={handleEditSpot}
              onDeleteSpot={handleDeleteSpot}
              onClose={() => {
                setSelectedSpot(null);
                setIsMobileDrawerOpen(false);
              }}
              onMinimize={() => setIsMobileDrawerOpen(false)}
            />
          </div>
        )}
      </main>

      {/* 포인트 등록 / 수정 모달 */}
      <SpotFormModal
        isOpen={isSpotModalOpen}
        onClose={() => {
          setIsSpotModalOpen(false);
          setEditingSpot(null);
        }}
        onSubmit={handleSaveSpot}
        editingSpot={editingSpot}
        initialLat={newSpotLat}
        initialLng={newSpotLng}
        extractExifFromImage={extractExifFromImage}
      />

      {/* 새 조과 기록 등록 및 수정 모달 (당시 환경 자동 스냅샷 박제 & 수정) */}
      {selectedSpot && (
        <CatchLogModal
          isOpen={isCatchLogModalOpen}
          onClose={() => {
            setIsCatchLogModalOpen(false);
            setEditingCatchLog(null);
          }}
          spotId={selectedSpot.id}
          spotName={selectedSpot.name}
          spotLat={selectedSpot.lat}
          spotLng={selectedSpot.lng}
          editingLog={editingCatchLog}
          currentWeather={weather}
          currentTide={tide}
          currentWaterTemp={marine?.seaSurfaceTemp || 17.5}
          currentVelocity={marine?.currentVelocity || 0.3}
          windUnit={windUnit}
          currentUnit={currentUnit}
          extractExifFromImage={extractExifFromImage}
          onSaveLog={handleSaveCatchLog}
        />
      )}

      {/* 간편 로그인 및 계정/환경 설정 모달 */}
      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        currentUser={currentUser}
        onLogin={(user) => {
          setCurrentUser(user);
          if (user.windUnit) setWindUnit(user.windUnit);
          if (user.currentUnit) setCurrentUnit(user.currentUnit);
        }}
        onLogout={() => setCurrentUser(null)}
        onUpdateFavorites={(favorites) => {
          if (currentUser) {
            setCurrentUser({ ...currentUser, favoriteSpecies: favorites });
          }
        }}
        windUnit={windUnit}
        currentUnit={currentUnit}
        onChangeWindUnit={setWindUnit}
        onChangeCurrentUnit={setCurrentUnit}
      />

      {/* 입질 종합 지수 평가 기준 설명 헬프 모달 */}
      <BiteScoreHelpModal
        isOpen={isHelpModalOpen}
        onClose={() => setIsHelpModalOpen(false)}
      />

      {/* 전국 포인트 리스트 모달 (필터, 소팅, 실시간 환경 요약) */}
      <SpotListModal
        isOpen={isSpotListModalOpen}
        onClose={() => setIsSpotListModalOpen(false)}
        spots={spots}
        selectedSpot={selectedSpot}
        onSelectSpot={(spot) => handleSelectSpot(spot, true, true)}
        environmentMap={environmentMap}
        windUnit={windUnit}
        currentUnit={currentUnit}
        currentUserId={currentUser?.id}
        userCoords={userLocation}
        favoriteSpotIds={favoriteSpotIds}
        onToggleFavorite={handleToggleFavorite}
      />
      {/* 출조 필수품 & 안전 점검 체크리스트 모달 */}
      <ChecklistModal
        isOpen={isChecklistModalOpen}
        onClose={() => setIsChecklistModalOpen(false)}
        spotName={selectedSpot?.name || '전국 포인트'}
        mulText={tide?.mulText}
      />
    </div>
  );
}

export default App;
