export type SpotType = 'ROCK' | 'SEAWALL' | 'BREAKWATER' | 'BEACH' | 'PIER';
export type FishingMethod = 'SURF' | 'LURE' | 'FLOAT';
export type WindUnit = 'ms' | 'knot' | 'kmh';
export type CurrentUnit = 'knot' | 'ms' | 'cms';

export interface SweetSpot {
  id: string;
  direction: number; // 0 ~ 359° (북쪽 0° 기준 시계방향)
  distance: number;  // 1 ~ 150m
  radius: number;    // 1 ~ 20m
  memo?: string;     // 메모 (예: "수중여 뒤편 포켓")
}

export interface FishingSpot {
  id: string;
  user_id: string;
  author_name: string;
  is_public: boolean;
  name: string;
  spot_type: SpotType;
  lat: number;
  lng: number;
  navi_name?: string; // 네비 검색명 / 주차장 지명 (예: 진두선착장 공영주차장)
  navi_url?: string; // 현장 네비 위치 URL (카카오/네이버지도 커스텀 링크)
  related_url?: string; // 포인트 관련 외부 웹/영상 URL (블로그, 유튜브 등)
  directions: string; // 찾아가는 길, 주차 위치, 도보 팁
  photo_urls: string[]; // 포인트 현장 사진 목록
  fishing_methods: FishingMethod[];
  target_species: string[];
  best_tides?: string[]; // 선호 물때 (예: 사리, 7~9물 등)
  best_times?: string[]; // 선호 시간대 (예: 새벽 해창, 해질녘 등)
  best_seasons?: number[]; // 선호 월 (예: 9, 10, 11)
  description?: string; // 채비 및 수심 팁
  casting_start_deg?: number; // 캐스팅 공략 유효 시작각 (0~359°, 북쪽 0° 기준 시계방향)
  casting_end_deg?: number; // 캐스팅 공략 유효 끝각 (0~359°)
  casting_directions?: string[]; // 캐스팅 공략 방향 (레거시 하위 호환)
  use_sweet_spot?: boolean; // 스위트 스팟 활성화 여부
  sweet_spots?: SweetSpot[]; // 스위트 스팟 목록 (최대 3개)
  created_at: string;
}

export interface CatchLog {
  id: string;
  spot_id: string;
  user_id: string;
  user_name: string;
  catch_date: string; // YYYY-MM-DD
  catch_time: string; // HH:mm (히트 시각)
  start_time?: string; // 낚시 시작 시각 (HH:mm)
  end_time?: string; // 낚시 종료 시각 (HH:mm)
  duration_minutes?: number; // 총 낚시 시간 (분 단위)
  fish_species: string; // 잡은 어종 또는 대상 어종
  fish_size_cm?: number;
  fish_count: number; // 0 = 꽝 (노피시/입질 무), >= 1 = 히트
  is_hitless?: boolean; // 꽝 여부 플래그
  catch_method: FishingMethod;
  lure_bait?: string;
  // 당시 환경 자동 스냅샷 (Environment Snapshot)
  catch_mul: string; // 당시 물때 (예: 8물)
  tide_state: string; // 당시 조석 상태 (예: 중들물 60%)
  water_temp: number; // 당시 수온 (°C)
  wind_speed: number; // 당시 풍속 (m/s)
  wind_direction?: number; // 당시 풍향 (0-360°)
  current_velocity?: number; // 당시 조류 유속 (m/s)
  current_direction?: number; // 당시 조류 방향 (0-360°)
  lat?: number; // 조과 히트 GPS 위도
  lng?: number; // 조과 히트 GPS 경도
  photo_url?: string; // 조과 인증 사진
  memo?: string;
  created_at: string;
}

export type SpotMemoTag = 'SAFETY' | 'PARKING' | 'CONDITION' | 'GENERAL';

export interface SpotMemo {
  id: string;
  spot_id: string;
  user_id: string;
  user_name: string;
  content: string; // 현장 메모 내용 (안전주의, 주차, 진입로, 조황 등)
  tag?: SpotMemoTag; // 메모 유형
  created_at: string;
}

export interface WeatherData {
  temp: number;
  apparentTemp: number; // 체감온도 (°C)
  humidity: number; // 상대습도 (%)
  weatherCode: number;
  weatherText: string;
  windSpeed: number; // m/s
  windDirection: number; // 0-360°
  windGust: number; // m/s
  isObserved?: boolean; // 국립해양조사원 실측 여부
  observedStationName?: string; // 관측소 명칭 (예: '영흥도')
  observedDistanceKm?: number; // 관측소 거리 (km)
  observedTime?: string; // 관측 시각 (예: '14:20')
  hourly: {
    time: string[];
    temp: number[];
    windSpeed: number[];
    windDirection: number[];
    windGust?: number[];
    pop: number[]; // 강수확률
    weatherCode?: number[];
  };
}

export interface MarineData {
  seaSurfaceTemp: number; // 수온 (°C)
  waveHeight: number; // 파고 (m)
  waveDirection: number; // 파향 (0-360°)
  wavePeriod: number; // 파주기 (s)
  currentVelocity: number; // 해류/조류 속도 (m/s)
  currentDirection: number; // 해류/조류 방향 (0-360°)
  isObservedTemp?: boolean; // 국립해양조사원 실측 수온 여부
  observedTempStationName?: string; // 수온 관측소 명칭
  isRomsCurrent?: boolean; // ROMS 수치예측모델 조류 여부
  hourly?: {
    time: string[];
    seaSurfaceTemp: number[];
    waveHeight: number[];
    currentVelocity: number[];
    currentDirection: number[];
  };
}

export interface TidePoint {
  timeStr: string; // HH:mm
  height: number; // cm
  type?: 'HIGH' | 'LOW';
}

export interface TideCurvePoint {
  hour: number;
  timeStr: string; // HH:mm or MM/DD HH:mm
  displayTime?: string; // HH:mm
  dateStr?: string; // MM/DD
  dayLabel?: string; // 오늘, 내일, 모레, 어제
  height: number;
  stateText: string;
  isSunrise?: boolean;
  isSunset?: boolean;
  isHighTide?: boolean;
  isLowTide?: boolean;
  isCurrent?: boolean;
  tideDiff?: number; // 조차 (cm)
  eventLabel?: string; // e.g. "만조 720cm (+580)", "간조 140cm", "일출", "일몰"
  isFeedingTime?: boolean; // 황금 피딩 타임 여부
  feedingReason?: string;
  feedingLabel?: string;
}

export interface TideDaySummary {
  dateStr: string; // MM/DD (요일)
  dayLabel: string; // 오늘, 내일, 모레
  mulText: string;
  sunrise: string;
  sunset: string;
  highTides: { time: string; height: number }[];
  lowTides: { time: string; height: number }[];
}

export interface TideDayInfo {
  lunarDateStr: string; // 음력 날짜
  mulText: string; // 물때 (예: 8물)
  mulNumber: number; // 1 ~ 15
  highTides: { time: string; height: number }[];
  lowTides: { time: string; height: number }[];
  hourlyCurve: TideCurvePoint[];
  hourly72Curve: TideCurvePoint[]; // 오늘 0시 기준 72시간 연속 조위 곡선
  curve36?: TideCurvePoint[]; // 현재 시각 -6시간 ~ 향후 +36시간 실시간 조위 곡선 (총 42시간)
  threeDays: TideDaySummary[]; // 오늘, 내일, 모레 3일간 요약
  sunrise: string; // HH:mm
  sunset: string; // HH:mm
  dawn: string; // HH:mm
  dusk: string; // HH:mm
  feedingTimes?: {
    label: string;
    timeRange: string;
    reason: string;
    startHour: number;
    endHour: number;
    startTimeStr: string;
    endTimeStr: string;
    startDisplayTime?: string;
    endDisplayTime?: string;
    startTimestamp?: number;
    endTimestamp?: number;
  }[];
}

export interface SpeciesBiteScore {
  speciesName: string;
  score: number;
  verdict: string;
  activityMatch: string; // 야행성/주행성 적합도
  tempMatch: string; // 수온 적합도
  effectiveTemp?: number; // 저층 보정 또는 유효 수온
  isBottomCorrected?: boolean; // 저층 수온 보정 여부
}

export interface BiteScoreBreakdown {
  totalScore: number; // 0 - 100
  mulScore: number;
  windScore: number;
  tempScore: number;
  timeScore: number;
  windRelation: '등바람 (최적)' | '옆바람 (주의)' | '맞바람/너울 (위험)';
  verdict: string;
  topSpecies?: SpeciesBiteScore; // 현재 여건 1위 추천 어종
  speciesScores?: SpeciesBiteScore[]; // 관심 대상어별 세부 점수
  targetSummaryLabel?: string; // 예: "내 관심어종 [우럭, 풀치] 맞춤"
  waveSweepWarning?: string | null; // 파고 채비 쓸림 진단
}
