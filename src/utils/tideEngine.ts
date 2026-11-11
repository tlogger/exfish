import * as SunCalc from 'suncalc';
import type { TideCurvePoint, TideDayInfo, TideDaySummary } from '../types';
import type { KhoaSwtcWeeklyResult } from './khoaSwtcApi';

// 한국 연안 주요 표준항 좌표 및 대략적 조차(Harmonic Constant M2, S2 근사치)
export interface HarborRef {
  name: string;
  lat: number;
  lng: number;
  meanRange: number; // 평균 조차 cm (서해: ~800, 남해: ~300, 동해: ~30)
  highLagHours: number; // 음력 합삭 기준 평균 만조 지각(시간)
  region: 'WEST' | 'SOUTH' | 'EAST' | 'JEJU';
}

export const KOREA_HARBORS: HarborRef[] = [
  // 서해안 (7물제 적용: 음력 16일 = 7물 사리, 음력 8일 조금, 음력 9일 무시)
  // highLagHours: 국립해양조사원(KHOA) 공인 합삭(New Moon, 음력 1일) 기준 평균고조간격(HWI, 시간)
  { name: '인천송도', lat: 37.338, lng: 126.586, meanRange: 750, highLagHours: 4.40, region: 'WEST' },
  { name: '인천', lat: 37.452, lng: 126.592, meanRange: 750, highLagHours: 4.48, region: 'WEST' },
  { name: '안산', lat: 37.192, lng: 126.647, meanRange: 720, highLagHours: 4.35, region: 'WEST' },
  { name: '평택', lat: 36.993, lng: 126.834, meanRange: 820, highLagHours: 4.80, region: 'WEST' },
  { name: '안흥(태안)', lat: 36.678, lng: 126.132, meanRange: 600, highLagHours: 3.25, region: 'WEST' },
  { name: '보령(대천)', lat: 36.327, lng: 126.512, meanRange: 580, highLagHours: 3.10, region: 'WEST' },
  { name: '군산', lat: 35.976, lng: 126.554, meanRange: 550, highLagHours: 3.15, region: 'WEST' },
  { name: '목포', lat: 34.779, lng: 126.376, meanRange: 420, highLagHours: 1.80, region: 'WEST' },
  
  // 남해안 (8물제 적용: 음력 16일 = 8물 사리, 음력 7일 조금, 음력 8일 무시)
  { name: '완도', lat: 34.316, lng: 126.757, meanRange: 320, highLagHours: 9.80, region: 'SOUTH' },
  { name: '여수', lat: 34.747, lng: 127.768, meanRange: 280, highLagHours: 8.75, region: 'SOUTH' },
  { name: '통영', lat: 34.829, lng: 128.423, meanRange: 220, highLagHours: 8.50, region: 'SOUTH' },
  { name: '부산', lat: 35.096, lng: 129.038, meanRange: 130, highLagHours: 8.00, region: 'SOUTH' },
  
  // 동해안 (8물제 적용)
  { name: '울산', lat: 35.503, lng: 129.382, meanRange: 50, highLagHours: 6.50, region: 'EAST' },
  { name: '포항', lat: 36.048, lng: 129.383, meanRange: 25, highLagHours: 4.80, region: 'EAST' },
  { name: '속초', lat: 38.204, lng: 128.601, meanRange: 20, highLagHours: 3.50, region: 'EAST' },
  { name: '강릉(안인진)', lat: 37.736, lng: 128.986, meanRange: 20, highLagHours: 1.80, region: 'EAST' },
  { name: '동해(묵호)', lat: 37.551, lng: 129.117, meanRange: 20, highLagHours: 1.80, region: 'EAST' },
  
  // 제주도 (8물제 적용)
  { name: '제주', lat: 33.528, lng: 126.543, meanRange: 230, highLagHours: 10.40, region: 'JEJU' },
  { name: '서귀포', lat: 33.241, lng: 126.564, meanRange: 220, highLagHours: 9.80, region: 'JEJU' },
];

/**
 * 한국 연안 천문 역법 기반 고조(만조) 시각 계산 (사리-조금 조위 지각 속도 비선형 변조 반영)
 * 합삭(New Moon, 음력 1일) 시각 기준 고조간격(HWI)에서 출발하여
 * 사리(대조기) 부근의 완만한 지각(~0.55시간/일)과 조금(소조기) 부근의 급격한 지각(~1.05시간/일)을 비선형 적분 반영
 */
export function getAstronomicalHighHour(hwi: number, lunarDay: number): number {
  const cycleDay = (lunarDay - 1) % 15;
  let totalAdvance = 0;
  for (let d = 0; d < cycleDay; d++) {
    const springCloseness = Math.cos((d / 14) * 2 * Math.PI);
    const rate = 0.8127 - 0.26 * springCloseness;
    totalAdvance += rate;
  }
  return (hwi + totalAdvance) % 12.42;
}

/** 하버사인 거리(km) 계산 */
export function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** 위경도에서 가장 가까운 표준항 찾기 */
export function findNearestHarbor(lat: number, lng: number): HarborRef {
  let nearest = KOREA_HARBORS[0];
  let minDistance = Infinity;

  for (const harbor of KOREA_HARBORS) {
    const dist = getDistanceKm(lat, lng, harbor.lat, harbor.lng);
    if (dist < minDistance) {
      minDistance = dist;
      nearest = harbor;
    }
  }
  return nearest;
}

/**
 * 한국천문연구원(KASI) 공식 음력 합삭(New Moon, 초하루 1일) 기준일 테이블 (2024~2030)
 * 달과 태양의 시황경이 일치하는 합삭 시각이 포함된 KST 당일(00:00~24:00)을 음력 1일로 규정
 */
export const KOREAN_NEW_MOON_DATES = [
  "2024-01-11","2024-02-10","2024-03-10","2024-04-09","2024-05-08","2024-06-06","2024-07-06","2024-08-04","2024-09-03","2024-10-03","2024-11-01","2024-12-01","2024-12-31",
  "2025-01-29","2025-02-28","2025-03-29","2025-04-28","2025-05-27","2025-06-25","2025-07-25","2025-08-23","2025-09-22","2025-10-21","2025-11-20","2025-12-20",
  "2026-01-19","2026-02-17","2026-03-19","2026-04-17","2026-05-17","2026-06-15","2026-07-14","2026-08-13","2026-09-11","2026-10-11","2026-11-09","2026-12-09",
  "2027-01-08","2027-02-07","2027-03-08","2027-04-07","2027-05-06","2027-06-05","2027-07-04","2027-08-02","2027-09-01","2027-09-30","2027-10-29","2027-11-28","2027-12-28",
  "2028-01-27","2028-02-25","2028-03-26","2028-04-25","2028-05-24","2028-06-23","2028-07-22","2028-08-20","2028-09-19","2028-10-18","2028-11-16","2028-12-16",
  "2029-01-15","2029-02-13","2029-03-15","2029-04-14","2029-05-13","2029-06-12","2029-07-12","2029-08-10","2029-09-08","2029-10-08","2029-11-06","2029-12-05",
  "2030-01-04","2030-02-03","2030-03-04","2030-04-03","2030-05-02","2030-06-01","2030-07-01","2030-07-30","2030-08-29","2030-09-27","2030-10-27","2030-11-25","2030-12-25"
];

/** 한국 표준시(KST) 기준 YYYY-MM-DD 문자열 취득 */
export function getKstDateString(date: Date): string {
  const kstTime = date.getTime() + 9 * 3600000;
  const kst = new Date(kstTime);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 양력 일자에 대한 한국 천문 역법 기준 음력 일수 (1일 ~ 30일) 계산 */
export function getKoreanLunarDay(date: Date): number {
  const dateStr = getKstDateString(date);

  // 1. KASI 공식 합삭일 테이블 탐색 (작은달 29일 / 큰달 30일 완벽 대응)
  let latestNewMoon: string | null = null;
  for (let i = KOREAN_NEW_MOON_DATES.length - 1; i >= 0; i--) {
    if (KOREAN_NEW_MOON_DATES[i] <= dateStr) {
      latestNewMoon = KOREAN_NEW_MOON_DATES[i];
      break;
    }
  }

  if (latestNewMoon) {
    const tTime = new Date(`${dateStr}T00:00:00Z`).getTime();
    const nmTime = new Date(`${latestNewMoon}T00:00:00Z`).getTime();
    const diffDays = Math.round((tTime - nmTime) / 86400000);
    return Math.max(1, Math.min(30, diffDays + 1));
  }

  // 2. 테이블 범위를 벗어난 날짜: 정밀 삭망월 주기(29.530588853일) 기반 동적 근사
  const synodicMonth = 29.530588853;
  const baseTime = new Date('2026-11-09T16:02:00+09:00').getTime();
  const diffDays = (date.getTime() - baseTime) / 86400000;
  const cycleDays = ((diffDays % synodicMonth) + synodicMonth) % synodicMonth;
  return Math.max(1, Math.min(30, Math.floor(cycleDays) + 1));
}

/** 양력 기준 달의 일령(Moon Age) 및 음력 일수 계산 (한국 표준시 정밀 천문 역법 기준) */
export function getMoonAge(date: Date): number {
  const lunarDay = getKoreanLunarDay(date);
  // 당일 KST 기준 시간 비율 (0.0 ~ 0.999) 반영하여 연속 시계열 생성
  const kstTime = date.getTime() + 9 * 3600000;
  const kst = new Date(kstTime);
  const fractionOfDay = (kst.getUTCHours() * 3600 + kst.getUTCMinutes() * 60 + kst.getUTCSeconds()) / 86400;
  return (lunarDay - 1) + fractionOfDay;
}

/**
 * KHOA 모바일 스마트조석예보 공식 mool7(서해 7물제), mool8(남해 8물제) 텍스트를 파싱
 */
export function parseKhoaSwtcMul(
  moolStr: string | undefined | null,
  region: 'WEST' | 'SOUTH' | 'EAST' | 'JEJU' = 'WEST'
): { mulNumber: number; mulText: string } | null {
  if (!moolStr || typeof moolStr !== 'string') return null;

  const trimmed = moolStr.trim();
  const isWest = region === 'WEST';

  // 서해 7물제 고유 명칭 매핑
  const westMap: Record<string, { num: number; text: string }> = {
    '한매': { num: 1, text: '1물' },
    '두매': { num: 2, text: '2물' },
    '세매': { num: 3, text: '3물' },
    '네매': { num: 4, text: '4물' },
    '다섯매': { num: 5, text: '5물' },
    '여섯매': { num: 6, text: '6물' },
    '일곱매': { num: 7, text: '7물 (사리)' },
    '여덟매': { num: 8, text: '8물' },
    '아홉매': { num: 9, text: '9물' },
    '열매': { num: 10, text: '10물' },
    '한꺽기': { num: 11, text: '11물' },
    '두꺽기': { num: 12, text: '12물' },
    '아조': { num: 13, text: '13물' },
    '조금': { num: 14, text: '14물 (조금)' },
    '무시': { num: 15, text: '15물 (무시)' },
  };

  // 남해/동해/제주 8물제 고유 명칭 매핑
  const southMap: Record<string, { num: number; text: string }> = {
    '한물': { num: 1, text: '1물' },
    '두물': { num: 2, text: '2물' },
    '세물': { num: 3, text: '3물' },
    '네물': { num: 4, text: '4물' },
    '다섯물': { num: 5, text: '5물' },
    '여섯물': { num: 6, text: '6물' },
    '일곱물': { num: 7, text: '7물' },
    '여덟물': { num: 8, text: '8물 (사리)' },
    '아홉물': { num: 9, text: '9물' },
    '열물': { num: 10, text: '10물' },
    '열한물': { num: 11, text: '11물' },
    '열두물': { num: 12, text: '12물' },
    '열셋물': { num: 13, text: '13물' },
    '열넷물': { num: 14, text: '14물 (조금)' },
    '조금': { num: 14, text: '14물 (조금)' },
    '무시': { num: 15, text: '15물 (무시)' },
  };

  const map = isWest ? westMap : southMap;
  for (const [key, val] of Object.entries(map)) {
    if (trimmed.includes(key)) {
      return { mulNumber: val.num, mulText: val.text };
    }
  }

  // "8물", "8" 등 정규 표현식 매칭
  const numMatch = trimmed.match(/(\d+)물?/);
  if (numMatch) {
    const n = parseInt(numMatch[1], 10);
    if (n >= 1 && n <= 15) {
      let t = `${n}물`;
      if (n === 14) t = '14물 (조금)';
      else if (n === 15) t = '15물 (무시)';
      else if (isWest && n === 7) t += ' (사리)';
      else if (!isWest && n === 8) t += ' (사리)';
      return { mulNumber: n, mulText: t };
    }
  }

  return null;
}

/**
 * 한국 해역별 물때 명칭 및 번호 계산
 * - 서해 (WEST): 7물제 (음력 8일 조금, 9일 무시, 10일 1물, 16일 7물 사리, 17일 8물) -> (lunarDay + 6) % 15
 * - 남해/동해/제주 (SOUTH, EAST, JEJU): 8물제 (음력 7일 조금, 8일 무시, 9일 1물, 16일 8물 사리, 17일 9물) -> (lunarDay + 7) % 15
 */
export function getMulInfo(
  moonAge: number,
  region: 'WEST' | 'SOUTH' | 'EAST' | 'JEJU' = 'WEST'
): { mulNumber: number; mulText: string; lunarDay: number } {
  const lunarDay = Math.floor(moonAge) + 1; // 음력 1일 ~ 30일
  
  const isWest = region === 'WEST';
  // 서해: 7물제 ((lunarDay + 6) % 15), 남해/동해/제주: 8물제 ((lunarDay + 7) % 15)
  let mulNum = (lunarDay + (isWest ? 6 : 7)) % 15;
  if (mulNum === 0) mulNum = 15;

  let mulText = `${mulNum}물`;
  if (mulNum === 14) mulText = '14물 (조금)';
  else if (mulNum === 15) mulText = '15물 (무시)';
  else if (isWest && mulNum === 7) mulText += ' (사리)';
  else if (!isWest && mulNum === 8) mulText += ' (사리)';

  return { mulNumber: mulNum, mulText, lunarDay };
}

/** 2자리 숫자 포맷 */
function padZero(num: number): string {
  return num < 10 ? `0${num}` : `${num}`;
}

/** 특정 날짜, 포인트 좌표에 대한 물때, 일출일몰 및 단일 연속 마스터 조석 시계열 엔진 (-6h ~ +72h 통합) */
export function calculateTideDay(
  lat: number,
  lng: number,
  baseDate: Date = new Date(),
  khoaOverride?: {
    events?: { type: 'HIGH' | 'LOW'; time: string; height: number; diff?: number }[];
    hourlyCurve?: { hour: number; time: string; height: number }[];
    swtcWeekly?: KhoaSwtcWeeklyResult | null;
  }
): TideDayInfo {
  const harbor = findNearestHarbor(lat, lng);
  const tideCycle = 12.42;

  const formatTime = (d: Date | null | undefined) =>
    !d || isNaN(d.getTime()) ? '--:--' : `${padZero(d.getHours())}:${padZero(d.getMinutes())}`;

  // 오늘 00:00:00 기준 시점
  const startOfDay = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 0, 0, 0);
  const baseTimestamp = baseDate.getTime();
  const currentHourOffset = Math.round((baseTimestamp - startOfDay.getTime()) / (3600 * 1000));

  const dayLabels = ['오늘', '내일', '모레'];
  const todayMoonAge = getMoonAge(baseDate);
  const fallbackMul = getMulInfo(todayMoonAge, harbor.region);
  const todayTimes = SunCalc.getTimes(new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 12, 0, 0), lat, lng);

  const useSwtc = Boolean(khoaOverride?.swtcWeekly && khoaOverride.swtcWeekly.allExtremums && khoaOverride.swtcWeekly.allExtremums.length >= 2);
  const swtc = khoaOverride?.swtcWeekly;

  // 당일 공식 물때 결정 (KHOA SWTC 우선 채택 -> 실패 시 한국천문연구원 정밀 역법 fallbackMul)
  let todayMul = fallbackMul;
  let todayLunarDateStr = `음력 ${fallbackMul.lunarDay}일`;

  if (useSwtc && swtc?.days && swtc.days[0]) {
    const swToday = swtc.days[0];
    const parsedOfficial = parseKhoaSwtcMul(harbor.region === 'WEST' ? swToday.mool7 : swToday.mool8, harbor.region);
    if (parsedOfficial) {
      todayMul = {
        mulNumber: parsedOfficial.mulNumber,
        mulText: parsedOfficial.mulText,
        lunarDay: fallbackMul.lunarDay,
      };
    }
    if (swToday.dateMoon) {
      todayLunarDateStr = `음력 ${swToday.dateMoon}`;
    }
  }

  // KHOA 모바일 공식 극점 관통 Hermite Cosine Spline 보간 함수
  const interpolateSwtc = (totalMinutes: number) => {
    const list = swtc!.allExtremums;
    let prevExt: (typeof list)[0] | null = null;
    let nextExt: (typeof list)[0] | null = null;

    for (let i = 0; i < list.length; i++) {
      if (list[i].totalMinutesFromStart <= totalMinutes) {
        prevExt = list[i];
      } else {
        nextExt = list[i];
        break;
      }
    }

    if (!prevExt && nextExt) {
      const secondNext = list[1] || nextExt;
      const dt = Math.max(300, secondNext.totalMinutesFromStart - nextExt.totalMinutesFromStart);
      prevExt = {
        ...nextExt,
        totalMinutesFromStart: nextExt.totalMinutesFromStart - dt,
        height: secondNext.height,
        type: nextExt.type === 'HIGH' ? 'LOW' : 'HIGH',
      };
    } else if (prevExt && !nextExt) {
      const secondPrev = list[list.length - 2] || prevExt;
      const dt = Math.max(300, prevExt.totalMinutesFromStart - secondPrev.totalMinutesFromStart);
      nextExt = {
        ...prevExt,
        totalMinutesFromStart: prevExt.totalMinutesFromStart + dt,
        height: secondPrev.height,
        type: prevExt.type === 'HIGH' ? 'LOW' : 'HIGH',
      };
    }

    if (!prevExt || !nextExt) return { height: 100, slope: 0 };
    const dt = nextExt.totalMinutesFromStart - prevExt.totalMinutesFromStart;
    if (dt <= 0) return { height: prevExt.height, slope: 0 };

    const ratio = (totalMinutes - prevExt.totalMinutesFromStart) / dt;
    const phase = ratio * Math.PI;
    const height = Math.round(
      (prevExt.height + nextExt.height) / 2 +
      ((prevExt.height - nextExt.height) / 2) * Math.cos(phase)
    );
    const slope = -((prevExt.height - nextExt.height) / 2) * Math.sin(phase);
    return { height, slope };
  };

  // KHOA 공식 발표치(관측소) 위상 보정계수 산출 (폴백용)
  let phaseShiftHours = 0;
  if (!useSwtc && khoaOverride?.events && khoaOverride.events.length >= 2) {
    const firstKhoaHigh = khoaOverride.events.find((e) => e.type === 'HIGH');
    if (firstKhoaHigh) {
      const [kh, km] = firstKhoaHigh.time.split(':').map(Number);
      const khoaHighHour = kh + km / 60;
      const modelHighHour = (harbor.highLagHours + todayMoonAge * 0.83) % tideCycle;
      let diffH = khoaHighHour - modelHighHour;
      while (diffH > tideCycle / 2) diffH -= tideCycle;
      while (diffH < -tideCycle / 2) diffH += tideCycle;
      phaseShiftHours = diffH;
    }
  }

  // =========================================================================
  // 1. 과거 -6시간부터 미래 +72시간까지 단일 연속 마스터 시계열 생성 (총 79개 포인트)
  // =========================================================================
  const masterSeries: TideCurvePoint[] = [];

  for (let totalHour = -6; totalHour <= 72; totalHour++) {
    const pointDate = new Date(startOfDay.getTime() + totalHour * 3600 * 1000);
    const dayDiff = Math.floor(totalHour / 24);
    const dayLabel = dayDiff === 0 ? '오늘' : dayDiff === 1 ? '내일' : dayDiff === -1 ? '어제' : '모레';
    const hourInDay = ((totalHour % 24) + 24) % 24;

    let height = 0;
    let stateText = '물돌이(정조)';

    if (useSwtc) {
      const { height: sHgt, slope: sSlope } = interpolateSwtc(totalHour * 60);
      height = sHgt;
      if (Math.abs(sSlope) < 30) stateText = '물돌이(정조)';
      else if (sSlope > 30) stateText = '들물';
      else stateText = '날물';
    } else {
      const dayStart = new Date(startOfDay.getTime() + dayDiff * 24 * 3600 * 1000);
      const dayLunarDay = getKoreanLunarDay(dayStart);
      const { mulNumber: pMulNumber } = getMulInfo(dayLunarDay - 1, harbor.region);

      // 일자별 앵커링된 고조 시각 산출 (시간별 누적 위상 왜곡 및 1시간 지연 원천 제거)
      const dayFirstHighHour = (getAstronomicalHighHour(harbor.highLagHours, dayLunarDay) + phaseShiftHours) % tideCycle;
      const springFactor = 0.4 + 0.6 * (Math.sin(((pMulNumber - 1) / 15) * Math.PI) ** 2);
      const amplitude = (harbor.meanRange * springFactor) / 2;
      const meanSeaLevel = harbor.meanRange <= 50 ? 16 : harbor.meanRange * 0.6;

      const t = hourInDay;
      const phase = ((t - dayFirstHighHour) * 2 * Math.PI) / tideCycle;
      const diurnalFactor = 0.15 * Math.sin(((dayLunarDay - 3) / 14.76) * Math.PI);
      const diurnalDiff = Math.round(amplitude * diurnalFactor);
      const phaseDiurnal = ((t - dayFirstHighHour) * Math.PI) / 12;

      height = Math.max(2, Math.round(meanSeaLevel + amplitude * Math.cos(phase) + diurnalDiff * Math.cos(phaseDiurnal)));

      // 당일(0~23시) KHOA 실제 관측/예보 시계열이 오버라이드로 제공된 경우 실측치 반영
      if (dayDiff === 0 && khoaOverride?.hourlyCurve && khoaOverride.hourlyCurve.length >= 24) {
        const kPt = khoaOverride.hourlyCurve.find((k) => k.hour === hourInDay);
        if (kPt && kPt.height != null) {
          height = kPt.height;
        }
      }

      const slope = -Math.sin(phase);
      if (slope > 0.3) stateText = '들물';
      else if (slope < -0.3) stateText = '날물';
    }

    const pTimes = SunCalc.getTimes(new Date(pointDate.getFullYear(), pointDate.getMonth(), pointDate.getDate(), 12, 0, 0), lat, lng);
    const isSunrise = pTimes.sunrise ? Math.abs(pointDate.getTime() - pTimes.sunrise.getTime()) <= 35 * 60000 : false;
    const isSunset = pTimes.sunset ? Math.abs(pointDate.getTime() - pTimes.sunset.getTime()) <= 35 * 60000 : false;

    const isCurrent = totalHour === currentHourOffset;
    const displayTime = `${dayLabel !== '오늘' ? `${dayLabel} ` : ''}${padZero(hourInDay)}:00`;

    masterSeries.push({
      hour: totalHour,
      timeStr: `${padZero(hourInDay)}:00`,
      displayTime,
      dateStr: `${padZero(pointDate.getMonth() + 1)}/${padZero(pointDate.getDate())}`,
      dayLabel,
      height,
      stateText,
      isCurrent,
      isSunrise,
      isSunset,
    });
  }

  // =========================================================================
  // 2. 단일 마스터 시계열 곡선 상의 극대(만조)/극소(간조) 목록 확정
  // =========================================================================
  let allExtremums: {
    type: 'HIGH' | 'LOW';
    time: string;
    height: number;
    exactMinutes: number;
    dayDiff: number;
  }[] = [];

  if (useSwtc && swtc?.allExtremums) {
    // KHOA 공식 모바일 극점을 100% 그대로 극치로 채택 (0분, 0cm 오차 없음)
    allExtremums = swtc.allExtremums.map((e) => ({
      type: e.type,
      time: e.time,
      height: e.height,
      exactMinutes: e.totalMinutesFromStart,
      dayDiff: e.dayIdx,
    }));

    // 마스터 시계열 정시 포인트 중 가장 가까운 포인트에 플래그 설정
    allExtremums.forEach((ext) => {
      const nearHour = Math.round(ext.exactMinutes / 60);
      const pt = masterSeries.find((p) => p.hour === nearHour);
      if (pt) {
        if (ext.type === 'HIGH') pt.isHighTide = true;
        if (ext.type === 'LOW') pt.isLowTide = true;
      }
    });
  } else {
    // 수치적 극치 탐색 (폴백용)
    for (let i = 1; i < masterSeries.length - 1; i++) {
      const prev = masterSeries[i - 1];
      const curr = masterSeries[i];
      const next = masterSeries[i + 1];

      const isPeakHigh = curr.height >= prev.height && curr.height >= next.height && (curr.height > prev.height || curr.height > next.height);
      const isPeakLow = curr.height <= prev.height && curr.height <= next.height && (curr.height < prev.height || curr.height < next.height);

      if (isPeakHigh || isPeakLow) {
        const denom = prev.height - 2 * curr.height + next.height;
        const xPeak = denom !== 0 ? (prev.height - next.height) / (2 * denom) : 0;
        const boundedX = Math.max(-0.5, Math.min(0.5, xPeak));

        const peakExactHours = curr.hour + boundedX;
        const peakMinutesTotal = Math.round(peakExactHours * 60);
        const dayDiff = Math.floor(peakMinutesTotal / 1440);
        const minInDay = ((peakMinutesTotal % 1440) + 1440) % 1440;
        const hh = Math.floor(minInDay / 60);
        const mm = minInDay % 60;

        const interpolatedHeight = Math.round(curr.height - (denom * boundedX * boundedX) / 2);

        allExtremums.push({
          type: isPeakHigh ? 'HIGH' : 'LOW',
          time: `${padZero(hh)}:${padZero(mm)}`,
          height: Math.max(2, interpolatedHeight),
          exactMinutes: peakMinutesTotal,
          dayDiff,
        });

        if (isPeakHigh) curr.isHighTide = true;
        if (isPeakLow) curr.isLowTide = true;
      }
    }
  }

  // 조위차(tideDiff) 계산 (인접 반대 극점과의 높이 차이)
  for (let i = 0; i < masterSeries.length; i++) {
    const pt = masterSeries[i];
    let prevExt: (typeof allExtremums)[0] | null = null;
    for (let e = allExtremums.length - 1; e >= 0; e--) {
      if (allExtremums[e].exactMinutes <= pt.hour * 60) {
        prevExt = allExtremums[e];
        break;
      }
    }
    if (prevExt) {
      pt.tideDiff = pt.height - prevExt.height;
    }
  }

  // 3일간 요약 데이터 (threeDays) 구축 (공식 데이터 100% 매핑)
  const threeDays: TideDaySummary[] = [];

  for (let d = 0; d < 3; d++) {
    const curDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + d, 12, 0, 0);
    const moonAge = getMoonAge(curDate);
    const fallbackMul = getMulInfo(moonAge, harbor.region);
    const times = SunCalc.getTimes(curDate, lat, lng);
    const dayName = `${padZero(curDate.getMonth() + 1)}/${padZero(curDate.getDate())} (${['일', '월', '화', '수', '목', '금', '토'][curDate.getDay()]})`;

    if (useSwtc && swtc?.days && swtc.days[d]) {
      const swDay = swtc.days[d];
      const parsedDayMul = parseKhoaSwtcMul(harbor.region === 'WEST' ? swDay.mool7 : swDay.mool8, harbor.region);
      const dayMulText = parsedDayMul?.mulText || fallbackMul.mulText;

      const dayHighs = swDay.events
        .filter((e) => e.type === 'HIGH')
        .map((e) => ({ time: e.time, height: e.height, diff: e.diff }));
      const dayLows = swDay.events
        .filter((e) => e.type === 'LOW')
        .map((e) => ({ time: e.time, height: e.height, diff: e.diff }));

      threeDays.push({
        dateStr: dayName,
        dayLabel: dayLabels[d],
        mulText: dayMulText,
        sunrise: swDay.sunrise || formatTime(times.sunrise),
        sunset: swDay.sunset || formatTime(times.sunset),
        highTides: dayHighs,
        lowTides: dayLows,
      });
    } else {
      let dayHighs = allExtremums
        .filter((e) => e.dayDiff === d && e.type === 'HIGH')
        .map((e) => ({ time: e.time, height: e.height }));
      let dayLows = allExtremums
        .filter((e) => e.dayDiff === d && e.type === 'LOW')
        .map((e) => ({ time: e.time, height: e.height }));

      // 오늘(d === 0) KHOA 공식 극점이 제공된 경우 최우선 적용
      if (d === 0 && khoaOverride?.events && khoaOverride.events.length >= 2) {
        dayHighs = khoaOverride.events
          .filter((e) => e.type === 'HIGH')
          .map((e) => ({ time: e.time, height: e.height, diff: e.diff }));
        dayLows = khoaOverride.events
          .filter((e) => e.type === 'LOW')
          .map((e) => ({ time: e.time, height: e.height, diff: e.diff }));
      }

      threeDays.push({
        dateStr: dayName,
        dayLabel: dayLabels[d],
        mulText: fallbackMul.mulText,
        sunrise: formatTime(times.sunrise),
        sunset: formatTime(times.sunset),
        highTides: dayHighs,
        lowTides: dayLows,
      });
    }
  }

  // =========================================================================
  // 4. 황금 피딩 타임(Feeding Times) 산출
  // =========================================================================
  const allFeedingTimes: {
    label: string;
    timeRange: string;
    reason: string;
    startHour: number;
    endHour: number;
    startTimeStr: string;
    endTimeStr: string;
    startTimestamp: number;
    endTimestamp: number;
    dayLabel: string;
    startDisplayTime?: string;
    endDisplayTime?: string;
  }[] = [];

  for (let d = 0; d < 3; d++) {
    const dayDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + d, 12, 0, 0);
    const dayTimes = SunCalc.getTimes(dayDate, lat, lng);
    const daySummary = threeDays[d];
    const prefix = d === 0 ? '오늘' : d === 1 ? '내일' : '모레';

    // (1) 아침 해창 피딩
    if (dayTimes.sunrise && !isNaN(dayTimes.sunrise.getTime())) {
      const srStart = new Date(dayTimes.sunrise.getTime() - 40 * 60000);
      const srEnd = new Date(dayTimes.sunrise.getTime() + 60 * 60000);
      allFeedingTimes.push({
        label: `🌅 ${prefix} 아침 해창`,
        timeRange: `${d > 0 ? `(${prefix}) ` : ''}${formatTime(srStart)} ~ ${formatTime(srEnd)}`,
        reason: '일출 전후 먹이활동 집중 (시각 어종 활성)',
        startHour: srStart.getHours() + d * 24,
        endHour: Math.max(srEnd.getHours() + d * 24, srStart.getHours() + d * 24 + 1),
        startTimeStr: `${padZero(srStart.getMonth() + 1)}/${padZero(srStart.getDate())} ${padZero(srStart.getHours())}:00`,
        endTimeStr: `${padZero(srEnd.getMonth() + 1)}/${padZero(srEnd.getDate())} ${padZero(srEnd.getHours())}:00`,
        startTimestamp: srStart.getTime(),
        endTimestamp: srEnd.getTime(),
        dayLabel: prefix,
      });
    }

    // (2) 들물 본류대 피딩
    if (daySummary?.highTides) {
      daySummary.highTides.forEach((ht, htIdx) => {
        const [hHour, hMin] = ht.time.split(':').map(Number);
        const htDate = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), hHour, hMin, 0);
        const htStartDate = new Date(htDate.getTime() - 2 * 3600 * 1000);
        allFeedingTimes.push({
          label: `🌊 ${prefix} 들물 피딩${daySummary.highTides.length > 1 ? ` (${htIdx + 1}차)` : ''}`,
          timeRange: `${d > 0 ? `(${prefix}) ` : ''}${formatTime(htStartDate)} ~ ${formatTime(htDate)} (만조)`,
          reason: '만조 직전 본류대 유입 및 베이트피시 연안 접근',
          startHour: htStartDate.getHours() + d * 24,
          endHour: Math.max(hHour + d * 24, htStartDate.getHours() + d * 24 + 1),
          startTimeStr: `${padZero(htStartDate.getMonth() + 1)}/${padZero(htStartDate.getDate())} ${padZero(htStartDate.getHours())}:00`,
          endTimeStr: `${padZero(htDate.getMonth() + 1)}/${padZero(htDate.getDate())} ${padZero(hHour)}:00`,
          startTimestamp: htStartDate.getTime(),
          endTimestamp: htDate.getTime(),
          dayLabel: prefix,
        });
      });
    }

    // (3) 저녁 일몰 골든아워
    if (dayTimes.sunset && !isNaN(dayTimes.sunset.getTime())) {
      const ssStart = new Date(dayTimes.sunset.getTime() - 40 * 60000);
      const ssEnd = new Date(dayTimes.sunset.getTime() + 40 * 60000);
      allFeedingTimes.push({
        label: `🌇 ${prefix} 저녁 일몰`,
        timeRange: `${d > 0 ? `(${prefix}) ` : ''}${formatTime(ssStart)} ~ ${formatTime(ssEnd)}`,
        reason: '일몰 골든아워 (포식성 어종 연안 접근)',
        startHour: ssStart.getHours() + d * 24,
        endHour: Math.max(ssEnd.getHours() + d * 24, ssStart.getHours() + d * 24 + 1),
        startTimeStr: `${padZero(ssStart.getMonth() + 1)}/${padZero(ssStart.getDate())} ${padZero(ssStart.getHours())}:00`,
        endTimeStr: `${padZero(ssEnd.getMonth() + 1)}/${padZero(ssEnd.getDate())} ${padZero(ssEnd.getHours())}:00`,
        startTimestamp: ssStart.getTime(),
        endTimestamp: ssEnd.getTime(),
        dayLabel: prefix,
      });
    }
  }

  // =========================================================================
  // 5. 단일 마스터 시계열로부터 100% 동기화된 파생 슬라이스(Slice) 추출
  // =========================================================================

  // (1) 24시간 곡선: 오늘 00:00 ~ 24:00 (총 25개)
  const hourlyCurve: TideCurvePoint[] = masterSeries
    .filter((p) => p.hour >= 0 && p.hour <= 24)
    .map((p) => ({ ...p }));

  // (2) 72시간 전체 곡선: 00:00 ~ 72시간 (총 73개)
  const hourly72Curve: TideCurvePoint[] = masterSeries
    .filter((p) => p.hour >= 0 && p.hour <= 72)
    .map((p) => ({ ...p }));

  // (3) 현재 시각 기준 -6h ~ +36h 실시간 예측 곡선 (AreaChart 바인딩용, 총 43개)
  const curve36: TideCurvePoint[] = masterSeries
    .filter((p) => p.hour >= currentHourOffset - 6 && p.hour <= currentHourOffset + 36)
    .map((p) => {
      const pointTimestamp = startOfDay.getTime() + p.hour * 3600 * 1000;
      const matchedFeeding = allFeedingTimes.find(
        (f) => pointTimestamp >= f.startTimestamp && pointTimestamp <= f.endTimestamp
      );
      return {
        ...p,
        hour: p.hour - currentHourOffset, // 상대 오프셋 (-6 ~ +36)
        isFeedingTime: Boolean(matchedFeeding),
        feedingReason: matchedFeeding?.reason,
        feedingLabel: matchedFeeding?.label,
      };
    });

  // 피딩 타임에 curve36의 시작/종료 displayTime 매핑
  for (const f of allFeedingTimes) {
    const startPt = curve36.find((c) => Math.abs(c.hour * 3600000 + baseTimestamp - f.startTimestamp) <= 45 * 60000) ||
      curve36.find((c) => c.hour * 3600000 + baseTimestamp >= f.startTimestamp);
    const endPt = curve36.slice().reverse().find((c) => Math.abs(c.hour * 3600000 + baseTimestamp - f.endTimestamp) <= 45 * 60000) ||
      curve36.slice().reverse().find((c) => c.hour * 3600000 + baseTimestamp <= f.endTimestamp);

    if (startPt && endPt) {
      f.startDisplayTime = startPt.displayTime;
      f.endDisplayTime = endPt.displayTime;
    }
  }

  const nowMs = baseDate.getTime();
  const futureFeedingTimes = allFeedingTimes
    .filter((f) => f.endTimestamp > nowMs)
    .sort((a, b) => a.endTimestamp - b.endTimestamp)
    .slice(0, 4);

  const feedingTimes = futureFeedingTimes.length > 0 ? futureFeedingTimes : allFeedingTimes.slice(0, 3);

  return {
    lunarDateStr: todayLunarDateStr,
    mulText: todayMul.mulText,
    mulNumber: todayMul.mulNumber,
    highTides: threeDays[0].highTides,
    lowTides: threeDays[0].lowTides,
    hourlyCurve,
    hourly72Curve,
    curve36,
    threeDays,
    sunrise: formatTime(todayTimes.sunrise),
    sunset: formatTime(todayTimes.sunset),
    dawn: formatTime(todayTimes.dawn),
    dusk: formatTime(todayTimes.dusk),
    feedingTimes,
  };
}
