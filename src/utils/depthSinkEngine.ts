/**
 * 국립해양조사원 자연과학용 수심(dpwt, 평균해면하) + 실시간 조위(h, 기본수준면 기준)
 * 기준면(Datum) 보정 및 채비 안착 시간(Sink Time) 정밀 계산 엔진
 */

import type { SpotType } from '../types';

export interface RealWaterDepthInfo {
  mslDepth: number; // 평균해면하 자연과학 수심 (m, dpwt)
  datumZ0: number; // 기본수준면상 평균해면고 (m, Z0)
  chartedDepth: number; // 환산 해도수심 (m, DL 기준 = mslDepth - Z0)
  tideHeightCm: number; // 현재 조위 (cm, DL 기준)
  realDepthM: number; // 최종 실시간 유효 현장 수심 (m)
  isExposed: boolean; // 간출 여부 (물이 빠져 갯벌/간출암이 드러난 상태)
  statusText: string;
}

export interface UnifiedWaterDepthParams {
  spotLat: number;
  spotLng: number;
  targetLat?: number;
  targetLng?: number;
  spotType?: SpotType;
  khoaDpwt?: number | null;
  /** true이면 khoaDpwt가 이미 착수 지점(targetLat, targetLng)에서 조회된 수심이므로 원거리 경사 보너스를 중복 가산하지 않음 */
  khoaDpwtIsAtTarget?: boolean;
  datumZ0?: number;
  tideHeightCm?: number;
  pressureHpa?: number;
  isPredictedTide?: boolean;
}

export interface UnifiedWaterDepthResult extends RealWaterDepthInfo {
  isEstimatedFallback: boolean;
  meteoSurgeCm: number;
  castDistanceM: number;
}

/**
 * 올바른 실시간 현장 수심 계산:
 * D_real = (D_msl - Z0) + (tideHeightCm / 100)
 */
export function calculateRealWaterDepth(
  mslDepth: number,
  datumZ0: number,
  tideHeightCm: number
): RealWaterDepthInfo {
  const chartedDepth = Math.max(0, mslDepth - datumZ0);
  const tideM = tideHeightCm / 100;
  const rawRealDepth = (mslDepth - datumZ0) + tideM;

  const isExposed = rawRealDepth <= 0.1;
  const realDepthM = isExposed ? 0 : Math.round(rawRealDepth * 10) / 10;

  let statusText = '';
  if (isExposed) {
    statusText = '⚠️ 간출 상태 (간조로 갯벌/바닥 노출)';
  } else if (realDepthM < 2.0) {
    statusText = '얕은 여밭/모래턱 (초천해)';
  } else if (realDepthM < 6.0) {
    statusText = '연안 표준 낚시 수심대';
  } else if (realDepthM < 15.0) {
    statusText = '깊은 물골/직벽 수심대';
  } else {
    statusText = '심해/선상 본류대 수심';
  }

  return {
    mslDepth: Math.round(mslDepth * 10) / 10,
    datumZ0: Math.round(datumZ0 * 10) / 10,
    chartedDepth: Math.round(chartedDepth * 10) / 10,
    tideHeightCm,
    realDepthM,
    isExposed,
    statusText,
  };
}

/**
 * 봉돌 / 싱커 호수별 자유 침강 속도 (m/s)
 * - 바다 원투 묶음추/고리봉돌: 호수당 약 3.75g
 * - 루어 지그헤드 / 싱커: 온스(oz) 단위
 */
export interface SinkerSpec {
  name: string;
  weightG: number;
  sinkSpeedMPerS: number; // 무조류 자유 침강 속도 (m/s)
}

export const COMMON_SINKER_SPECS: Record<string, SinkerSpec> = {
  // 원투 낚시 봉돌
  '원투 16호 (60g)': { name: '원투 16호', weightG: 60, sinkSpeedMPerS: 1.1 },
  '원투 20호 (75g)': { name: '원투 20호', weightG: 75, sinkSpeedMPerS: 1.25 },
  '원투 25호 (94g)': { name: '원투 25호', weightG: 94, sinkSpeedMPerS: 1.35 },
  '원투 30호 (112g)': { name: '원투 30호', weightG: 112, sinkSpeedMPerS: 1.45 },
  '원투 35호 (131g)': { name: '원투 35호', weightG: 131, sinkSpeedMPerS: 1.55 },

  // 바다 루어 지그헤드 / 다운샷 싱커
  '지그헤드 1/8oz (3.5g)': { name: '1/8oz 지그헤드', weightG: 3.5, sinkSpeedMPerS: 0.35 },
  '지그헤드 1/4oz (7g)': { name: '1/4oz 지그헤드', weightG: 7, sinkSpeedMPerS: 0.5 },
  '지그헤드 3/8oz (10.5g)': { name: '3/8oz 지그헤드', weightG: 10.5, sinkSpeedMPerS: 0.65 },
  '지그헤드 1/2oz (14g)': { name: '1/2oz 지그헤드', weightG: 14, sinkSpeedMPerS: 0.8 },
  '다운샷 3/4oz (21g)': { name: '3/4oz 싱커', weightG: 21, sinkSpeedMPerS: 0.95 },
  '다운샷 1oz (28g)': { name: '1oz 싱커', weightG: 28, sinkSpeedMPerS: 1.1 },

  // 두족류 / 에깅
  '에기 3.5호 (20g)': { name: '에기 3.5호', weightG: 20, sinkSpeedMPerS: 0.33 }, // 3초/m
  '주꾸미 10호 (37.5g)': { name: '주꾸미 10호', weightG: 37.5, sinkSpeedMPerS: 0.95 },

  // 타이라바 / 메탈지그
  '타이라바 60g': { name: '타이라바 60g', weightG: 60, sinkSpeedMPerS: 1.3 },
  '메탈지그 30g': { name: '메탈지그 30g', weightG: 30, sinkSpeedMPerS: 1.2 },
};

/**
 * KHOA dpwt, 연안 지형 경사(캐스팅 비거리), 실시간/시뮬레이션 조위 및 역기압 효과를 통합한 단일 현장 수심 연산
 */
export function resolveUnifiedWaterDepth(params: UnifiedWaterDepthParams): UnifiedWaterDepthResult {
  const {
    spotLat,
    spotLng,
    targetLat,
    targetLng,
    spotType = 'ROCK',
    khoaDpwt,
    khoaDpwtIsAtTarget = false,
    datumZ0 = 2.0,
    tideHeightCm,
    pressureHpa,
    isPredictedTide = true,
  } = params;

  const castDistanceM =
    targetLat != null && targetLng != null
      ? Math.min(200, Math.round(Math.hypot((targetLat - spotLat) * 111000, (targetLng - spotLng) * 88800)))
      : 0;

  const slopeByType: Record<SpotType, number> = {
    ROCK: 0.08,
    SEAWALL: 0.06,
    BREAKWATER: 0.05,
    PIER: 0.025,
    BEACH: 0.018,
  };
  let slope = slopeByType[spotType] ?? 0.05;
  const isDeepEastOrJeju = spotLng > 129.0 || spotLat < 33.8;
  if (isDeepEastOrJeju) {
    slope *= 1.3;
  }

  const distSlopeBonusM = castDistanceM * slope;
  const hasValidDpwt = khoaDpwt != null && Number.isFinite(khoaDpwt) && khoaDpwt > 0;

  let mslDepth: number;
  if (hasValidDpwt) {
    mslDepth = (khoaDpwt as number) + (khoaDpwtIsAtTarget ? 0 : distSlopeBonusM);
  } else {
    const dlBaseByType: Record<SpotType, number> = {
      ROCK: 4.0,
      SEAWALL: 3.5,
      BREAKWATER: 4.5,
      PIER: 3.0,
      BEACH: 1.5,
    };
    const dlBase = (dlBaseByType[spotType] ?? 3.5) + (isDeepEastOrJeju ? 1.5 : 0);
    mslDepth = dlBase + datumZ0 + distSlopeBonusM;
  }

  // 천문/예측 조위 모드일 때만 역기압(1 hPa 하강 ≈ +1.01 cm) 보정 적용 (실측 조위에는 이미 포함됨)
  const meteoSurgeCm =
    isPredictedTide && pressureHpa != null && Number.isFinite(pressureHpa)
      ? Math.max(-35, Math.min(35, Math.round((1013.25 - pressureHpa) * 1.01 * 10) / 10))
      : 0;

  const baseTideCm = tideHeightCm != null && Number.isFinite(tideHeightCm) ? tideHeightCm : Math.round(datumZ0 * 100);
  const effectiveTideCm = Math.round(baseTideCm + meteoSurgeCm);

  const depthInfo = calculateRealWaterDepth(mslDepth, datumZ0, effectiveTideCm);

  // 해수욕장 원투(15m 이상 원거리 투척) 시 극단적 대조 간조가 아니면 서프존 최소 수심 하한(0.8m) 보존
  if (
    spotType === 'BEACH' &&
    castDistanceM >= 15 &&
    depthInfo.isExposed &&
    effectiveTideCm >= datumZ0 * 25
  ) {
    return {
      ...depthInfo,
      realDepthM: 0.8,
      isExposed: false,
      statusText: '얕은 모래톱/서프존 (최소 수심 보정)',
      isEstimatedFallback: !hasValidDpwt,
      meteoSurgeCm,
      castDistanceM,
    };
  }

  return {
    ...depthInfo,
    isEstimatedFallback: !hasValidDpwt,
    meteoSurgeCm,
    castDistanceM,
  };
}

/**
 * 실시간 수심 + 조류 유속 + 조류·캐스팅 상대방위각 + 봉돌 침강속도 기반 채비 바닥 안착 시간(초) 계산
 */
export function calculateSinkTimeToBottom(
  realDepthM: number,
  sinkerSpeedMPerS: number = 1.25,
  currentVelMPerS: number = 0.3,
  castBearingDeg?: number,
  currentDirectionDeg?: number
): {
  sinkSeconds: number;
  driftOffsetM: number;
  description: string;
  deltaThetaDeg?: number;
  canReachBottom?: boolean;
  recommendedMinWeightG?: number;
} {
  if (realDepthM <= 0.2) {
    return {
      sinkSeconds: 0,
      driftOffsetM: 0,
      description: '수심 극천해 (즉시 착저)',
      canReachBottom: true,
      recommendedMinWeightG: 2,
    };
  }

  let directionalFactor = 1.0;
  let deltaThetaDeg: number | undefined;
  if (castBearingDeg != null && currentDirectionDeg != null) {
    let diff = Math.abs(currentDirectionDeg - castBearingDeg) % 360;
    if (diff > 180) diff = 360 - diff;
    deltaThetaDeg = Math.round(diff);
    const rad = (diff * Math.PI) / 180;
    // 횡조류(sin)는 원줄 배부름 항력 증가, 뒷조류(cos > 0)는 텐션 부력 상승, 맞조류(cos < 0)는 슬랙라인
    directionalFactor = 1 + 0.18 * Math.sin(rad) + 0.12 * Math.cos(rad);
  }

  // 조류 유속 및 방향에 의한 침강 지연 (조류가 빠를수록 채비가 비스듬히 날려 수직 침강속도 저하)
  const effectiveCurrent = Math.max(0, currentVelMPerS) * directionalFactor;
  const driftFactor = Math.max(0.55, Math.cos(Math.min(1.05, effectiveCurrent / 1.5)));
  const effectiveSpeed = sinkerSpeedMPerS * driftFactor;

  const sinkSeconds = Math.max(1, Math.round((realDepthM / effectiveSpeed) * 10) / 10);
  const driftOffsetM = Math.round(Math.max(0, currentVelMPerS) * sinkSeconds * 10) / 10;
  const recommendedMinWeightG = Math.max(
    2,
    Math.ceil((realDepthM * 0.45 + effectiveCurrent * 9.0) * 2) / 2
  );
  const estWeightG = Math.pow(sinkerSpeedMPerS / 0.26, 2);
  const canReachBottom = estWeightG >= recommendedMinWeightG * 0.45 && sinkSeconds <= 90;

  return {
    sinkSeconds,
    driftOffsetM,
    description: `수심 ${realDepthM}m 기준 바닥 착저까지 약 ${sinkSeconds}초 소요 (조류에 의한 흘림 약 ${driftOffsetM}m)`,
    deltaThetaDeg,
    canReachBottom,
    recommendedMinWeightG,
  };
}
