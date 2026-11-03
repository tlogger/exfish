// ExFish AI 꽝 사후 복기 엔진 (Post-Mortem Analysis Engine)
// 슬로건: "ex-gf, ex-wife, and ex-fish. 떠나버린 물고기를 기리며..."
// 7대 환경 물리 벡터 기반 실패 기여도(%) 및 차기 공략 전술 도출

import type { WeatherData, MarineData, TideDayInfo, BiteScoreBreakdown } from '../types';

export interface PostMortemInput {
  targetSpecies: string;
  catchTime: string; // HH:mm
  weather: WeatherData | null;
  marine: MarineData | null;
  tide: TideDayInfo | null;
  biteScore: BiteScoreBreakdown | null;
  castingBearingDeg?: number; // 공략 중심 방위각 (0~359)
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

// 주요 어종별 최적 수온 범위 (°C)
const SPECIES_TEMP_MAP: Record<string, { min: number; max: number; opt: number }> = {
  광어: { min: 12, max: 22, opt: 16.5 },
  우럭: { min: 9, max: 21, opt: 14.5 },
  농어: { min: 14, max: 24, opt: 18.5 },
  감성돔: { min: 13, max: 23, opt: 17.5 },
  참돔: { min: 15, max: 25, opt: 19.5 },
  주꾸미: { min: 14, max: 24, opt: 18.0 },
  갑오징어: { min: 15, max: 23, opt: 18.5 },
  무늬오징어: { min: 16, max: 26, opt: 21.0 },
  삼치: { min: 17, max: 26, opt: 21.5 },
  부시리: { min: 16, max: 25, opt: 20.0 },
  방어: { min: 14, max: 22, opt: 17.5 },
  볼락: { min: 10, max: 19, opt: 14.0 },
  벵에돔: { min: 15, max: 25, opt: 19.0 },
};

/**
 * 7대 환경 특성 벡터 기반 꽝 원인 분해 및 사후 복기 리포트 생성
 */
export function generatePostMortemReport(input: PostMortemInput): PostMortemReport {
  const { targetSpecies, weather, marine, tide, biteScore: _biteScore, castingBearingDeg = 180 } = input;

  const tempSpec = SPECIES_TEMP_MAP[targetSpecies] || { min: 12, max: 22, opt: 17.0 };
  const currentTemp = marine?.seaSurfaceTemp ?? 16.0;
  const currentWave = marine?.waveHeight ?? 0.8;
  const currentPeriod = marine?.wavePeriod ?? 6.0;
  const currentCurrent = marine?.currentVelocity ?? 0.3; // knot
  const currentWindSpeed = weather?.windSpeed ?? 4.0; // m/s
  const currentWindDir = weather?.windDirection ?? 0; // deg

  // 1. 수온 적정성 괴리 지수 (Delta T)
  const tempDiff = Math.abs(currentTemp - tempSpec.opt);
  let tempRaw = 0;
  if (currentTemp < tempSpec.min) {
    tempRaw = (tempSpec.min - currentTemp) * 18 + 15;
  } else if (currentTemp > tempSpec.max) {
    tempRaw = (currentTemp - tempSpec.max) * 14 + 10;
  } else {
    tempRaw = tempDiff * 6;
  }

  // 2. 냉수대/수온 급강하율 (추정: 일교차 및 풍속 결합)
  // 풍속 7m/s 이상 또는 북서풍 시 표층수 외해 유출로 수온 급강하 반영
  const isColdSurge = (currentWindDir >= 300 || currentWindDir <= 45) && currentWindSpeed >= 6.0;
  const coldSurgeRaw = isColdSurge ? 35 : currentWindSpeed >= 8.0 ? 20 : 5;

  // 3. 조류 정체율 (유속 정체 또는 격류)
  // 최적 유속 0.6~1.2 knot
  let currentRaw = 10;
  if (currentCurrent < 0.25) {
    currentRaw = 40; // 조류 완전 멈춤
  } else if (currentCurrent < 0.5) {
    currentRaw = 25; // 완류
  } else if (currentCurrent > 2.0) {
    currentRaw = 30; // 지나치게 빠른 격류로 바닥 안착 불가
  } else {
    currentRaw = 8; // 적정 유속
  }

  // 4. 캐스팅 맞바람 성분 세기
  // currentWindDir는 불어오는 방향(From)이므로 실제 바람 진행 방향(To)은 (currentWindDir + 180) % 360
  const windVectorDeg = (currentWindDir + 180) % 360;
  const rawWindDiff = Math.abs(windVectorDeg - castingBearingDeg) % 360;
  const windAngleDiff = rawWindDiff > 180 ? 360 - rawWindDiff : rawWindDiff;
  // windAngleDiff: 0도(등바람), 180도(정면 맞바람)
  const isHeadwind = windAngleDiff > 120;
  const headwindFactor = Math.max(0, Math.cos((windAngleDiff * Math.PI) / 180) * -1);
  const headwindRaw = isHeadwind
    ? currentWindSpeed * headwindFactor * 5 + 10
    : currentWindSpeed >= 8.0
    ? 20
    : 5;

  // 5. 물때 정체 페널티 (조금, 1물, 15물 등 물돌이 정체)
  let tideRaw = 10;
  if (tide?.mulText?.includes('조금') || tide?.mulText?.includes('1물') || tide?.mulText?.includes('15물')) {
    tideRaw = 35;
  } else if (tide?.mulText?.includes('2물') || tide?.mulText?.includes('14물')) {
    tideRaw = 22;
  } else {
    tideRaw = 12;
  }

  // 6. 너울성 파고 및 파주기 계수 (Swell Index = WaveHeight * WavePeriod)
  const swellIndex = currentWave * currentPeriod;
  let swellRaw = 8;
  if (swellIndex >= 10.0 || currentWave >= 1.5) {
    swellRaw = 45; // 치명적 너울 및 바닥 흙탕물
  } else if (swellIndex >= 6.0 || currentWave >= 1.0) {
    swellRaw = 25; // 너울성 파도로 입질 파악 곤란
  } else {
    swellRaw = 7;
  }

  // 7. 피딩 타임 불일치 (골든타임 벗어남)
  const isFeedingTime = tide?.feedingTimes?.some((f) => f.label.includes('현재') || f.label.includes('피딩')) || false;
  const feedingRaw = isFeedingTime ? 5 : 28;

  // 총합 및 기여도(%) 정규화
  const rawFactors = [
    {
      id: 'temp_deviation',
      name: '수온 괴리 및 활성 저하',
      raw: tempRaw,
      metricLabel: `${currentTemp.toFixed(1)}°C (적정 ${tempSpec.opt}°C)`,
      description:
        currentTemp < tempSpec.min
          ? `적정 하한선(${tempSpec.min}°C)보다 낮아 대상어의 대사율이 급감하고 바닥 깊은 은신처로 침잠했습니다.`
          : `최적 수온(${tempSpec.opt}°C)과의 괴리로 인해 먹이 사냥 활동 영역이 축소되었습니다.`,
    },
    {
      id: 'cold_surge',
      name: '북서풍성 표층수 역전·수온 급강하',
      raw: coldSurgeRaw,
      metricLabel: `풍속 ${currentWindSpeed.toFixed(1)}m/s, 북풍계열`,
      description: '강한 외해풍으로 인해 표층 수온이 급락하여 바닥층 어류가 입질을 전면 중단했습니다.',
    },
    {
      id: 'current_stagnation',
      name: '조류 정체 및 유속 부족',
      raw: currentRaw,
      metricLabel: `유속 ${currentCurrent.toFixed(2)} knot`,
      description:
        currentCurrent < 0.3
          ? '조류가 거의 흐르지 않는 정체 구간으로 베이트피시 이동이 멈추고 대상어의 경계심이 극대화되었습니다.'
          : '지나치게 강한 조류로 채비가 바닥권에 정렬되지 못하고 떠내려갔습니다.',
    },
    {
      id: 'headwind_cast',
      name: '캐스팅 맞바람에 의한 비거리 손실',
      raw: headwindRaw,
      metricLabel: isHeadwind ? `정면 맞바람 ${currentWindSpeed.toFixed(1)}m/s` : `풍속 ${currentWindSpeed.toFixed(1)}m/s`,
      description: isHeadwind
        ? '공략 지점 방면으로 강한 맞바람이 불어 채비가 핵심 어도/수중여(40m+ 지점)까지 닿지 못했습니다.'
        : '측풍 또는 강풍으로 라인 슬랙(줄날림)이 발생하여 미세한 입질 감도가 상쇄되었습니다.',
    },
    {
      id: 'tide_penalty',
      name: '정체 물때(조금/1물/15물) 조석차 부족',
      raw: tideRaw,
      metricLabel: `${tide?.mulText || '물때 정보'}`,
      description: '간만조 조차가 협소하여 조류가 살아나는 골든타임 폭이 좁고 섭이 활동이 제한되었습니다.',
    },
    {
      id: 'swell_wave',
      name: '너울성 파고 및 바닥 펄물·탁도 증가',
      raw: swellRaw,
      metricLabel: `파고 ${currentWave.toFixed(1)}m, 주기 ${currentPeriod.toFixed(1)}초`,
      description:
        swellIndex >= 8.0
          ? '긴 파주기의 너울이 갯바위를 치며 바닥 앙금을 뒤흔들어 시야(탁도)가 크게 악화되었습니다.'
          : '파도로 인해 미끼의 자연스러운 액션 연출이 방해받았습니다.',
    },
    {
      id: 'feeding_mismatch',
      name: '피딩 골든타임(물돌이/여명) 불일치',
      raw: feedingRaw,
      metricLabel: `${input.catchTime} 출조`,
      description: '일출/일몰 전후(마즈메) 또는 만조/간조 전후 2시간의 유속 변화 구간을 빗겨갔습니다.',
    },
  ];

  const totalRaw = rawFactors.reduce((acc, f) => acc + f.raw, 0) || 1;

  const allFactors: FactorContribution[] = rawFactors
    .map((f) => {
      const pct = Math.round((f.raw / totalRaw) * 100);
      let severity: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
      if (pct >= 25) severity = 'HIGH';
      else if (pct >= 15) severity = 'MEDIUM';
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
  if (top1 === 'temp_deviation' || top1 === 'cold_surge') {
    advice = `💡 차기 공략 팁: 표층 수온 악화 시에는 루어/바늘 무게를 평소보다 1단계 무겁게 운영(예: 1/4oz -> 3/8oz)하여 바닥 50cm 이내의 초저층을 데드 슬로우 리트리브로 공략하세요.`;
  } else if (top1 === 'current_stagnation') {
    advice = `💡 차기 공략 팁: 조류가 살아나는 만조/간조 2시간 전후(중들물/중날물)에 물골과 훈수지대(조류가 부딪쳐 거품이 이는 곳)를 집중 노리십시오.`;
  } else if (top1 === 'headwind_cast') {
    advice = `💡 차기 공략 팁: 맞바람을 뚫을 수 있도록 공기저항이 적은 텅스텐 싱커 또는 비거리 중심 메탈지그(20~30g)를 장착하고 0.8호 이하 얇은 합사 라인을 추천합니다.`;
  } else if (top1 === 'swell_wave') {
    advice = `💡 차기 공략 팁: 너울이 심할 때는 외해 직벽 갯바위보다 파도를 피할 수 있는 방파제 내항 홈통이나 곶부리 안쪽 완충 구역으로 포인트를 이동하십시오.`;
  } else {
    advice = `💡 차기 공략 팁: 일출 30분 전 또는 간조 직후 물이 돌기 시작하는 첫 1시간에 출조 타이밍을 맞추는 것이 입질 확률을 3배 이상 높입니다.`;
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
