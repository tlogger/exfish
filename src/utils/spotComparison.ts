// 출조 전 후보 포인트(2~5곳) 미래 시점(+0h~+48h) 0-API 비교 & 캐스팅 아크 상대 풍향·내 채비 공략 가능성 엔진
import type {
  CompareSortPreset,
  FishingSpot,
  MarineData,
  RelativeWindClass,
  SpotComparisonMetric,
  WeatherData,
} from '../types';
import {
  calculateAerodynamicCastingDrift,
  calculateSinkingPhysics,
  type TackleRigConfig,
} from './tackleCalibration';
import { calculateSwellRisk } from './weatherApi';

function describeWeatherCode(code: number): string {
  if (code === 0) return '맑음';
  if (code <= 3) return '구름 조금';
  if (code <= 48) return '안개/흐림';
  if (code <= 67) return '비';
  if (code <= 77) return '눈';
  return '소나기/뇌우';
}

const KOREAN_DIR_TO_DEG: Record<string, number> = {
  '북': 0, 'N': 0,
  '북동': 45, 'NE': 45,
  '동': 90, 'E': 90,
  '남동': 135, 'SE': 135,
  '남': 180, 'S': 180,
  '남서': 225, 'SW': 225,
  '서': 270, 'W': 270,
  '북서': 315, 'NW': 315,
};

/**
 * 0°/360° 경계를 안전하게 처리하는 시계방향 캐스팅 아크 원형 중점 산출
 * (예: 315° ~ 45° -> 0°, 45° ~ 135° -> 90°)
 * casting_start_deg/end_deg 미설정 시 레거시 casting_directions 평균 방위각으로 폴백
 */
export function resolveCastCenterDeg(spot: Pick<FishingSpot, 'casting_start_deg' | 'casting_end_deg' | 'casting_directions'>): number | null {
  if (typeof spot.casting_start_deg === 'number' && typeof spot.casting_end_deg === 'number') {
    const start = ((spot.casting_start_deg % 360) + 360) % 360;
    const end = ((spot.casting_end_deg % 360) + 360) % 360;
    const span = (end - start + 360) % 360;
    return Math.round((start + span / 2) % 360);
  }

  if (Array.isArray(spot.casting_directions) && spot.casting_directions.length > 0) {
    let sinSum = 0;
    let cosSum = 0;
    let count = 0;
    for (const dir of spot.casting_directions) {
      const deg = KOREAN_DIR_TO_DEG[String(dir).trim()];
      if (deg != null) {
        const rad = (deg * Math.PI) / 180;
        sinSum += Math.sin(rad);
        cosSum += Math.cos(rad);
        count++;
      }
    }
    if (count > 0 && (Math.abs(sinSum) > 1e-6 || Math.abs(cosSum) > 1e-6)) {
      const avg = (Math.atan2(sinSum, cosSum) * 180) / Math.PI;
      return Math.round(((avg % 360) + 360) % 360);
    }
  }

  return null;
}

/**
 * 두 방위각(0~359°) 간 최소 사잇각 (0~180°)
 */
export function minimalAngleDiffDeg(a: number, b: number): number {
  const diff = Math.abs((((a - b) % 360) + 360) % 360);
  return diff > 180 ? 360 - diff : diff;
}

/**
 * windDirectionDeg(바람이 불어오는 방위 From) 기준 캐스팅 아크 상대 풍향 분류
 * - 사잇각 <= 60°: 맞바람 (HEADWIND)
 * - 60° < 사잇각 < 120°: 옆바람 (CROSSWIND)
 * - 사잇각 >= 120°: 등바람 (TAILWIND)
 */
export function classifyRelativeWind(
  castCenterDeg: number | null,
  windDirectionFromDeg: number
): { angleDiff: number | null; windClass: RelativeWindClass } {
  if (castCenterDeg == null) {
    return { angleDiff: null, windClass: 'NO_ARC' };
  }
  const angleDiff = Math.round(minimalAngleDiffDeg(castCenterDeg, windDirectionFromDeg));
  if (angleDiff <= 60) return { angleDiff, windClass: 'HEADWIND' };
  if (angleDiff >= 120) return { angleDiff, windClass: 'TAILWIND' };
  return { angleDiff, windClass: 'CROSSWIND' };
}

export function getRelativeWindLabel(windClass: RelativeWindClass): string {
  switch (windClass) {
    case 'TAILWIND': return '등바람';
    case 'CROSSWIND': return '옆바람';
    case 'HEADWIND': return '맞바람';
    case 'NO_ARC': return '아크 미설정';
  }
}

/**
 * 이미 로드된 96시간 WeatherData/MarineData에서 offsetHours(+0h~+48h) 시점의
 * 비교 지표를 추가 API 호출 0회(<5ms 로컬 동기 연산)로 계산합니다.
 */
export function computeSpotComparisonMetric(params: {
  spot: FishingSpot;
  weather: WeatherData;
  marine: MarineData;
  offsetHours: number;
  rig: TackleRigConfig;
  depthMeters?: number | null;
  biteScore?: number;
  now?: Date;
}): SpotComparisonMetric {
  const { spot, weather, marine, offsetHours, rig, depthMeters, biteScore = 50, now = new Date() } = params;
  const clampedOffset = Math.max(0, Math.min(72, Math.floor(offsetHours)));
  const targetDate = new Date(now.getTime() + clampedOffset * 60 * 60 * 1000);
  const currentHour = now.getHours();
  const idx = Math.max(0, Math.min((weather.hourly?.time?.length || 1) - 1, currentHour + clampedOffset));

  const windSpeedMs = weather.hourly?.windSpeed?.[idx] ?? weather.windSpeed ?? 0;
  const windDirectionDeg = weather.hourly?.windDirection?.[idx] ?? weather.windDirection ?? 0;
  const airTempC = weather.hourly?.temp?.[idx] ?? weather.temp ?? 15;
  const weatherCode = weather.hourly?.weatherCode?.[idx] ?? weather.weatherCode ?? 0;
  const weatherText = weather.weatherText || describeWeatherCode(weatherCode);

  const mIdx = Math.max(0, Math.min((marine.hourly?.time?.length || 1) - 1, currentHour + clampedOffset));
  const waveHeightM = marine.hourly?.waveHeight?.[mIdx] ?? marine.waveHeight ?? 0.5;
  const wavePeriodS = marine.hourly?.wavePeriod?.[mIdx] ?? marine.wavePeriod ?? 5.0;
  const waterTempC = marine.hourly?.seaSurfaceTemp?.[mIdx] ?? marine.seaSurfaceTemp ?? 16.0;
  const currentVelocityMs = marine.hourly?.currentVelocity?.[mIdx] ?? marine.currentVelocity ?? 0.25;
  const currentDirectionDeg = marine.hourly?.currentDirection?.[mIdx] ?? marine.currentDirection ?? 180;

  const swell = calculateSwellRisk(waveHeightM, wavePeriodS);
  const castCenterDeg = resolveCastCenterDeg(spot);
  const { angleDiff, windClass } = classifyRelativeWind(castCenterDeg, windDirectionDeg);

  // 내 채비 기준 공략 가능성 계산
  let castDistanceDeltaM: number | null = null;
  let actualCastDistanceM: number | null = null;
  if (castCenterDeg != null) {
    const drift = calculateAerodynamicCastingDrift(
      castCenterDeg,
      rig.calibratedDistanceMeters,
      windSpeedMs,
      windDirectionDeg,
      rig.weightGrams,
      rig.peLineSize,
      rig.baitConfig.lengthInches,
      rig.baitConfig
    );
    actualCastDistanceM = Math.round(drift.actualDistanceM);
    castDistanceDeltaM = Math.round(drift.actualDistanceM - rig.calibratedDistanceMeters);
  }

  let canReachBottom: boolean | null = null;
  let fallTimeSec: number | null = null;
  let recommendedMinWeightG: number | null = null;
  const validDepth = depthMeters != null && Number.isFinite(depthMeters) && depthMeters > 0 ? depthMeters : null;

  if (validDepth != null) {
    const sink = calculateSinkingPhysics(rig.weightGrams, validDepth, currentVelocityMs, rig.baitConfig, {
      castBearingDeg: castCenterDeg ?? undefined,
      currentDirectionDeg,
      peLineSize: rig.peLineSize,
    });
    canReachBottom = sink.canReachBottom ?? null;
    fallTimeSec = sink.fallTimeSec != null ? Math.round(sink.fallTimeSec) : null;
    recommendedMinWeightG = sink.recommendedMinWeightG ?? null;
  }

  const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
  const dd = String(targetDate.getDate()).padStart(2, '0');
  const hh = String(targetDate.getHours()).padStart(2, '0');

  return {
    spot,
    offsetHours: clampedOffset,
    targetTimeLabel: `${mm}/${dd} ${hh}:00`,
    windSpeedMs: Math.round(windSpeedMs * 10) / 10,
    windDirectionDeg: Math.round(windDirectionDeg),
    castCenterDeg,
    relativeWindAngleDeg: angleDiff,
    relativeWindClass: windClass,
    waveHeightM: Math.round(waveHeightM * 10) / 10,
    wavePeriodS: Math.round(wavePeriodS * 10) / 10,
    swellEnergy: swell.energyScore,
    currentVelocityMs: Math.round(currentVelocityMs * 100) / 100,
    currentDirectionDeg: Math.round(currentDirectionDeg),
    waterTempC: Math.round(waterTempC * 10) / 10,
    airTempC: Math.round(airTempC * 10) / 10,
    weatherText,
    biteScore,
    castDistanceDeltaM,
    actualCastDistanceM,
    depthM: validDepth,
    canReachBottom,
    fallTimeSec,
    recommendedMinWeightG,
  };
}

function getWindAvoidScore(m: SpotComparisonMetric): number {
  const classScore = m.relativeWindClass === 'TAILWIND'
    ? 100
    : m.relativeWindClass === 'CROSSWIND'
      ? 60
      : m.relativeWindClass === 'HEADWIND'
        ? 15
        : 35; // NO_ARC는 등바람/옆바람보다 하단 배치
  const speedPenalty = Math.min(40, m.windSpeedMs * 3.5);
  return Math.max(0, classScore - (m.relativeWindClass === 'TAILWIND' ? speedPenalty * 0.3 : speedPenalty));
}

function getSwellSafeScore(m: SpotComparisonMetric): number {
  return Math.max(0, 100 - m.swellEnergy * 7 - m.waveHeightM * 15);
}

/**
 * 4종 1탭 정렬 성향 프리셋 적용
 */
export function sortComparisonMetrics(
  metrics: SpotComparisonMetric[],
  preset: CompareSortPreset
): SpotComparisonMetric[] {
  return [...metrics].sort((a, b) => {
    if (a.error && !b.error) return 1;
    if (!a.error && b.error) return -1;

    if (preset === 'WIND_AVOID') {
      return getWindAvoidScore(b) - getWindAvoidScore(a);
    }
    if (preset === 'SWELL_SAFE') {
      return getSwellSafeScore(b) - getSwellSafeScore(a);
    }
    if (preset === 'BITE_ACTIVE') {
      return b.biteScore - a.biteScore;
    }
    // BALANCED: 상대풍향 35% + 너울안전 30% + 입질점수 35%
    const scoreA = getWindAvoidScore(a) * 0.35 + getSwellSafeScore(a) * 0.30 + a.biteScore * 0.35;
    const scoreB = getWindAvoidScore(b) * 0.35 + getSwellSafeScore(b) * 0.30 + b.biteScore * 0.35;
    return scoreB - scoreA;
  });
}
