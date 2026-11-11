// ExFish 유저 맞춤형 공기역학 채비 및 로드 탄성 비거리 & 수중 침강(폴링) 물리 엔진
// 1. 낚싯대 파워(루어대 UL~H, 원투대) 탄성 곡선 + 로드 길이(m, ft) 레버 암 공식
// 2. 루어/싱커 무게(지그헤드 1~5g, 1/32~1oz, 주꾸미 3~7호, 원투 8~40호) + 합사 PE 라인 공기저항 비거리 계산
// 3. 착수 수심(m) 및 조류 유속(m/s)을 고려한 유효 침강 속도, 바닥 안착 소요 시간, 조류 흘림 거리 산출

export type RodType = 'LURE' | 'SURF';
export type RodPower = 'UL' | 'L' | 'ML' | 'M' | 'MH' | 'H' | 'SURF';

// 미끼 선택 모델: 생미끼(원투용), 루어(지그헤드/싱커+웜), 캐스팅볼(던질찌+지그헤드+웜), 메탈(메탈지그 1~80g)
export type BaitType = 'LIVE' | 'LURE' | 'CASTING_BALL' | 'METAL';
export type LureShape = 'GRUB' | 'SHAD' | 'STRAIGHT' | 'MINNOW';

export interface BaitConfig {
  type: BaitType;
  lengthInches: number; // 1 ~ 4 (루어, 캐스팅볼용)
  lengthCm?: number; // 2.5 ~ 16.0cm (메탈용)
  shape: LureShape;
  weightGrams: number; // 웜 자중 또는 메탈 자중
  surfaceAreaCm2: number;
  // 캐스팅볼 전용
  castingBallHo?: number; // 캐스팅볼 호수 (1~8호, 1호=3.75g)
  castingBallWeightGrams?: number; // 캐스팅볼 무게 (g)
  jigheadWeightGrams?: number; // 지그헤드 무게 (g)
  // 메탈 지그 전용
  metalWeightGrams?: number; // 메탈 무게 (1~80g)
}

export const LURE_SHAPE_NAMES: Record<LureShape, string> = {
  GRUB: '그럽웜',
  SHAD: '쉐드웜',
  STRAIGHT: '스트레이트',
  MINNOW: '미노우',
};

// 캐스팅볼 규격 프리셋 (1호 ~ 8호, 1호 = 3.75g)
export interface CastingBallPreset {
  ho: number;
  label: string;
  weightGrams: number;
}

export const CASTING_BALL_PRESETS: CastingBallPreset[] = [
  { ho: 1.0, label: '1호', weightGrams: 3.8 },
  { ho: 1.5, label: '1.5호', weightGrams: 5.6 },
  { ho: 2.0, label: '2호', weightGrams: 7.5 },
  { ho: 2.5, label: '2.5호', weightGrams: 9.4 },
  { ho: 3.0, label: '3호', weightGrams: 11.3 },
  { ho: 4.0, label: '4호', weightGrams: 15.0 },
  { ho: 5.0, label: '5호', weightGrams: 18.8 },
  { ho: 6.0, label: '6호', weightGrams: 22.5 },
  { ho: 7.0, label: '7호', weightGrams: 26.3 },
  { ho: 8.0, label: '8호', weightGrams: 30.0 },
];

// 캐스팅볼용 지그헤드 프리셋 (그램 & 온스)
export interface JigheadPreset {
  id: string;
  type: 'g' | 'oz';
  label: string;
  weightGrams: number;
}

export const JIGHEAD_PRESETS: JigheadPreset[] = [
  { id: 'jh-0.5g', type: 'g', label: '0.5g', weightGrams: 0.5 },
  { id: 'jh-1g',   type: 'g', label: '1g',   weightGrams: 1.0 },
  { id: 'jh-1.5g', type: 'g', label: '1.5g', weightGrams: 1.5 },
  { id: 'jh-2g',   type: 'g', label: '2g',   weightGrams: 2.0 },
  { id: 'jh-3g',   type: 'g', label: '3g',   weightGrams: 3.0 },
  { id: 'jh-5g',   type: 'g', label: '5g',   weightGrams: 5.0 },
  { id: 'jh-1-32', type: 'oz', label: '1/32oz', weightGrams: 0.9 },
  { id: 'jh-1-16', type: 'oz', label: '1/16oz', weightGrams: 1.8 },
  { id: 'jh-1-8',  type: 'oz', label: '1/8oz',  weightGrams: 3.5 },
  { id: 'jh-1-4',  type: 'oz', label: '1/4oz',  weightGrams: 7.1 },
];

// 메탈 지그 무게 퀵 프리셋 (1~80g)
export const METAL_WEIGHT_PRESETS = [7, 10, 14, 20, 28, 40, 60, 80] as const;

// 메탈 지그 길이 퀵 프리셋
export const METAL_LENGTH_PRESETS = [3.0, 5.0, 7.0, 10.0, 14.0] as const;

export function getBaitSpecs(
  type: BaitType,
  lengthInches: number = 2,
  shape: LureShape = 'GRUB',
  lengthCm: number = 6.0,
  castingBallHo: number = 3.0,
  jigheadWeightGrams: number = 1.0,
  metalWeightGrams: number = 28.0
): BaitConfig {
  if (type === 'LIVE') {
    // 생미끼는 2인치 그럽웜 기준으로 2.5g 가정
    return {
      type: 'LIVE',
      lengthInches: 2,
      shape: 'GRUB',
      weightGrams: 2.5,
      surfaceAreaCm2: 2.0,
    };
  }

  if (type === 'METAL') {
    // 메탈 지그: 길이(2.5cm ~ 16.0cm)와 메탈 무게(1~80g)
    const safeCm = Math.max(2.5, Math.min(16.0, Math.round(lengthCm * 2) / 2));
    const safeMetalWeight = Math.max(1, Math.min(80, Math.round(metalWeightGrams * 10) / 10));
    const surfaceAreaCm2 = Math.round((0.012 * safeCm * safeCm + 0.6) * 10) / 10;

    return {
      type: 'METAL',
      lengthInches: Math.round(safeCm / 2.54),
      lengthCm: safeCm,
      shape: 'MINNOW',
      weightGrams: safeMetalWeight,
      metalWeightGrams: safeMetalWeight,
      surfaceAreaCm2,
    };
  }

  if (type === 'CASTING_BALL') {
    const safeHo = Math.max(0.5, Math.min(15, Math.round(castingBallHo * 2) / 2));
    const ballWeight = Math.round(safeHo * 3.75 * 10) / 10;
    const safeJighead = Math.max(0.2, Math.min(20, Math.round(jigheadWeightGrams * 10) / 10));

    const safeLen = Math.max(1, Math.min(4, Math.round(lengthInches)));
    const weightTable: Record<LureShape, Record<number, number>> = {
      GRUB: { 1: 1.0, 2: 2.5, 3: 5.0, 4: 9.0 },
      SHAD: { 1: 1.2, 2: 3.2, 3: 6.8, 4: 12.5 },
      STRAIGHT: { 1: 0.8, 2: 1.8, 3: 3.6, 4: 6.2 },
      MINNOW: { 1: 1.6, 2: 4.2, 3: 8.8, 4: 15.5 },
    };
    const areaTable: Record<LureShape, Record<number, number>> = {
      GRUB: { 1: 1.2, 2: 2.0, 3: 3.5, 4: 5.2 },
      SHAD: { 1: 1.4, 2: 2.6, 3: 4.8, 4: 7.5 },
      STRAIGHT: { 1: 0.9, 2: 1.5, 3: 2.4, 4: 3.5 },
      MINNOW: { 1: 1.8, 2: 3.2, 3: 5.6, 4: 8.8 },
    };

    const wormWeight = weightTable[shape]?.[safeLen] ?? 2.5;
    const wormArea = areaTable[shape]?.[safeLen] ?? 2.0;
    const ballArea = Math.round((Math.PI * Math.pow((ballWeight / 3.75) * 0.45 + 0.6, 2)) * 10) / 10;

    return {
      type: 'CASTING_BALL',
      lengthInches: safeLen,
      lengthCm: Math.round(safeLen * 2.54 * 10) / 10,
      shape,
      weightGrams: wormWeight,
      castingBallHo: safeHo,
      castingBallWeightGrams: ballWeight,
      jigheadWeightGrams: safeJighead,
      surfaceAreaCm2: Math.round((ballArea + wormArea * 0.4) * 10) / 10,
    };
  }

  // 루어 형상 & 길이별 무게 및 단면적
  const safeLen = Math.max(1, Math.min(4, Math.round(lengthInches)));
  const weightTable: Record<LureShape, Record<number, number>> = {
    GRUB: { 1: 1.0, 2: 2.5, 3: 5.0, 4: 9.0 },
    SHAD: { 1: 1.2, 2: 3.2, 3: 6.8, 4: 12.5 },
    STRAIGHT: { 1: 0.8, 2: 1.8, 3: 3.6, 4: 6.2 },
    MINNOW: { 1: 1.6, 2: 4.2, 3: 8.8, 4: 15.5 },
  };

  const areaTable: Record<LureShape, Record<number, number>> = {
    GRUB: { 1: 1.2, 2: 2.0, 3: 3.5, 4: 5.2 },
    SHAD: { 1: 1.4, 2: 2.6, 3: 4.8, 4: 7.5 },
    STRAIGHT: { 1: 0.9, 2: 1.5, 3: 2.4, 4: 3.5 },
    MINNOW: { 1: 1.8, 2: 3.2, 3: 5.6, 4: 8.8 },
  };

  const weightGrams = weightTable[shape]?.[safeLen] ?? 2.5;
  const surfaceAreaCm2 = areaTable[shape]?.[safeLen] ?? 2.0;

  return {
    type: 'LURE',
    lengthInches: safeLen,
    lengthCm: Math.round(safeLen * 2.54 * 10) / 10,
    shape,
    weightGrams,
    surfaceAreaCm2,
  };
}

export interface RodPowerSpec {
  power: RodPower;
  label: string;
  optWeightG: number;
  minWeightG: number;
  maxWeightG: number;
  description: string;
  rodType: RodType;
}

export const ROD_POWER_SPECS: Record<RodPower, RodPowerSpec> = {
  UL:   { power: 'UL',   label: 'UL (울트라라이트)', optWeightG: 3,  minWeightG: 1,  maxWeightG: 7,   description: '아징/볼락 지그헤드 (1~7g)', rodType: 'LURE' },
  L:    { power: 'L',    label: 'L (라이트)',        optWeightG: 7,  minWeightG: 3,  maxWeightG: 12,  description: '호래기/우럭 다운샷 (3~12g)', rodType: 'LURE' },
  ML:   { power: 'ML',   label: 'ML (미디엄라이트)', optWeightG: 18, minWeightG: 7,  maxWeightG: 30,  description: '주꾸미/에기/라이트루어 (7~30g)', rodType: 'LURE' },
  M:    { power: 'M',    label: 'M (미디엄 표준)',   optWeightG: 22, minWeightG: 10, maxWeightG: 35,  description: '에깅 3.5호/광어 다운샷 (10~35g)', rodType: 'LURE' },
  MH:   { power: 'MH',   label: 'MH (미디엄헤비)',   optWeightG: 35, minWeightG: 14, maxWeightG: 50,  description: '농어 미노우/삼치/쇼어 (최대 50g)', rodType: 'LURE' },
  H:    { power: 'H',    label: 'H (헤비)',          optWeightG: 48, minWeightG: 25, maxWeightG: 60,  description: '쇼어지깅/대물 루어 (최대 50~60g)', rodType: 'LURE' },
  SURF: { power: 'SURF', label: '원투대 (서프캐스팅)', optWeightG: 95, minWeightG: 30, maxWeightG: 150, description: '원투 낚싯대 (봉돌 8~40호 / 30~150g)', rodType: 'SURF' },
};

// 원투대 고정 표준 규격 길이 (2.7, 3.3, 4.2, 4.5, 5.4m)
export const SURF_ROD_LENGTHS_M = [2.7, 3.3, 4.2, 4.5, 5.4] as const;

// 루어대 표준 프리셋 길이 (1.6m ~ 3.0m)
export const LURE_ROD_LENGTH_PRESETS_M = [
  { m: 1.6, ft: 5.2, label: '1.6m (5.2ft) 선상/계류' },
  { m: 1.8, ft: 5.9, label: '1.8m (5.9ft) 볼락/아징' },
  { m: 2.0, ft: 6.6, label: '2.0m (6.6ft) 워킹' },
  { m: 2.1, ft: 6.9, label: '2.1m (6.9ft) 배스/우럭' },
  { m: 2.4, ft: 7.9, label: '2.4m (7.9ft) 만능 8ft' },
  { m: 2.6, ft: 8.6, label: '2.6m (8.6ft) 국민 표준' },
  { m: 2.7, ft: 8.9, label: '2.7m (8.9ft) 농어 9ft' },
  { m: 3.0, ft: 9.8, label: '3.0m (9.8ft) 쇼어 10ft' },
] as const;

export type WeightCategory = 'JIG' | 'OZ' | 'JUKKUMI' | 'SURF';

export interface WeightPreset {
  id: string;
  category: WeightCategory;
  categoryLabel: string;
  label: string;
  subLabel: string;
  weightGrams: number;
}

export const WEIGHT_PRESETS: WeightPreset[] = [
  // 1. 일반 지그헤드 (1, 2, 3, 5g)
  { id: 'jig-1g', category: 'JIG', categoryLabel: '지그헤드 (g)', label: '1g', subLabel: '극소', weightGrams: 1 },
  { id: 'jig-2g', category: 'JIG', categoryLabel: '지그헤드 (g)', label: '2g', subLabel: '아징', weightGrams: 2 },
  { id: 'jig-3g', category: 'JIG', categoryLabel: '지그헤드 (g)', label: '3g', subLabel: '볼락', weightGrams: 3 },
  { id: 'jig-5g', category: 'JIG', categoryLabel: '지그헤드 (g)', label: '5g', subLabel: '우럭', weightGrams: 5 },

  // 2. 온스(oz) 지그헤드/루어 (1/32oz ~ 2oz, 3/32oz 및 3/16oz 제외)
  { id: 'oz-1-32', category: 'OZ', categoryLabel: '온스 루어 (oz)', label: '1/32oz', subLabel: '0.9g', weightGrams: 0.9 },
  { id: 'oz-1-16', category: 'OZ', categoryLabel: '온스 루어 (oz)', label: '1/16oz', subLabel: '1.8g', weightGrams: 1.8 },
  { id: 'oz-1-8',  category: 'OZ', categoryLabel: '온스 루어 (oz)', label: '1/8oz',  subLabel: '3.5g', weightGrams: 3.5 },
  { id: 'oz-1-4',  category: 'OZ', categoryLabel: '온스 루어 (oz)', label: '1/4oz',  subLabel: '7.1g', weightGrams: 7.1 },
  { id: 'oz-3-8',  category: 'OZ', categoryLabel: '온스 루어 (oz)', label: '3/8oz',  subLabel: '10.6g', weightGrams: 10.6 },
  { id: 'oz-1-2',  category: 'OZ', categoryLabel: '온스 루어 (oz)', label: '1/2oz',  subLabel: '14.2g', weightGrams: 14.2 },
  { id: 'oz-3-4',  category: 'OZ', categoryLabel: '온스 루어 (oz)', label: '3/4oz',  subLabel: '21.3g', weightGrams: 21.3 },
  { id: 'oz-1',    category: 'OZ', categoryLabel: '온스 루어 (oz)', label: '1oz',    subLabel: '28.3g', weightGrams: 28.3 },
  { id: 'oz-2',    category: 'OZ', categoryLabel: '온스 루어 (oz)', label: '2oz',    subLabel: '56.7g', weightGrams: 56.7 },

  // 3. 주꾸미 낚시용 봉돌 (3호~7호, 1호=3.75g)
  { id: 'juk-3', category: 'JUKKUMI', categoryLabel: '주꾸미 (호)', label: '3호', subLabel: '11.3g', weightGrams: 11.3 },
  { id: 'juk-4', category: 'JUKKUMI', categoryLabel: '주꾸미 (호)', label: '4호', subLabel: '15.0g', weightGrams: 15.0 },
  { id: 'juk-5', category: 'JUKKUMI', categoryLabel: '주꾸미 (호)', label: '5호', subLabel: '18.8g', weightGrams: 18.8 },
  { id: 'juk-6', category: 'JUKKUMI', categoryLabel: '주꾸미 (호)', label: '6호', subLabel: '22.5g', weightGrams: 22.5 },
  { id: 'juk-7', category: 'JUKKUMI', categoryLabel: '주꾸미 (호)', label: '7호', subLabel: '26.3g', weightGrams: 26.3 },

  // 4. 원투낚시용 봉돌 (16호, 20호, 25호, 30호, 35호, 40호, 1호=3.75g)
  { id: 'surf-16', category: 'SURF', categoryLabel: '원투 봉돌 (호)', label: '16호', subLabel: '60g',   weightGrams: 60 },
  { id: 'surf-20', category: 'SURF', categoryLabel: '원투 봉돌 (호)', label: '20호', subLabel: '75g',   weightGrams: 75 },
  { id: 'surf-25', category: 'SURF', categoryLabel: '원투 봉돌 (호)', label: '25호', subLabel: '93.8g', weightGrams: 93.8 },
  { id: 'surf-30', category: 'SURF', categoryLabel: '원투 봉돌 (호)', label: '30호', subLabel: '112.5g', weightGrams: 112.5 },
  { id: 'surf-35', category: 'SURF', categoryLabel: '원투 봉돌 (호)', label: '35호', subLabel: '131.3g', weightGrams: 131.3 },
  { id: 'surf-40', category: 'SURF', categoryLabel: '원투 봉돌 (호)', label: '40호', subLabel: '150g',  weightGrams: 150 },
];

export function getWeightDescription(weightGrams: number, baitConfig?: BaitConfig): string {
  if (baitConfig) {
    if (baitConfig.type === 'CASTING_BALL') {
      const ho = baitConfig.castingBallHo ?? 3.0;
      const jh = baitConfig.jigheadWeightGrams ?? 1.0;
      return `캐스팅볼 ${ho}호(${Math.round(ho * 3.75 * 10) / 10}g) + 지그헤드 ${jh}g`;
    }
    if (baitConfig.type === 'METAL') {
      const mw = baitConfig.metalWeightGrams ?? weightGrams;
      const len = baitConfig.lengthCm ?? 6.0;
      return `메탈지그 ${mw}g (${len}cm)`;
    }
  }

  const match = WEIGHT_PRESETS.find((p) => Math.abs(p.weightGrams - weightGrams) < 0.15);
  if (match) {
    if (match.category === 'OZ') return `${match.label} (${match.weightGrams}g)`;
    if (match.category === 'JUKKUMI') return `주꾸미 ${match.label} (${match.weightGrams}g)`;
    if (match.category === 'SURF') return `원투 ${match.label} 봉돌 (${match.weightGrams}g)`;
    return `${match.weightGrams}g 지그헤드`;
  }
  const bongdolNo = Math.round((weightGrams / 3.75) * 10) / 10;
  if (weightGrams >= 30) {
    return `${weightGrams}g (원투 약 ${bongdolNo}호)`;
  }
  if (weightGrams >= 10 && weightGrams < 30) {
    return `${weightGrams}g (약 ${bongdolNo}호 봉돌)`;
  }
  return `${weightGrams}g`;
}

const KEY_RIG_WEIGHT = 'exfish_rig_weight_g';
const KEY_PE_LINE = 'exfish_pe_line_size';
const KEY_ROD_POWER = 'exfish_rod_power';
const KEY_ROD_LENGTH_M = 'exfish_rod_length_m';
const KEY_ROD_LENGTH = 'exfish_rod_length_ft'; // 레거시 호환용
const KEY_BAIT_TYPE = 'exfish_bait_type';
const KEY_BAIT_LENGTH = 'exfish_bait_length';
const KEY_BAIT_LENGTH_CM = 'exfish_bait_length_cm';
const KEY_BAIT_SHAPE = 'exfish_bait_shape';
const KEY_CASTING_BALL_HO = 'exfish_casting_ball_ho';
const KEY_JIGHEAD_WEIGHT = 'exfish_jighead_weight_g';
const KEY_METAL_WEIGHT = 'exfish_metal_weight_g';

export interface TackleRigConfig {
  weightGrams: number; // 싱커/추/봉돌 무게 (0.9g ~ 150g)
  totalWeightGrams: number; // 봉돌 + 미끼 합산 총 무게
  baitConfig: BaitConfig; // [요구사항 2-6-12] 미끼 스펙
  peLineSize: number; // 0.4호 ~ 3.0호
  rodType: RodType; // 'LURE' | 'SURF'
  rodPower: RodPower; // UL ~ H, SURF
  rodLengthM: number; // 1.6m ~ 5.4m
  rodLengthFt: number; // 5.2ft ~ 17.7ft
  calibratedDistanceMeters: number; // 계산된 기준 비거리 (m)
  radii: [number, number, number]; // [단거리, 기준거리, 원거리]
  rodElasticityEfficiency: number; // 로드 탄성/추진 효율 (0.0 ~ 1.0)
  rodLengthFactor: number; // 로드 길이/지렛대 계수
}

/**
 * 낚싯대 파워(탄성), 전장(길이), 채비 무게 + 미끼 무게/표면적, 합사 라인 굵기를 결합한 공기역학 비거리 산식
 * - 루어대: 파워별 탄성 복원율(UL~H) + 길이(1.6~3.0m) 레버 암 (ML대: 7~30g, MH/H대: 50g+ 반영)
 * - 원투대: 휨/탄성의 왜곡보다 "추 무게(8~40호)"와 "로드 길이(2.7~5.4m)"가 비거리의 지배적 변수
 * - 미끼(생미끼/루어 형상·길이): 합산 질량 증가 및 표면적에 따른 공기저항 감쇄 반영
 */
export function calculateCalibratedDistance(
  weightGrams: number,
  peLineSize: number,
  rodPower: RodPower = 'M',
  rodLengthM: number = 2.6,
  baitConfig: BaitConfig = getBaitSpecs('LIVE', 2, 'GRUB')
): {
  distanceMeters: number;
  elasticityEfficiency: number;
  lengthFactor: number;
  totalWeightGrams: number;
} {
  let safeTotalWeight: number;
  let baitAirFactor = 1.0;

  if (baitConfig.type === 'CASTING_BALL') {
    const ballW = baitConfig.castingBallWeightGrams ?? ((baitConfig.castingBallHo ?? 3.0) * 3.75);
    const jhW = baitConfig.jigheadWeightGrams ?? 1.0;
    const wormW = baitConfig.weightGrams ?? 2.5;
    safeTotalWeight = Math.max(0.5, Math.min(200, ballW + jhW + wormW));
    baitAirFactor = 1.06; // 구형/유선형 던질찌의 안정적 비행 특성
  } else if (baitConfig.type === 'METAL') {
    const metalW = baitConfig.metalWeightGrams ?? weightGrams;
    safeTotalWeight = Math.max(1.0, Math.min(200, metalW));
    baitAirFactor = 1.15; // 메탈 지그의 극도로 낮은 공기 저항 및 높은 관성
  } else {
    const safeSinkerWeight = Math.max(0.5, Math.min(160, weightGrams));
    safeTotalWeight = Math.max(0.5, Math.min(180, safeSinkerWeight + baitConfig.weightGrams));
    const baitDragRatio = Math.max(0.5, baitConfig.surfaceAreaCm2) / 2.0;
    baitAirFactor = Math.pow(1.0 / baitDragRatio, 0.08);
  }

  const safePE = Math.max(0.4, Math.min(3.0, peLineSize));

  if (rodPower === 'SURF') {
    // ----------------------------------------------------
    // [원투대 비거리 연산 엔진]
    // 휨과 탄성의 영향보다 "추 무게"와 "로드 길이"가 주요 변수
    // ----------------------------------------------------
    const safeSurfLengthM = Math.max(2.5, Math.min(6.0, rodLengthM));

    // 1. 로드 길이 레버 암 및 원심력 계수 (기준 4.2m = 1.0)
    const lengthFactor = Math.pow(safeSurfLengthM / 4.2, 0.70);

    // 2. 총 무게 관성 모멘텀 계수 (스위트스팟 25호 95g 기준 = 1.0)
    const optWeight = 95.0;
    const weightFactor =
      Math.pow(safeTotalWeight / optWeight, 0.35) *
      Math.exp(-Math.pow(Math.log(safeTotalWeight) - Math.log(optWeight), 2) / (2 * 0.95 * 0.95));

    // 3. 원줄 합사 PE 라인 공기저항 계수 (원투 기준 1.5호 = 1.0)
    const lineFactor = Math.pow(1.5 / safePE, 0.20);

    // 4. 원투 기준 비거리 (4.2m 대, 25호 95g, 1.5호 합사 기준 95m)
    const rawDist = 95.0 * lengthFactor * weightFactor * lineFactor * baitAirFactor;
    const distanceMeters = Math.round(Math.max(20, Math.min(150, rawDist)));

    return {
      distanceMeters,
      elasticityEfficiency: Math.round(Math.min(1.0, weightFactor) * 100) / 100,
      lengthFactor: Math.round(lengthFactor * 100) / 100,
      totalWeightGrams: Math.round(safeTotalWeight * 10) / 10,
    };
  }

  // ----------------------------------------------------
  // [루어대 비거리 연산 엔진]
  // 파워 등급(UL~H)별 탄성 복원율 + 로드 길이(ft) 레버 암
  // 미끼 합산 질량 및 표면적 공기저항 반영
  // ----------------------------------------------------
  const rodLengthFt = rodLengthM * 3.28084;
  const safeLengthFt = Math.max(5.0, Math.min(11.0, rodLengthFt));

  // 1. 로드 길이 레버 암 계수 (8.6ft 기준 = 1.0)
  const lengthFactor = Math.pow(safeLengthFt / 8.6, 0.65);

  // 2. 루어 총 질량 기반 비행 포텐셜
  const massPotential = 78.0 * (1 - Math.exp(-0.31 * Math.pow(safeTotalWeight, 0.58)));

  // 3. 로드 파워 탄성 위치에너지 축적 및 복원 효율 (적정 루어 무게와의 일치도)
  const spec = ROD_POWER_SPECS[rodPower] || ROD_POWER_SPECS.M;
  const optW = spec.optWeightG;

  let sigma = 0.55;
  if (rodPower === 'ML') {
    sigma = 0.65;
  } else if (rodPower === 'MH' || rodPower === 'H') {
    sigma = 0.62;
  }

  const logRatio = Math.log(safeTotalWeight) - Math.log(optW);
  const elasticityEfficiency = Math.exp(-(logRatio * logRatio) / (2 * sigma * sigma));
  const rodEfficiencyFactor = 0.62 + 0.38 * elasticityEfficiency;

  // 4. 합사 PE 라인 공기저항 계수 (0.8호 기준 = 1.0)
  const lineAirFactor = Math.pow(0.8 / safePE, 0.18);

  // 5. 스풀 림 방출 저항 및 가이드 링 마찰 저항
  let spoolGuideFactor = 1.0;
  if (safeTotalWeight < 5.5) {
    const lightDeficit = (5.5 - safeTotalWeight) / 5.0;
    const lineStiffnessPenalty = Math.max(0, safePE - 0.3) / 0.5;
    const loss = 0.38 * Math.pow(lightDeficit, 1.1) * Math.pow(lineStiffnessPenalty, 0.85);
    spoolGuideFactor = Math.max(0.20, 1.0 - loss);
  }

  // 6. 비거리 종합 산출
  const rawDist = massPotential * lengthFactor * rodEfficiencyFactor * lineAirFactor * spoolGuideFactor * baitAirFactor;
  const distanceMeters = Math.round(Math.max(3, Math.min(125, rawDist)));

  return {
    distanceMeters,
    elasticityEfficiency: Math.round(elasticityEfficiency * 100) / 100,
    lengthFactor: Math.round(lengthFactor * 100) / 100,
    totalWeightGrams: Math.round(safeTotalWeight * 10) / 10,
  };
}

export interface CastingDriftResult {
  targetDistanceM: number;
  targetBearingDeg: number;
  actualDistanceM: number;
  actualBearingDeg: number;
  driftDistanceM: number;
  driftAngleDeg: number;
  flightTimeSec: number;
  headwindMps: number;
  crosswindMps: number;
}

/**
 * 지그헤드 + 2인치 쉐드 웜 채비 면적 및 합사(PE 라인) 길이/두께를 반영한
 * 실시간 풍향·풍속 비거리 변화 및 측면 편류(줄날림/밀림) 정밀 물리 산식
 */
export function calculateAerodynamicCastingDrift(
  targetBearingDeg: number,
  baseDistanceM: number,
  windSpeedMps: number,
  windDirectionDeg: number,
  weightGrams: number = 25,
  peLineSize: number = 1.0,
  wormLengthInches: number = 2.0
): CastingDriftResult {
  const safeWeight = Math.max(0.5, Math.min(160, weightGrams));
  const safePE = Math.max(0.4, Math.min(3.0, peLineSize));
  const safeWindSpeed = Math.max(0, windSpeedMps);

  // 1. 바람 진행 방위 (To) = (From + 180) % 360
  const windVectorDeg = (windDirectionDeg + 180) % 360;

  // 2. 사잇각 계산 (캐스팅 방향 기준 바람 진행 방향 사잇각)
  let angleDiff = (windVectorDeg - targetBearingDeg) % 360;
  if (angleDiff > 180) angleDiff -= 360;
  if (angleDiff < -180) angleDiff += 360;
  const alphaRad = (angleDiff * Math.PI) / 180;

  // 3. 종방향(순풍/역풍) 및 횡방향(측풍) 성분 분해
  const headwindMps = safeWindSpeed * Math.cos(alphaRad);
  const crosswindMps = safeWindSpeed * Math.sin(alphaRad);

  // 4. 종방향 바람에 의한 비거리 증감 (가벼운 채비 + 굵은 합사일수록 맞바람 손실 극대화)
  const weightPenalty = Math.pow(18 / (safeWeight + 5), 0.4);
  const peWindResistance = Math.pow(safePE, 0.2);
  let distRatio = 1.0;
  if (headwindMps >= 0) {
    distRatio += Math.min(0.35, ((headwindMps / 10) * 0.25) / weightPenalty);
  } else {
    distRatio -= Math.min(0.40, (Math.abs(headwindMps) / 10) * 0.28 * weightPenalty * peWindResistance);
  }
  const effectiveDist = Math.max(8, Math.round(baseDistanceM * distRatio));

  // 5. 체공 시간 계산 (약 0.38 * sqrt(D))
  const flightTimeSec = Math.round(0.38 * Math.sqrt(effectiveDist) * 10) / 10;

  // 6. 채비(지그헤드 + 2인치 쉐드 웜) 및 합사 측면 공기역학 풍압력 산출
  const rigSideArea = wormLengthInches * 0.0254 * 0.008 + 0.00015;
  const lineDiam = 0.000165 * Math.sqrt(safePE);
  const lineArea = effectiveDist * 1.08 * lineDiam;

  const absCross = Math.abs(crosswindMps);
  const dynamicPressure = 0.5 * 1.225 * absCross * absCross;
  const fCross = dynamicPressure * (0.65 * rigSideArea + 0.35 * 1.1 * lineArea);
  const mKg = safeWeight / 1000;
  const aCross = fCross / mKg;

  // 텐션 억제 감쇠 계수 및 라인 공기 연행력
  const tensionDamping = 0.38;
  let driftM =
    0.5 * aCross * flightTimeSec * flightTimeSec * tensionDamping +
    absCross * flightTimeSec * 0.06 * Math.sqrt(safePE);
  driftM = Math.min(effectiveDist * 0.35, driftM);
  const signedDrift = crosswindMps >= 0 ? driftM : -driftM;

  // 7. 목표 지점 벡터에 횡방향 오프셋 벡터 합성
  const radTarget = (targetBearingDeg * Math.PI) / 180;
  const xTarget = effectiveDist * Math.sin(radTarget);
  const yTarget = effectiveDist * Math.cos(radTarget);

  const radNormal = ((targetBearingDeg + 90) * Math.PI) / 180;
  const xActual = xTarget + signedDrift * Math.sin(radNormal);
  const yActual = yTarget + signedDrift * Math.cos(radNormal);

  const actualDistanceM = Math.round(Math.sqrt(xActual * xActual + yActual * yActual));
  const actualBearingRad = Math.atan2(xActual, yActual);
  const actualBearingDeg = Math.round(((actualBearingRad * 180) / Math.PI + 360) % 360);

  let driftAngleDeg = (actualBearingDeg - targetBearingDeg) % 360;
  if (driftAngleDeg > 180) driftAngleDeg -= 360;
  if (driftAngleDeg < -180) driftAngleDeg += 360;

  return {
    targetDistanceM: effectiveDist,
    targetBearingDeg,
    actualDistanceM,
    actualBearingDeg,
    driftDistanceM: Math.round(driftM * 10) / 10,
    driftAngleDeg,
    flightTimeSec,
    headwindMps: Math.round(headwindMps * 10) / 10,
    crosswindMps: Math.round(crosswindMps * 10) / 10,
  };
}

/**
 * 수중 침강 물리 및 조류 연동 폴링(바닥 안착) 시간 & 조류 흘림 거리 산출
 * @param weightGrams 루어/싱커 무게 (g)
 * @param depthMeters 착수 지점 수심 (m)
 * @param currentVelocityMps 실시간 조류 유속 (m/s)
 * @param baitConfig 미끼 스펙 (무게 합산 및 수중 유체 항력 반영)
 */
export function calculateSinkingPhysics(
  weightGrams: number,
  depthMeters: number,
  currentVelocityMps: number = 0.3,
  baitConfig: BaitConfig = getBaitSpecs('LIVE', 2, 'GRUB')
): {
  sinkSpeedMps: number;
  effSinkSpeedMps: number;
  fallTimeSec: number;
  driftDistanceM: number;
  totalWeightGrams: number;
} {
  let safeTotalWeight: number;
  let hydroDragFactor: number;

  if (baitConfig.type === 'CASTING_BALL') {
    const ballW = baitConfig.castingBallWeightGrams ?? ((baitConfig.castingBallHo ?? 3.0) * 3.75);
    const jhW = baitConfig.jigheadWeightGrams ?? 1.0;
    const wormW = baitConfig.weightGrams ?? 2.5;
    safeTotalWeight = Math.max(0.5, Math.min(200, ballW + jhW + wormW));
    hydroDragFactor = 0.65; // 던질찌의 부력 및 유체 저항 감속
  } else if (baitConfig.type === 'METAL') {
    const metalW = baitConfig.metalWeightGrams ?? weightGrams;
    safeTotalWeight = Math.max(1.0, Math.min(200, metalW));
    hydroDragFactor = 1.45; // 고비중 메탈의 고속 수중 침강
  } else {
    const safeSinkerWeight = Math.max(0.5, Math.min(160, weightGrams));
    safeTotalWeight = Math.max(0.5, Math.min(180, safeSinkerWeight + baitConfig.weightGrams));
    const baitDragRatio = Math.max(0.6, baitConfig.surfaceAreaCm2) / 2.0;
    hydroDragFactor = Math.pow(1.0 / baitDragRatio, 0.25);
  }

  const safeDepth = Math.max(1.0, Math.min(60, depthMeters));
  const safeCurrent = Math.max(0.0, Math.min(3.0, currentVelocityMps));

  // 2. 정지 수역 수중 종단 침강 속도 (v_sink = 0.28 * sqrt(W_total) * hydroDrag)
  const rawSinkSpeed = 0.28 * Math.sqrt(safeTotalWeight) * hydroDragFactor;
  const sinkSpeedMps = Math.round(Math.max(0.15, Math.min(4.0, rawSinkSpeed)) * 100) / 100;

  // 3. 조류에 의한 원줄(합사) 배불뚝이(Belly) 양력 감쇄 효과
  const currentRatio = safeCurrent / (0.6 * sinkSpeedMps);
  const effSinkSpeedMps = Math.round((sinkSpeedMps / Math.sqrt(1 + currentRatio * currentRatio)) * 100) / 100;

  // 4. 바닥 안착(폴링) 총 소요 시간 (초)
  const fallTimeSec = Math.max(1, Math.round(safeDepth / Math.max(0.15, effSinkSpeedMps)));

  // 5. 침강 중 조류 방향으로 밀려가는 흘림 거리 (m)
  const driftDistanceM = Math.round(safeCurrent * fallTimeSec * 10) / 10;

  return {
    sinkSpeedMps,
    effSinkSpeedMps,
    fallTimeSec,
    driftDistanceM,
    totalWeightGrams: Math.round(safeTotalWeight * 10) / 10,
  };
}

export function getSavedTackleConfig(): TackleRigConfig {
  let weight = 25;
  let pe = 1.0;
  let rodPower: RodPower = 'M';
  let rodLengthM = 2.6; // 기본 8.6ft = 2.6m
  let baitType: BaitType = 'LURE';
  let baitLength = 2;
  let baitLengthCm = 6.0;
  let baitShape: LureShape = 'GRUB';
  let castingBallHo = 3.0;
  let jigheadWeightGrams = 1.0;
  let metalWeightGrams = 28.0;

  if (typeof window !== 'undefined') {
    try {
      const savedW = localStorage.getItem(KEY_RIG_WEIGHT);
      const savedPE = localStorage.getItem(KEY_PE_LINE);
      const savedPower = localStorage.getItem(KEY_ROD_POWER) as string | null;
      const savedLenM = localStorage.getItem(KEY_ROD_LENGTH_M);
      const savedLenFt = localStorage.getItem(KEY_ROD_LENGTH);
      const savedBaitType = localStorage.getItem(KEY_BAIT_TYPE) as BaitType | null;
      const savedBaitLen = localStorage.getItem(KEY_BAIT_LENGTH);
      const savedBaitLenCm = localStorage.getItem(KEY_BAIT_LENGTH_CM);
      const savedBaitShape = localStorage.getItem(KEY_BAIT_SHAPE) as LureShape | null;
      const savedBallHo = localStorage.getItem(KEY_CASTING_BALL_HO);
      const savedJH = localStorage.getItem(KEY_JIGHEAD_WEIGHT);
      const savedMetalW = localStorage.getItem(KEY_METAL_WEIGHT);

      if (savedW) weight = parseFloat(savedW) || 25;
      if (savedPE) pe = parseFloat(savedPE) || 1.0;

      // XH 레거시는 원투대(SURF)로 자동 전환
      if (savedPower === 'XH' || savedPower === 'SURF') {
        rodPower = 'SURF';
      } else if (savedPower && ROD_POWER_SPECS[savedPower as RodPower]) {
        rodPower = savedPower as RodPower;
      }

      if (savedLenM) {
        rodLengthM = parseFloat(savedLenM) || (rodPower === 'SURF' ? 4.2 : 2.6);
      } else if (savedLenFt) {
        const ft = parseFloat(savedLenFt) || 8.6;
        rodLengthM = Math.round(ft * 0.3048 * 10) / 10;
      }

      if (savedBaitType === 'LIVE' || savedBaitType === 'LURE' || savedBaitType === 'CASTING_BALL' || savedBaitType === 'METAL') {
        baitType = savedBaitType;
      }
      if (savedBaitLen) baitLength = parseInt(savedBaitLen, 10) || 2;
      if (savedBaitLenCm) baitLengthCm = parseFloat(savedBaitLenCm) || 6.0;
      if (savedBaitShape && ['GRUB', 'SHAD', 'STRAIGHT', 'MINNOW'].includes(savedBaitShape)) {
        baitShape = savedBaitShape;
      }
      if (savedBallHo) castingBallHo = parseFloat(savedBallHo) || 3.0;
      if (savedJH) jigheadWeightGrams = parseFloat(savedJH) || 1.0;
      if (savedMetalW) metalWeightGrams = parseFloat(savedMetalW) || 28.0;
    } catch {
      // ignore
    }
  }

  // 원투대/루어대 규격 안전 정규화
  const rodType: RodType = rodPower === 'SURF' ? 'SURF' : 'LURE';
  if (rodType === 'SURF') {
    if (!SURF_ROD_LENGTHS_M.includes(rodLengthM as any)) {
      rodLengthM = 4.2;
    }
    baitType = 'LIVE'; // 원투대는 현행대로 생미끼
    if (weight < 30) weight = 93.8; // 원투 봉돌 기본값 (25호)
  } else {
    rodLengthM = Math.max(1.6, Math.min(3.0, rodLengthM));
    if (baitType === 'LIVE') baitType = 'LURE'; // 루어대에서는 루어가 기본
    if (baitType === 'METAL') {
      weight = metalWeightGrams;
    } else if (baitType === 'CASTING_BALL') {
      weight = Math.round((castingBallHo * 3.75 + jigheadWeightGrams) * 10) / 10;
    }
  }

  const baitConfig = getBaitSpecs(
    baitType,
    baitLength,
    baitShape,
    baitLengthCm,
    castingBallHo,
    jigheadWeightGrams,
    metalWeightGrams
  );

  const { distanceMeters, elasticityEfficiency, lengthFactor, totalWeightGrams } = calculateCalibratedDistance(
    weight,
    pe,
    rodPower,
    rodLengthM,
    baitConfig
  );

  const rodLengthFt = Math.round(rodLengthM * 3.28084 * 10) / 10;
  const r1 = Math.round(distanceMeters * 0.5);
  const r2 = distanceMeters;
  const r3 = Math.round(distanceMeters * 1.5);

  return {
    weightGrams: weight,
    totalWeightGrams,
    baitConfig,
    peLineSize: pe,
    rodType,
    rodPower,
    rodLengthM,
    rodLengthFt,
    calibratedDistanceMeters: distanceMeters,
    radii: [r1, r2, r3],
    rodElasticityEfficiency: elasticityEfficiency,
    rodLengthFactor: lengthFactor,
  };
}

export function saveTackleConfig(
  weightGrams: number,
  peLineSize: number,
  rodPower?: RodPower,
  rodLength?: number, // m 단위 (만약 6.0 이상이면 ft로 간주하여 m로 변환)
  baitType?: BaitType,
  baitLength?: number,
  baitShape?: LureShape,
  baitLengthCm?: number,
  castingBallHo?: number,
  jigheadWeightGrams?: number,
  metalWeightGrams?: number
): TackleRigConfig {
  if (typeof window !== 'undefined') {
    try {
      let finalPower = rodPower;
      if (finalPower === ('XH' as any)) finalPower = 'SURF';
      if (finalPower) localStorage.setItem(KEY_ROD_POWER, finalPower);
      else {
        finalPower = (localStorage.getItem(KEY_ROD_POWER) as RodPower) || 'M';
      }

      if (rodLength !== undefined) {
        let lengthM = rodLength;
        if (rodLength > 6.0) {
          lengthM = Math.round(rodLength * 0.3048 * 10) / 10;
        }
        localStorage.setItem(KEY_ROD_LENGTH_M, String(lengthM));
        localStorage.setItem(KEY_ROD_LENGTH, String(Math.round(lengthM * 3.28084 * 10) / 10));
      }

      let finalBaitType = baitType;
      if (!finalBaitType) {
        finalBaitType = (localStorage.getItem(KEY_BAIT_TYPE) as BaitType) || (finalPower === 'SURF' ? 'LIVE' : 'LURE');
      }
      if (finalPower === 'SURF') finalBaitType = 'LIVE';
      else if (finalBaitType === 'LIVE') finalBaitType = 'LURE';
      localStorage.setItem(KEY_BAIT_TYPE, finalBaitType);

      if (baitLength !== undefined) localStorage.setItem(KEY_BAIT_LENGTH, String(baitLength));
      if (baitLengthCm !== undefined) localStorage.setItem(KEY_BAIT_LENGTH_CM, String(baitLengthCm));
      if (baitShape) localStorage.setItem(KEY_BAIT_SHAPE, baitShape);

      if (castingBallHo !== undefined) localStorage.setItem(KEY_CASTING_BALL_HO, String(castingBallHo));
      if (jigheadWeightGrams !== undefined) localStorage.setItem(KEY_JIGHEAD_WEIGHT, String(jigheadWeightGrams));
      if (metalWeightGrams !== undefined) localStorage.setItem(KEY_METAL_WEIGHT, String(metalWeightGrams));

      // 미끼 타입에 따른 weightGrams 동기화
      let finalWeight = weightGrams;
      if (finalPower !== 'SURF') {
        if (finalBaitType === 'METAL') {
          const mWeight = metalWeightGrams !== undefined ? metalWeightGrams : (parseFloat(localStorage.getItem(KEY_METAL_WEIGHT) || '28') || 28);
          finalWeight = mWeight;
        } else if (finalBaitType === 'CASTING_BALL') {
          const ho = castingBallHo !== undefined ? castingBallHo : (parseFloat(localStorage.getItem(KEY_CASTING_BALL_HO) || '3') || 3);
          const jh = jigheadWeightGrams !== undefined ? jigheadWeightGrams : (parseFloat(localStorage.getItem(KEY_JIGHEAD_WEIGHT) || '1') || 1);
          finalWeight = Math.round((ho * 3.75 + jh) * 10) / 10;
        }
      }
      localStorage.setItem(KEY_RIG_WEIGHT, String(finalWeight));
      localStorage.setItem(KEY_PE_LINE, String(peLineSize));

      window.dispatchEvent(
        new CustomEvent('exfish_tackle_updated', {
          detail: {
            weightGrams: finalWeight,
            peLineSize,
            rodPower: finalPower,
            rodLength,
            baitType: finalBaitType,
            baitLength,
            baitShape,
            baitLengthCm,
            castingBallHo,
            jigheadWeightGrams,
            metalWeightGrams,
          },
        })
      );
    } catch {
      // ignore
    }
  }
  return getSavedTackleConfig();
}
