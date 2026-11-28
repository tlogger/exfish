import React from 'react';
import { CompactEnvHud, SpotCompareAndWindCard } from './CompactEnvHud';
import {
  Bell,
  ChevronDown,
  Clock,
  Compass,
  Download,
  Edit,
  ExternalLink,
  Fish,
  Info,
  MessageSquare,
  Pause,
  Play,
  PlusCircle,
  RotateCcw,
  Send,
  Share2,
  ShieldAlert,
  Star,
  Thermometer,
  Trash2,
  Volume2,
  Waves,
  Wind
} from 'lucide-react';
import { Area, AreaChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type {
  BiteScoreBreakdown,
  CatchLog,
  CurrentUnit,
  FishingSpot,
  MarineData,
  SpotMemo,
  SpotMemoTag,
  TideCurvePoint,
  TideDayInfo,
  WeatherData,
  WindUnit
} from '../types';
import { calculateBiteScore, calculateSingleSpeciesScore } from '../utils/biteScore';
import { classifyRelativeWind, getRelativeWindLabel, resolveCastCenterDeg } from '../utils/spotComparison';
import { calculateTideDay } from '../utils/tideEngine';
import { ChecklistModal } from './ChecklistModal';
import { BiteScoreHelpModal } from './BiteScoreHelpModal';
import type { AuthUser } from './LoginModal';
import { isUserAdmin } from '../services/oauthService';
import { deleteCloudMemo, fetchCloudMemos, saveCloudMemo } from '../utils/cloudDb';
import { SPECIES_ENCYCLOPEDIA } from '../utils/speciesDatabase';
import { SpeciesQuickModal } from './SpeciesQuickModal';
import { getSpeciesRigInfo } from '../utils/speciesRigs';
import {
  formatCurrentVelocity,
  formatWindSpeed,
  getWeatherText,
  getWindyWebUrl,
  getWindDirectionKor,
  getCurrentDirectionKor,
} from '../utils/weatherApi';
import { generatePostMortemReport } from '../utils/postMortemEngine';
import { playEvacuationBeep } from '../utils/tideAlertSound';
import { sendEmergencyEvacuationNotification, requestNotificationPermission } from '../utils/nativeBridge';
import { findNearestKhoaStation } from '../utils/tideService';
import { resolveUnifiedWaterDepth } from '../utils/depthSinkEngine';
import { useLandingKhoaDepth } from '../utils/castingLanding';
import {
  calculateSinkingPhysics,
  getSavedTackleConfig,
  getTackleShortLabel,
  solveLeadCastAimPoint,
} from '../utils/tackleCalibration';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';
import { APP_VERSION } from '../version';

interface SpotDetailPanelProps {
  spot: FishingSpot;
  weather: WeatherData | null;
  marine: MarineData | null;
  tide: TideDayInfo | null;
  biteScore: BiteScoreBreakdown | null;
  catchLogs: CatchLog[];
  favoriteSpecies?: string[];
  isFavorited?: boolean;
  onToggleFavorite?: (spotId: string) => void;
  windUnit: WindUnit;
  currentUnit: CurrentUnit;
  currentUser?: AuthUser | null;
  onStartMicroAdjust?: (spot: FishingSpot) => void;
  onOpenCatchLogModal: () => void;
  onEditLog: (log: CatchLog) => void;
  onDeleteLog: (logId: string) => void;
  onEditSpot: (spot: FishingSpot) => void;
  onDeleteSpot: (spotId: string) => void;
  onClose: () => void;
  onMinimize?: () => void;
  allSpots?: FishingSpot[];
  onSelectSpot?: (spot: FishingSpot) => void;
  onOpenCompare?: (spotIds: string[]) => void;
}

export const SpotDetailPanel: React.FC<SpotDetailPanelProps> = ({
  spot,
  weather,
  marine,
  tide,
  biteScore,
  catchLogs,
  favoriteSpecies,
  isFavorited = false,
  onToggleFavorite,
  windUnit,
  currentUnit,
  currentUser,
  onStartMicroAdjust: _onStartMicroAdjust,
  onOpenCatchLogModal,
  onEditLog,
  onDeleteLog,
  onEditSpot,
  onDeleteSpot,
  onClose,
  onMinimize,
  allSpots = [],
  onSelectSpot,
  onOpenCompare,
}) => {
  const [activeTab, setActiveTab] = React.useState<'WEATHER_TIDE' | 'LOGS' | 'DIRECTIONS' | 'MEMOS'>('WEATHER_TIDE');
  const [activePhotoIndex, setActivePhotoIndex] = React.useState(0);
  const [isChecklistOpen, setIsChecklistOpen] = React.useState(false);
  const [isBiteScoreHelpOpen, setIsBiteScoreHelpOpen] = React.useState(false);
  const [expandedSpecies, setExpandedSpecies] = React.useState<string | null>(null);
  const [selectedEncyclopediaSpecies, setSelectedEncyclopediaSpecies] = React.useState<string | null>(null);
  const [encyclopediaCategory, setEncyclopediaCategory] = React.useState<string>('ALL');

  // 갯바위 들물 탈출 골든타임 비프 경보 활성화 상태 (Phase 3: 네이티브 푸시/알람 연동)
  const [isEvacAlarmEnabled, setIsEvacAlarmEnabled] = React.useState(false);

  // 30초 주기 동기화되는 현재 시각 상태 (JSX 렌더 중 new Date() 직접 호출로 인한 순수성 위반 방지)
  const [currentTime, setCurrentTime] = React.useState<Date>(() => new Date());

  React.useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  // 관리자(구글 paedros@gmail.com) 및 작성자 권한 판별
  const isAdmin = isUserAdmin(currentUser);
  const isSpotOwner = Boolean(
    spot.user_id === 'user-me' ||
    spot.user_id === 'user-esper-1' ||
    (currentUser && (spot.user_id === currentUser.id || spot.author_name === currentUser.name))
  );
  const canManageSpot = isAdmin || isSpotOwner;
  const evacAlarmIntervalRef = React.useRef<any>(null);

  const toggleEvacAlarm = async () => {
    if (!isEvacAlarmEnabled) {
      // 알림 권한 획득 시도
      await requestNotificationPermission();
      setIsEvacAlarmEnabled(true);
      sendEmergencyEvacuationNotification(
        '🛡️ ExFish 들물 안전 감시 활성화',
        '갯바위 퇴로 침수 위험 구간 도달 시 비상 사이렌 및 진동이 울립니다.'
      );
    } else {
      setIsEvacAlarmEnabled(false);
    }
  };

  React.useEffect(() => {
    if (isEvacAlarmEnabled) {
      evacAlarmIntervalRef.current = setInterval(() => {
        playEvacuationBeep();
      }, 25000); // 25초마다 위험 알림 비프
    } else {
      if (evacAlarmIntervalRef.current) {
        clearInterval(evacAlarmIntervalRef.current);
        evacAlarmIntervalRef.current = null;
      }
    }
    return () => {
      if (evacAlarmIntervalRef.current) {
        clearInterval(evacAlarmIntervalRef.current);
      }
    };
  }, [isEvacAlarmEnabled]);

  // 포인트별 커뮤니티 현장 메모 (Spot Memos) 상태
  const [spotMemos, setSpotMemos] = React.useState<SpotMemo[]>([]);
  const [newMemoAuthor, setNewMemoAuthor] = React.useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('espfish_memo_author') || '익명 조사';
    return '익명 조사';
  });
  const [newMemoContent, setNewMemoContent] = React.useState('');
  const [newMemoTag, setNewMemoTag] = React.useState<SpotMemoTag>('GENERAL');
  const [memoFilterTag, setMemoFilterTag] = React.useState<string>('ALL');
  const [isSubmittingMemo, setIsSubmittingMemo] = React.useState(false);

  // 채비 캘리브레이션 상태 동기화 (MapView 팝오버 변경 즉시 반영)
  const [tackleConfig, setTackleConfig] = React.useState(() => getSavedTackleConfig());
  React.useEffect(() => {
    const handleTackleUpdate = () => setTackleConfig(getSavedTackleConfig());
    window.addEventListener('exfish_tackle_updated', handleTackleUpdate);
    return () => window.removeEventListener('exfish_tackle_updated', handleTackleUpdate);
  }, []);

  // 국립해양조사원 150m 격자 자연과학 수심 비동기 취득 (캐스팅 방향 정중앙 + 채비 비거리 착수점 기준)
  const { landingPoint, khoaDepthRecord } = useLandingKhoaDepth(
    spot,
    tackleConfig.calibratedDistanceMeters
  );

  const nearestStationInfo = React.useMemo(() => {
    return findNearestKhoaStation(spot.lat, spot.lng);
  }, [spot.lat, spot.lng]);

  // 포인트 변경 시 해당 포인트의 현장 메모 로드
  React.useEffect(() => {
    let isMounted = true;
    fetchCloudMemos(spot.id).then((memos) => {
      if (isMounted) setSpotMemos(memos);
    });
    return () => {
      isMounted = false;
    };
  }, [spot.id]);

  const handleAddSpotMemo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemoContent.trim()) return;

    setIsSubmittingMemo(true);
    const author = (currentUser?.name || newMemoAuthor).trim() || '익명 조사';
    if (!currentUser?.name && typeof window !== 'undefined') {
      localStorage.setItem('espfish_memo_author', author);
    }

    const newMemo: SpotMemo = {
      id: `memo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      spot_id: spot.id,
      user_id: 'user-me',
      user_name: author,
      content: newMemoContent.trim(),
      tag: newMemoTag,
      created_at: new Date().toISOString(),
    };

    try {
      await saveCloudMemo(newMemo);
      setSpotMemos((prev) => [newMemo, ...prev]);
      setNewMemoContent('');
    } finally {
      setIsSubmittingMemo(false);
    }
  };

  const handleDeleteSpotMemo = async (memoId: string) => {
    if (!confirm('이 현장 메모를 삭제하시겠습니까?')) return;
    await deleteCloudMemo(memoId);
    setSpotMemos((prev) => prev.filter((m) => m.id !== memoId));
  };

  // 48시간 미래 환경 타임라인 시뮬레이션 상태
  const [timelineOffsetHours, setTimelineOffsetHours] = React.useState<number>(0);
  const [isPlaying, setIsPlaying] = React.useState(false);

  // 자동 재생 (1초마다 +1시간 전진, 48시간 초과 시 0으로 리셋)
  React.useEffect(() => {
    let interval: any;
    if (isPlaying) {
      interval = setInterval(() => {
        setTimelineOffsetHours((prev) => (prev >= 48 ? 0 : prev + 1));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  const windyUrl = getWindyWebUrl(spot.lat, spot.lng);

  // 미니 어종 백과사전 모달 상태
  const [quickModalSpecies, setQuickModalSpecies] = React.useState<string | null>(null);

  // 아코디언 드로어(Drawer) 상태: 기본 숨김 (화살표 터치 시 펼침)
  const [isSpeciesBiteDrawerOpen, setIsSpeciesBiteDrawerOpen] = React.useState(false);
  const [isEncyclopediaDrawerOpen, setIsEncyclopediaDrawerOpen] = React.useState(false);
  const [isMemoDrawerOpen, setIsMemoDrawerOpen] = React.useState(false);

  // 네비 목적지 명칭: 사용자가 지정한 navi_name이 있으면 그것을 우선 사용, 없으면 spot.name
  const destinationName = spot.navi_name && spot.navi_name.trim().length > 0 ? spot.navi_name.trim() : spot.name;

  // 모바일 웹뷰 및 시스템 브라우저/카카오맵 앱 외부 링크 안전 오픈 헬퍼
  const openExternalUrl = (url: string) => {
    try {
      const win = window.open(url, '_system');
      if (!win || win.closed) {
        window.location.href = url;
      }
    } catch {
      window.location.href = url;
    }
  };

  // 카카오맵 길찾기 URL (커스텀 navi_url이 있으면 우선 사용)
  const kakaoNaviUrl = spot.navi_url && spot.navi_url.trim().length > 0
    ? spot.navi_url
    : `https://map.kakao.com/link/to/${encodeURIComponent(destinationName)},${spot.lat},${spot.lng}`;

  // 현재 시각 및 시뮬레이션 대상 시각 Date 객체
  const now = currentTime;
  const currentHour = now.getHours();
  const currentTidePoint = tide?.hourlyCurve.find((c) => c.hour === currentHour);

  const targetTime = new Date(now.getTime() + timelineOffsetHours * 3600 * 1000);
  const isNow = timelineOffsetHours === 0;

  const targetHour = targetTime.getHours();
  const targetYear = targetTime.getFullYear();
  const targetMonth = String(targetTime.getMonth() + 1).padStart(2, '0');
  const targetDate = String(targetTime.getDate()).padStart(2, '0');
  const targetHourStr = String(targetHour).padStart(2, '0');
  const targetTimePrefix = `${targetYear}-${targetMonth}-${targetDate}T${targetHourStr}:00`;

  let weatherIdx = -1;
  if (weather?.hourly?.time) {
    weatherIdx = weather.hourly.time.findIndex((t) => t.startsWith(targetTimePrefix));
  }

  let marineIdx = -1;
  if (marine?.hourly?.time) {
    marineIdx = marine.hourly.time.findIndex((t) => t.startsWith(targetTimePrefix));
  }

  // 시뮬레이션 시각에 따른 기상 / 해양 지표
  // isNow(현재 시각)일 때는 KHOA 실측치가 주입된 최신 실시간 데이터를 사용하여 맵 화면과 100% 일치 보장
  const simWindSpeed = isNow
    ? weather?.windSpeed ?? 0
    : weatherIdx >= 0 && weather?.hourly?.windSpeed && weather.hourly.windSpeed[weatherIdx] != null
    ? weather.hourly.windSpeed[weatherIdx]
    : weather?.windSpeed ?? 0;

  const simWindGust = isNow
    ? weather?.windGust ?? simWindSpeed
    : weatherIdx >= 0 && weather?.hourly?.windGust && weather.hourly.windGust[weatherIdx] != null
    ? weather.hourly.windGust[weatherIdx]
    : Math.max(weather?.windGust ?? 0, simWindSpeed);

  const simWindDir = isNow
    ? weather?.windDirection ?? 0
    : weatherIdx >= 0 && weather?.hourly?.windDirection && weather.hourly.windDirection[weatherIdx] != null
    ? weather.hourly.windDirection[weatherIdx]
    : weather?.windDirection ?? 0;

  const simTemp = isNow
    ? weather?.temp ?? 0
    : weatherIdx >= 0 && weather?.hourly?.temp && weather.hourly.temp[weatherIdx] != null
    ? weather.hourly.temp[weatherIdx]
    : weather?.temp ?? 0;

  const simWaterTemp = isNow
    ? marine?.seaSurfaceTemp ?? 0
    : marineIdx >= 0 && marine?.hourly?.seaSurfaceTemp && marine.hourly.seaSurfaceTemp[marineIdx] != null
    ? marine.hourly.seaSurfaceTemp[marineIdx]
    : marine?.seaSurfaceTemp ?? 0;

  const simCurrentVel = isNow
    ? marine?.currentVelocity ?? 0
    : marineIdx >= 0 && marine?.hourly?.currentVelocity && marine.hourly.currentVelocity[marineIdx] != null
    ? marine.hourly.currentVelocity[marineIdx]
    : marine?.currentVelocity ?? 0;

  const simCurrentDir = isNow
    ? marine?.currentDirection ?? 0
    : marineIdx >= 0 && marine?.hourly?.currentDirection && marine.hourly.currentDirection[marineIdx] != null
    ? marine.hourly.currentDirection[marineIdx]
    : marine?.currentDirection ?? 0;

  const simWaveHeight = isNow
    ? marine?.waveHeight ?? 0
    : marineIdx >= 0 && marine?.hourly?.waveHeight && marine.hourly.waveHeight[marineIdx] != null
    ? marine.hourly.waveHeight[marineIdx]
    : marine?.waveHeight ?? 0;

  const simWeatherText = isNow
    ? weather?.weatherText ?? '--'
    : weatherIdx >= 0 && weather?.hourly?.weatherCode && weather.hourly.weatherCode[weatherIdx] != null
    ? getWeatherText(weather.hourly.weatherCode[weatherIdx])
    : weather?.weatherText ?? '--';

  const simPop =
    weatherIdx >= 0 && weather?.hourly?.pop && weather.hourly.pop[weatherIdx] != null
      ? weather.hourly.pop[weatherIdx]
      : 0;

  const simPressureHpa = isNow
    ? weather?.pressureHpa
    : weatherIdx >= 0 && weather?.hourly?.pressureHpa && weather.hourly.pressureHpa[weatherIdx] != null
    ? weather.hourly.pressureHpa[weatherIdx]
    : weather?.pressureHpa;

  // 48h 시뮬레이션 타임라인과 실시간 조위/역기압 연동 현장 수심 계산
  const realDepthResult = React.useMemo(() => {
    const simHourIdx = currentHour + timelineOffsetHours;
    const simPoint =
      tide?.hourly72Curve?.find((c) => c.hour === simHourIdx) ||
      tide?.hourlyCurve?.find((c) => c.hour === targetHour) ||
      tide?.hourlyCurve?.[0];
    const simTideCm = simPoint?.height ?? Math.round((nearestStationInfo.station.datumZ0 ?? 2.5) * 100);

    return resolveUnifiedWaterDepth({
      spotLat: spot.lat,
      spotLng: spot.lng,
      targetLat: landingPoint?.lat,
      targetLng: landingPoint?.lng,
      spotType: spot.spot_type,
      khoaDpwt: khoaDepthRecord?.dpwt ?? null,
      khoaDpwtIsAtTarget: true,
      datumZ0: nearestStationInfo.station.datumZ0 ?? 2.5,
      tideHeightCm: simTideCm,
      pressureHpa: simPressureHpa,
      isPredictedTide: true,
    });
  }, [spot.lat, spot.lng, spot.spot_type, landingPoint?.lat, landingPoint?.lng, khoaDepthRecord, nearestStationInfo, tide?.hourly72Curve, tide?.hourlyCurve, currentHour, timelineOffsetHours, targetHour, simPressureHpa]);

  // 포인트 중심 캐스팅 방위각 산출 (방향성 Δθ 안착·선행조준 연산용)
  const castBearingDeg = React.useMemo(() => {
    if (spot.casting_start_deg !== undefined && spot.casting_end_deg !== undefined) {
      const span =
        spot.casting_end_deg >= spot.casting_start_deg
          ? spot.casting_end_deg - spot.casting_start_deg
          : 360 - spot.casting_start_deg + spot.casting_end_deg;
      return (spot.casting_start_deg + span / 2) % 360;
    }
    const compassMap: Record<string, number> = {
      N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315,
    };
    const first = spot.casting_directions?.find((d) => d !== 'ALL');
    return first ? compassMap[first] : undefined;
  }, [spot.casting_start_deg, spot.casting_end_deg, spot.casting_directions]);

  // 맞춤형 채비 선행 조준 / 적정 무게 처방
  const leadCastPrescription = React.useMemo(() => {
    const bearing = castBearingDeg ?? 90;
    return solveLeadCastAimPoint(
      bearing,
      tackleConfig.calibratedDistanceMeters,
      simWindSpeed,
      simWindDir,
      simCurrentVel,
      simCurrentDir,
      Math.max(1.0, realDepthResult.realDepthM),
      tackleConfig
    );
  }, [castBearingDeg, tackleConfig, simWindSpeed, simWindDir, simCurrentVel, simCurrentDir, realDepthResult.realDepthM]);

  // 현재 선택된 채비의 착수점 수심·조류 연동 예상 안착 시간 (MapView 레이더와 동일 물리 모델)
  const selectedSinkPhysics = React.useMemo(() => {
    return calculateSinkingPhysics(
      tackleConfig.weightGrams,
      realDepthResult.realDepthM,
      simCurrentVel,
      tackleConfig.baitConfig,
      {
        castBearingDeg,
        currentDirectionDeg: simCurrentDir,
        peLineSize: tackleConfig.peLineSize,
        honorFloatLayer: true,
      }
    );
  }, [tackleConfig, realDepthResult.realDepthM, simCurrentVel, castBearingDeg, simCurrentDir]);

  // 시뮬레이션 시각(timelineOffsetHours)에 동기화되는 환경 스냅샷 기반 종합/어종별 입질 점수
  const simTideSnapshot = React.useMemo(() => {
    if (!tide) return null;
    if (isNow) return tide;
    const simHourIdx = currentHour + timelineOffsetHours;
    const dayShift = Math.floor(simHourIdx / 24);
    const simMulNumber = (((tide.mulNumber - 1 + dayShift) % 15) + 15) % 15 + 1;
    const simCurvePt =
      tide.hourly72Curve?.find((c) => c.hour === simHourIdx) ||
      tide.hourlyCurve?.find((c) => c.hour === targetHour);
    return {
      ...tide,
      mulNumber: simMulNumber,
      hourlyCurve: simCurvePt ? [{ ...simCurvePt, hour: targetHour }] : tide.hourlyCurve,
    };
  }, [tide, isNow, currentHour, timelineOffsetHours, targetHour]);

  const effectiveBiteScore = React.useMemo(() => {
    if (isNow || !weather || !marine || !simTideSnapshot) return biteScore;
    const simWeatherObj: WeatherData = {
      ...weather,
      temp: simTemp,
      windSpeed: simWindSpeed,
      windDirection: simWindDir,
      windGust: simWindGust,
      pressureHpa: simPressureHpa,
    };
    const simMarineObj: MarineData = {
      ...marine,
      seaSurfaceTemp: simWaterTemp,
      waveHeight: simWaveHeight,
      currentVelocity: simCurrentVel,
      currentDirection: simCurrentDir,
    };
    return calculateBiteScore(spot, simWeatherObj, simMarineObj, simTideSnapshot, favoriteSpecies, targetTime, realDepthResult.realDepthM);
  }, [isNow, biteScore, spot, weather, marine, simTideSnapshot, favoriteSpecies, targetTime, realDepthResult.realDepthM, simTemp, simWindSpeed, simWindDir, simWindGust, simPressureHpa, simWaterTemp, simWaveHeight, simCurrentVel, simCurrentDir]);

  const scoredList = React.useMemo(() => {
    const spotTargetSpecies = spot.target_species || [];
    const caughtSpeciesFromLogs = Array.from(new Set(catchLogs.map((l) => l.fish_species).filter(Boolean)));
    const combinedSpecies = Array.from(new Set([...spotTargetSpecies, ...caughtSpeciesFromLogs]));
    const availableSpeciesList = combinedSpecies.length > 0 ? combinedSpecies : ['우럭', '광어', '감성돔', '농어'];

    const userFavorites =
      favoriteSpecies && favoriteSpecies.length > 0
        ? favoriteSpecies
        : (() => {
            try {
              const local = localStorage.getItem('exfish_favorite_species');
              return local ? JSON.parse(local) : ['우럭', '광어'];
            } catch {
              return ['우럭', '광어'];
            }
          })();

    const simWeatherObj: WeatherData | null = weather
      ? isNow
        ? weather
        : {
            ...weather,
            temp: simTemp,
            windSpeed: simWindSpeed,
            windDirection: simWindDir,
            windGust: simWindGust,
            pressureHpa: simPressureHpa,
          }
      : null;
    const simMarineObj: MarineData | null = marine
      ? isNow
        ? marine
        : {
            ...marine,
            seaSurfaceTemp: simWaterTemp,
            waveHeight: simWaveHeight,
            currentVelocity: simCurrentVel,
            currentDirection: simCurrentDir,
          }
      : null;

    const evalMonth = targetTime.getMonth() + 1;
    const list = availableSpeciesList.map((spName) => {
      const ecology =
        SPECIES_ENCYCLOPEDIA[spName] ||
        Object.values(SPECIES_ENCYCLOPEDIA).find((sp) => sp.name.includes(spName) || spName.includes(sp.name)) ||
        SPECIES_ENCYCLOPEDIA['우럭'];

      const scoreInfo =
        simWeatherObj && simMarineObj && simTideSnapshot
          ? calculateSingleSpeciesScore(
              ecology,
              spot,
              simWeatherObj,
              simMarineObj,
              simTideSnapshot,
              targetHour,
              evalMonth,
              targetTime,
              realDepthResult.realDepthM
            )
          : {
              speciesName: spName,
              score: 50,
              verdict: '환경 데이터 수신 중...',
              activityMatch: ecology.activityName,
              tempMatch: `최적수온 ${ecology.tempRange.optMin}~${ecology.tempRange.optMax}°C`,
            };

      const isFavorite = userFavorites.some((fav: string) => fav.includes(spName) || spName.includes(fav));
      const hitsCount = catchLogs.filter((l) => l.fish_species === spName && (l.fish_count ?? 0) > 0 && !l.is_hitless).length;
      const hitlessCount = catchLogs.filter((l) => l.fish_species === spName && ((l.fish_count ?? 0) === 0 || l.is_hitless)).length;
      const isPeakSeason = ecology.peakMonths ? ecology.peakMonths.includes(evalMonth) : false;

      return {
        name: spName,
        ecology,
        scoreInfo,
        isFavorite,
        hitsCount,
        hitlessCount,
        isPeakSeason,
      };
    });

    list.sort((a, b) => {
      if (a.isFavorite && !b.isFavorite) return -1;
      if (!a.isFavorite && b.isFavorite) return 1;
      return b.scoreInfo.score - a.scoreInfo.score;
    });
    return list;
  }, [spot, catchLogs, favoriteSpecies, weather, marine, simTideSnapshot, isNow, simTemp, simWindSpeed, simWindDir, simWindGust, simPressureHpa, simWaterTemp, simWaveHeight, simCurrentVel, simCurrentDir, targetHour, targetTime, realDepthResult.realDepthM]);

  return (
    <div className="spot-detail-panel flex flex-col h-full bg-[#0F172A] border-l border-slate-800 text-slate-100 overflow-hidden shadow-2xl">
      {/* 1. 상단 일체형 히어로: 사진 유무에 따라 동적 높이 최적화 (사진 없을 시 컴팩트 헤더로 세로 공간 확보) */}
      {(() => {
        const hasPhotos = Boolean(spot.photo_urls && spot.photo_urls.length > 0);
        const warnings: string[] = [];
        if (weather && weather.windSpeed >= 8) {
          warnings.push(`순간 강풍 주의 (${weather.windSpeed}m/s)`);
        }
        if (marine && marine.waveHeight >= 1.5) {
          warnings.push(`높은 파고/너울 주의 (${marine.waveHeight}m)`);
        }
        const isHazardTerrain = spot.spot_type === 'ROCK' || spot.spot_type === 'SEAWALL' || spot.spot_type === 'BEACH';
        if (isHazardTerrain && tide?.highTides && tide.highTides.length > 0) {
          const nowMinutes = now.getHours() * 60 + now.getMinutes();
          for (const ht of tide.highTides) {
            const [h, m] = ht.time.split(':').map(Number);
            const htMinutes = h * 60 + m;
            const diff = htMinutes - nowMinutes;
            if (diff > 0 && diff <= 120) {
              warnings.push(`만조(${ht.time}) ${diff}분 전! 퇴로 확보 필수`);
              break;
            }
          }
        }

        return (
          <div className="relative shrink-0 bg-[#0F172A] overflow-hidden border-b border-slate-800">
            <div className={hasPhotos ? 'relative w-full h-36 sm:h-44 overflow-hidden' : 'relative w-full bg-[#0F172A]'}>
              {hasPhotos && (
                <>
                  <img
                    src={spot.photo_urls![activePhotoIndex] || spot.photo_urls![0]}
                    alt={spot.name}
                    className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
                  />
                  {/* 비네팅 & 딤 오버레이 (사진 위 글씨 가독성 확보) */}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0F172A] via-[#0F172A]/50 to-[#0F172A]/75" />
                </>
              )}

              {/* Superimpose / 컴팩트 콘텐츠 레이어 */}
              <div className={hasPhotos ? 'absolute inset-0 p-3 flex flex-col justify-between z-10' : 'relative px-3 py-2 flex flex-col gap-1 z-10'}>
                {/* 상단 행: 타입 뱃지 + 작성자 + 사진 인디케이터 + 액션 버튼 그룹 */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                    <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-[#1E293B] text-slate-200 border border-slate-700/70">
                      {spot.spot_type === 'ROCK' ? '갯바위' : spot.spot_type === 'SEAWALL' ? '석축' : spot.spot_type === 'BREAKWATER' ? '방파제' : spot.spot_type === 'BEACH' ? '해변/백사장' : '선착장'}
                    </span>
                    <span className="text-[10px] text-slate-400">작성: {spot.author_name}</span>
                    {isAdmin && (
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-300 border border-amber-500/40 font-bold ml-1">
                        👑 ADMIN
                      </span>
                    )}
                    {hasPhotos && spot.photo_urls!.length > 1 && (
                      <div className="flex gap-1 ml-1 bg-[#0F172A]/70 backdrop-blur-sm px-1.5 py-0.5 rounded-full border border-slate-700/60">
                        {spot.photo_urls!.map((_, idx) => (
                          <button
                            key={idx}
                            onClick={() => setActivePhotoIndex(idx)}
                            className={`w-1.5 h-1.5 rounded-full transition-all ${
                              idx === activePhotoIndex ? 'bg-emerald-400 w-3' : 'bg-slate-500'
                            }`}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 액션 버튼 그룹 */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={async () => {
                        const spotTypeLabel = spot.spot_type === 'ROCK' ? '갯바위' : spot.spot_type === 'SEAWALL' ? '석축' : spot.spot_type === 'BREAKWATER' ? '방파제' : spot.spot_type === 'BEACH' ? '해변' : '선착장';
                        const spotSummary = `[ExFish 포인트] ${spot.name} (${spotTypeLabel}${spot.navi_name ? ` · ${spot.navi_name}` : ''})`;
                        const biteText = `🎣 입질 지수: ${biteScore?.totalScore ?? 0}점${biteScore?.verdict ? ` (${biteScore.verdict})` : ''}`;
                        
                        const weatherParts: string[] = [];
                        if (weather?.weatherText) weatherParts.push(weather.weatherText);
                        if (weather?.temp != null) weatherParts.push(`기온 ${weather.temp.toFixed(1)}℃`);
                        if (weather?.windSpeed != null) weatherParts.push(`풍속 ${formatWindSpeed(weather.windSpeed, windUnit)}`);
                        if (marine?.waveHeight != null) weatherParts.push(`파고 ${marine.waveHeight.toFixed(1)}m`);
                        if (marine?.seaSurfaceTemp != null) weatherParts.push(`수온 ${marine.seaSurfaceTemp.toFixed(1)}℃`);
                        const weatherText = weatherParts.length > 0 ? `🌤️ 날씨: ${weatherParts.join(' · ')}` : '';

                        const shareTitle = `ExFish - ${spot.name}`;
                        // 실제 배포 도메인 주소 보장 (localhost 방지)
                        const shareUrl = `https://exfish.vercel.app/?spot=${encodeURIComponent(spot.id)}`;
                        const shareText = `${spotSummary}\n${biteText}${weatherText ? `\n${weatherText}` : ''}\n🔗 바로가기: ${shareUrl}`;

                        // 모바일 네이티브 앱 환경: 다른 앱(카카오톡, 메시지 등)으로 공유 다이얼로그 호출
                        if (Capacitor.isNativePlatform()) {
                          try {
                            await Share.share({
                              title: shareTitle,
                              text: shareText,
                              url: shareUrl,
                              dialogTitle: `${spot.name} 포인트 공유하기`,
                            });
                            return;
                          } catch (e: any) {
                            if (e?.message?.includes('canceled') || e?.message?.includes('dismissed')) return;
                          }
                        }

                        // 웹 브라우저 환경: 포인트 링크 클립보드 복사
                        try {
                          if (navigator.clipboard) {
                            await navigator.clipboard.writeText(shareText);
                            alert(`포인트 요약 및 링크가 클립보드에 복사되었습니다.\n\n${shareText}`);
                          } else {
                            const ta = document.createElement('textarea');
                            ta.value = shareText;
                            document.body.appendChild(ta);
                            ta.select();
                            document.execCommand('copy');
                            document.body.removeChild(ta);
                            alert(`포인트 요약 및 링크가 클립보드에 복사되었습니다.\n\n${shareText}`);
                          }
                        } catch {
                          alert(`포인트 정보:\n${shareText}`);
                        }
                      }}
                      className="p-1.5 rounded-lg bg-[#1E293B] text-slate-200 hover:text-emerald-300 border border-slate-700/60 transition"
                      title="공유"
                    >
                      <Share2 size={13} />
                    </button>
                    {canManageSpot && (
                      <>
                        <button
                          onClick={() => onEditSpot(spot)}
                          className={`p-1.5 rounded-lg transition border ${
                            isAdmin
                              ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:text-white'
                              : 'bg-[#1E293B] border-slate-700/60 text-slate-200 hover:text-emerald-300'
                          }`}
                          title={isAdmin ? '포인트 수정 (관리자 전권)' : '포인트 수정'}
                        >
                          <Edit size={13} />
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm(`'${spot.name}' 포인트를 정말 삭제하시겠습니까?`)) {
                              onDeleteSpot(spot.id);
                            }
                          }}
                          className={`p-1.5 rounded-lg transition border ${
                            isAdmin
                              ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:text-white'
                              : 'bg-[#1E293B] border-slate-700/60 text-slate-200 hover:text-amber-300'
                          }`}
                          title={isAdmin ? '포인트 삭제 (관리자 전권)' : '포인트 삭제'}
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}
                    {/* 모바일 앱/웹 창 아래로 내리기 ('V' ChevronDown 버튼으로 교체) */}
                    <button
                      onClick={onMinimize || onClose}
                      className="p-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 border border-emerald-400/40 transition md:hidden flex items-center justify-center shadow"
                      title="상세보기 접기 (아래로 내리기)"
                    >
                      <ChevronDown size={16} />
                    </button>
                  </div>
                </div>

                {/* 하단 행: 포인트 이름 + 실시간 최고 타깃 + 날씨/기온/수온 */}
                <div className="space-y-1">
                  <h1 className="text-base sm:text-lg font-black text-white truncate">
                    {spot.name}
                  </h1>

                  <div className={hasPhotos ? 'space-y-1' : 'flex flex-wrap items-center gap-1.5'}>
                    {/* 실시간 최고 타깃 */}
                    {biteScore?.topSpecies && (
                      <div className="inline-flex items-center gap-1.5 bg-emerald-500/15 px-2 py-0.5 rounded-lg border border-emerald-500/40 text-[11px]">
                        <span className="text-emerald-400 font-black shrink-0">✨ 최고 타깃:</span>
                        <button
                          type="button"
                          onClick={() => biteScore.topSpecies && setQuickModalSpecies(biteScore.topSpecies.speciesName)}
                          className="font-bold text-slate-100 underline decoration-emerald-400 underline-offset-2 hover:text-emerald-200"
                        >
                          {biteScore.topSpecies.speciesName} ({biteScore.topSpecies.score}점)
                        </button>
                      </div>
                    )}

                    {/* 날씨, 기온, 수온 배치 */}
                    <div className="inline-flex items-center gap-2 bg-[#1E293B] px-2 py-0.5 rounded-lg border border-slate-700/60 text-[11px] font-mono">
                      <span className="text-slate-100 font-sans font-bold">{simWeatherText}</span>
                      <span className="text-slate-500">·</span>
                      <span className="text-slate-300 font-semibold">기온 {simTemp.toFixed(1)}°C</span>
                      <span className="text-slate-500">·</span>
                      <span className="text-emerald-300 font-semibold">수온 {simWaterTemp > 0 ? `${simWaterTemp.toFixed(1)}°C` : '--'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 2행: 안전 경보 & 고립 주의 배너 (경보가 있을 때만 영역 차지) */}
            {warnings.length > 0 && (
              <div className="p-[6px] bg-[#0F172A]">
                <div className="p-[10px] rounded-[16px] bg-[#1E293B] border border-amber-500/50 text-slate-200 text-xs flex items-start gap-2">
                  <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center text-slate-950 font-black text-xs shrink-0 mt-0.5">
                    !
                  </div>
                  <div className="flex-1 flex flex-col gap-0.5">
                    <span className="font-extrabold text-amber-300 text-xs">안전주의:</span>
                    <div className="text-xs text-slate-200 font-medium leading-relaxed flex flex-wrap gap-x-2">
                      {warnings.map((w, idx) => (
                        <span key={idx} className="inline-flex items-center">
                          {idx > 0 && <span className="text-amber-400 mr-2">·</span>}
                          {w}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* 3. 아이콘 전용 탭 바 (활성 탭 에머랄드 단일 통일) */}
      <div className="flex border-b border-slate-800 bg-[#0F172A] shrink-0 px-2 py-1 gap-1.5">
        <button
          onClick={() => setActiveTab('WEATHER_TIDE')}
          className={`flex-1 py-2 rounded-xl flex items-center justify-center transition relative ${
            activeTab === 'WEATHER_TIDE'
              ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-[#1E293B]'
          }`}
          title="기상과 물때"
        >
          <Waves size={20} className={activeTab === 'WEATHER_TIDE' ? 'text-emerald-400 scale-110' : ''} />
          {activeTab === 'WEATHER_TIDE' && (
            <span className="absolute bottom-0 w-6 h-0.5 bg-emerald-400 rounded-full" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('LOGS')}
          className={`flex-1 py-2 rounded-xl flex items-center justify-center transition relative ${
            activeTab === 'LOGS'
              ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-[#1E293B]'
          }`}
          title="어종과 조과"
        >
          <div className="relative">
            <Fish size={20} className={activeTab === 'LOGS' ? 'text-emerald-400 scale-110' : ''} />
            {catchLogs.length > 0 && (
              <span className="absolute -top-1.5 -right-2 px-1 py-0.2 rounded-full bg-emerald-500 text-slate-950 text-[9px] font-bold">
                {catchLogs.length}
              </span>
            )}
          </div>
          {activeTab === 'LOGS' && (
            <span className="absolute bottom-0 w-6 h-0.5 bg-emerald-400 rounded-full" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('DIRECTIONS')}
          className={`flex-1 py-2 rounded-xl flex items-center justify-center transition relative ${
            activeTab === 'DIRECTIONS'
              ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-[#1E293B]'
          }`}
          title="포인트 정보"
        >
          <Info size={20} className={activeTab === 'DIRECTIONS' ? 'text-emerald-400 scale-110' : ''} />
          {activeTab === 'DIRECTIONS' && (
            <span className="absolute bottom-0 w-6 h-0.5 bg-emerald-400 rounded-full" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('MEMOS')}
          className={`flex-1 py-2 rounded-xl flex items-center justify-center transition relative ${
            activeTab === 'MEMOS'
              ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-[#1E293B]'
          }`}
          title="메모"
        >
          <div className="relative">
            <MessageSquare size={20} className={activeTab === 'MEMOS' ? 'text-emerald-400 scale-110' : ''} />
            {spotMemos.length > 0 && (
              <span className="absolute -top-1.5 -right-2 px-1 py-0.2 rounded-full bg-emerald-500 text-slate-950 text-[9px] font-bold">
                {spotMemos.length}
              </span>
            )}
          </div>
          {activeTab === 'MEMOS' && (
            <span className="absolute bottom-0 w-6 h-0.5 bg-emerald-400 rounded-full" />
          )}
        </button>

        {/* [요구사항 6] 상세보기 '현장 메모' 아이콘 옆에 즐겨찾기(별표) 토글 버튼 */}
        {onToggleFavorite && (
          <button
            onClick={() => onToggleFavorite(spot.id)}
            className={`px-3 py-2 rounded-xl flex items-center justify-center transition active:scale-95 ${
              isFavorited
                ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40 shadow-sm'
                : 'text-slate-400 hover:text-emerald-300 hover:bg-[#1E293B]'
            }`}
            title={isFavorited ? '즐겨찾기(찜) 해제' : '이 포인트 즐겨찾기(찜) 추가'}
            aria-label="즐겨찾기"
          >
            <Star size={19} className={isFavorited ? 'fill-emerald-400 text-emerald-400 animate-in zoom-in-75' : ''} />
          </button>
        )}
      </div>

      {/* 탭 본문 영역 (배경 #0F172A, 카드 간격 6px 고정) */}
      <div className="flex-1 overflow-y-auto p-[6px] space-y-[6px] bg-[#0F172A]">
        {activeTab === 'WEATHER_TIDE' && (
          <div className="space-y-[6px]">
            {/* [최상단 통합 배치] 모든 경고 카드 (해양 기상 특보 + 연안안전사고 위험예보 + 들물 고립 탈출 골든타임) */}
            {(() => {
              const isWindDangerTop = simWindSpeed >= 9.5 || simWindGust >= 13.0;
              const isCurrentDangerTop = simCurrentVel >= 0.9;
              const isWaveDangerTop = simWaveHeight >= 1.8;
              if (!isWindDangerTop && !isCurrentDangerTop && !isWaveDangerTop) return null;

              return (
                <div className="p-[10px] bg-[#1E293B] border border-amber-500/50 rounded-[16px] flex items-center gap-2.5 text-slate-200 text-xs">
                  <ShieldAlert size={22} className="text-amber-400 shrink-0" />
                  <div>
                    <div className="font-bold text-amber-300 flex items-center gap-1.5">
                      <span>🚨 해양 기상 특보급 위험 경고</span>
                    </div>
                    <p className="text-[11px] text-slate-300 leading-relaxed pt-0.5">
                      {isWaveDangerTop && '⚠️ 높은 파고(너울)로 인한 갯바위/방파제 테트라포드 월파 위험! '}
                      {isWindDangerTop && '⚠️ 강풍/돌풍으로 인한 낚시 불가 및 실족 추락 위험! '}
                      {isCurrentDangerTop && '⚠️ 빠른 급류/와류로 인한 채비 쓸림 및 해상 안전사고 위험! '}
                      출조를 자제하고 안전장구(구명조끼/펠트화)를 반드시 점검하세요.
                    </p>
                  </div>
                </div>
              );
            })()}

            {/* [제안 2] 국립해양조사원·해양경찰청 연안안전사고 위험예보제 위젯 (석축, 갯바위, 해변, 백사장에만 적용) */}
            {(() => {
              const isHazardTerrain = spot.spot_type === 'ROCK' || spot.spot_type === 'SEAWALL' || spot.spot_type === 'BEACH';
              if (!isHazardTerrain) return null;

              const isSpringTide = tide ? (tide.mulNumber >= 6 && tide.mulNumber <= 10) : false;
              const now = currentTime;
              const curMinutes = now.getHours() * 60 + now.getMinutes();
              let isNearHighTide = false;
              let nextHighTideTimeStr = '';

              if (tide?.highTides && tide.highTides.length > 0) {
                for (const ht of tide.highTides) {
                  const parts = ht.time.split(':').map(Number);
                  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                    const htMinutes = parts[0] * 60 + parts[1];
                    if (Math.abs(curMinutes - htMinutes) <= 120) {
                      isNearHighTide = true;
                      nextHighTideTimeStr = ht.time;
                      break;
                    }
                  }
                }
                if (!nextHighTideTimeStr && tide.highTides[0]) {
                  nextHighTideTimeStr = tide.highTides[0].time;
                }
              }

              const isHighWave = simWaveHeight >= 1.5;
              const isHighWind = simWindSpeed >= 8.5;

              // 연안안전사고 예보 등급 판정
              const safetyLevel: 'WARNING' | 'ADVISORY' | 'NORMAL' =
                (isSpringTide && isNearHighTide && isHighWave) || simWaveHeight >= 2.0 || simWindSpeed >= 11.0
                  ? 'WARNING' // 경보
                  : (isSpringTide && isNearHighTide) || isHighWave || isHighWind || (tide && tide.mulNumber >= 7 && tide.mulNumber <= 9)
                  ? 'ADVISORY' // 주의보
                  : 'NORMAL'; // 관심

              if (safetyLevel === 'NORMAL') return null;

              const isWarning = safetyLevel === 'WARNING';

              return (
                <div
                  className={`p-[10px] rounded-[16px] bg-[#1E293B] border text-xs space-y-1.5 ${
                    isWarning
                      ? 'border-amber-500/60 text-slate-100'
                      : 'border-amber-500/40 text-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-bold">
                      <ShieldAlert size={16} className="text-amber-400" />
                      <span className="text-amber-300">
                        해양경찰청 연안안전사고 위험예보 [{isWarning ? '🚨 경보' : '⚡ 주의보'}]
                      </span>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-bold bg-[#0F172A] text-amber-300 border border-amber-500/35">
                      {isSpringTide ? '사리(대조기)' : '연안위험'}
                    </span>
                  </div>

                  <div className="space-y-1 text-[11px] leading-relaxed">
                    {isSpringTide && isNearHighTide && (
                      <p className="font-semibold text-slate-200">
                        🚨 <strong className="text-amber-300">[만조 전후 갯바위 고립 주의]</strong> 현재 대조기(사리) 만조({nextHighTideTimeStr}) 전후 2시간 구간입니다. 바닷물이 빠르게 유입되어 갯바위 하산로나 진입로가 침수될 수 있으니 미리 퇴로를 확보하세요!
                      </p>
                    )}
                    {isHighWave && (
                      <p className="text-slate-200">
                        🌊 <strong className="text-amber-300">[너울성 파도 월파 주의]</strong> 테트라포드(TTP) 및 간출암에 너울이 덮칠 수 있습니다. 미끄럼 방지 펠트화 및 구명조끼를 반드시 착용하세요.
                      </p>
                    )}
                    <div className="flex items-center justify-between pt-1 border-t border-slate-700/60 text-[10px] text-slate-400">
                      <span>연안사고 예방법 낚시통제구역 진입 금지</span>
                      <span className="font-bold text-amber-300">📞 해양긴급신고 119 / 122</span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* [항목 1] 갯바위/석축 들물 고립 방지 탈출 골든타임 카운트다운 타이머 & 비프 경보 (석축, 갯바위, 해변, 백사장에만 적용) */}
            {tide && (() => {
              const isHazardTerrain = spot.spot_type === 'ROCK' || spot.spot_type === 'SEAWALL' || spot.spot_type === 'BEACH';
              if (!isHazardTerrain || !tide.lowTides || tide.lowTides.length === 0) return null;
              const now = currentTime;
              const curMins = now.getHours() * 60 + now.getMinutes();

              // 가장 인접한 간조(들물 시작점) 찾기 (조위변화곡선 예측 tide.lowTides와 100% 동기화)
              let nearestLow: { time: string; height: number; diffMinutes: number } | null = null;
              const lowTidesList = tide.lowTides || [];
              for (const lt of lowTidesList) {
                const [lh, lm] = lt.time.split(':').map(Number);
                const lowMins = lh * 60 + lm;
                const diff = curMins - lowMins;
                if (diff >= -60 && diff <= 300) {
                  if (!nearestLow || Math.abs(diff) < Math.abs(nearestLow.diffMinutes)) {
                    nearestLow = { time: lt.time, height: lt.height, diffMinutes: diff };
                  }
                }
              }

              if (!nearestLow) return null;

              const isFloodStarted = nearestLow.diffMinutes >= 0;
              const elapsedMinutes = Math.max(0, nearestLow.diffMinutes);
              const safeWindowMinutes = 90; // 간조 후 90분 이내 철수 권장
              const remainingMinutes = safeWindowMinutes - elapsedMinutes;

              const isDanger = isFloodStarted && remainingMinutes <= 0;
              const isCaution = isFloodStarted && remainingMinutes > 0 && remainingMinutes <= 30;
              const isSafe = isFloodStarted && remainingMinutes > 30;

              return (
                <div
                  className={`p-[10px] rounded-[16px] bg-[#1E293B] border text-xs space-y-2 transition-all ${
                    isDanger || isCaution
                      ? 'border-amber-500/50 text-slate-100'
                      : 'border-slate-700/60 text-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-1.5 font-bold">
                      {isDanger || isCaution ? (
                        <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center text-slate-950 font-black text-xs shrink-0">
                          !
                        </div>
                      ) : (
                        <Clock size={16} className="text-emerald-400" />
                      )}
                      <span className={isDanger || isCaution ? 'text-amber-300 text-sm font-extrabold' : 'text-emerald-300'}>
                        {isDanger
                          ? '🚨 [갯바위 침수 고립 위험] 즉시 철수하십시오!'
                          : isCaution
                          ? '⚠️ [들물 탈출 골든타임 임박] 안전 철수 준비'
                          : isSafe
                          ? '⏱️ 갯바위 들물 탈출 골든타임 카운트다운'
                          : '🌊 [간조 임박] 들물 안전 계획'}
                      </span>
                    </div>

                    {/* Phase 3: 비프/사이렌 경보음 토글 및 비상 알람 테스트 버튼 */}
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          sendEmergencyEvacuationNotification(
                            '🚨 [긴급 대피 훈련] 들물 퇴로 침수 경보',
                            '테스트 경보: 갯바위 하산로가 침수되기 전 즉시 고지대로 대피하십시오!',
                            true
                          );
                        }}
                        className="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40 text-[10px] flex items-center gap-1 font-bold transition active:scale-95"
                        title="로컬 알림 + 사이렌 + 햅틱 비상 경보 테스트"
                      >
                        <Volume2 size={12} className="text-amber-400" />
                        <span>비상 알람 테스트</span>
                      </button>
                      <button
                        type="button"
                        onClick={toggleEvacAlarm}
                        className={`px-2.5 py-1 rounded-lg border text-[10px] flex items-center gap-1 font-bold transition active:scale-95 ${
                          isEvacAlarmEnabled
                            ? 'bg-amber-500 text-slate-950 border-amber-400'
                            : 'bg-[#0F172A] text-slate-300 border-slate-700/60 hover:text-white'
                        }`}
                        title="들물 안전 실시간 감시 및 비상 알림 토글"
                      >
                        <Bell size={12} className={isEvacAlarmEnabled ? 'text-slate-950' : 'text-slate-400'} />
                        <span>{isEvacAlarmEnabled ? '안전 감시 가동중' : '들물 감시 켜기'}</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] pt-1.5 border-t border-slate-700/60">
                    <div>
                      <span className="text-slate-400">기준 간조: </span>
                      <strong className="text-emerald-300 font-mono">{nearestLow.time}</strong>
                      <span className="text-slate-400"> ({nearestLow.height}cm)</span>
                      {isFloodStarted ? (
                        <span className="text-slate-400 ml-1.5">
                          · 들물 <strong className="text-amber-300 font-mono">{elapsedMinutes}분</strong> 경과
                        </span>
                      ) : (
                        <span className="text-slate-400 ml-1.5">
                          · 간조까지 <strong className="text-emerald-300 font-mono">{Math.abs(nearestLow.diffMinutes)}분</strong> 전
                        </span>
                      )}
                    </div>

                    <div className="text-right">
                      {isFloodStarted ? (
                        remainingMinutes > 0 ? (
                          <span className="font-bold text-amber-300">
                            탈출 잔여: <span className="text-sm font-mono text-white">{remainingMinutes}분</span>
                          </span>
                        ) : (
                          <span className="font-bold text-amber-400">
                            골든타임 초과 (+{Math.abs(remainingMinutes)}분)
                          </span>
                        )
                      ) : (
                        <span className="text-emerald-300 font-bold">간조 후 90분 골든타임 예정</span>
                      )}
                    </div>
                  </div>

                  <p className="text-[10px] text-slate-300 leading-snug">
                    {isDanger
                      ? '⚠️ 바닷물이 갯바위 하산로나 낮은 진입로를 이미 삼켰을 수 있습니다. 테트라포드나 갯바위에 서 있지 말고 해경(119/122)에 구조를 요청하거나 즉시 고지대로 대피하세요.'
                      : isCaution
                      ? '💡 갯바위는 간조 후 1시간 30분이 지나면 발목 이상 물이 차올라 짐을 챙기기 어려워집니다. 지금 즉시 낚싯대를 접고 철수하십시오.'
                      : '💡 서해/남해 갯바위는 들물 시작 시 퇴로가 가장 먼저 잠깁니다. 안전을 위해 간조 후 90분 이내에 반드시 육지로 철수하세요.'}
                  </p>
                </div>
              );
            })()}

            {/* 기상과 물때 첫 카드: 풍향(화살표), 조류 각도(화살표), 파고·너울(0.6m, 3sec) */}
            <CompactEnvHud
              spot={spot}
              weather={weather}
              marine={marine}
            />

            {/* [국립해양조사원 KHOA 공식 연동] 조위 그래픽 곡선 및 물때표 */}
            {tide && (() => {
              const nearestStation = findNearestKhoaStation(spot.lat, spot.lng);

              interface TideScheduleItem {
                type: 'HIGH' | 'LOW' | 'SUNRISE' | 'SUNSET';
                typeLabel: string;
                time: string;
                minutes: number;
                height?: number;
                diff?: number;
              }

              // [정합성 동기화] 뒤쪽 조위변화곡선 예측(-6h ~ +36h)과 100% 일치하도록 tide.highTides / tide.lowTides 동기화 사용
              const rawExtremums: { type: 'HIGH' | 'LOW'; time: string; height: number; minutes: number; diff?: number }[] = [
                ...(tide.highTides || []).map((h) => {
                  const [hh, mm] = h.time.split(':').map(Number);
                  return { type: 'HIGH' as const, time: h.time, height: h.height, minutes: (hh || 0) * 60 + (mm || 0) };
                }),
                ...(tide.lowTides || []).map((l) => {
                  const [hh, mm] = l.time.split(':').map(Number);
                  return { type: 'LOW' as const, time: l.time, height: l.height, minutes: (hh || 0) * 60 + (mm || 0) };
                }),
              ];

              rawExtremums.sort((a, b) => a.minutes - b.minutes);

              // 조위차 계산 (이전/이후 반대 극값과의 높이 차이)
              for (let i = 0; i < rawExtremums.length; i++) {
                const ev = rawExtremums[i];
                if (ev.diff !== undefined) continue;
                let prevOpp: typeof ev | null = null;
                for (let j = i - 1; j >= 0; j--) {
                  if (rawExtremums[j].type !== ev.type) {
                    prevOpp = rawExtremums[j];
                    break;
                  }
                }
                if (!prevOpp) {
                  for (let j = i + 1; j < rawExtremums.length; j++) {
                    if (rawExtremums[j].type !== ev.type) {
                      prevOpp = rawExtremums[j];
                      break;
                    }
                  }
                }
                ev.diff = prevOpp ? Math.abs(ev.height - prevOpp.height) : 20;
              }

              const scheduleItems: TideScheduleItem[] = [
                ...rawExtremums.map((e) => ({
                  type: e.type,
                  typeLabel: e.type === 'HIGH' ? '만조' : '간조',
                  time: e.time,
                  minutes: e.minutes,
                  height: e.height,
                  diff: e.diff,
                })),
              ];

              if (tide.sunrise) {
                const [hh, mm] = tide.sunrise.split(':').map(Number);
                scheduleItems.push({
                  type: 'SUNRISE',
                  typeLabel: '일출',
                  time: tide.sunrise,
                  minutes: (hh || 0) * 60 + (mm || 0),
                });
              }

              if (tide.sunset) {
                const [hh, mm] = tide.sunset.split(':').map(Number);
                scheduleItems.push({
                  type: 'SUNSET',
                  typeLabel: '일몰',
                  time: tide.sunset,
                  minutes: (hh || 0) * 60 + (mm || 0),
                });
              }

              scheduleItems.sort((a, b) => a.minutes - b.minutes);

              // 24시간 그래픽 조위 곡선 (SVG 좌표 산출: width 320, height 70)
              const svgW = 320;
              const svgH = 70;
              const allHeights = rawExtremums.map((e) => e.height);
              const minH = allHeights.length ? Math.min(...allHeights) - 15 : 0;
              const maxH = allHeights.length ? Math.max(...allHeights) + 20 : 100;
              const rangeH = Math.max(20, maxH - minH);

              // [정합성 동기화] 뒤쪽 조위변화곡선 예측(-6h ~ +36h)의 당일 00:00~24:00 연속 시계열(hourly72Curve/hourlyCurve)을 100% 동일하게 직접 렌더링
              const curvePoints: { x: number; y: number; hour: number }[] = [];
              for (let hr = 0; hr <= 24; hr++) {
                const x = (hr / 24) * svgW;
                // 당일 0~24시간의 시간대별 정확한 조위 취득 (마스터 시계열 기반 100% 동기화)
                const targetPt = tide.hourlyCurve?.[hr] ?? tide.hourly72Curve?.[hr];
                let estHeight = targetPt?.height;
                if (estHeight === undefined) {
                  if (rawExtremums.length >= 2) {
                    const targetMins = hr * 60;
                    const firstEv = rawExtremums[0];
                    const phase = ((targetMins - firstEv.minutes) / 745.2) * 2 * Math.PI;
                    const amp = (maxH - minH) / 2;
                    const mid = minH + amp;
                    estHeight = firstEv.type === 'HIGH' ? mid + amp * Math.cos(phase) : mid - amp * Math.cos(phase);
                  } else {
                    estHeight = (minH + maxH) / 2;
                  }
                }
                const y = svgH - 12 - ((estHeight - minH) / rangeH) * (svgH - 24);
                curvePoints.push({ x, y: Math.max(10, Math.min(svgH - 6, y)), hour: hr });
              }

              const pathD = curvePoints.reduce((acc, pt, idx) => {
                return idx === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
              }, '');
              const areaD = `${pathD} L ${svgW} ${svgH} L 0 ${svgH} Z`;

              const nowMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
              const nowX = Math.min(svgW - 2, Math.max(2, (nowMinutes / 1440) * svgW));

              const displayMulText = tide.mulText;
              const displayLunarDate = tide.lunarDateStr;
              const curPredictPoint = (tide.curve36 || []).find((c) => c.isCurrent);
              const displayCurrentHeight = curPredictPoint?.height ?? currentTidePoint?.height;

              return (
                <div className="p-[10px] bg-[#1E293B] border border-slate-700/60 rounded-[16px] space-y-2.5">
                  {/* 1행: 물때 명칭 & 음력 & 국립해양조사원 관측소 & 현재 조위 (앞 아이콘 생략) */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-extrabold text-base sm:text-lg text-emerald-300">{displayMulText}</span>
                      <span className="text-xs sm:text-sm text-slate-300 font-medium">({displayLunarDate})</span>
                      <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-[#0F172A] text-slate-300 border border-slate-700/60 font-medium">
                        국립해양조사원 {nearestStation.station.name} 관측소 ({nearestStation.distanceKm}km)
                      </span>
                    </div>
                    {displayCurrentHeight !== undefined && (
                      <div className="text-xs sm:text-sm text-emerald-300 font-mono font-bold bg-[#0F172A] border border-emerald-500/35 px-2.5 py-1 rounded-xl flex items-center gap-1.5">
                        <span className="text-slate-400 font-sans font-normal text-xs">현재:</span>
                        <span className="text-white font-extrabold">{displayCurrentHeight}cm</span>
                        {currentTidePoint?.stateText && (
                          <span className="text-emerald-300 font-sans text-xs">({currentTidePoint.stateText})</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 2행: 24시간 실시간 조위 곡선 그래픽 (바다타임 표준 그래픽 시각화) */}
                  <div className="relative overflow-hidden rounded-xl border border-slate-700/50 bg-[#0F172A] p-2">
                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono mb-1 px-1">
                      <span>00:00</span>
                      <span className="text-emerald-300 font-sans font-semibold">24시간 연속 조위 변화 곡선</span>
                      <span>24:00</span>
                    </div>
                    <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-16 overflow-visible">
                      <defs>
                        <linearGradient id="tideGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity="0.40" />
                          <stop offset="100%" stopColor="#10b981" stopOpacity="0.03" />
                        </linearGradient>
                      </defs>
                      {/* 수위 영역 그래디언트 채우기 */}
                      <path d={areaD} fill="url(#tideGrad)" />
                      {/* 수위 조석 곡선 */}
                      <path d={pathD} fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" />

                      {/* 만조/간조 극점 그래픽 핀 & 텍스트 */}
                      {rawExtremums.map((ev, idx) => {
                        const px = (ev.minutes / 1440) * svgW;
                        const py = svgH - 12 - ((ev.height - minH) / rangeH) * (svgH - 24);
                        const isHigh = ev.type === 'HIGH';
                        return (
                          <g key={idx}>
                            <circle
                              cx={px}
                              cy={py}
                              r={isHigh ? 3.5 : 3}
                              fill={isHigh ? '#f59e0b' : '#34d399'}
                              stroke="#0f172a"
                              strokeWidth="1.5"
                            />
                            <text
                              x={px}
                              y={isHigh ? Math.max(10, py - 6) : Math.min(svgH - 2, py + 11)}
                              fill={isHigh ? '#fbbf24' : '#34d399'}
                              fontSize="8.5"
                              fontWeight="bold"
                              textAnchor="middle"
                              className="font-mono"
                            >
                              {ev.time} ({ev.height}cm)
                            </text>
                          </g>
                        );
                      })}

                      {/* 현재 시각 버티컬 인디케이터 라인 */}
                      <line
                        x1={nowX}
                        y1="4"
                        x2={nowX}
                        y2={svgH}
                        stroke="#f59e0b"
                        strokeWidth="1.5"
                        strokeDasharray="2 2"
                      />
                      <circle cx={nowX} cy="5" r="2.5" fill="#f59e0b" />
                    </svg>
                  </div>

                  {/* 3행: 물때 & 태양 이벤트 시간표 (박스/아이콘 제거하여 한 줄 유지) */}
                  <div className="overflow-hidden rounded-xl border border-slate-700/50 bg-[#0F172A]">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 bg-[#1E293B]/60 text-[10px] text-slate-400 font-semibold">
                          <th className="py-1 px-2.5 w-14 text-center">시간</th>
                          <th className="py-1 px-2.5 w-14 text-center">구분</th>
                          <th className="py-1 px-2.5 text-right">조위 (수위 변화)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70 font-mono">
                        {scheduleItems.map((item, idx) => {
                          const isHigh = item.type === 'HIGH';
                          const isLow = item.type === 'LOW';
                          const isSunrise = item.type === 'SUNRISE';
                          const isSunset = item.type === 'SUNSET';

                          return (
                            <tr
                              key={idx}
                              className="transition-colors hover:bg-[#1E293B]/50"
                            >
                              <td className="py-1 px-2.5 text-center font-bold text-slate-200 text-[11px] whitespace-nowrap">
                                {item.time}
                              </td>
                              <td className="py-1 px-2.5 text-center whitespace-nowrap">
                                {isHigh && (
                                  <span className="font-bold text-amber-400 text-[11px]">만조</span>
                                )}
                                {isLow && (
                                  <span className="font-bold text-emerald-400 text-[11px]">간조</span>
                                )}
                                {isSunrise && (
                                  <span className="font-medium text-slate-300 text-[11px]">일출</span>
                                )}
                                {isSunset && (
                                  <span className="font-medium text-slate-400 text-[11px]">일몰</span>
                                )}
                              </td>
                              <td className="py-1 px-2.5 text-right whitespace-nowrap">
                                {item.height !== undefined ? (
                                  <span className="inline-flex items-center justify-end gap-1">
                                    <span className="font-extrabold text-white text-[11px]">
                                      {item.height}cm
                                    </span>
                                    <span
                                      className={`text-[10px] font-semibold ${
                                        isHigh ? 'text-amber-400' : 'text-emerald-400'
                                      }`}
                                    >
                                      ({isHigh ? '+' : '-'}{item.diff}cm)
                                    </span>
                                  </span>
                                ) : (
                                  <span className="text-slate-600 font-sans text-[11px]">-</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}

            {/* 포인트 비교 & 바람 피하기 카드 (물때 표시 카드 아래 배치) */}
            <SpotCompareAndWindCard
              spot={spot}
              allSpots={allSpots}
              weather={weather}
              onSelectSpot={onSelectSpot}
              onOpenCompare={onOpenCompare}
            />

            {/* 풍속·조류·파고 위험 수준 판정 및 48시간 시뮬레이터 */}
            {(() => {
              const isWindDanger = simWindSpeed >= 9.5 || simWindGust >= 13.0;
              const isWindWarning = !isWindDanger && simWindSpeed >= 6.5;

              const isCurrentDanger = simCurrentVel >= 0.9;
              const isCurrentWarning = !isCurrentDanger && simCurrentVel >= 0.6;

              const isWaveDanger = simWaveHeight >= 1.8;
              const isWaveWarning = !isWaveDanger && simWaveHeight >= 1.2;

              return (
                <>
                  {/* 48시간 미래 환경 타임라인 시뮬레이터 (슬라이더 바로 아래 4대 날씨 카드가 인접하여 직관적 관찰 가능) */}
                  <div className="p-[10px] bg-[#1E293B] border border-slate-700/60 rounded-[16px] space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/40">
                          {isNow
                            ? '⏱️ 실시간 환경'
                            : `⏱️ ${targetMonth}/${targetDate} ${targetHourStr}:00 (+${timelineOffsetHours}시간 예측)`}
                        </span>
                        {!isNow && (
                          <button
                            onClick={() => setTimelineOffsetHours(0)}
                            className="flex items-center gap-1 text-[11px] text-emerald-300 hover:text-emerald-200 font-semibold"
                          >
                            <RotateCcw size={11} /> 현재 시각 복귀
                          </button>
                        )}
                      </div>
                      <button
                        onClick={() => setIsPlaying(!isPlaying)}
                        className={`flex items-center justify-center p-1.5 rounded-lg transition shadow ${
                          isPlaying
                            ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                            : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                        }`}
                        title={isPlaying ? '시뮬레이션 일시정지' : '미래 예측 자동 재생'}
                        aria-label={isPlaying ? '일시정지' : '재생'}
                      >
                        {isPlaying ? <Pause size={12} /> : <Play size={12} />}
                      </button>
                    </div>

                    {/* 타임라인 슬라이더 바 (0h ~ 48h) */}
                    <div className="space-y-1">
                      <input
                        type="range"
                        min="0"
                        max="48"
                        step="1"
                        value={timelineOffsetHours}
                        onChange={(e) => {
                          setTimelineOffsetHours(Number(e.target.value));
                          if (isPlaying) setIsPlaying(false);
                        }}
                        className="w-full h-1.5 bg-[#0F172A] rounded-lg appearance-none cursor-pointer accent-emerald-400"
                      />
                      <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                        <span>현재 (0h)</span>
                        <span>+12h</span>
                        <span>내일 (+24h)</span>
                        <span>+36h</span>
                        <span>모레 (+48h)</span>
                      </div>
                    </div>
                  </div>

                  {/* 실시간/예측 환경 1x3 컴팩트 3박스 (바람, 조류, 파고·주기 - 상단 헤더와 중복 제거) */}
                  {(() => {
                    const castCenter = resolveCastCenterDeg(spot);
                    const { windClass } = classifyRelativeWind(castCenter, simWindDir);
                    const hasCastArc = castCenter !== null;
                    const relWindLabel = hasCastArc ? getRelativeWindLabel(windClass) : '';
                    const currentStateLabel =
                      simCurrentVel > 0.8 ? '급류' : simCurrentVel > 0.5 ? '본류' : simCurrentVel > 0.2 ? '완만' : '정조·약류';

                    return (
                      <div className="grid grid-cols-3 gap-[6px] text-xs">
                        {/* 박스1: 풍향 화살표(상대풍향), 풍속(돌풍) */}
                        <div
                          className={`p-[10px] rounded-[16px] bg-[#1E293B] border transition-colors ${
                            isWindDanger || isWindWarning
                              ? 'border-amber-500/50'
                              : 'border-slate-700/60'
                          }`}
                        >
                          <div className="flex items-center justify-between text-[10px] text-slate-400 leading-tight">
                            <span className="flex items-center gap-0.5">
                              <span
                                className="inline-flex items-center justify-center w-3.5 h-3.5 text-slate-300 font-bold text-xs"
                                style={{ transform: `rotate(${simWindDir}deg)` }}
                              >
                                ↓
                              </span>
                              <span>바람</span>
                            </span>
                            {relWindLabel && (
                              <span className={`px-1 rounded text-[9px] font-semibold ${
                                windClass === 'TAILWIND'
                                  ? 'text-emerald-300 bg-emerald-500/15'
                                  : 'text-amber-300 bg-amber-500/15'
                              }`}>
                                {relWindLabel}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-baseline gap-1 truncate">
                            <span className={`text-xs font-bold ${isWindDanger || isWindWarning ? 'text-amber-300' : 'text-slate-100'}`}>
                              {formatWindSpeed(simWindSpeed, windUnit)}
                            </span>
                            <span className="text-[10px] text-slate-400 truncate">
                              ({formatWindSpeed(simWindGust, windUnit)})
                            </span>
                          </div>
                        </div>

                        {/* 박스2: 조류 화살표, 조류 속도 (정조/약류 등) */}
                        <div
                          className={`p-[10px] rounded-[16px] bg-[#1E293B] border transition-colors ${
                            isCurrentDanger || isCurrentWarning
                              ? 'border-amber-500/50'
                              : 'border-slate-700/60'
                          }`}
                        >
                          <div className="flex items-center justify-between text-[10px] text-slate-400 leading-tight">
                            <span className="flex items-center gap-0.5">
                              <span
                                className="inline-flex items-center justify-center w-3.5 h-3.5 text-emerald-400 font-bold text-xs"
                                style={{ transform: `rotate(${simCurrentDir}deg)` }}
                              >
                                ↑
                              </span>
                              <span>조류</span>
                            </span>
                            <span className={`text-[9px] font-semibold ${isCurrentDanger || isCurrentWarning ? 'text-amber-300' : 'text-emerald-400'}`}>
                              {currentStateLabel}
                            </span>
                          </div>
                          <div className="mt-0.5 text-xs font-bold text-emerald-300 truncate">
                            {formatCurrentVelocity(simCurrentVel, currentUnit)}
                          </div>
                        </div>

                        {/* 박스3: 파고, 파고 주기 */}
                        <div
                          className={`p-[10px] rounded-[16px] bg-[#1E293B] border transition-colors ${
                            isWaveDanger || isWaveWarning
                              ? 'border-amber-500/50'
                              : 'border-slate-700/60'
                          }`}
                        >
                          <div className="text-[10px] text-slate-400 leading-tight">파고·주기</div>
                          <div className="mt-0.5 flex items-baseline justify-between gap-1 truncate">
                            <span className={`text-xs font-bold ${isWaveDanger || isWaveWarning ? 'text-amber-300' : 'text-slate-100'}`}>
                              {simWaveHeight.toFixed(1)}m
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {marine?.wavePeriod ? `${marine.wavePeriod}초` : '-'}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* 2-1. [KHOA 연동] 수심 및 안착시간 (채비 비거리 예측과 동일 지표) */}
                  <div className="p-[10px] bg-[#1E293B] border border-slate-700/60 rounded-[16px] space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-bold text-xs text-slate-100 shrink-0">
                          수심 및 안착시간
                        </span>
                        <span className="px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold bg-[#0F172A] text-emerald-300 border border-slate-700/60 shrink-0">
                          {tackleConfig.totalWeightGrams ?? tackleConfig.weightGrams}g
                        </span>
                        <span className="text-[10px] text-slate-400 truncate">
                          {getTackleShortLabel(tackleConfig)}
                        </span>
                      </div>
                      <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/35 shrink-0">
                        {khoaDepthRecord ? `KHOA · ${nearestStationInfo.station.name}` : `추정 · ${nearestStationInfo.station.name}`}
                      </span>
                    </div>

                    <div className="bg-[#0F172A] rounded-xl px-2.5 py-2 border border-slate-700/50 space-y-1 text-[11px] font-mono">
                      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
                        <span className="text-slate-300">
                          비거리 <strong className="text-emerald-300 text-xs">{tackleConfig.calibratedDistanceMeters}m</strong>
                          <span className="text-slate-500 text-[10px]"> ({tackleConfig.totalWeightGrams ?? tackleConfig.weightGrams}g)</span>
                        </span>
                        <span className="text-slate-300">
                          수심 <strong className="text-slate-100">{realDepthResult.isExposed ? '간출(0m)' : `${realDepthResult.realDepthM.toFixed(1)}m`}</strong>
                        </span>
                        <span className="text-slate-300">
                          유속 <strong className="text-emerald-300">{simCurrentVel.toFixed(1)}m/s</strong>
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 pt-1 border-t border-slate-800/80">
                        <span className="text-slate-300">
                          바닥안착 <strong className="text-emerald-300">{selectedSinkPhysics.fallTimeSec}초</strong>
                        </span>
                        <span className="text-slate-300">
                          하강속도 <strong className="text-slate-100">{Math.round(selectedSinkPhysics.effSinkSpeedMps * 100)}cm/s</strong>
                        </span>
                        {selectedSinkPhysics.driftDistanceM > 0.3 && (
                          <span className="text-slate-300">
                            흘림 <strong className="text-emerald-300">+{selectedSinkPhysics.driftDistanceM}m</strong>
                          </span>
                        )}
                      </div>
                      {selectedSinkPhysics.canReachBottom === false && (
                        <div className="text-[10px] text-amber-300 font-semibold pt-0.5">
                          흘림 과도 · {selectedSinkPhysics.recommendedMinWeightG}g+ 증량 권장
                        </div>
                      )}
                    </div>

                    {realDepthResult.isExposed && (
                      <div className="text-[10px] text-amber-300 bg-amber-500/10 p-1.5 rounded-lg border border-amber-500/35">
                        {realDepthResult.statusText}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}

            {/* 3. [제안 6] 현재 시각 기준 연속 조위 변화 곡선 (-6h ~ +36h, 스크롤 없는 반응형 100% 뷰) */}
            {tide && (
              <div className="p-[10px] bg-[#1E293B] border border-slate-700/60 rounded-[16px] space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-100">
                    조위 변화 곡선 (-6h ~ +36h 실시간 예측)
                  </span>
                </div>

                {/* 그래프 본체: 스크롤 없이 가로 100% 반응형으로 채움 */}
                <div className="w-full h-56 pt-1 rounded-xl bg-[#0F172A] border border-slate-700/50">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={200}>
                    <AreaChart
                      data={tide.curve36 || tide.hourly72Curve || tide.hourlyCurve}
                      margin={{ top: 18, right: 10, left: -22, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="tideGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.45} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>

                      {/* 황금 피딩 타임 영역 시각화 */}
                      {tide.feedingTimes?.map((f, fIdx) => {
                        if (!f.startDisplayTime || !f.endDisplayTime) return null;
                        return (
                          <ReferenceArea
                            key={`feed-zone-${fIdx}`}
                            x1={f.startDisplayTime}
                            x2={f.endDisplayTime}
                            fill="#10b981"
                            fillOpacity={0.14}
                            stroke="#10b981"
                            strokeOpacity={0.45}
                            strokeDasharray="2 2"
                          />
                        );
                      })}

                      <XAxis
                        dataKey="displayTime"
                        stroke="#64748b"
                        fontSize={9}
                        tickLine={false}
                        interval={5}
                      />
                      <YAxis stroke="#64748b" fontSize={9} tickLine={false} unit="cm" domain={['auto', 'auto']} />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload as TideCurvePoint;
                            const diffStr = typeof data.tideDiff === 'number'
                              ? ` (${data.tideDiff > 0 ? `+${data.tideDiff}` : data.tideDiff}cm)`
                              : '';
                            return (
                              <div className="bg-[#0F172A] border border-slate-700 p-2.5 rounded-xl text-xs shadow-2xl">
                                <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-1 font-bold mb-1">
                                  <span className="text-emerald-300">
                                    {data.dayLabel && <span className="mr-1 text-slate-400">[{data.dayLabel}]</span>}
                                    {data.timeStr}
                                  </span>
                                  {data.isCurrent && (
                                    <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 text-[9px] font-bold">
                                      현재
                                    </span>
                                  )}
                                </div>
                                <div className="font-mono text-sm font-bold text-white">
                                  {data.stateText} {data.height}cm{diffStr}
                                </div>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />

                      {/* 현재 시각 세로 점선 표시 (isCurrent === true) */}
                      {(() => {
                        const curPoint = (tide.curve36 || []).find((c) => c.isCurrent);
                        if (!curPoint) return null;
                        return (
                          <ReferenceLine
                            x={curPoint.displayTime}
                            stroke="#34d399"
                            strokeWidth={2}
                            strokeDasharray="3 3"
                            label={{
                              value: `현재 (${curPoint.height}cm)`,
                              position: 'top',
                              fill: '#34d399',
                              fontSize: 10,
                              fontWeight: 'bold',
                            }}
                          />
                        );
                      })()}

                      <Area
                        type="monotone"
                        dataKey="height"
                        stroke="#10b981"
                        strokeWidth={2.5}
                        fillOpacity={1}
                        fill="url(#tideGradient)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* 4. 예상 입질 기회 테이블 (일자 D+0/D+1 · 시간 · 이유) */}
            {tide?.feedingTimes && tide.feedingTimes.length > 0 && (
              <div className="p-[10px] bg-[#1E293B] border border-slate-700/60 rounded-[16px] space-y-1.5">
                <div className="text-xs font-bold text-emerald-300">
                  <span>예상 입질 기회</span>
                </div>
                <div className="overflow-hidden rounded-xl border border-slate-700/50 bg-[#0F172A]">
                  <table className="w-full text-[11px] text-left border-collapse">
                    <thead>
                      <tr className="bg-[#1E293B]/60 border-b border-slate-800 text-[10px] text-slate-400">
                        <th className="py-1 px-2 w-12 text-center">일자</th>
                        <th className="py-1 px-2 w-32">시간</th>
                        <th className="py-1 px-2">이유</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {tide.feedingTimes.map((f, idx) => {
                        const dCode =
                          f.dayLabel === '내일' ? 'D+1' : f.dayLabel === '모레' ? 'D+2' : 'D+0';
                        const pureTime = f.timeRange.replace(/^\((오늘|내일|모레)\)\s*/, '').trim();
                        const tideParenMatch = pureTime.match(/\((만조|간조)\)\s*$/);
                        const timeOnly = pureTime.replace(/\s*\((만조|간조)\)\s*$/, '').trim();
                        const tideSubLabel = tideParenMatch ? `(${tideParenMatch[1]})` : null;
                        const cleanReason = f.reason.replace(/[^\w\sㄱ-힣.,·~()]/g, '').trim();
                        return (
                          <tr key={idx} className="hover:bg-emerald-500/10">
                            <td className="py-1.5 px-2 text-center font-mono font-bold text-emerald-300 whitespace-nowrap align-top">
                              {dCode}
                            </td>
                            <td className="py-1.5 px-2 font-mono text-slate-200 whitespace-nowrap align-top">
                              <div>{timeOnly}</div>
                              {tideSubLabel && (
                                <div className="text-[10px] font-sans font-semibold text-amber-300 mt-0.5">
                                  {tideSubLabel}
                                </div>
                              )}
                            </td>
                            <td className="py-1.5 px-2 text-slate-400 align-top">
                              {cleanReason || f.reason}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 5. Windy 상시 노출 (요구사항 7) */}
            <div className="p-[10px] bg-[#1E293B] border border-slate-700/60 rounded-[16px] space-y-2">
              <div className="flex items-center justify-end">
                <a
                  href={windyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-[11px] text-emerald-300 flex items-center gap-1 font-bold transition"
                >
                  <span>windy 새창 열기</span>
                  <ExternalLink size={10} />
                </a>
              </div>

              <div className="relative w-full h-52 rounded-xl overflow-hidden border border-slate-700/50 bg-[#0F172A]">
                <iframe
                  title="Windy Map"
                  src={`https://embed.windy.com/embed2.html?lat=${spot.lat}&lon=${spot.lng}&detailLat=${spot.lat}&detailLon=${spot.lng}&width=400&height=200&zoom=11&level=surface&overlay=wind&product=ecmwf&menu=&message=&marker=true&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=m%2Fs&metricTemp=%C2%B0C&radarRange=-1`}
                  className="w-full h-full border-0"
                />
              </div>
            </div>
          </div>
        )}



        {activeTab === 'LOGS' && (
          <div className="space-y-[6px]">
            {/* [요구사항 7] 입질 종합 지수 브리핑 카드 (타임라인 오프셋 연동) */}
            {effectiveBiteScore && (
              <div className="p-[10px] rounded-[16px] bg-[#1E293B] border border-slate-700/60 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex flex-col items-center justify-center w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-extrabold shrink-0">
                    <span className="text-[10px] leading-none opacity-80">{isNow ? '종합' : `+${timelineOffsetHours}h`}</span>
                    <span className="text-lg leading-none font-mono font-black">{effectiveBiteScore.totalScore}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5 flex-wrap">
                      <span>{isNow ? '실시간' : '예측'} 종합 입질 {effectiveBiteScore.totalScore}점</span>
                      <span
                        className={`px-1.5 py-0.2 rounded text-[9px] ${
                          effectiveBiteScore.windRelation.includes('최적')
                            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40'
                            : 'bg-amber-500/15 text-amber-300 border border-amber-500/40'
                        }`}
                      >
                        {effectiveBiteScore.windRelation}
                      </span>
                      {effectiveBiteScore.targetSummaryLabel && (
                        <span className="px-1.5 py-0.2 rounded text-[9px] bg-[#0F172A] text-slate-300 border border-slate-700/60 truncate max-w-[140px]">
                          🎯 {effectiveBiteScore.targetSummaryLabel}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-300 truncate pt-0.5">{effectiveBiteScore.verdict}</p>
                    {effectiveBiteScore.waveSweepWarning && (
                      <p className="text-[10.5px] text-amber-300 font-medium truncate pt-0.5 flex items-center gap-1">
                        <span>{effectiveBiteScore.waveSweepWarning}</span>
                      </p>
                    )}
                  </div>
                </div>
                {effectiveBiteScore.topSpecies && (
                  <div className="hidden sm:block text-right shrink-0">
                    <div className="text-xs font-bold text-emerald-300">
                      🏆 1순위: {effectiveBiteScore.topSpecies.speciesName} ({effectiveBiteScore.topSpecies.score}점)
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 1. 이 포인트에서 낚이는 어종별 실시간 입질 지수 */}
            {(() => {
              return (
                <div className="p-[10px] bg-[#1E293B] border border-slate-700/60 rounded-[16px] space-y-2">
                  <button
                    type="button"
                    onClick={() => setIsSpeciesBiteDrawerOpen(!isSpeciesBiteDrawerOpen)}
                    className="w-full flex items-center justify-between cursor-pointer select-none"
                  >
                    <div className="flex items-center gap-1.5">
                      <Fish size={15} className="text-emerald-400" />
                      <span className="text-xs font-bold text-slate-100">
                        실시간 어종별 입질 지수
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        ({scoredList.length}종)
                      </span>
                    </div>
                    <ChevronDown
                      size={15}
                      className={`text-slate-400 transition-transform duration-200 ${
                        isSpeciesBiteDrawerOpen ? 'rotate-180 text-emerald-400' : ''
                      }`}
                    />
                  </button>

                  {/* 리스트 뷰 형태의 실시간 어종 목록 (Drawer 접힘/펼침 지원) */}
                  {isSpeciesBiteDrawerOpen && (
                    <div className="divide-y divide-slate-800/80 bg-[#0F172A] rounded-xl border border-slate-700/50 overflow-hidden">
                      {scoredList.map((item) => {
                        const { name, ecology, scoreInfo, isFavorite, hitsCount, isPeakSeason } = item;
                        const score = scoreInfo.score;
                        const isExpanded = expandedSpecies === name;
                        const rigInfo = getSpeciesRigInfo(name);

                        // 점수 등급별 스타일 (강조 Emerald / 경고 Amber / 중립 Slate)
                        const scoreBg = score >= 65
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                          : score >= 50
                          ? 'bg-[#1E293B] text-slate-300 border-slate-700/60'
                          : 'bg-amber-500/15 text-amber-300 border-amber-500/40';

                        const scoreLabel = score >= 80 ? '대박 찬스' : score >= 65 ? '호조황 기대' : score >= 50 ? '무난한 편' : '비활성';

                        return (
                          <div
                            key={`scored-species-${name}`}
                            onClick={() => setExpandedSpecies(isExpanded ? null : name)}
                            className={`p-2.5 transition select-none cursor-pointer ${
                              isFavorite
                                ? 'bg-emerald-500/5 hover:bg-emerald-500/10'
                                : 'hover:bg-[#1E293B]/60'
                            } ${isExpanded ? 'bg-[#1E293B]/80 ring-1 ring-emerald-500/35' : ''}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {isFavorite && (
                                  <span className="flex items-center gap-0.5 px-1.5 py-0.2 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 text-[9px] font-bold">
                                    <Star size={9} className="fill-emerald-300" /> 관심
                                  </span>
                                )}

                                {/* [요구사항 7] 물고기명 (클릭 시 아코디언으로 설명+선호물때+시간대+채비 일체형 펼침) */}
                                <span className="font-bold text-sm text-slate-100 flex items-center gap-1">
                                  <span>🐟 {name}</span>
                                  <ChevronDown
                                    size={13}
                                    className={`text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-180 text-emerald-400' : ''}`}
                                  />
                                </span>

                                <span className="px-1.5 py-0.2 rounded bg-[#1E293B] text-slate-300 text-[10px]">
                                  {ecology.categoryName}
                                </span>
                                {isPeakSeason && (
                                  <span className="px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 text-[9px] font-semibold">
                                    제철
                                  </span>
                                )}
                                {hitsCount > 0 && (
                                  <span className="text-[10px] text-emerald-400 font-mono">
                                    ({hitsCount}수)
                                  </span>
                                )}
                              </div>

                              {/* 입질 점수 뱃지 (점수는 크게, 평가는 아래에 작게 표기) */}
                              <div className={`px-2 py-0.5 rounded-lg border font-mono font-bold text-center shrink-0 min-w-[54px] ${scoreBg}`}>
                                <span className="text-sm font-extrabold block leading-tight">{score}점</span>
                                <span className="text-[9px] font-sans font-normal opacity-85 block leading-tight">{scoreLabel}</span>
                              </div>
                            </div>

                            {/* [요구사항 5 & 7] 원클릭 어종 설명 + 선호 물때/시간대 + 맞춤 추천 채비 일체형 아코디언 */}
                            {isExpanded && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="mt-2 pt-2 border-t border-slate-700/60 space-y-2 animate-in fade-in duration-150"
                              >
                                {/* 1. 어종 설명 & 생태 요약 */}
                                <div className="p-2.5 bg-[#0F172A] rounded-xl border border-slate-700/50 space-y-1.5 text-xs">
                                  <div className="text-slate-200 leading-relaxed text-[11px]">
                                    {ecology.description}
                                  </div>
                                  <div className="flex flex-wrap gap-1.5 text-[10px] text-slate-400 pt-0.5">
                                    {ecology.bottomName && (
                                      <span className="px-1.5 py-0.5 rounded bg-[#1E293B] border border-slate-700/60 text-slate-300">
                                        바닥: {ecology.bottomName}
                                      </span>
                                    )}
                                    {ecology.waterLayerName && (
                                      <span className="px-1.5 py-0.5 rounded bg-[#1E293B] border border-slate-700/60 text-slate-300">
                                        유영층: {ecology.waterLayerName}
                                      </span>
                                    )}
                                    {ecology.minLengthCm && (
                                      <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300 font-bold">
                                        {ecology.minLengthCm}cm 이하 방생
                                      </span>
                                    )}
                                    {ecology.prohibitedNote && (
                                      <span className="px-1.5 py-0.5 rounded bg-[#1E293B] border border-slate-700/60 text-slate-300 text-[9.5px]">
                                        {ecology.prohibitedNote}
                                      </span>
                                    )}
                                  </div>
                                </div>

                              {/* 2. [요구사항 5] 선호 물때 & 선호 시간대 & 적정 수온 브리핑 */}
                              <div className="p-2.5 bg-[#0F172A] rounded-xl border border-emerald-500/30 space-y-1.5 text-xs">
                                <div className="font-bold text-emerald-300 flex items-center gap-1.5 text-xs">
                                  <span>🌊 최적 공략 물때 & 피딩 타임</span>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px] text-slate-300">
                                  <div>
                                    <strong className="text-slate-400">· 선호 물때:</strong>{' '}
                                    <span className="text-slate-200">
                                      {ecology.currentPrefName || (spot.best_tides?.length ? spot.best_tides.join(', ') : '전 물때 무난')}
                                    </span>
                                  </div>
                                  <div>
                                    <strong className="text-slate-400">· 선호 시간대:</strong>{' '}
                                    <span className="text-slate-200">
                                      {ecology.activityName || (spot.best_times?.length ? spot.best_times.join(', ') : '새벽/해질녘 피딩')}
                                    </span>
                                  </div>
                                  <div className="sm:col-span-2">
                                    <strong className="text-slate-400">· 적정 수온:</strong>{' '}
                                    <span className="text-slate-200">
                                      최적 {ecology.tempRange.optMin}~{ecology.tempRange.optMax}°C (생존한계 {ecology.tempRange.min}~{ecology.tempRange.max}°C)
                                    </span>
                                  </div>
                                </div>
                                <div className="text-[10.5px] text-emerald-300 pt-1 border-t border-slate-800">
                                  <strong>히트 골든타임:</strong> {rigInfo.goldenHoursText(tide?.sunrise || '06:30', tide?.sunset || '18:30', tide?.mulNumber || 7)}
                                </div>
                              </div>

                              {/* 3. [요구사항 7] 맞춤 추천 채비 상세 */}
                              <div className="p-2.5 bg-[#0F172A] rounded-xl border border-slate-700/50 space-y-2 text-[11px]">
                                <div className="font-bold text-emerald-300 flex items-center justify-between flex-wrap gap-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span>맞춤 추천 채비 ({name})</span>
                                    <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold border bg-emerald-500/15 text-emerald-300 border-emerald-500/40">
                                      {rigInfo.primaryMethodName}
                                    </span>
                                  </div>
                                  <span className="text-[10px] text-slate-400">
                                    수온 {simWaterTemp.toFixed(1)}°C · 조류 {simCurrentVel.toFixed(1)}m/s 기준
                                  </span>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-slate-300 text-[10px]">
                                  {rigInfo.rig?.isLureApplicable ? (
                                    <div>
                                      <strong className="text-emerald-300">· 루어/에기:</strong> {rigInfo.recommendedRig.lure}
                                    </div>
                                  ) : (
                                    <div>
                                      <strong className="text-emerald-300">· 원투/채비:</strong> {rigInfo.rig?.hookRig || rigInfo.recommendedRig.hookWeight}
                                    </div>
                                  )}
                                  <div>
                                    <strong className="text-slate-400">· 주력 미끼:</strong> {rigInfo.recommendedRig.bait}
                                  </div>
                                  <div>
                                    <strong className="text-slate-400">· 원줄/목줄:</strong> {rigInfo.recommendedRig.line}
                                  </div>
                                  <div>
                                    <strong className="text-slate-400">· 봉돌/싱커:</strong> {rigInfo.recommendedRig.hookWeight}
                                  </div>
                                  {rigInfo.rig?.rodReel && (
                                    <div className="sm:col-span-2 text-[9.5px] text-slate-400">
                                      <strong className="text-slate-300">· 추천 낚싯대/릴:</strong> {rigInfo.rig.rodReel}
                                    </div>
                                  )}
                                </div>

                                {!rigInfo.rig?.isLureApplicable && rigInfo.rig?.lureAltText && (
                                  <div className="text-[9.5px] text-amber-300 bg-amber-500/10 px-2 py-1 rounded border border-amber-500/35">
                                    ⚠️ <strong>주의:</strong> {rigInfo.rig.lureAltText}
                                  </div>
                                )}

                                <div className="text-[10px] text-slate-200 bg-[#1E293B] p-1.5 rounded-lg border border-slate-700/60">
                                  <strong>핵심 액션:</strong> {rigInfo.recommendedRig.action}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  )}
                </div>
              );
            })()}

            {/* 2. 채비 및 수심 공략 팁 (실시간 어종별 입질 지수 아래로 이동) */}
            {spot.description && (
              <div className="p-[10px] bg-[#1E293B] border border-slate-700/60 rounded-[16px] space-y-1">
                <span className="text-xs font-bold text-slate-200">💡 채비 및 수심 공략 팁</span>
                <p className="text-xs text-slate-300 leading-relaxed">{spot.description}</p>
              </div>
            )}

            {/* 3. 조과 히스토리 및 조과 등록 (실시간 어종별 입질 지수 아래로 이동) */}
            <div className="flex justify-between items-center px-1 pt-0.5">
              <span className="text-xs font-semibold text-slate-300">
                조과 히스토리 ({catchLogs.length}건)
              </span>
              <button
                onClick={onOpenCatchLogModal}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition active:scale-95 cursor-pointer"
              >
                <PlusCircle size={14} />
                <span>조과/꽝 등록</span>
              </button>
            </div>

            {/* 빅데이터 조과 & 꽝 통계 카드 (출조 1건 이상일 때 표시) */}
            {catchLogs.length > 0 && (() => {
              const total = catchLogs.length;
              const hitLogs = catchLogs.filter((l) => (l.fish_count ?? 0) > 0 && !l.is_hitless);
              const hitlessLogs = catchLogs.filter((l) => (l.fish_count ?? 0) === 0 || l.is_hitless);
              const hitRate = Math.round((hitLogs.length / total) * 100);
              const avgHitTemp = hitLogs.length > 0
                ? (hitLogs.reduce((acc, cur) => acc + (cur.water_temp || 0), 0) / hitLogs.length).toFixed(1)
                : null;
              const avgHitlessTemp = hitlessLogs.length > 0
                ? (hitlessLogs.reduce((acc, cur) => acc + (cur.water_temp || 0), 0) / hitlessLogs.length).toFixed(1)
                : null;

              return (
                <div className="p-[10px] bg-[#1E293B] border border-slate-700/60 rounded-[16px] space-y-2 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-slate-100">
                      손맛 통계
                    </span>
                    <span className="text-[11px] text-emerald-300 font-mono font-bold">
                      히트율: {hitRate}%
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 text-center">
                    <div className="bg-[#0F172A] p-2 rounded-xl border border-slate-700/50">
                      <div className="text-[10px] text-slate-400">총 출조</div>
                      <div className="text-sm font-bold text-white font-mono">{total}회</div>
                    </div>
                    <div className="bg-[#0F172A] p-2 rounded-xl border border-emerald-500/35">
                      <div className="text-[10px] text-emerald-400">손맛 성공</div>
                      <div className="text-sm font-bold text-emerald-300 font-mono">{hitLogs.length}회</div>
                    </div>
                    <div className="bg-[#0F172A] p-2 rounded-xl border border-amber-500/35">
                      <div className="text-[10px] text-amber-400">꽝 (노피시)</div>
                      <div className="text-sm font-bold text-amber-300 font-mono">{hitlessLogs.length}회</div>
                    </div>
                  </div>
                  {(avgHitTemp || avgHitlessTemp) && (
                    <div className="text-[11px] text-slate-400 pt-1 flex justify-between border-t border-slate-700/60">
                      {avgHitTemp && <span>🐟 성공 시 평균수온: <strong className="text-emerald-300">{avgHitTemp}°C</strong></span>}
                      {avgHitlessTemp && <span>❌ 꽝 당시 평균수온: <strong className="text-amber-300">{avgHitlessTemp}°C</strong></span>}
                    </div>
                  )}
                </div>
              );
            })()}

            {catchLogs.length === 0 ? null : (
              catchLogs.map((log) => {
                const isHitless = (log.fish_count ?? 0) === 0 || log.is_hitless;

                return (
                  <div
                    key={log.id}
                    className={`p-[10px] rounded-[16px] bg-[#1E293B] space-y-2 text-xs border transition ${
                      isHitless
                        ? 'border-amber-500/40'
                        : 'border-slate-700/60'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-2 flex-wrap">
                        {isHitless ? (
                          <>
                            <span className="px-2 py-0.5 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/40 font-bold text-[11px] flex items-center gap-1">
                              <span>💔 꽝</span>
                              <span className="text-[10px] opacity-90">(떠나버린 물고기)</span>
                            </span>
                            <span className="text-sm font-bold text-slate-100">
                              대상어: {log.fish_species}
                            </span>
                            <span className="text-slate-400 text-[11px]">(0수 / 입질 없음)</span>
                          </>
                        ) : (
                          <>
                            <span className="text-base font-bold text-emerald-400">
                              {log.fish_species}
                            </span>
                            {log.fish_size_cm && (
                              <span className="px-1.5 py-0.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 font-mono font-bold">
                                {log.fish_size_cm} cm
                              </span>
                            )}
                            <span className="text-slate-300">({log.fish_count}수)</span>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[11px] text-slate-400">
                          {log.catch_date} {log.catch_time}
                        </span>
                        {Boolean(isAdmin || log.user_id === 'user-me' || (currentUser && log.user_id === currentUser.id)) && (
                          <>
                            <button
                              onClick={() => onEditLog(log)}
                              className="p-1 rounded-lg bg-[#0F172A] hover:bg-slate-800 text-slate-300 hover:text-emerald-300 transition"
                              title={isAdmin ? "조과 기록 수정 (관리자 권한)" : "조과 기록 수정"}
                            >
                              <Edit size={13} />
                            </button>
                            <button
                              onClick={() => {
                                if (confirm(`'${log.fish_species}' 조과 기록을 삭제하시겠습니까?`)) {
                                  onDeleteLog(log.id);
                                }
                              }}
                              className="p-1 rounded-lg bg-[#0F172A] hover:bg-amber-500/15 text-slate-400 hover:text-amber-300 transition"
                              title={isAdmin ? "조과 기록 삭제 (관리자 권한)" : "조과 기록 삭제"}
                            >
                              <Trash2 size={13} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* 출조 시간대 정보 (시작~종료 및 총 낚시시간) */}
                    {(log.start_time || log.end_time || log.duration_minutes) && (
                      <div className="text-[11px] text-slate-300 flex items-center gap-1.5">
                        <Clock size={11} className="text-slate-400" />
                        <span>낚시 시간: </span>
                        <span className="font-mono text-slate-100">
                          {log.start_time || ''} ~ {log.end_time || ''}
                        </span>
                        {log.duration_minutes != null && log.duration_minutes > 0 && (
                          <span className="text-emerald-300 font-medium">
                            ({Math.floor(log.duration_minutes / 60)}시간 {log.duration_minutes % 60}분간)
                          </span>
                        )}
                      </div>
                    )}

                    {/* 당시 환경 스냅샷 배지 (중립 슬레이트 통일) */}
                    <div className="flex flex-wrap gap-1.5 text-[11px]">
                      <span className="px-2 py-0.5 rounded-lg bg-[#0F172A] text-slate-300 border border-slate-700/60">
                        🌊 {log.catch_mul} ({log.tide_state})
                      </span>
                      <span className="px-2 py-0.5 rounded-lg bg-[#0F172A] text-slate-300 border border-slate-700/60">
                        🌡️ 수온 {log.water_temp}°C
                      </span>
                      <span className="px-2 py-0.5 rounded-lg bg-[#0F172A] text-slate-300 border border-slate-700/60 inline-flex items-center gap-1">
                        <span>💨</span>
                        {log.wind_direction != null && (
                          <span
                            className="inline-flex items-center justify-center w-3.5 h-3.5 font-bold"
                            style={{ transform: `rotate(${log.wind_direction}deg)` }}
                          >
                            ↓
                          </span>
                        )}
                        <span>{formatWindSpeed(log.wind_speed, windUnit)}</span>
                      </span>
                      {log.current_velocity != null && (
                        <span className="px-2 py-0.5 rounded-lg bg-[#0F172A] text-emerald-300 border border-emerald-500/35 font-mono">
                          🧭 조류 {formatCurrentVelocity(log.current_velocity, currentUnit)}
                        </span>
                      )}
                      {log.lat != null && log.lng != null && (
                        <button
                          type="button"
                          onClick={() =>
                            openExternalUrl(
                              `https://map.kakao.com/link/map/${encodeURIComponent(spot.name)},${log.lat},${log.lng}`
                            )
                          }
                          className="px-2 py-0.5 rounded-lg bg-[#0F172A] hover:bg-slate-800 text-emerald-300 border border-slate-700/60 font-mono cursor-pointer transition"
                        >
                          📍 {log.lat.toFixed(4)}, {log.lng.toFixed(4)}
                        </button>
                      )}
                    </div>

                    {log.lure_bait && (
                      <div className="text-slate-300">
                        <span className="text-slate-500">채비: </span>
                        {log.lure_bait} ({log.catch_method === 'LURE' ? '루어' : log.catch_method === 'SURF' ? '원투' : '찌낚'})
                      </div>
                    )}

                    {log.memo && (
                      <div className="p-2 rounded-xl text-slate-300 leading-relaxed bg-[#0F172A] border border-slate-700/50">
                        {log.memo}
                      </div>
                    )}

                    {/* AI 꽝 사후 복기 브리핑 ("떠나버린 물고기를 기리며") */}
                    {isHitless && (() => {
                      const rawLogDate = log.catch_date ? new Date(`${log.catch_date}T${log.catch_time || '12:00'}:00`) : new Date();
                      const validLogDate = isNaN(rawLogDate.getTime()) ? new Date() : rawLogDate;
                      const historicalTide = calculateTideDay(spot.lat, spot.lng, validLogDate);
                      let spotCastBearing: number | undefined;
                      if (spot.casting_start_deg != null && spot.casting_end_deg != null) {
                        const span = (spot.casting_end_deg - spot.casting_start_deg + 360) % 360;
                        spotCastBearing = (spot.casting_start_deg + span / 2) % 360;
                      }
                      const pm = generatePostMortemReport({
                        targetSpecies: log.fish_species || '우럭',
                        catchTime: log.catch_time || '16:00',
                        weather: {
                          temp: 18,
                          apparentTemp: 18,
                          windSpeed: log.wind_speed || 4.5,
                          windDirection: log.wind_direction || 180,
                          windGust: (log.wind_speed || 4.5) * 1.3,
                          weatherCode: 0,
                          weatherText: '맑음',
                          humidity: 60,
                          hourly: { time: [], temp: [], windSpeed: [], windDirection: [], pop: [] },
                        },
                        marine: {
                          seaSurfaceTemp: log.water_temp || 16.5,
                          waveHeight: 0.8,
                          wavePeriod: 6.0,
                          currentVelocity: log.current_velocity ?? 0.35,
                          waveDirection: 180,
                          currentDirection: log.current_direction ?? 135,
                          hourly: { time: [], seaSurfaceTemp: [], waveHeight: [], currentVelocity: [], currentDirection: [] },
                        },
                        tide: historicalTide,
                        biteScore: null,
                        castingBearingDeg: spotCastBearing,
                        lat: spot.lat,
                        lng: spot.lng,
                        spotType: spot.spot_type,
                        catchMethod: log.catch_method,
                        lureBait: log.lure_bait,
                        tackleSnapshot: log.tackle_snapshot,
                        mulTextOverride: log.catch_mul,
                      });
                      return (
                        <div className="mt-1.5 p-2.5 rounded-xl bg-[#0F172A] border border-amber-500/35 text-[11px] space-y-1.5 animate-in fade-in duration-150">
                          <div className="flex items-center justify-between text-amber-300 font-bold border-b border-slate-800 pb-1">
                            <span>💔 실패 원인 분석: {pm.topFactors[0]?.name} ({pm.topFactors[0]?.contributionPercent}%)</span>
                            <span className="text-[10px] text-slate-400 font-mono">정밀 환경·물리벡터</span>
                          </div>
                          <div className="text-[10.5px] text-slate-300 leading-snug">
                            {pm.topFactors[0]?.description}
                            {pm.topFactors[1] && (
                              <span className="block text-[10px] text-slate-400 mt-0.5">
                                2순위: {pm.topFactors[1].name} ({pm.topFactors[1].contributionPercent}% · {pm.topFactors[1].metricLabel})
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-amber-300 bg-[#1E293B] p-2 rounded-lg border border-slate-700/60 mt-0.5">
                            {pm.tacticalAdvice}
                          </div>
                        </div>
                      );
                    })()}

                    {log.photo_url && (
                      <div className="mt-2 h-32 rounded-xl overflow-hidden border border-slate-700/50">
                        <img src={log.photo_url} alt="Catch" className="w-full h-full object-cover" />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {activeTab === 'DIRECTIONS' && (
          <div className="space-y-[6px] text-sm">
            {/* 목적지 안내 & 도보 진입로/주차 팁 통합 박스 */}
            <div className="p-[10px] bg-[#1E293B] border border-slate-700/60 rounded-[16px] space-y-2">
              <span className="text-xs font-bold text-slate-100">
                목적지
              </span>
              <div className="text-xs space-y-2 pt-0.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="truncate">
                    <strong className="text-slate-400">네비 검색 지명:</strong>{' '}
                    <a
                      href={kakaoNaviUrl}
                      onClick={(e) => {
                        e.preventDefault();
                        openExternalUrl(kakaoNaviUrl);
                      }}
                      className="text-emerald-300 font-bold hover:text-emerald-200 underline decoration-emerald-500/50 hover:decoration-emerald-300 inline-flex items-center gap-1 transition"
                      title="카카오맵 길찾기 바로 연결"
                    >
                      <span>{destinationName}</span>
                      <ExternalLink size={12} className="text-emerald-400" />
                    </a>
                  </div>

                  {/* 목적지의 '카카오맵'과 '로드뷰'를 같은 줄에 표시 */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => openExternalUrl(kakaoNaviUrl)}
                      className="px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[11px] font-bold inline-flex items-center gap-1 transition cursor-pointer"
                    >
                      <span>카카오맵</span>
                      <ExternalLink size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={() => openExternalUrl(`https://map.kakao.com/link/roadview/${spot.lat},${spot.lng}`)}
                      className="px-2.5 py-1 rounded-lg bg-[#0F172A] hover:bg-slate-800 text-slate-200 border border-slate-700/60 text-[11px] font-bold inline-flex items-center gap-1 transition cursor-pointer"
                    >
                      <span>로드뷰</span>
                      <ExternalLink size={11} />
                    </button>
                    {spot.related_url && (
                      <button
                        type="button"
                        onClick={() => openExternalUrl(spot.related_url!)}
                        className="px-2.5 py-1 rounded-lg bg-[#0F172A] hover:bg-slate-800 text-emerald-300 border border-slate-700/60 text-[11px] font-bold inline-flex items-center gap-1 transition cursor-pointer"
                        title={spot.related_url}
                      >
                        <span>관련 URL</span>
                        <ExternalLink size={11} />
                      </button>
                    )}
                  </div>
                </div>

                {spot.navi_url && (
                  <div className="truncate">
                    <strong className="text-slate-400">현장 네비 URL:</strong>{' '}
                    <a
                      href={spot.navi_url}
                      onClick={(e) => {
                        e.preventDefault();
                        openExternalUrl(spot.navi_url!);
                      }}
                      className="text-emerald-300 underline"
                    >
                      {spot.navi_url}
                    </a>
                  </div>
                )}

                {/* 도보 진입로 및 팁 통합 */}
                <div className="pt-2 border-t border-slate-700/60 space-y-1">
                  <span className="text-[11px] font-bold text-slate-400">도보 진입로 & 주차 팁</span>
                  <p className="text-xs text-slate-200 leading-relaxed whitespace-pre-line">
                    {spot.directions || '등록된 진입로 정보가 없습니다.'}
                  </p>
                </div>
              </div>
            </div>

            {/* 캐스팅 공략 방향 안내 */}
            {spot.casting_directions && spot.casting_directions.length > 0 && (
              <div className="p-[10px] bg-[#1E293B] border border-slate-700/60 rounded-[16px] space-y-1 text-xs text-slate-300">
                <span className="text-[11px] font-bold text-slate-400">캐스팅 공략 방향</span>
                <p className="text-emerald-300 font-semibold">
                  {spot.casting_directions.includes('ALL') ? '전방위 (모든 방향 공략 가능)' : spot.casting_directions.join(', ')}
                </p>
              </div>
            )}

            {/* 연안 어종 정보 (기본 숨김 아코디언 Drawer 및 간소화) */}
            {(() => {
              const uniqueSpeciesList = Array.from(
                new Map(Object.values(SPECIES_ENCYCLOPEDIA).map((sp) => [sp.name, sp])).values()
              );

              return (
                <div className="p-[10px] bg-[#1E293B] border border-slate-700/60 rounded-[16px] space-y-2">
                  <button
                    type="button"
                    onClick={() => setIsEncyclopediaDrawerOpen(!isEncyclopediaDrawerOpen)}
                    className="w-full flex items-center justify-between cursor-pointer select-none"
                  >
                    <div className="flex items-center gap-1.5 font-bold text-xs text-slate-100">
                      <Fish size={15} className="text-emerald-400" />
                      <span>연안 어종 정보</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-[#0F172A] text-slate-300 border border-slate-700/60">
                        {uniqueSpeciesList.length}종
                      </span>
                    </div>
                    <ChevronDown
                      size={15}
                      className={`text-slate-400 transition-transform duration-200 ${
                        isEncyclopediaDrawerOpen ? 'rotate-180 text-emerald-400' : ''
                      }`}
                    />
                  </button>

                  {/* Drawer 펼침 시 표시 */}
                  {isEncyclopediaDrawerOpen && (
                    <div className="space-y-2 pt-1">
                      {/* 카테고리 필터 */}
                      <div className="flex gap-1 overflow-x-auto pb-0.5 text-[10.5px]">
                        {[
                          { id: 'ALL', label: '전체' },
                          { id: 'ROCKFISH', label: '락피시' },
                          { id: 'CEPHALOPOD', label: '두족류' },
                          { id: 'SEA_BREAM', label: '도미류' },
                          { id: 'PELAGIC', label: '회유성' },
                          { id: 'BENTHIC', label: '저서성' },
                        ].map((cat) => (
                          <button
                            type="button"
                            key={cat.id}
                            onClick={() => setEncyclopediaCategory(cat.id)}
                            className={`px-2 py-0.8 rounded-lg shrink-0 transition font-medium ${
                              encyclopediaCategory === cat.id
                                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 font-bold'
                                : 'bg-[#0F172A] text-slate-400 border border-slate-700/60 hover:text-slate-200'
                            }`}
                          >
                            {cat.label}
                          </button>
                        ))}
                      </div>

                      {/* 어종 리스트 뷰 */}
                      <div className="space-y-1.5 max-h-80 overflow-y-auto pr-0.5">
                        {uniqueSpeciesList
                          .filter((sp) => {
                            if (encyclopediaCategory !== 'ALL' && sp.category !== encyclopediaCategory) return false;
                            return true;
                          })
                          .map((sp) => {
                            const isExpanded = selectedEncyclopediaSpecies === sp.name;
                            const curMonth = new Date().getMonth() + 1;
                            const isTastiest = sp.tastiestMonths?.includes(curMonth);
                            const isPeak = sp.peakMonths?.includes(curMonth);

                            return (
                              <div
                                key={sp.name}
                                className={`rounded-xl border transition overflow-hidden ${
                                  isExpanded
                                    ? 'bg-[#0F172A] border-emerald-500/45'
                                    : 'bg-[#0F172A] border-slate-700/50 hover:border-slate-600'
                                }`}
                              >
                                {/* 어종 요약 헤더 (클릭 시 토글) */}
                                <button
                                  type="button"
                                  onClick={() => setSelectedEncyclopediaSpecies(isExpanded ? null : sp.name)}
                                  className="w-full p-2.5 flex items-center justify-between text-left transition cursor-pointer"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="font-bold text-xs text-white truncate">{sp.name}</span>
                                    <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-[#1E293B] text-slate-400 border border-slate-700/60 shrink-0">
                                      {sp.categoryName.split('(')[0]}
                                    </span>
                                    {isTastiest && (
                                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 font-bold shrink-0">
                                        제철
                                      </span>
                                    )}
                                    {isPeak && !isTastiest && (
                                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 font-bold shrink-0">
                                        시즌
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-2 shrink-0">
                                    <span className="text-[10px] font-mono text-emerald-300">
                                      {sp.tempRange.optMin}~{sp.tempRange.optMax}°C
                                    </span>
                                    <ChevronDown
                                      size={14}
                                      className={`text-slate-400 transition-transform ${isExpanded ? 'rotate-180 text-emerald-400' : ''}`}
                                    />
                                  </div>
                                </button>

                        {/* 클릭 시 펼쳐지는 어종 종합 정보 */}
                        {isExpanded && (
                          <div className="p-2.5 pt-1 border-t border-slate-800 space-y-2 text-[11px] bg-[#0F172A]">
                            {sp.scientificName && (
                              <div className="text-[10px] font-mono text-slate-500 italic">
                                학명: {sp.scientificName}
                              </div>
                            )}

                            <p className="text-slate-300 leading-relaxed text-xs">
                              {sp.description}
                            </p>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 bg-[#1E293B] p-2 rounded-lg border border-slate-700/60 text-[10.5px]">
                              <div>
                                <strong className="text-slate-400">· 서식 바닥:</strong> {sp.bottomName}
                              </div>
                              <div>
                                <strong className="text-slate-400">· 활동 특성:</strong> {sp.activityName}
                              </div>
                              {sp.waterLayerName && (
                                <div>
                                  <strong className="text-slate-400">· 공략 수층:</strong> {sp.waterLayerName}
                                </div>
                              )}
                              <div>
                                <strong className="text-slate-400">· 선호 조류:</strong> {sp.currentPrefName}
                              </div>
                              {sp.regionNames && (
                                <div className="sm:col-span-2">
                                  <strong className="text-slate-400">· 주요 서식지:</strong> {sp.regionNames}
                                </div>
                              )}
                              {sp.recommendedBait && (
                                <div className="sm:col-span-2 text-emerald-300">
                                  <strong className="text-slate-300">· 추천 채비/미끼:</strong> {sp.recommendedBait}
                                </div>
                              )}
                            </div>

                            {/* 금어기 및 포획 금지 규정 */}
                            {(sp.minLengthCm || sp.prohibitedPeriod || sp.prohibitedNote) && (
                              <div className="p-2 rounded-lg bg-[#1E293B] border border-amber-500/35 text-[10px] text-slate-300 space-y-0.5">
                                <div className="font-bold flex items-center gap-1 text-slate-200">
                                  <span>⚖️ 수산자원관리법 규정</span>
                                  {sp.minLengthCm && (
                                    <span className="text-amber-300 font-semibold">
                                      (금지체장: {sp.minLengthCm}cm 이하 방생)
                                    </span>
                                  )}
                                </div>
                                {sp.prohibitedPeriod && (
                                  <div>금어기: <strong>{sp.prohibitedPeriod}</strong></div>
                                )}
                                {sp.prohibitedNote && (
                                  <div className="text-slate-400">{sp.prohibitedNote}</div>
                                )}
                              </div>
                            )}

                            {/* 제철 및 맛 */}
                            {sp.tastiestDesc && (
                              <div className="text-[10px] text-slate-300 bg-[#1E293B] px-2 py-1 rounded border border-slate-700/60">
                                <strong>맛있는 제철:</strong> {sp.tastiestDesc} ({sp.tastiestMonths?.join(', ')}월)
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })()}

          {/* 유튜브 검색 링크 (포인트명 + 낚시 + 포인트 어종 + 관심어종 통합 검색) */}
          {(() => {
            const youtubeKeywords = Array.from(
              new Set(
                [spot.name, '낚시', ...(spot.target_species || []), ...(favoriteSpecies || [])]
                  .map((kw) => kw?.trim())
                  .filter((kw): kw is string => Boolean(kw))
              )
            ).join(' ');
            const youtubeSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(youtubeKeywords)}`;

            return (
              <div className="p-[10px] bg-[#1E293B] border border-slate-700/60 rounded-[16px] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-300 text-[10px] font-black">
                      ▶
                    </span>
                    <span>유튜브 검색 링크</span>
                  </span>
                </div>
                <a
                  href={youtubeSearchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2.5 rounded-xl bg-[#0F172A] hover:bg-slate-800 border border-slate-700/50 text-slate-200 transition flex items-center justify-between group"
                >
                  <div className="truncate pr-2 text-xs font-bold text-white group-hover:text-emerald-300">
                    📺 {youtubeKeywords}
                  </div>
                  <ExternalLink size={13} className="text-slate-400 group-hover:text-emerald-300 shrink-0" />
                </a>
              </div>
            );
          })()}

            {/* 기타 안내 및 체크리스트 & 모바일 APK 다운로드 링크 */}
            <div className="p-[10px] bg-[#1E293B] border border-slate-700/60 rounded-[16px] space-y-2">
              <span className="text-xs font-bold text-slate-100">
                기타
              </span>
              <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                <button
                  type="button"
                  onClick={() => setIsBiteScoreHelpOpen(true)}
                  className="p-2.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 text-xs font-bold transition flex items-center justify-center gap-1.5 active:scale-98 cursor-pointer"
                  title="입질 종합 지수(Bite Index) 평가 기준 설명 열람"
                >
                  <Info size={14} className="text-emerald-400 shrink-0" />
                  <span>입질지수 기준</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsChecklistOpen(true)}
                  className="p-2.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 text-xs font-bold transition flex items-center justify-center gap-1.5 active:scale-98 cursor-pointer"
                  title="출조 필수품 및 안전 점검 체크리스트 열기"
                >
                  <span>체크리스트</span>
                </button>
              </div>

              {/* 모바일 앱 다운로드 (exfish.apk) 링크 */}
              <div className="pt-2 border-t border-slate-700/60">
                <a
                  href="./exfish.apk"
                  download="exfish.apk"
                  className="w-full p-2.5 rounded-xl bg-[#0F172A] hover:bg-slate-800 border border-slate-700/50 text-slate-200 text-xs font-bold transition flex items-center justify-between group cursor-pointer"
                  title="APK 다운로드"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">📱</span>
                    <span className="text-white font-bold group-hover:text-emerald-300">APK 다운로드</span>
                  </div>
                  <Download size={16} className="text-slate-400 group-hover:text-emerald-300 group-hover:translate-y-0.5 transition shrink-0" />
                </a>
              </div>

              {/* 7.6 앱 버전 정보 */}
              <div className="pt-2 border-t border-slate-700/60 flex items-center justify-between text-[11px] text-slate-400 font-mono">
                <span>시스템 버전</span>
                <span className="text-emerald-300 font-bold">
                  v{APP_VERSION}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* 💬 커뮤니티 현장 메모 (Spot Memos / 실시간 팁 & 방명록) */}
        {activeTab === 'MEMOS' && (() => {
          const isUserLoggedIn = Boolean(currentUser && currentUser.name);
          const authorValue = isUserLoggedIn ? currentUser!.name : newMemoAuthor;

          return (
            <div className="space-y-[6px] text-xs">
              {/* 새 메모 작성 폼 */}
              <div className="p-[10px] bg-[#1E293B] border border-slate-700/60 rounded-[16px] space-y-2">
                <button
                  type="button"
                  onClick={() => setIsMemoDrawerOpen(!isMemoDrawerOpen)}
                  className="w-full flex items-center justify-between cursor-pointer select-none py-0.5"
                >
                  <span className="font-semibold text-slate-100 text-xs">메모 남기기</span>
                  <ChevronDown
                    size={15}
                    className={`text-slate-400 transition-transform duration-200 ${
                      isMemoDrawerOpen ? 'rotate-180 text-emerald-400' : ''
                    }`}
                  />
                </button>

                {isMemoDrawerOpen && (
                  <form onSubmit={handleAddSpotMemo} className="space-y-2 pt-1.5 border-t border-slate-700/60">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-400 block mb-0.5">작성자 닉네임</label>
                        <input
                          type="text"
                          required
                          value={authorValue}
                          onChange={(e) => {
                            if (!isUserLoggedIn) setNewMemoAuthor(e.target.value);
                          }}
                          readOnly={isUserLoggedIn}
                          placeholder="조사 닉네임"
                          className={`w-full border rounded-lg px-2.5 py-1.5 text-white font-medium focus:outline-none text-xs ${
                            isUserLoggedIn
                              ? 'bg-[#0F172A]/70 border-slate-700/50 text-slate-400 cursor-not-allowed'
                              : 'bg-[#0F172A] border-slate-700/60 focus:border-emerald-400'
                          }`}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 block mb-0.5">메모 유형</label>
                        <select
                          value={newMemoTag}
                          onChange={(e) => setNewMemoTag(e.target.value as SpotMemoTag)}
                          className="w-full bg-[#0F172A] border border-slate-700/60 rounded-lg px-2 py-1.5 text-white focus:outline-none focus:border-emerald-400 text-xs"
                        >
                          <option value="GENERAL">일반</option>
                          <option value="SAFETY">안전</option>
                          <option value="PARKING">이동</option>
                          <option value="CONDITION">상황</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <textarea
                        rows={5}
                        required
                        value={newMemoContent}
                        onChange={(e) => setNewMemoContent(e.target.value)}
                        placeholder="예: 간조 2시간 전부터 진입로가 드러납니다. 갯바위 젖은 곳 매우 미끄러우니 안전 유의하세요!"
                        className="w-full bg-[#0F172A] border border-slate-700/60 rounded-xl p-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400 text-xs leading-relaxed min-h-[110px]"
                      />
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={isSubmittingMemo || !newMemoContent.trim()}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:opacity-40 text-slate-950 font-bold transition cursor-pointer"
                      >
                        <Send size={12} />
                        <span>{isSubmittingMemo ? '등록 중...' : '등록'}</span>
                      </button>
                    </div>
                  </form>
                )}
              </div>

              {/* 태그 필터 칩 */}
              <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
                {[
                  { id: 'ALL', label: '전체' },
                  { id: 'SAFETY', label: '안전' },
                  { id: 'PARKING', label: '진입' },
                  { id: 'CONDITION', label: '상황' },
                  { id: 'GENERAL', label: '일반팁' },
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setMemoFilterTag(f.id)}
                    className={`px-2.5 py-1 rounded-xl text-[11px] font-medium shrink-0 transition cursor-pointer border ${
                      memoFilterTag === f.id
                        ? 'bg-emerald-500 text-slate-950 border-emerald-400 font-bold'
                        : 'bg-[#1E293B] text-slate-400 border-slate-700/60 hover:text-slate-200'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              {/* 메모 카드 리스트 */}
              {(() => {
                const filtered = spotMemos.filter((m) => memoFilterTag === 'ALL' || m.tag === memoFilterTag);

                if (filtered.length === 0) {
                  return (
                    <div className="p-[10px] py-8 text-center bg-[#1E293B] rounded-[16px] border border-slate-700/60 text-slate-400 space-y-1">
                      <MessageSquare size={28} className="mx-auto text-slate-600" />
                      <p className="text-xs">현장 팁을 남기세요</p>
                    </div>
                  );
                }

                return filtered.map((m) => {
                  const isSafety = m.tag === 'SAFETY';
                  const isParking = m.tag === 'PARKING';
                  const isCondition = m.tag === 'CONDITION';

                  const tagBadge = isSafety ? (
                    <span className="px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/40 text-[10px] font-bold">
                      안전
                    </span>
                  ) : isParking ? (
                    <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold">
                      진입
                    </span>
                  ) : isCondition ? (
                    <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold">
                      상황
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-md bg-[#0F172A] text-slate-300 border border-slate-700/60 text-[10px]">
                      일반
                    </span>
                  );

                  const dateStr = new Date(m.created_at).toLocaleDateString('ko-KR', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  });

                  return (
                    <div
                      key={m.id}
                      className={`p-[10px] rounded-[16px] bg-[#1E293B] space-y-1.5 border transition ${
                        isSafety
                          ? 'border-amber-500/40'
                          : 'border-slate-700/60'
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          {tagBadge}
                          <span className="font-bold text-slate-100 text-xs">{m.user_name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-500 font-mono">{dateStr}</span>
                          {(isAdmin || m.user_name === (currentUser?.name || '') || m.user_id === 'user-me' || (currentUser && m.user_id === currentUser.id)) && (
                            <button
                              onClick={() => {
                                if (window.confirm('이 필드 메모를 삭제하시겠습니까?')) {
                                  handleDeleteSpotMemo(m.id);
                                }
                              }}
                              className="p-1 rounded-lg text-slate-500 hover:text-amber-300 hover:bg-[#0F172A] transition"
                              title={isAdmin ? "메모 삭제 (관리자 권한)" : "메모 삭제"}
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-slate-300 text-xs leading-relaxed whitespace-pre-line pl-0.5">
                        {m.content}
                      </p>
                    </div>
                  );
                });
              })()}
            </div>
          );
        })()}
      </div>

      {/* 출조 필수품 & 안전 점검 체크리스트 모달 */}
      <ChecklistModal
        isOpen={isChecklistOpen}
        onClose={() => setIsChecklistOpen(false)}
        spotName={spot.name}
        mulText={tide?.mulText}
      />

      {/* 입질 종합 지수 평가 기준 설명 모달 */}
      <BiteScoreHelpModal
        isOpen={isBiteScoreHelpOpen}
        onClose={() => setIsBiteScoreHelpOpen(false)}
      />

      {/* [신규 고도화: 제안 4] 3초 초간결 미니 어종 카드 팝업 */}
      <SpeciesQuickModal
        speciesName={quickModalSpecies}
        onClose={() => setQuickModalSpecies(null)}
      />
    </div>
  );
};
