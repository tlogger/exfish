import * as SunCalc from 'suncalc';
import { BiteScoreBreakdown, FishingSpot, MarineData, SpeciesBiteScore, TideDayInfo, WeatherData } from '../types';
import { SPECIES_ENCYCLOPEDIA, SpeciesEcology } from './speciesDatabase';

/**
 * 어종의 서식 수층(waterLayer) 및 계절, 포인트 수심을 감안한 실제 체감 수온 추정
 * - 표층/중층 어종: 표층 수온(SST) 그대로 사용
 * - 저서성 바닥 어종(BOTTOM):
 *   - 수심 3m 미만: 표층과 저층 동일 (강한 연안 파도 혼합)
 *   - 여름철(6~9월): 표층 가열로 인한 수온약층 발생 -> 수심당 -0.25°C 하강 (최대 4.0°C)
 *   - 겨울철(12~2월): 차가운 북서풍 표층 급랭 -> 저층이 상대적으로 온화 (+0.5~+1.5°C 완충)
 *   - 봄/가을(3~5월, 10~11월): 연직 혼합 활발 -> 표층과 동일
 */
export function estimateTargetWaterTemp(
  sst: number,
  waterLayer: string | undefined,
  depthM: number | undefined,
  month: number,
  region?: 'WEST' | 'SOUTH' | 'EAST' | 'JEJU'
): { effectiveTemp: number; isBottomCorrected: boolean; depthDiff: number } {
  if (waterLayer !== 'BOTTOM' || !depthM || depthM <= 3.0) {
    return { effectiveTemp: sst, isBottomCorrected: false, depthDiff: 0 };
  }

  const effectiveDepth = Math.max(0, depthM - 3.0);
  let diff = 0;

  if (month >= 6 && month <= 9) {
    // 여름철: 서해안('WEST')은 강한 조석 연직 혼합으로 저층 냉각이 완화됨 (0.12°C/m, 최대 -2.0°C)
    if (region === 'WEST') {
      diff = -Math.min(2.0, effectiveDepth * 0.12);
    } else {
      diff = -Math.min(4.0, effectiveDepth * 0.25);
    }
  } else if (month === 12 || month === 1 || month === 2) {
    // 겨울철: 표층 냉각 대비 저층이 상대적으로 온화 (최대 +1.5°C)
    diff = Math.min(1.5, effectiveDepth * 0.1);
  } else {
    diff = 0;
  }

  const effectiveTemp = Math.round((sst + diff) * 10) / 10;
  return { effectiveTemp, isBottomCorrected: Math.abs(diff) >= 0.2, depthDiff: diff };
}

/**
 * 사다리꼴 코사인 평활화(Trapezoidal Cosine Decay) 수온 활성도 계산기 (30점 만점)
 * 1. 최적 활성 구간 [optMin, optMax]: 30점 만점
 * 2. 완만 감점 구간 [min, optMin]: 코사인 곡선으로 10점 -> 30점
 * 3. 완만 감점 구간 [optMax, max]: 코사인 곡선으로 30점 -> 10점
 * 4. 생존 한계 초과 (< min 또는 > max): 5점 고정 (생태 쇼크/비활성)
 */
export function calculateSmoothTempScore(
  temp: number,
  tr: { min: number; optMin: number; optMax: number; max: number }
): { score: number; matchText: string; isStress: boolean } {
  if (temp >= tr.optMin && temp <= tr.optMax) {
    return {
      score: 30,
      matchText: `최적 활성수온 (${temp.toFixed(1)}°C)`,
      isStress: false,
    };
  }

  if (temp >= tr.min && temp < tr.optMin) {
    // min ~ optMin 구간: 10점 -> 30점 코사인 보간
    const ratio = (temp - tr.min) / Math.max(0.1, tr.optMin - tr.min);
    const smoothFactor = (1 - Math.cos(ratio * Math.PI)) / 2; // 0 to 1
    const score = Math.round(10 + 20 * smoothFactor);
    return {
      score,
      matchText: `적정 수온하한 (${temp.toFixed(1)}°C)`,
      isStress: false,
    };
  }

  if (temp > tr.optMax && temp <= tr.max) {
    // optMax ~ max 구간: 30점 -> 10점 코사인 보간
    const ratio = (temp - tr.optMax) / Math.max(0.1, tr.max - tr.optMax);
    const smoothFactor = (1 + Math.cos(ratio * Math.PI)) / 2; // 1 to 0
    const score = Math.round(10 + 20 * smoothFactor);
    return {
      score,
      matchText: `적정 수온상한 (${temp.toFixed(1)}°C)`,
      isStress: false,
    };
  }

  // 한계 초과 (생태적 쇼크/비활성)
  const isCold = temp < tr.min;
  return {
    score: 5,
    matchText: isCold ? `저수온 쇼크/비활성 (${temp.toFixed(1)}°C)` : `고수온 쇼크/비활성 (${temp.toFixed(1)}°C)`,
    isStress: true,
  };
}

/**
 * 위경도와 현재 시각 기반 천문학적 일출/일몰/박명(해창) 및 주야간 활성도 평가 (25점 만점)
 */
export function evaluateDayNightFeeding(
  species: SpeciesEcology,
  now: Date,
  lat: number,
  lng: number,
  simulatedHour?: number,
  depthM?: number
): { timeScore: number; activityMatch: string; isStrictlyInactiveTime: boolean; isGoldenFeeding: boolean } {
  const targetDate = new Date(now);
  if (simulatedHour !== undefined && simulatedHour >= 0 && simulatedHour <= 23) {
    targetDate.setHours(simulatedHour, 30, 0, 0);
  }

  let times;
  try {
    times = SunCalc.getTimes(targetDate, lat, lng);
  } catch {
    times = {
      sunrise: new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 6, 0, 0),
      sunset: new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 18, 30, 0),
      dawn: new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 5, 30, 0),
      dusk: new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 19, 0, 0),
    };
  }

  const curTime = targetDate.getTime();
  const srTime = (times.sunrise && !isNaN(times.sunrise.getTime()))
    ? times.sunrise.getTime()
    : new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 6, 0, 0).getTime();
  const ssTime = (times.sunset && !isNaN(times.sunset.getTime()))
    ? times.sunset.getTime()
    : new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 18, 30, 0).getTime();

  const dawnTime = (times.dawn && !isNaN(times.dawn.getTime())) ? times.dawn.getTime() : srTime - 35 * 60000;
  const duskTime = (times.dusk && !isNaN(times.dusk.getTime())) ? times.dusk.getTime() : ssTime + 35 * 60000;

  // 1. 아침 해창 (Civil Dawn ~ Sunrise + 45분)
  const morningGoldenEnd = srTime + 45 * 60000;
  const isMorningCrepuscular = curTime >= dawnTime && curTime <= morningGoldenEnd;

  // 2. 저녁 해창 (Sunset - 45분 ~ Civil Dusk)
  const eveningGoldenStart = ssTime - 45 * 60000;
  const isEveningCrepuscular = curTime >= eveningGoldenStart && curTime <= duskTime;

  const isGoldenFeeding = isMorningCrepuscular || isEveningCrepuscular;

  // 3. 주간(Day) vs 야간(Night)
  const isDay = curTime > morningGoldenEnd && curTime < eveningGoldenStart;
  const isNight = curTime > duskTime || curTime < dawnTime;

  const profile = species.dailyProfile;
  const hour = targetDate.getHours();
  const isProfilePeak = profile ? profile.peakHours.includes(hour) : false;
  const isProfileActive = profile ? profile.activeHours.includes(hour) : false;

  let timeScore = 14;
  let activityMatch = '';
  let isStrictlyInactiveTime = false;

  // 해창 피딩 타임 우선 평가
  if (isGoldenFeeding) {
    timeScore = 25;
    activityMatch = isMorningCrepuscular
      ? '🌅 아침 여명/해창 골든타임 (폭발적 피딩)'
      : '🌇 저녁 일몰/해창 골든타임 (폭발적 피딩)';
    return { timeScore, activityMatch, isStrictlyInactiveTime: false, isGoldenFeeding: true };
  }

  // 어종의 생태 시간 프로필 검사
  if (profile) {
    if (profile.restriction === 'STRICT_DAY') {
      if (isDay) {
        timeScore = isProfilePeak ? 25 : isProfileActive ? 20 : 16;
        activityMatch = `주간 정상 먹이활동 시간대 (${profile.timeNote})`;
      } else {
        timeScore = 2;
        activityMatch = `야간 비활성/휴면 (입질 전무: ${profile.timeNote})`;
        isStrictlyInactiveTime = true;
      }
    } else if (profile.restriction === 'STRICT_NIGHT') {
      if (isNight) {
        timeScore = isProfilePeak ? 25 : isProfileActive ? 20 : 16;
        activityMatch = `야간 집중 먹이 사냥 골든타임 (${profile.timeNote})`;
      } else if (depthM !== undefined && depthM >= 15) {
        timeScore = 15;
        activityMatch = `주간 심수심(15m 이상) 바닥권 입질 가능 (${profile.timeNote})`;
      } else {
        timeScore = 2;
        activityMatch = `주간 은신/매몰 상태 (15m 미만 입질 저조: ${profile.timeNote})`;
        isStrictlyInactiveTime = true;
      }
    } else if (profile.restriction === 'CREPUSCULAR_PEAK') {
      if (isDay) {
        timeScore = 15;
        activityMatch = '낮 시간대 완만한 활동 (은신처 주변)';
      } else {
        timeScore = 17;
        activityMatch = '야간 완만한 피딩';
      }
    } else {
      timeScore = isProfilePeak ? 22 : 16;
      activityMatch = `통상 활동 시간대 (${profile.timeNote})`;
    }
    return { timeScore, activityMatch, isStrictlyInactiveTime, isGoldenFeeding: false };
  }

  // 기본 생태 주기(activityPeriod) 폴백
  if (species.activityPeriod === 'NOCTURNAL') {
    if (isNight) {
      timeScore = 24;
      activityMatch = '야간 먹이활동 집중 (최고 활성)';
    } else if (depthM !== undefined && depthM >= 15) {
      timeScore = 15;
      activityMatch = '주간 심수심(15m 이상) 바닥권 입질 가능';
    } else {
      timeScore = 3;
      activityMatch = '주간 은신 상태 (15m 미만 얕은 수심 입질 뜸함)';
      isStrictlyInactiveTime = true;
    }
  } else if (species.activityPeriod === 'DIURNAL') {
    if (isDay) {
      timeScore = 24;
      activityMatch = '주간 시각 사냥 최적';
    } else {
      timeScore = 3;
      activityMatch = '야간 시야 부재 (입질 저하/휴면)';
      isStrictlyInactiveTime = true;
    }
  } else {
    // CREPUSCULAR
    timeScore = isNight ? 17 : 15;
    activityMatch = isNight ? '야간 완만한 활동' : '주간 잔잔한 입질';
  }

  return { timeScore, activityMatch, isStrictlyInactiveTime, isGoldenFeeding: false };
}

/**
 * 파고(Wave Height)에 따른 채비 쓸림 및 바닥 안착 방해 페널티 (총점 감점 및 진단)
 * - 파고 >= 1.8m: 극심한 너울/파도로 채비 안착 불가, 밑걸림 및 원줄 쓸림 극심 (-14점)
 * - 파고 >= 1.2m: 채비 쓸림/밀림 주의, 봉돌 증량 필요 (-6점)
 * - 파고 >= 0.8m: 약간의 너울성 출렁임 (-2점)
 * - 파고 < 0.8m: 안정적인 채비 운용 가능 (0점)
 */
export function evaluateWaveRigSweep(waveHeight: number): {
  penalty: number;
  sweepWarning: string | null;
  status: 'OPTIMAL' | 'MODERATE' | 'HEAVY' | 'DANGEROUS';
} {
  if (waveHeight >= 1.8) {
    return {
      penalty: 14,
      sweepWarning: `🌊 파고 ${waveHeight.toFixed(1)}m 극심: 채비 쓸림/날림으로 바닥 안착 불가 (낚시 위험)`,
      status: 'DANGEROUS',
    };
  }
  if (waveHeight >= 1.2) {
    return {
      penalty: 6,
      sweepWarning: `🌊 파고 ${waveHeight.toFixed(1)}m 주의: 너울성 파도로 채비 쓸림 발생 (봉돌 1~2호 증량 권장)`,
      status: 'HEAVY',
    };
  }
  if (waveHeight >= 0.8) {
    return {
      penalty: 2,
      sweepWarning: `🌊 파고 ${waveHeight.toFixed(1)}m: 약간의 너울성 출렁임`,
      status: 'MODERATE',
    };
  }
  return {
    penalty: 0,
    sweepWarning: null,
    status: 'OPTIMAL',
  };
}

/**
 * 사리/정조에 따른 물 탁도(Turbidity) 변화가 대상어 입질에 미치는 영향 보정
 * - 사리 + 강한 조류 -> 부유물 증가(탁수): 시각 사냥/두족류 불리, 후각·측선 의존/경계심 완화 어종 유리
 * - 조금/무시 또는 정조 -> 맑은 물(청수): 시각 사냥/두족류 유리, 경계심 높은 연안 어종 불리
 */
export function evaluateTurbidityEffect(
  species: SpeciesEcology,
  tide: TideDayInfo,
  currentVel: number,
  region: 'WEST' | 'SOUTH' | 'EAST' | 'JEJU'
): { delta: number; note: string | null } {
  const isSpringTide = tide.mulNumber >= 6 && tide.mulNumber <= 10;
  const isNeapTide = tide.mulNumber <= 3 || tide.mulNumber >= 13;
  const turbidityVelThreshold = region === 'WEST' ? 0.3 : 0.4;

  const isHighTurbidity = isSpringTide && currentVel >= turbidityVelThreshold;
  const isClearSlack = isNeapTide || currentVel <= 0.12;

  const isSightClearPreferred =
    species.category === 'CEPHALOPOD' ||
    /볼락|전갱이|고등어|삼치|광어|방어|부시리|벵에돔/.test(species.name);
  const isTurbidTolerant =
    /감성돔|농어|우럭|붕장어|숭어|망둥어|도다리|민어|참돔/.test(species.name);

  if (isHighTurbidity) {
    if (isSightClearPreferred) {
      return { delta: -6, note: '사리 탁수 시야 저하(불리)' };
    }
    if (isTurbidTolerant) {
      return { delta: 3, note: '사리 적정 탁도 경계심 완화' };
    }
  } else if (isClearSlack) {
    if (isSightClearPreferred) {
      return { delta: 2, note: '청수 시인성 양호' };
    }
    if (isTurbidTolerant) {
      return { delta: -4, note: '물 맑음·정조 경계심 증가' };
    }
  }
  return { delta: 0, note: null };
}

/**
 * 특정 단일 어종의 현재 환경 적합도(0~100점) 정밀 채점기
 */
export function calculateSingleSpeciesScore(
  species: SpeciesEcology,
  spot: FishingSpot,
  weather: WeatherData,
  marine: MarineData,
  tide: TideDayInfo,
  currentHour?: number,
  currentMonth?: number,
  targetDate?: Date,
  actualDepthM?: number
): SpeciesBiteScore {
  const now = targetDate || new Date();
  const month = currentMonth !== undefined ? currentMonth : now.getMonth() + 1;

  const sst = marine.seaSurfaceTemp;
  const currentVel = marine.currentVelocity ?? 0.3;

  // 1. 수온 활성도 채점 (30점 만점) - 저서어종 저층수온 보정 + 사다리꼴 코사인 평활화
  let depthM = 5.0;
  if (actualDepthM !== undefined && actualDepthM > 0) depthM = actualDepthM;
  else if (spot.spot_type === 'ROCK') depthM = 6.0;
  else if (spot.spot_type === 'BREAKWATER') depthM = 7.0;
  else if (spot.spot_type === 'SEAWALL') depthM = 5.0;
  else if (spot.spot_type === 'PIER') depthM = 4.5;
  else if (spot.spot_type === 'BEACH') depthM = 2.5;

  const region: 'WEST' | 'SOUTH' | 'EAST' | 'JEJU' =
    spot.lat < 33.6
      ? 'JEJU'
      : spot.lng > 128.8 && spot.lat > 35.2
      ? 'EAST'
      : spot.lng < 126.9 && spot.lat > 34.4
      ? 'WEST'
      : 'SOUTH';

  const { effectiveTemp, isBottomCorrected, depthDiff } = estimateTargetWaterTemp(
    sst,
    species.waterLayer,
    depthM,
    month,
    region
  );

  const tempRes = calculateSmoothTempScore(effectiveTemp, species.tempRange);
  let tempMatch = tempRes.matchText;
  if (isBottomCorrected) {
    const sign = depthDiff > 0 ? `+${depthDiff.toFixed(1)}` : depthDiff.toFixed(1);
    tempMatch += ` [저층보정 ${sign}°C]`;
  }

  // 2. 일중 활동 시간대(주행성/야행성/천문 해창 피딩) 적합도 (25점 만점)
  const timeRes = evaluateDayNightFeeding(species, now, spot.lat, spot.lng, currentHour, depthM);

  // 3. 조류 유속 및 물때 위상(들물/날물/정조) 적합도 (25점 만점)
  let currentScore = 16;
  if (species.currentPref === 'STRONG') {
    // 참돔, 감성돔, 농어, 방어: 사리 물때와 빠른 유속 선호
    if (tide.mulNumber >= 6 && tide.mulNumber <= 10 && currentVel >= 0.35) {
      currentScore = 25;
    } else if (currentVel >= 0.25) {
      currentScore = 20;
    } else {
      currentScore = 12;
    }
  } else if (species.currentPref === 'SLACK_GENTLE') {
    // 주꾸미, 갑오징어, 낙지, 도다리: 채비 안착과 바닥 탐색에 약한 조류 선호
    if (currentVel <= 0.25 || tide.mulNumber <= 3 || tide.mulNumber >= 13) {
      currentScore = 25;
    } else if (currentVel <= 0.45) {
      currentScore = 18;
    } else {
      currentScore = 10; // 채비 날림
    }
  } else {
    // MODERATE (우럭, 광어, 볼락, 무늬오징어): 0.15~0.5m/s 유속 적합
    if (currentVel >= 0.15 && currentVel <= 0.5) {
      currentScore = 24;
    } else {
      currentScore = 16;
    }
  }

  // 시간대별 조위 곡선 위상(들물/날물/정조) 보정 (25점 배점 상한 내 ±3점)
  const targetH = currentHour !== undefined ? currentHour : now.getHours();
  const phasePoint =
    tide.hourlyCurve?.find((c) => ((c.hour % 24) + 24) % 24 === targetH) ||
    tide.hourly72Curve?.find((c) => ((c.hour % 24) + 24) % 24 === targetH);
  if (phasePoint) {
    const absNormSlope = Math.abs(phasePoint.normalizedSlope ?? 0);
    if (phasePoint.stateText.includes('물돌이')) {
      if (species.currentPref === 'SLACK_GENTLE') {
        currentScore = Math.min(25, currentScore + 2);
      } else if (species.currentPref === 'STRONG') {
        currentScore = Math.max(0, currentScore - 3);
      }
    } else if ((phasePoint.stateText.includes('들물') || phasePoint.stateText.includes('날물')) && absNormSlope >= 0.45) {
      if (species.currentPref === 'STRONG') {
        currentScore = Math.min(25, currentScore + 2);
      }
    }
  }

  // 4. 지형 & 제철(계절) 적합도 (20점 만점)
  let spotSeasonScore = 12;
  // 지형 매칭
  if (
    (species.bottomType === 'ROCK_REEF' && (spot.spot_type === 'ROCK' || spot.spot_type === 'SEAWALL' || spot.spot_type === 'BREAKWATER')) ||
    (species.bottomType === 'SAND_FLAT' && spot.spot_type === 'BEACH') ||
    (species.bottomType === 'MUD_FLAT' && spot.spot_type === 'PIER') ||
    species.bottomType === 'OPEN_WATER'
  ) {
    spotSeasonScore += 4;
  }

  // 제철 월 매칭
  if (species.peakMonths.includes(month)) {
    spotSeasonScore += 4;
  }

  const turbidityEffect = evaluateTurbidityEffect(species, tide, currentVel, region);
  let score = Math.max(0, Math.min(100, Math.round(tempRes.score + timeRes.timeScore + currentScore + spotSeasonScore + turbidityEffect.delta)));

  // 생태 락 (Strict Inactive): 야간 휴면 주간어종 또는 주간 은신 야간어종
  if (timeRes.isStrictlyInactiveTime) {
    score = Math.min(score, 15);
  }
  // 수온 쇼크 락: 생존 한계 초과 시 총점 상한 제한
  if (tempRes.isStress) {
    score = Math.min(score, 25);
  }

  let verdict = '';
  if (score >= 85) verdict = `${species.name} 대박 찬스! ${timeRes.activityMatch}, ${tempMatch}`;
  else if (score >= 70) verdict = `${species.name} 조황 기대. ${timeRes.activityMatch}`;
  else if (score >= 50) verdict = `${species.name} 무난한 편이나 타이밍 조율 필요`;
  else verdict = `${species.name} 비활성 구간 (${timeRes.activityMatch})`;

  return {
    speciesName: species.name,
    score,
    verdict,
    activityMatch: timeRes.activityMatch,
    tempMatch,
    effectiveTemp,
    isBottomCorrected,
  };
}

/**
 * 포인트 출현·대상 어종 개별 점수(내림차순)로부터 입질 종합 기본 점수를 산출합니다.
 * - 1~2종: 전체 평균 (예: 우럭 90점, 광어 80점 -> 85점)
 * - 3종 이상: 비활성/휴면 어종(<30점)이 대박 어종 점수를 과도하게 희석하지 않도록
 *   활성 어종(>=30점) 중 상위 최대 3종의 평균을 사용하며, 전 어종이 비활성이면 전체 평균 사용
 */
export function aggregateSpeciesBiteScore(sortedScoresDesc: number[]): number {
  if (sortedScoresDesc.length === 0) return 0;
  if (sortedScoresDesc.length <= 2) {
    return Math.round(
      sortedScoresDesc.reduce((acc, s) => acc + s, 0) / sortedScoresDesc.length
    );
  }
  const activeScores = sortedScoresDesc.filter((s) => s >= 30);
  const pool = activeScores.length > 0 ? activeScores.slice(0, 3) : sortedScoresDesc;
  return Math.round(pool.reduce((acc, s) => acc + s, 0) / pool.length);
}

/**
 * ExFish 어종 생태 기반 맞춤형 입질 종합 지수 (Bite Index, 100점 만점)
 * - 관심 대상어(favoriteSpecies)가 주어지면 해당 어종들의 생태 데이터를 기반으로 점수 산출
 */
export function calculateBiteScore(
  spot: FishingSpot,
  weather: WeatherData,
  marine: MarineData,
  tide: TideDayInfo,
  favoriteSpecies?: string[],
  targetDate?: Date,
  actualDepthM?: number
): BiteScoreBreakdown {
  const now = targetDate || new Date();
  const currentHour = now.getHours();
  const currentMonth = now.getMonth() + 1; // 1~12

  // 1. 바람 및 캐스팅 방향 물리적 일치도 연산
  const speed = weather.windSpeed;
  let windScore = 25;
  if (speed <= 4.0) windScore = 25;
  else if (speed <= 6.5) windScore = 20;
  else if (speed <= 8.5) windScore = 13;
  else windScore = 5;

  let windRelation: BiteScoreBreakdown['windRelation'] = '등바람 (최적)';
  const CASTING_DEG: Record<string, number> = {
    N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315,
  };

  let bearing: number | null = null;
  if (spot.casting_start_deg !== undefined && spot.casting_end_deg !== undefined) {
    const span = spot.casting_end_deg >= spot.casting_start_deg
      ? spot.casting_end_deg - spot.casting_start_deg
      : 360 - spot.casting_start_deg + spot.casting_end_deg;
    bearing = (spot.casting_start_deg + span / 2) % 360;
  } else {
    const primaryCastingDir = spot.casting_directions?.find((d) => d !== 'ALL');
    if (primaryCastingDir && CASTING_DEG[primaryCastingDir] !== undefined) {
      bearing = CASTING_DEG[primaryCastingDir];
    }
  }

  if (bearing !== null) {
    const windVectorDeg = (weather.windDirection + 180) % 360;
    const diff = Math.abs(bearing - windVectorDeg) % 360;
    const angleDiff = diff > 180 ? 360 - diff : diff;

    if (angleDiff <= 45 && speed <= 7.0 && marine.waveHeight <= 1.5) {
      windRelation = '등바람 (최적)';
    } else if (angleDiff >= 135 || speed > 7.5 || marine.waveHeight > 1.5) {
      windRelation = '맞바람/너울 (위험)';
      windScore = Math.max(5, windScore - 6);
    } else {
      windRelation = '옆바람 (주의)';
    }
  } else {
    if (speed > 7.0 || marine.waveHeight > 1.5) {
      windRelation = '맞바람/너울 (위험)';
      windScore = Math.max(5, windScore - 6);
    } else if (speed > 4.5) {
      windRelation = '옆바람 (주의)';
    } else {
      windRelation = '등바람 (최적)';
    }
  }

  // 2. 파고에 따른 채비 쓸림 및 바닥 안착 방해 페널티 연산
  const waveSweep = evaluateWaveRigSweep(marine.waveHeight);

  // 3. 평가 대상 어종 목록 결정
  const spotActualSpecies = (spot.target_species && spot.target_species.length > 0)
    ? spot.target_species
    : ['우럭', '광어'];

  let targetNames: string[] = [];
  let isCustom = false;

  if (favoriteSpecies && favoriteSpecies.length > 0) {
    const matchedFavorites = spotActualSpecies.filter((sp) =>
      favoriteSpecies.some((fav) => fav.includes(sp) || sp.includes(fav))
    );

    if (matchedFavorites.length > 0) {
      targetNames = matchedFavorites;
      isCustom = true;
    } else {
      targetNames = spotActualSpecies;
      isCustom = false;
    }
  } else {
    targetNames = spotActualSpecies;
  }

  // 어종별 개별 점수 산출
  const speciesScores: SpeciesBiteScore[] = targetNames.map((name) => {
    const matchedEcology =
      SPECIES_ENCYCLOPEDIA[name] ||
      Object.values(SPECIES_ENCYCLOPEDIA).find((sp) => sp.name.includes(name) || name.includes(sp.name)) ||
      SPECIES_ENCYCLOPEDIA['우럭'];

    return calculateSingleSpeciesScore(matchedEcology, spot, weather, marine, tide, currentHour, currentMonth, now, actualDepthM);
  });

  // 점수 높은 순 정렬
  speciesScores.sort((a, b) => b.score - a.score);
  const topSpecies = speciesScores[0];

  // 종합 점수: 포인트 출현·대상 어종(또는 관심어종)의 상위 활성 어종 기반 평균 (최대 100점)
  const avgSpeciesScore = aggregateSpeciesBiteScore(speciesScores.map((s) => s.score));

  // 풍속/너울 및 파고 채비 쓸림 감점 반영
  let totalScore = avgSpeciesScore;

  // 파고 채비 쓸림 페널티 적용
  if (waveSweep.penalty > 0) {
    totalScore = Math.max(10, totalScore - waveSweep.penalty);
  }

  // 바람(상대풍향 + 풍속) 감점: 맞바람/옆바람 시 강풍 페널티 가중
  let windPenalty = 0;
  if (windRelation.startsWith('맞바람')) {
    if (speed >= 7.5) windPenalty = 14;
    else if (speed >= 5.0) windPenalty = 8;
    else if (speed >= 3.5) windPenalty = 4;
  } else if (windRelation.startsWith('옆바람')) {
    if (speed >= 7.5) windPenalty = 10;
    else if (speed >= 5.5) windPenalty = 6;
    else if (speed >= 4.0) windPenalty = 3;
  } else {
    if (speed >= 8.5) windPenalty = 6;
    else if (speed >= 6.5) windPenalty = 3;
  }
  if (windPenalty > 0) {
    totalScore = Math.max(10, totalScore - windPenalty);
  }

  // 조류 과속 감점: 유속이 지나치게 빨라 채비 운용·바닥 안착이 어려운 경우
  const curVel = marine.currentVelocity ?? 0;
  let currentExcessPenalty = 0;
  if (curVel >= 1.0) currentExcessPenalty = 12;
  else if (curVel >= 0.8) currentExcessPenalty = 7;
  else if (curVel >= 0.65) currentExcessPenalty = 3;
  if (currentExcessPenalty > 0) {
    totalScore = Math.max(10, totalScore - currentExcessPenalty);
  }

  // 브리핑 평결 생성
  let verdict = '';
  const targetLabel = isCustom
    ? `내 관심어종 [${targetNames.slice(0, 2).join(', ')}${targetNames.length > 2 ? ` 외 ${targetNames.length - 2}` : ''}]`
    : `포인트 대상어 [${targetNames.slice(0, 2).join(', ')}]`;

  if (waveSweep.status === 'DANGEROUS') {
    verdict = `🌊 파고 ${marine.waveHeight.toFixed(1)}m 급증: 채비 쓸림이 극심하여 바닥 안착이 어렵습니다. (주의 출조)`;
  } else if (topSpecies && topSpecies.score >= 80) {
    verdict = `🔥 현재 [${topSpecies.speciesName}] 입질 확률 최고 (${topSpecies.score}점)! ${topSpecies.activityMatch}`;
  } else if (totalScore >= 70) {
    verdict = `✨ 양호한 출조 여건 (${totalScore}점). ${topSpecies ? `${topSpecies.speciesName} 위주 공략 추천` : '물때와 수온이 안정적입니다.'}`;
  } else if (totalScore >= 50) {
    verdict = `⚖️ 무난한 여건 (${totalScore}점). ${topSpecies ? `${topSpecies.speciesName} 입질 타이밍을 노려보세요.` : '중들물 시간대 집중 요망'}`;
  } else {
    verdict = `⚠️ 까다로운 여건 (${totalScore}점). ${topSpecies ? `${topSpecies.speciesName} 활동 시간대 확인 필요.` : '바람/파고에 유의하세요.'}`;
  }

  return {
    totalScore,
    mulScore: Math.round(avgSpeciesScore * 0.3),
    windScore,
    tempScore: Math.round(avgSpeciesScore * 0.3),
    timeScore: Math.round(avgSpeciesScore * 0.25),
    windRelation,
    verdict,
    topSpecies,
    speciesScores,
    targetSummaryLabel: targetLabel,
    waveSweepWarning: waveSweep.sweepWarning,
  };
}

export interface GoldenWindow48h {
  offsetHours: number;
  timeLabel: string;
  tideState: string;
  topSpeciesName: string;
  score: number;
  reason: string;
}

/**
 * 향후 48시간 내 기상·조류·조석 위상이 교차하는 Top 3 황금 출조 시간대 자동 탐색
 */
export function findTopGoldenWindows48h(
  spot: FishingSpot,
  weather: WeatherData | null,
  marine: MarineData | null,
  tide: TideDayInfo | null,
  favoriteSpecies?: string[],
  baseTime: Date = new Date()
): GoldenWindow48h[] {
  if (!weather || !marine || !tide) return [];

  const now = new Date(baseTime.getTime());
  const nowHour = now.getHours();
  const candidates: GoldenWindow48h[] = [];

  for (let offset = 0; offset <= 47; offset++) {
    const tDate = new Date(now.getTime() + offset * 3600 * 1000);
    const tHour = tDate.getHours();
    const y = tDate.getFullYear();
    const m = String(tDate.getMonth() + 1).padStart(2, '0');
    const d = String(tDate.getDate()).padStart(2, '0');
    const hh = String(tHour).padStart(2, '0');
    const prefix = `${y}-${m}-${d}T${hh}:00`;

    const wIdx = weather.hourly?.time?.findIndex((t) => t.startsWith(prefix)) ?? -1;
    const mIdx = marine.hourly?.time?.findIndex((t) => t.startsWith(prefix)) ?? -1;

    const simWeather: WeatherData =
      offset === 0 || wIdx < 0
        ? weather
        : {
            ...weather,
            temp: weather.hourly.temp[wIdx] ?? weather.temp,
            windSpeed: weather.hourly.windSpeed[wIdx] ?? weather.windSpeed,
            windDirection: weather.hourly.windDirection[wIdx] ?? weather.windDirection,
            windGust: weather.hourly.windGust?.[wIdx] ?? weather.windGust,
          };

    const simMarine: MarineData =
      offset === 0 || mIdx < 0 || !marine.hourly
        ? marine
        : {
            ...marine,
            seaSurfaceTemp: marine.hourly.seaSurfaceTemp[mIdx] ?? marine.seaSurfaceTemp,
            waveHeight: marine.hourly.waveHeight[mIdx] ?? marine.waveHeight,
            currentVelocity: marine.hourly.currentVelocity[mIdx] ?? marine.currentVelocity,
            currentDirection: marine.hourly.currentDirection[mIdx] ?? marine.currentDirection,
          };

    const curvePt =
      tide.hourly72Curve?.find((c) => c.hour === nowHour + offset) ||
      tide.hourlyCurve?.find((c) => c.hour === tHour);
    const dayShift = Math.floor((nowHour + offset) / 24);
    const simMul = (((tide.mulNumber - 1 + dayShift) % 15) + 15) % 15 + 1;

    const simTide: TideDayInfo = {
      ...tide,
      mulNumber: simMul,
      hourlyCurve: curvePt ? [{ ...curvePt, hour: tHour }] : tide.hourlyCurve,
    };

    const res = calculateBiteScore(spot, simWeather, simMarine, simTide, favoriteSpecies, tDate);
    let adjustedScore = res.totalScore;
    if (curvePt?.isFeedingTime) adjustedScore = Math.min(100, adjustedScore + 4);

    const dayLabel = dayShift === 0 ? '오늘' : dayShift === 1 ? '내일' : '모레';
    const tideState = curvePt?.stateText || '조류 변화';
    const reason = curvePt?.isFeedingTime
      ? `${tideState} · ${curvePt.feedingLabel || '피딩골든'}`
      : `${tideState} · ${res.windRelation.split(' ')[0]}`;

    candidates.push({
      offsetHours: offset,
      timeLabel: `${dayLabel} ${hh}:00`,
      tideState,
      topSpeciesName: res.topSpecies?.speciesName || '대상어',
      score: adjustedScore,
      reason,
    });
  }

  // 점수순 정렬하되 서로 3시간 이상 떨어진 독립 피크 시간대 Top 3 선별
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const picked: GoldenWindow48h[] = [];
  for (const item of sorted) {
    if (picked.every((p) => Math.abs(p.offsetHours - item.offsetHours) >= 3)) {
      picked.push(item);
    }
    if (picked.length >= 3) break;
  }

  return picked;
}
