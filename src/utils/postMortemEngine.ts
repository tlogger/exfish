// ExFish AI 꽝 사후 복기 엔진 (Post-Mortem Analysis Engine)
// 슬로건: "ex-gf, ex-wife, and ex-fish. 떠나버린 물고기를 기리며..."
// 정밀 환경·수중 물리 벡터 기반 실패 기여도(%) 및 차기 공략 전술 도출

import type {
  WeatherData,
  MarineData,
  TideDayInfo,
  BiteScoreBreakdown,
  SpotType,
  FishingMethod,
} from '../types';
import {
  SPECIES_ENCYCLOPEDIA,
  type CoastRegion,
  type SpeciesEcology,
} from './speciesDatabase';
import {
  calculateSinkingPhysics,
  getBaitSpecs,
  type BaitConfig,
  type TackleRigConfig,
} from './tackleCalibration';

export interface PostMortemInput {
  targetSpecies: string;
  catchTime: string; // HH:mm
  weather: WeatherData | null;
  marine: MarineData | null;
  tide: TideDayInfo | null;
  biteScore: BiteScoreBreakdown | null;
  castingBearingDeg?: number; // 공략 중심 방위각 (0~359)
  // === 정밀 물리/생태 컨텍스트 (선택, 하위 호환) ===
  lat?: number;
  lng?: number;
  region?: CoastRegion;
  spotType?: SpotType;
  depthMeters?: number;
  catchMethod?: FishingMethod;
  lureBait?: string;
  tackleSnapshot?: Partial<TackleRigConfig> | null;
  mulTextOverride?: string;
}

export interface FactorContribution {
  id: string;
  name: string;
  contributionPercent: number; // 0 ~ 100
  metricLabel: string;
  description: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface PostMortemReport {
  isSkunk: true;
  summary: string;
  topFactors: FactorContribution[];
  allFactors: FactorContribution[];
  tacticalAdvice: string;
  calculatedAt: string;
}

interface ResolvedSpeciesProfile {
  name: string;
  minTemp: number;
  optMinTemp: number;
  optMaxTemp: number;
  maxTemp: number;
  optTemp: number;
  waterLayer: 'SURFACE' | 'MID' | 'BOTTOM' | 'ALL';
  category: SpeciesEcology['category'] | 'UNKNOWN';
  currentPref: SpeciesEcology['currentPref'];
  isDemersal: boolean;
  isSightClearPreferred: boolean;
  isTurbidTolerant: boolean;
}

function resolveSpeciesProfile(targetSpecies: string): ResolvedSpeciesProfile {
  const rawName = (targetSpecies || '').trim();
  let eco: SpeciesEcology | undefined = SPECIES_ENCYCLOPEDIA[rawName];
  if (!eco && rawName) {
    const matchedKey = Object.keys(SPECIES_ENCYCLOPEDIA).find(
      (k) => k.includes(rawName) || rawName.includes(k)
    );
    if (matchedKey) eco = SPECIES_ENCYCLOPEDIA[matchedKey];
  }

  const name = eco?.name || rawName || '대상어';
  const minTemp = eco?.tempRange.min ?? 10;
  const optMinTemp = eco?.tempRange.optMin ?? 13;
  const optMaxTemp = eco?.tempRange.optMax ?? 21;
  const maxTemp = eco?.tempRange.max ?? 24;
  const optTemp = Math.round(((optMinTemp + optMaxTemp) / 2) * 10) / 10;
  const waterLayer = eco?.waterLayer ?? 'BOTTOM';
  const category = eco?.category ?? 'UNKNOWN';
  const currentPref = eco?.currentPref ?? 'MODERATE';

  const isDemersal =
    waterLayer === 'BOTTOM' ||
    category === 'BENTHIC' ||
    (category === 'ROCKFISH' && !/볼락/.test(name));

  const isSightClearPreferred =
    category === 'CEPHALOPOD' ||
    /볼락|전갱이|고등어|삼치|광어|방어|부시리|벵에돔|학꽁치/.test(name);

  const isTurbidTolerant =
    /감성돔|농어|붕장어|숭어|망둥어|민어/.test(name);

  return {
    name,
    minTemp,
    optMinTemp,
    optMaxTemp,
    maxTemp,
    optTemp,
    waterLayer,
    category,
    currentPref,
    isDemersal,
    isSightClearPreferred,
    isTurbidTolerant,
  };
}

function inferRegion(lat?: number, lng?: number, region?: CoastRegion): CoastRegion {
  if (region) return region;
  if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    if (lat < 33.6) return 'JEJU';
    if (lng > 128.8 && lat > 35.2) return 'EAST';
    if (lng < 126.9 && lat > 34.4) return 'WEST';
    return 'SOUTH';
  }
  return 'WEST';
}

function inferDepthMeters(spotType?: SpotType, depthMeters?: number): number {
  if (depthMeters != null && Number.isFinite(depthMeters) && depthMeters > 0) {
    return depthMeters;
  }
  switch (spotType) {
    case 'ROCK':
      return 6.0;
    case 'BREAKWATER':
      return 7.0;
    case 'SEAWALL':
      return 5.0;
    case 'PIER':
      return 4.5;
    case 'BEACH':
      return 2.5;
    default:
      return 5.5;
  }
}

/**
 * 채비 스냅샷 또는 루어/미끼 문자열("지그헤드 1/4oz", "14g", "원투 30호", "에기 3.5호")에서 유효 침강 무게(g) 추론
 */
export function inferRigWeightGrams(
  tackleSnapshot?: Partial<TackleRigConfig> | null,
  lureBait?: string,
  catchMethod?: FishingMethod
): { weightGrams: number; baitConfig: BaitConfig; label: string } {
  if (tackleSnapshot?.weightGrams && tackleSnapshot.weightGrams > 0) {
    const bait = tackleSnapshot.baitConfig ?? getBaitSpecs(catchMethod === 'SURF' ? 'LIVE' : 'LURE', 2, 'GRUB');
    return {
      weightGrams: tackleSnapshot.weightGrams,
      baitConfig: bait,
      label: `${tackleSnapshot.weightGrams}g`,
    };
  }

  const text = (lureBait || '').trim();
  if (text) {
    // 1. 분수 온스 (예: 1/8oz, 3/8oz, 1/2oz, 3/4oz)
    const fracOz = text.match(/(\d+)\s*\/\s*(\d+)\s*oz/i);
    if (fracOz) {
      const num = parseFloat(fracOz[1]);
      const den = parseFloat(fracOz[2]);
      if (den > 0) {
        const g = Math.round((num / den) * 28.3495 * 10) / 10;
        return {
          weightGrams: g,
          baitConfig: getBaitSpecs('LURE', 2, 'GRUB'),
          label: `${fracOz[1]}/${fracOz[2]}oz (${g}g)`,
        };
      }
    }

    // 2. 소수/정수 온스 (예: 1oz, 0.5oz)
    const decOz = text.match(/(\d+(?:\.\d+)?)\s*oz/i);
    if (decOz) {
      const oz = parseFloat(decOz[1]);
      if (oz > 0) {
        const g = Math.round(oz * 28.3495 * 10) / 10;
        return {
          weightGrams: g,
          baitConfig: getBaitSpecs('LURE', 2, 'GRUB'),
          label: `${oz}oz (${g}g)`,
        };
      }
    }

    // 3. 그램 (예: 14g, 3.5g, 30g)
    const gramMatch = text.match(/(\d+(?:\.\d+)?)\s*g\b/i);
    if (gramMatch) {
      const g = parseFloat(gramMatch[1]);
      if (g > 0) {
        const isMetal = /메탈|지그(?!헤드)/.test(text);
        return {
          weightGrams: g,
          baitConfig: isMetal ? getBaitSpecs('METAL', 2, 'STRAIGHT', 6, 3, 1, g) : getBaitSpecs('LURE', 2, 'GRUB'),
          label: `${g}g`,
        };
      }
    }

    // 4. 호수 (에기 vs 봉돌/주꾸미)
    const hoMatch = text.match(/(\d+(?:\.\d+)?)\s*호/);
    if (hoMatch) {
      const ho = parseFloat(hoMatch[1]);
      if (ho > 0) {
        if (/에기/.test(text)) {
          const egiG = Math.round(Math.max(6.5, ho * 5.5) * 10) / 10;
          return {
            weightGrams: egiG,
            baitConfig: getBaitSpecs('LURE', 2, 'STRAIGHT', 6, 3, 1, 20, 'JUKKUMI', 'REAL_BALL', undefined, egiG, 0),
            label: `에기 ${ho}호`,
          };
        }
        const sinkerG = Math.round(ho * 3.75 * 10) / 10;
        return {
          weightGrams: sinkerG,
          baitConfig: getBaitSpecs(catchMethod === 'SURF' ? 'LIVE' : 'LURE', 2, 'GRUB'),
          label: `${ho}호 (${sinkerG}g)`,
        };
      }
    }
  }

  // 기본 채비 무게 (미입력 시)
  if (catchMethod === 'SURF') {
    return { weightGrams: 75, baitConfig: getBaitSpecs('LIVE', 2, 'GRUB'), label: '원투 기본(75g)' };
  }
  if (catchMethod === 'FLOAT') {
    return { weightGrams: 5.0, baitConfig: getBaitSpecs('LURE', 2, 'STRAIGHT'), label: '찌낚 기본(5g)' };
  }
  return { weightGrams: 10.5, baitConfig: getBaitSpecs('LURE', 2, 'GRUB'), label: '루어 기본(3/8oz)' };
}

function resolveTidePhase(tide: TideDayInfo | null, mulTextOverride?: string): {
  mulNumber: number | null;
  mulText: string;
  isSpringTide: boolean;
  isPeakSpringTide: boolean;
  isNeapTide: boolean;
  isMildNeapTide: boolean;
} {
  const mulText = (mulTextOverride || tide?.mulText || '').trim();
  let mulNumber: number | null = tide?.mulNumber ?? null;

  if (mulTextOverride) {
    const parsed = mulTextOverride.match(/(\d+)\s*물/);
    if (parsed) {
      mulNumber = parseInt(parsed[1], 10);
    } else if (mulTextOverride.includes('조금')) {
      mulNumber = 15;
    } else if (mulTextOverride.includes('무시')) {
      mulNumber = 1;
    } else if (mulTextOverride.includes('사리')) {
      mulNumber = 8;
    }
  } else if (mulNumber == null && mulText) {
    const parsed = mulText.match(/(\d+)\s*물/);
    if (parsed) mulNumber = parseInt(parsed[1], 10);
  }

  const isSpringTide =
    (mulNumber != null && mulNumber >= 6 && mulNumber <= 10) ||
    mulText.includes('사리');
  const isPeakSpringTide =
    (mulNumber != null && mulNumber >= 7 && mulNumber <= 9) ||
    mulText.includes('사리');
  const isNeapTide =
    mulText.includes('조금') ||
    mulText.includes('무시') ||
    mulText.includes('1물') ||
    mulText.includes('15물') ||
    mulNumber === 1 ||
    mulNumber === 15;
  const isMildNeapTide =
    !isNeapTide &&
    (mulText.includes('2물') ||
      mulText.includes('14물') ||
      mulNumber === 2 ||
      mulNumber === 14);

  return {
    mulNumber,
    mulText: mulText || '물때 정보 없음',
    isSpringTide,
    isPeakSpringTide,
    isNeapTide,
    isMildNeapTide,
  };
}

/**
 * 정밀 환경·수중 물리 벡터 기반 꽝 원인 분해 및 사후 복기 리포트 생성
 */
export function generatePostMortemReport(input: PostMortemInput): PostMortemReport {
  const {
    targetSpecies,
    weather,
    marine,
    tide,
    biteScore: _biteScore,
    castingBearingDeg = 180,
    lat,
    lng,
    region: inputRegion,
    spotType,
    depthMeters,
    catchMethod,
    lureBait,
    tackleSnapshot,
    mulTextOverride,
  } = input;

  const species = resolveSpeciesProfile(targetSpecies);
  const region = inferRegion(lat, lng, inputRegion);
  const depthM = inferDepthMeters(spotType, depthMeters);
  const tidePhase = resolveTidePhase(tide, mulTextOverride);

  const currentTemp = marine?.seaSurfaceTemp ?? 16.0;
  const currentWave = marine?.waveHeight ?? 0.8;
  const currentPeriod = marine?.wavePeriod ?? 6.0;
  // marine.currentVelocity는 m/s 단위이므로 knot 임계값 판정을 위해 1 m/s = 1.94384 kt 변환
  const rawCurrentMps = Math.min(3.0, Math.max(0, marine?.currentVelocity ?? 0.3));
  const currentCurrentKt = rawCurrentMps * 1.94384;
  const currentDirectionDeg = marine?.currentDirection;
  const currentWindSpeed = weather?.windSpeed ?? 4.0; // m/s
  const currentWindDir = weather?.windDirection ?? 0; // deg

  // 1. 수온 적정성 괴리 지수 (Delta T — 38개 어종 생태 DB 기준)
  let tempRaw = 0;
  if (currentTemp < species.minTemp) {
    tempRaw = (species.minTemp - currentTemp) * 18 + 22;
  } else if (currentTemp < species.optMinTemp) {
    tempRaw = (species.optMinTemp - currentTemp) * 9 + 6;
  } else if (currentTemp > species.maxTemp) {
    tempRaw = (currentTemp - species.maxTemp) * 15 + 18;
  } else if (currentTemp > species.optMaxTemp) {
    tempRaw = (currentTemp - species.optMaxTemp) * 8 + 6;
  } else {
    tempRaw = Math.abs(currentTemp - species.optTemp) * 2.5;
  }

  // 2. 냉수대/수온 급강하율 (북서/북동 강풍 시 표층수 외해 유출 반영)
  const isNorthWind = currentWindDir >= 300 || currentWindDir <= 45;
  const isColdSurge = isNorthWind && currentWindSpeed >= 6.0;
  const coldSurgeRaw = isColdSurge ? 28 : currentWindSpeed >= 8.5 ? 16 : 4;

  // 3. 조류 정체율 (순수 저유속·물돌이 정체만 평가, 어종 유속 선호도 반영)
  let stagnationBase = 4;
  if (currentCurrentKt < 0.25) {
    stagnationBase = 36; // 조류 완전 멈춤
  } else if (currentCurrentKt < 0.5) {
    stagnationBase = 20; // 완류 정체
  }
  const stagnationPrefMul =
    species.currentPref === 'STRONG' ? 1.2 : species.currentPref === 'SLACK_GENTLE' ? 0.5 : 1.0;
  const currentStagnationRaw = Math.round(stagnationBase * stagnationPrefMul * 10) / 10;

  // 4. 강조류 채비 안착 불량 및 바닥 감도 상실 (저서 어류 핵심 물리 요인)
  const rigInfo = inferRigWeightGrams(tackleSnapshot, lureBait, catchMethod);
  const sinkPhysics = calculateSinkingPhysics(
    rigInfo.weightGrams,
    depthM,
    rawCurrentMps,
    rigInfo.baitConfig,
    {
      castBearingDeg: castingBearingDeg,
      currentDirectionDeg,
      peLineSize: tackleSnapshot?.peLineSize,
    }
  );

  let bottomLossBase = 3;
  if (rawCurrentMps >= 0.4) {
    if (rawCurrentMps < 0.6) {
      // 0.40~0.60 m/s (0.78~1.17 kt): 바닥 감도 둔화 시작
      bottomLossBase = 14 + ((rawCurrentMps - 0.4) / 0.2) * 14;
    } else if (rawCurrentMps < 0.9) {
      // 0.60~0.90 m/s (1.17~1.75 kt): 채비 부상·흘림 심화
      bottomLossBase = 28 + ((rawCurrentMps - 0.6) / 0.3) * 14;
    } else {
      // 0.90 m/s+ (1.75 kt+): 격류 안착 극히 곤란
      bottomLossBase = Math.min(54, 42 + (rawCurrentMps - 0.9) * 18);
    }
  }

  const recMinG = sinkPhysics.recommendedMinWeightG ?? 8;
  const weightDeficitRatio = recMinG / Math.max(1, rigInfo.weightGrams);
  const cannotReachBottom = sinkPhysics.canReachBottom === false;

  if (cannotReachBottom && rawCurrentMps >= 0.35) {
    bottomLossBase = Math.max(bottomLossBase, 38) + 12;
  } else if (weightDeficitRatio > 1.15 && rawCurrentMps >= 0.35) {
    bottomLossBase += Math.min(16, (weightDeficitRatio - 1.15) * 14);
  }

  if (sinkPhysics.driftDistanceM >= 10 && rawCurrentMps >= 0.4) {
    bottomLossBase += Math.min(10, (sinkPhysics.driftDistanceM - 10) * 0.7);
  }

  const demersalMultiplier = species.isDemersal
    ? species.currentPref === 'SLACK_GENTLE'
      ? 1.35
      : species.currentPref === 'MODERATE'
      ? 1.25
      : 0.95
    : 0.3;

  const bottomLossRaw = Math.round(bottomLossBase * demersalMultiplier * 10) / 10;

  // 5. 사리 기간 물 뒤집힘·탁수 시야 저하
  const turbidityVelThreshold =
    region === 'WEST' ? 0.28 : region === 'EAST' ? 0.5 : 0.38;
  const isWaterOverturned = tidePhase.isSpringTide && rawCurrentMps >= turbidityVelThreshold;
  const isSevereOverturn =
    tidePhase.isPeakSpringTide &&
    (rawCurrentMps >= turbidityVelThreshold + 0.22 || currentWave >= 0.9);

  let turbidityBase = 3;
  if (isWaterOverturned) {
    const velExcess = Math.max(0, rawCurrentMps - turbidityVelThreshold);
    const peakBonus = tidePhase.isPeakSpringTide ? 8 : 0;
    const waveStirBonus = currentWave >= 1.1 ? 12 : currentWave >= 0.7 ? 7 : 0;
    turbidityBase = Math.min(48, 20 + peakBonus + velExcess * 32 + waveStirBonus);
  } else if (tidePhase.isSpringTide) {
    // 사리 기간이나 현재 물돌이 구간: 잔류 부유물 영향
    turbidityBase = currentWave >= 0.9 ? 16 : 10;
  }

  const turbiditySpeciesMul = species.isSightClearPreferred
    ? 1.3
    : species.isTurbidTolerant
    ? isSevereOverturn
      ? 0.85
      : 0.55
    : 1.0;
  const springTurbidityRaw = Math.round(turbidityBase * turbiditySpeciesMul * 10) / 10;

  // 6. 바람·라인 슬랙 영향 (보조 요인 — 맞바람 안착 페널티 대폭 하향)
  const windVectorDeg = (currentWindDir + 180) % 360;
  const rawWindDiff = Math.abs(windVectorDeg - castingBearingDeg) % 360;
  const windAngleDiff = rawWindDiff > 180 ? 360 - rawWindDiff : rawWindDiff;
  const isHeadwind = windAngleDiff > 120;
  const headwindFactor = Math.max(0, Math.cos((windAngleDiff * Math.PI) / 180) * -1);
  let headwindRaw = 3;
  if (isHeadwind) {
    if (currentWindSpeed <= 7.0) {
      // 일반 맞바람: 비거리 일부 손실 정도의 경미 보조 요인 (2~8점)
      headwindRaw = Math.min(8, Math.max(2, currentWindSpeed * headwindFactor * 1.1 + 1.5));
    } else {
      // 7m/s 초과 강풍 맞바람: 완만 증가하되 최대 18점 상한
      headwindRaw = Math.min(18, 8 + (currentWindSpeed - 7.0) * headwindFactor * 2.2);
    }
  } else if (currentWindSpeed >= 9.0) {
    headwindRaw = Math.min(14, 6 + (currentWindSpeed - 9.0) * 1.8);
  } else if (currentWindSpeed >= 7.0) {
    headwindRaw = 5;
  }
  headwindRaw = Math.round(headwindRaw * 10) / 10;

  // 7. 정체 물때 페널티 (조금, 무시, 1물, 15물 등)
  let tideRaw = 6;
  if (tidePhase.isNeapTide) {
    tideRaw = species.currentPref === 'SLACK_GENTLE' ? 14 : 32;
  } else if (tidePhase.isMildNeapTide) {
    tideRaw = species.currentPref === 'SLACK_GENTLE' ? 10 : 20;
  }

  // 8. 너울성 파고 및 파주기 계수 (Swell Index = WaveHeight * WavePeriod)
  const swellIndex = currentWave * currentPeriod;
  let swellRaw = 6;
  if (swellIndex >= 11.0 || currentWave >= 1.6) {
    swellRaw = 38; // 치명적 너울 및 포말·액션 붕괴
  } else if (swellIndex >= 6.5 || currentWave >= 1.1) {
    swellRaw = 20; // 너울성 파도로 미끼 액션 불안정
  }

  // 9. 피딩 타임 불일치 (골든타임 벗어남)
  const catchHourVal = (() => {
    if (!input.catchTime || !input.catchTime.includes(':')) return null;
    const [hh, mm] = input.catchTime.split(':').map(Number);
    return Number.isFinite(hh) && Number.isFinite(mm) ? hh + mm / 60 : null;
  })();
  const isFeedingTime =
    tide?.feedingTimes?.some((f) => {
      if (catchHourVal !== null && f.startHour != null && f.endHour != null) {
        if (f.startHour <= f.endHour) {
          return catchHourVal >= f.startHour && catchHourVal <= f.endHour;
        }
        return catchHourVal >= f.startHour || catchHourVal <= f.endHour;
      }
      return f.label.includes('현재') || f.label.includes('피딩') || f.label.includes('골든');
    }) || false;
  const feedingRaw = isFeedingTime ? 4 : 22;

  const regionKor =
    region === 'WEST' ? '서해' : region === 'SOUTH' ? '남해' : region === 'EAST' ? '동해' : '제주';

  // 총합 및 기여도(%) 정규화
  const rawFactors = [
    {
      id: 'temp_deviation',
      name: '수온 괴리 및 활성 저하',
      raw: tempRaw,
      metricLabel: `${currentTemp.toFixed(1)}°C (적정 ${species.optMinTemp}~${species.optMaxTemp}°C)`,
      description:
        currentTemp < species.minTemp
          ? `${species.name} 생존·활성 하한선(${species.minTemp}°C) 미만으로 대사율이 급감하고 깊은 은신처로 침잠했습니다.`
          : currentTemp < species.optMinTemp
          ? `${species.name} 최적 수온(${species.optMinTemp}~${species.optMaxTemp}°C)보다 낮아 입질 빈도와 추격 반경이 축소되었습니다.`
          : `최적 수온(${species.optMinTemp}~${species.optMaxTemp}°C)과의 괴리로 먹이 사냥 활동이 둔화되었습니다.`,
    },
    {
      id: 'cold_surge',
      name: '북풍계열 표층수 역전·수온 급강하',
      raw: coldSurgeRaw,
      metricLabel: `풍속 ${currentWindSpeed.toFixed(1)}m/s${isNorthWind ? ', 북풍계열' : ''}`,
      description: isColdSurge
        ? '강한 북풍계열 바람으로 표층수가 밀려나며 급격한 수온 저하가 발생해 바닥층 어류의 입질이 위축되었습니다.'
        : '급격한 기상성 냉수대 유입 징후는 제한적이었습니다.',
    },
    {
      id: 'current_stagnation',
      name: '조류 정체 및 유속 부족',
      raw: currentStagnationRaw,
      metricLabel: `유속 ${currentCurrentKt.toFixed(2)}kt (${rawCurrentMps.toFixed(2)}m/s)`,
      description:
        currentCurrentKt < 0.25
          ? '조류가 거의 멈춘 정체 구간으로 베이트피시 유입이 끊기고 대상어의 경계심이 극대화되었습니다.'
          : currentCurrentKt < 0.5
          ? '완만한 약류 구간으로 먹이 유입량이 부족해 활성도가 낮게 유지되었습니다.'
          : '유속 부족으로 인한 조류 정체 영향은 낮았습니다.',
    },
    {
      id: 'current_bottom_loss',
      name: species.isDemersal
        ? '강조류 채비 안착 불량·바닥 감도 상실'
        : '강조류 채비 흘림 및 수층 이탈',
      raw: bottomLossRaw,
      metricLabel: `유속 ${currentCurrentKt.toFixed(2)}kt · 흘림 ${sinkPhysics.driftDistanceM.toFixed(1)}m · 권장 ≥${recMinG}g`,
      description: species.isDemersal
        ? cannotReachBottom || rawCurrentMps >= 0.45
          ? `빠른 유속(${currentCurrentKt.toFixed(2)}kt)에서 ${rigInfo.label} 채비가 바닥에 안정적으로 안착하지 못하고 떠내려가(${sinkPhysics.driftDistanceM.toFixed(1)}m 흘림), 바닥을 느끼기 어려워 저서 어종(${species.name}) 공략 효율이 급감했습니다.`
          : `현재 유속(${currentCurrentKt.toFixed(2)}kt)에서 ${rigInfo.label} 채비의 바닥 안착은 비교적 양호했습니다.`
        : `대상어(${species.name})는 중·표층 어종으로 바닥 안착 불량의 직접 영향은 제한적입니다.`,
    },
    {
      id: 'spring_turbidity',
      name: '사리 물 뒤집힘·탁수 시야 저하',
      raw: springTurbidityRaw,
      metricLabel: `${tidePhase.mulText} · ${regionKor} 유속 ${rawCurrentMps.toFixed(2)}m/s`,
      description: isWaterOverturned
        ? `사리 기간(${tidePhase.mulText})의 강한 조석 혼합으로 ${regionKor} 바닥 펄·부유물이 뒤집혀 물색이 탁해지면서 ${species.name}의 시야 확보와 입질 반응이 크게 감소했습니다.`
        : tidePhase.isSpringTide
        ? `사리 기간(${tidePhase.mulText}) 잔류 부유물로 물색이 다소 탁해져 시인성이 저하되었습니다.`
        : '사리성 물 뒤집힘으로 인한 극심한 탁수 영향은 낮았습니다.',
    },
    {
      id: 'headwind_cast',
      name: '바람·라인 슬랙 영향 (보조)',
      raw: headwindRaw,
      metricLabel: isHeadwind
        ? `맞바람 ${currentWindSpeed.toFixed(1)}m/s`
        : `풍속 ${currentWindSpeed.toFixed(1)}m/s`,
      description: isHeadwind
        ? '맞바람으로 캐스팅 비거리와 표층 라인 슬랙이 일부 발생했으나, 수중 유속·탁도에 비해 채비 안착에 미치는 영향은 보조적입니다.'
        : '측풍·약풍 수준으로 표층 줄날림 영향은 크지 않았습니다.',
    },
    {
      id: 'tide_penalty',
      name: '정체 물때(조금/1물/15물) 조석차 부족',
      raw: tideRaw,
      metricLabel: tidePhase.mulText,
      description:
        tidePhase.isNeapTide || tidePhase.isMildNeapTide
          ? '간만조 조차가 협소하여 조류가 살아나는 골든타임 폭이 좁고 섭이 활동이 제한되었습니다.'
          : '조석차 부족으로 인한 물때 정체 영향은 낮았습니다.',
    },
    {
      id: 'swell_wave',
      name: '너울성 파고 및 채비 액션 불안정',
      raw: swellRaw,
      metricLabel: `파고 ${currentWave.toFixed(1)}m, 주기 ${currentPeriod.toFixed(1)}초`,
      description:
        swellIndex >= 8.0
          ? '긴 파주기의 너울이 연안을 강타하며 채비의 자연스러운 액션 연출과 입질 파악을 방해했습니다.'
          : '파도로 인한 직접적인 액션 방해는 크지 않았습니다.',
    },
    {
      id: 'feeding_mismatch',
      name: '피딩 골든타임(물돌이/여명) 불일치',
      raw: feedingRaw,
      metricLabel: `${input.catchTime} 출조`,
      description: isFeedingTime
        ? '주요 피딩 타임 구간 내에 출조하여 시간대 조건은 양호했습니다.'
        : '일출/일몰 전후(마즈메) 또는 만조/간조 전후 2시간의 유속 변화 구간을 빗겨갔습니다.',
    },
  ];

  const totalRaw = rawFactors.reduce((acc, f) => acc + f.raw, 0) || 1;

  const allFactors: FactorContribution[] = rawFactors
    .map((f) => {
      const pct = Math.round((f.raw / totalRaw) * 100);
      let severity: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
      if (pct >= 22) severity = 'HIGH';
      else if (pct >= 13) severity = 'MEDIUM';
      return {
        id: f.id,
        name: f.name,
        contributionPercent: pct,
        metricLabel: f.metricLabel,
        description: f.description,
        severity,
      };
    })
    .sort((a, b) => b.contributionPercent - a.contributionPercent);

  // 상위 3개 주요 패인
  const topFactors = allFactors.slice(0, 3);

  // 실전 차기 공략 전술 수립
  let advice = '';
  const top1 = topFactors[0]?.id;
  if (top1 === 'current_bottom_loss') {
    advice = `💡 차기 공략 팁: 유속 ${currentCurrentKt.toFixed(2)}kt에서는 바닥 감도 확보가 최우선입니다. 현재 채비(${rigInfo.label}) 대신 최소 ${recMinG}g 이상 텅스텐 싱커·프리리그·무거운 지그헤드로 증량하거나, 조류가 완만해지는 초들물·끝날물 물돌이 전후 1시간에 바닥을 정확히 찍으며 공략하세요.`;
  } else if (top1 === 'spring_turbidity') {
    advice = `💡 차기 공략 팁: 사리 물 뒤집힘으로 탁도가 높을 때는 시각 의존 루어보다 강한 파동·진동의 쉐드웜/바이브/블레이드와 고대비 컬러(차트류스·글로우·블랙) 또는 후각 어필이 강한 생미끼로 전환하고, 부유물이 가라앉는 물돌이 전후나 내만 완충 지형을 노리세요.`;
  } else if (top1 === 'temp_deviation' || top1 === 'cold_surge') {
    advice = `💡 차기 공략 팁: 수온 악화 시에는 채비 무게를 1단계 높여 바닥 50cm 이내 초저층을 데드 슬로우로 긁고, 수심이 깊고 수온 변화가 완만한 본류 인접 직벽·여밭을 공략하세요.`;
  } else if (top1 === 'current_stagnation' || top1 === 'tide_penalty') {
    advice = `💡 차기 공략 팁: 조류가 살아나는 중들물·중날물 구간에 물골과 훈수지대(조류가 부딪쳐 거품이 이는 곳)를 집중 공략하고, 정체 시간대에는 가벼운 채비로 폴링 체공 시간을 늘리세요.`;
  } else if (top1 === 'swell_wave') {
    advice = `💡 차기 공략 팁: 너울이 심할 때는 외해 직벽 갯바위보다 파도를 피할 수 있는 방파제 내항 홈통이나 곶부리 안쪽 완충 구역으로 포인트를 이동하십시오.`;
  } else if (top1 === 'headwind_cast') {
    advice = `💡 차기 공략 팁: 강풍 시에는 공기저항이 적은 슬림 싱커나 메탈지그와 0.8호 이하 얇은 합사를 사용해 라인 슬랙을 줄이세요.`;
  } else {
    advice = `💡 차기 공략 팁: 일출 30분 전 또는 간조 직후 물이 돌기 시작하는 첫 1시간에 출조 타이밍을 맞추는 것이 입질 확률을 크게 높입니다.`;
  }

  return {
    isSkunk: true,
    summary: `떠나버린 물고기 사후 복기: [${topFactors[0]?.name}] (${topFactors[0]?.contributionPercent}%) 및 [${topFactors[1]?.name}] (${topFactors[1]?.contributionPercent}%)가 주된 불황 원인으로 분석되었습니다.`,
    topFactors,
    allFactors,
    tacticalAdvice: advice,
    calculatedAt: new Date().toISOString(),
  };
}
