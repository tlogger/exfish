// ExFish 유저 맞춤형 공기역학 채비 및 로드 탄성 비거리 & 수중 침강(폴링) 물리 엔진
// 1. 낚싯대 파워(루어대 UL~H, 원투대) 탄성 곡선 + 로드 길이(m, ft) 레버 암 공식
// 2. 루어/싱커 무게(지그헤드 1~5g, 1/32~1oz, 주꾸미 3~7호, 원투 8~40호) + 합사 PE 라인 공기저항 비거리 계산
// 3. 착수 수심(m) 및 조류 유속(m/s)을 고려한 유효 침강 속도, 바닥 안착 소요 시간, 조류 흘림 거리 산출

export type RodType = 'LURE' | 'SURF';
export type RodPower = 'UL' | 'L' | 'ML' | 'M' | 'MH' | 'H' | 'SURF';

// 미끼 선택 모델: 생미끼(원투용), 루어(지그헤드/싱커+웜/에기), 캐스팅볼(던질찌/구멍찌), 메탈(메탈지그 1~80g)
export type BaitType = 'LIVE' | 'LURE' | 'CASTING_BALL' | 'METAL';
export type LureSubMode = 'JIG' | 'OZ' | 'JUKKUMI';
export type CastingBallSubMode = 'REAL_BALL' | 'VARIANT_FLOAT';
export type LureShape = 'GRUB' | 'SHAD' | 'STRAIGHT' | 'MINNOW';
export const LURE_SHAPES: LureShape[] = ['GRUB', 'SHAD', 'STRAIGHT'];

export interface BaitConfig {
  type: BaitType;
  lureSubMode?: LureSubMode; // 루어 하위 모드 ('JIG' | 'OZ' | 'JUKKUMI')
  lengthInches: number; // 1 ~ 4 (루어, 캐스팅볼용)
  lengthCm?: number; // 2.5 ~ 16.0cm (메탈용)
  shape: LureShape;
  weightGrams: number; // 웜 자중 또는 에기/메탈 자중
  surfaceAreaCm2: number;

  // 주꾸미 / 에기 전용
  egiWeightGrams?: number; // 에기 자체 무게 (예: 6.5g, 10g, 15g 등)
  sinkerWeightGrams?: number; // 추가 봉돌 무게 (0g 허용!)

  // 캐스팅볼 전용
  castingBallSubMode?: CastingBallSubMode; // 'REAL_BALL' (던질찌) vs 'VARIANT_FLOAT' (구멍찌)
  castingBallWeightGrams?: number; // 던질찌 / 구멍찌 자중 (1~40g)
  castingBallHo?: number; // 구멍찌 호수 (0.5호~3.0호)
  jigheadWeightGrams?: number; // 지그헤드 무게 (0.5~20g)

  // 메탈 지그 전용
  metalWeightGrams?: number; // 메탈 무게 (1~80g)
}

export const LURE_SHAPE_NAMES: Record<LureShape, string> = {
  GRUB: '그럽웜',
  SHAD: '쉐드웜',
  STRAIGHT: '스트레이트',
  MINNOW: '미노우',
};

// 루어 형상별 공기 항력 계수 (Cd_air: 슬림 직선형 < 그럽 컬테일 < 쉐드 패들테일)
export const LURE_AIR_DRAG_CD: Record<LureShape, number> = {
  STRAIGHT: 0.28,
  GRUB: 0.42,
  SHAD: 0.56,
  MINNOW: 0.34,
};

// 루어 형상별 수중 유체 항력 계수 (Cd_water: 스트레이트 < 그럽웜 < 쉐드웜)
export const LURE_HYDRO_DRAG_CD: Record<LureShape, number> = {
  STRAIGHT: 0.82,
  GRUB: 1.12,
  SHAD: 1.42,
  MINNOW: 1.00,
};

// 본체(던질찌, 구멍찌, 메탈지그) 형상별 공기·유체 항력 계수
export const BODY_AIR_DRAG_CD = {
  REAL_BALL: 0.34,     // 던질찌 (유선형 슬림 캐스팅 바디)
  VARIANT_FLOAT: 0.54, // 구멍찌 (부피가 큰 구형/타원형 바디)
  METAL_JIG: 0.22,     // 메탈지그 (고밀도 유선형 금속 바디)
} as const;

export const BODY_HYDRO_DRAG_CD = {
  REAL_BALL: 0.95,
  VARIANT_FLOAT: 1.15,
  METAL_JIG: 0.35,     // 메탈지그 최소 수중 형상 저항 (고속 폴링)
} as const;

const WORM_WEIGHT_TABLE: Record<LureShape, Record<number, number>> = {
  GRUB: { 1: 1.0, 2: 2.5, 3: 5.0, 4: 9.0 },
  SHAD: { 1: 1.2, 2: 3.2, 3: 6.8, 4: 12.5 },
  STRAIGHT: { 1: 0.8, 2: 1.8, 3: 3.6, 4: 6.2 },
  MINNOW: { 1: 1.6, 2: 4.2, 3: 8.8, 4: 15.5 },
};

const WORM_AREA_TABLE: Record<LureShape, Record<number, number>> = {
  GRUB: { 1: 1.2, 2: 2.0, 3: 3.5, 4: 5.2 },
  SHAD: { 1: 1.4, 2: 2.6, 3: 4.8, 4: 7.5 },
  STRAIGHT: { 1: 0.9, 2: 1.5, 3: 2.4, 4: 3.5 },
  MINNOW: { 1: 1.8, 2: 3.2, 3: 5.6, 4: 8.8 },
};

function getWormGeometry(shape: LureShape, lengthInches: number): { safeLen: number; weightGrams: number; areaCm2: number } {
  const safeLen = Math.max(1, Math.min(4, Math.round(lengthInches)));
  return {
    safeLen,
    weightGrams: WORM_WEIGHT_TABLE[shape]?.[safeLen] ?? 2.5,
    areaCm2: WORM_AREA_TABLE[shape]?.[safeLen] ?? 2.0,
  };
}

// 에기 규격 프리셋 (2.0호 ~ 4.0호)
export interface EgiPreset {
  ho: number;
  label: string;
  weightGrams: number;
  desc: string;
}

export const EGI_WEIGHT_PRESETS: EgiPreset[] = [
  { ho: 2.0, label: '2.0호', weightGrams: 6.5, desc: '한치/라이트' },
  { ho: 2.5, label: '2.5호', weightGrams: 10.0, desc: '주꾸미/갑오징어' },
  { ho: 3.0, label: '3.0호', weightGrams: 15.0, desc: '무늬/갑오징어' },
  { ho: 3.5, label: '3.5호', weightGrams: 20.0, desc: '무늬오징어/문어' },
  { ho: 4.0, label: '4.0호', weightGrams: 25.0, desc: '대물 무늬/문어' },
];

// 주꾸미/문어/무늬 봉돌 프리셋 (0g 노싱커 포함)
export interface SinkerPreset {
  ho: number;
  label: string;
  weightGrams: number;
  desc: string;
}

export const JUKKUMI_SINKER_PRESETS: SinkerPreset[] = [
  { ho: 0, label: '0g', weightGrams: 0, desc: '에기 단독' },
  { ho: 3, label: '3호', weightGrams: 11.3, desc: '11.3g' },
  { ho: 4, label: '4호', weightGrams: 15.0, desc: '15.0g' },
  { ho: 5, label: '5호', weightGrams: 18.8, desc: '18.8g' },
  { ho: 6, label: '6호', weightGrams: 22.5, desc: '22.5g' },
];

// 구멍찌 규격 프리셋 (0.5호 ~ 3.0호 실측 규격표)
export interface VariantFloatPreset {
  ho: number;
  label: string;
  weightGrams: number;
  buoyancyG: number;
  sizeSpec: string;
  recSinker: string;
  recSinkerWeightG: number;
  recJighead: string;
  recJigheadWeightG?: number;
  desc: string;
}

export const VARIANT_FLOAT_HO_PRESETS: VariantFloatPreset[] = [
  { ho: 0.5, label: '0.5호', weightGrams: 20.46, buoyancyG: 3.5, sizeSpec: '5.1/3', recSinker: '4B',    recSinkerWeightG: 1.2,  recJighead: '-',           desc: '20.46g / 부력 3.5g' },
  { ho: 1.0, label: '1.0호', weightGrams: 18.32, buoyancyG: 5.0, sizeSpec: '-',     recSinker: '0.8호', recSinkerWeightG: 3.0,  recJighead: '1/8 (3.5g)',  recJigheadWeightG: 3.5,  desc: '18.32g / 부력 5.0g' },
  { ho: 1.5, label: '1.5호', weightGrams: 16.79, buoyancyG: 6.0, sizeSpec: '-',     recSinker: '1.0호', recSinkerWeightG: 3.75, recJighead: '1/8 (3.5g)',  recJigheadWeightG: 3.5,  desc: '16.79g / 부력 6.0g' },
  { ho: 2.0, label: '2.0호', weightGrams: 15.15, buoyancyG: 7.5, sizeSpec: '-',     recSinker: '1.5호', recSinkerWeightG: 5.62, recJighead: '1/4 (7g)',    recJigheadWeightG: 7.0,  desc: '15.15g / 부력 7.5g' },
  { ho: 2.5, label: '2.5호', weightGrams: 14.42, buoyancyG: 8.0, sizeSpec: '-',     recSinker: '2.0호', recSinkerWeightG: 7.5,  recJighead: '1/4 (7g)',    recJigheadWeightG: 7.0,  desc: '14.42g / 부력 8.0g' },
  { ho: 3.0, label: '3.0호', weightGrams: 13.92, buoyancyG: 10,  sizeSpec: '-',     recSinker: '2.5호', recSinkerWeightG: 9.38, recJighead: '3/8 (10.5g)', recJigheadWeightG: 10.5, desc: '13.92g / 부력 10g' },
];

export function getVariantFloatWeightByHo(ho: number): number {
  const exact = VARIANT_FLOAT_HO_PRESETS.find((p) => Math.abs(p.ho - ho) < 0.05);
  if (exact) return exact.weightGrams;
  let best = VARIANT_FLOAT_HO_PRESETS[1];
  let minDiff = Infinity;
  for (const p of VARIANT_FLOAT_HO_PRESETS) {
    const d = Math.abs(p.ho - ho);
    if (d < minDiff) {
      minDiff = d;
      best = p;
    }
  }
  return best.weightGrams;
}

// 던질찌 규격 프리셋 (버튼: 3, 5, 7, 10, 20g / 슬라이더: 1~40g)
export const REAL_CASTING_BALL_PRESETS = [3, 5, 7, 10, 20] as const;

// 레거시 호환용 캐스팅볼 규격 프리셋 (1호 ~ 8호)
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
  { id: 'jh-0.5g', type: 'g',  label: '0.5g', weightGrams: 0.5 },
  { id: 'jh-1g',   type: 'g',  label: '1g',   weightGrams: 1.0 },
  { id: 'jh-1.5g', type: 'g',  label: '1.5g', weightGrams: 1.5 },
  { id: 'jh-2g',   type: 'g',  label: '2g',   weightGrams: 2.0 },
  { id: 'jh-3g',   type: 'g',  label: '3g',   weightGrams: 3.0 },
  { id: 'jh-5g',   type: 'g',  label: '5g',   weightGrams: 5.0 },
  { id: 'jh-7g',   type: 'g',  label: '7g',   weightGrams: 7.0 },
  { id: 'jh-10g',  type: 'g',  label: '10g',  weightGrams: 10.0 },
  { id: 'jh-1-32', type: 'oz', label: '1/32oz', weightGrams: 0.9 },
  { id: 'jh-1-16', type: 'oz', label: '1/16oz', weightGrams: 1.8 },
  { id: 'jh-1-8',  type: 'oz', label: '1/8oz',  weightGrams: 3.5 },
  { id: 'jh-1-4',  type: 'oz', label: '1/4oz',  weightGrams: 7.1 },
  { id: 'jh-3-8',  type: 'oz', label: '3/8oz',  weightGrams: 10.6 },
];

// 메탈 지그 무게 퀵 프리셋 (버튼: 10, 20, 30, 40g / 슬라이더: 1~80g)
export const METAL_WEIGHT_PRESETS = [10, 20, 30, 40] as const;

// 메탈 지그 길이 퀵 프리셋 (레거시 호환용 보존)
export const METAL_LENGTH_PRESETS = [3.5, 5.0, 6.5, 8.0, 10.0, 12.0, 14.0] as const;

export function getBaitSpecs(
  type: BaitType,
  lengthInches: number = 2,
  shape: LureShape = 'GRUB',
  lengthCm: number = 6.0,
  castingBallHo: number = 3.0,
  jigheadWeightGrams: number = 1.0,
  metalWeightGrams: number = 20.0,
  lureSubMode: LureSubMode = 'OZ',
  castingBallSubMode: CastingBallSubMode = 'REAL_BALL',
  castingBallWeightGrams?: number,
  egiWeightGrams: number = 15.0,
  sinkerWeightGrams: number = 0.0
): BaitConfig {
  if (type === 'LIVE') {
    return {
      type: 'LIVE',
      lengthInches: 2,
      shape: 'GRUB',
      weightGrams: 2.5,
      surfaceAreaCm2: 2.0,
    };
  }

  if (type === 'METAL') {
    const safeCm = Math.max(2.5, Math.min(16.0, Math.round(lengthCm * 2) / 2));
    const safeMetalWeight = Math.max(1, Math.min(80, Math.round(metalWeightGrams * 10) / 10));
    const surfaceAreaCm2 = Math.round((0.35 * Math.pow(safeMetalWeight, 2 / 3) + 0.3) * 10) / 10;

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
    const safeJighead = Math.max(0.5, Math.min(20, Math.round(jigheadWeightGrams * 10) / 10));
    const { safeLen, weightGrams: wormWeight, areaCm2: wormArea } = getWormGeometry(shape, lengthInches);

    if (castingBallSubMode === 'VARIANT_FLOAT') {
      // 구멍찌 (규격표 0.5호~3.0호 또는 1~40g 슬라이더)
      const safeHo = Math.max(0.5, Math.min(3.0, Math.round(castingBallHo * 10) / 10));
      const floatWeight = castingBallWeightGrams !== undefined
        ? Math.max(1, Math.min(40, Math.round(castingBallWeightGrams * 100) / 100))
        : getVariantFloatWeightByHo(safeHo);
      const floatArea = Math.round((Math.PI * Math.pow(Math.cbrt(floatWeight) * 0.9 + 0.8, 2)) * 10) / 10;

      return {
        type: 'CASTING_BALL',
        castingBallSubMode: 'VARIANT_FLOAT',
        lengthInches: safeLen,
        lengthCm: Math.round(safeLen * 2.54 * 10) / 10,
        shape,
        weightGrams: wormWeight,
        castingBallHo: safeHo,
        castingBallWeightGrams: floatWeight,
        jigheadWeightGrams: safeJighead,
        surfaceAreaCm2: Math.round((floatArea + wormArea * 0.3) * 10) / 10,
      };
    } else {
      // 던질찌 (1~40g 슬라이더 선택)
      const safeBallWeight = castingBallWeightGrams !== undefined
        ? Math.max(1, Math.min(40, Math.round(castingBallWeightGrams * 100) / 100))
        : Math.max(1, Math.min(40, Math.round(castingBallHo * 3.75 * 10) / 10));
      const safeHo = castingBallWeightGrams !== undefined
        ? Math.round((safeBallWeight / 3.75) * 10) / 10
        : castingBallHo;
      const ballArea = safeBallWeight > 0 ? Math.round((Math.PI * Math.pow(Math.cbrt(safeBallWeight) * 0.6 + 0.4, 2)) * 10) / 10 : 0;

      return {
        type: 'CASTING_BALL',
        castingBallSubMode: 'REAL_BALL',
        lengthInches: safeLen,
        lengthCm: Math.round(safeLen * 2.54 * 10) / 10,
        shape,
        weightGrams: wormWeight,
        castingBallWeightGrams: safeBallWeight,
        castingBallHo: safeHo,
        jigheadWeightGrams: safeJighead,
        surfaceAreaCm2: Math.round((ballArea + wormArea * 0.3) * 10) / 10,
      };
    }
  }

  // 루어 (JIG / OZ / JUKKUMI)
  if (lureSubMode === 'JUKKUMI') {
    const safeEgiWeight = Math.max(5.0, Math.min(35.0, Math.round(egiWeightGrams * 10) / 10));
    const safeSinkerWeight = Math.max(0.0, Math.min(22.5, Math.round(sinkerWeightGrams * 10) / 10)); // 0g ~ 6호(22.5g)
    const egiArea = 4.2; // 에기 기본 단면적
    const sinkerArea = safeSinkerWeight > 0 ? Math.round((Math.PI * Math.pow(Math.cbrt(safeSinkerWeight) * 0.45, 2)) * 10) / 10 : 0;

    return {
      type: 'LURE',
      lureSubMode: 'JUKKUMI',
      lengthInches: 3,
      lengthCm: 8.5,
      shape: 'MINNOW',
      weightGrams: safeEgiWeight,
      egiWeightGrams: safeEgiWeight,
      sinkerWeightGrams: safeSinkerWeight,
      surfaceAreaCm2: Math.round((egiArea + sinkerArea) * 10) / 10,
    };
  }

  // 일반 웜 루어 (JIG / OZ)
  const { safeLen, weightGrams, areaCm2: surfaceAreaCm2 } = getWormGeometry(shape, lengthInches);

  return {
    type: 'LURE',
    lureSubMode,
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
      if (baitConfig.castingBallSubMode === 'VARIANT_FLOAT') {
        const ho = baitConfig.castingBallHo ?? 1.0;
        const bw = baitConfig.castingBallWeightGrams ?? getVariantFloatWeightByHo(ho);
        const jh = baitConfig.jigheadWeightGrams ?? 1.0;
        return `구멍찌 ${ho}호(${bw}g) + 지그헤드 ${jh}g`;
      } else {
        const bw = baitConfig.castingBallWeightGrams ?? 10.0;
        const jh = baitConfig.jigheadWeightGrams ?? 1.0;
        return `던질찌 ${bw}g + 지그헤드 ${jh}g`;
      }
    }
    if (baitConfig.type === 'METAL') {
      const mw = baitConfig.metalWeightGrams ?? weightGrams;
      return `메탈지그 ${mw}g`;
    }
    if (baitConfig.lureSubMode === 'JUKKUMI') {
      const ew = baitConfig.egiWeightGrams ?? 15;
      const sw = baitConfig.sinkerWeightGrams ?? 0;
      return sw === 0 ? `에기 ${ew}g (0g)` : `에기 ${ew}g + 추 ${sw}g (총 ${ew + sw}g)`;
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
const KEY_LURE_SUBMODE = 'exfish_lure_submode';
const KEY_BAIT_LENGTH = 'exfish_bait_length';
const KEY_BAIT_LENGTH_CM = 'exfish_bait_length_cm';
const KEY_BAIT_SHAPE = 'exfish_bait_shape';
const KEY_CASTING_BALL_SUBMODE = 'exfish_casting_ball_submode';
const KEY_CASTING_BALL_WEIGHT = 'exfish_casting_ball_weight_g';
const KEY_CASTING_BALL_HO = 'exfish_casting_ball_ho';
const KEY_JIGHEAD_WEIGHT = 'exfish_jighead_weight_g';
const KEY_METAL_WEIGHT = 'exfish_metal_weight_g';
const KEY_EGI_WEIGHT = 'exfish_egi_weight_g';
const KEY_SINKER_WEIGHT = 'exfish_sinker_weight_g';

export interface TackleRigConfig {
  weightGrams: number; // 싱커/추/봉돌 무게 (0.9g ~ 150g)
  totalWeightGrams: number; // 봉돌 + 미끼 합산 총 무게
  baitConfig: BaitConfig; // 미끼 스펙
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
  let ballisticWeightG: number;
  let baitAirFactor = 1.0;

  if (baitConfig.type === 'CASTING_BALL') {
    const isVariant = baitConfig.castingBallSubMode === 'VARIANT_FLOAT';
    const ballW = isVariant
      ? (baitConfig.castingBallWeightGrams ?? getVariantFloatWeightByHo(baitConfig.castingBallHo ?? 1.0))
      : (baitConfig.castingBallWeightGrams ?? 10.0);
    const jhW = baitConfig.jigheadWeightGrams ?? 1.0;
    const wormW = baitConfig.weightGrams ?? 2.5;
    safeTotalWeight = Math.max(0.5, Math.min(200, ballW + jhW + wormW));
    // 캐스팅 추진 주체는 본체(던질찌/구멍찌)+지그헤드이며 웜 트레일러는 공기저항 성분으로 작용
    ballisticWeightG = Math.max(0.5, Math.min(200, ballW + jhW));

    const { areaCm2: wormArea } = getWormGeometry(baitConfig.shape, baitConfig.lengthInches);
    const wormAirCd = LURE_AIR_DRAG_CD[baitConfig.shape] ?? LURE_AIR_DRAG_CD.GRUB;
    const bodyAirTerm = isVariant
      ? BODY_AIR_DRAG_CD.VARIANT_FLOAT * 1.35 // 부력체 구형/타원형 체적 저항 (0.729)
      : BODY_AIR_DRAG_CD.REAL_BALL * 0.90;    // 유선형 고비중 던질찌 저항 (0.306)
    const trailerAirTerm = (0.24 * wormAirCd * wormArea) / Math.pow(Math.max(4, ballisticWeightG), 0.35);
    const combinedDragIndex = bodyAirTerm + trailerAirTerm;
    baitAirFactor = Math.pow(0.52 / Math.max(0.25, combinedDragIndex), 0.16);
  } else if (baitConfig.type === 'METAL') {
    const metalW = baitConfig.metalWeightGrams ?? weightGrams;
    safeTotalWeight = Math.max(1.0, Math.min(200, metalW));
    ballisticWeightG = safeTotalWeight;
    const areaPerMassExp = Math.max(0.5, baitConfig.surfaceAreaCm2) / Math.pow(Math.max(1, metalW), 2 / 3);
    const metalDragIndex = BODY_AIR_DRAG_CD.METAL_JIG * (0.75 + 0.04 * areaPerMassExp);
    baitAirFactor = Math.pow(0.52 / Math.max(0.12, metalDragIndex), 0.11);
  } else {
    // 루어 (JIG / OZ / JUKKUMI)
    if (baitConfig.lureSubMode === 'JUKKUMI') {
      const egiW = baitConfig.egiWeightGrams ?? 15.0;
      const sinkerW = Math.max(0.0, baitConfig.sinkerWeightGrams ?? 0.0); // 0g 가능!
      safeTotalWeight = Math.max(1.0, Math.min(200, egiW + sinkerW));
      ballisticWeightG = safeTotalWeight;
      baitAirFactor = sinkerW === 0
        ? 0.95
        : Math.min(1.06, 0.95 + 0.11 * (sinkerW / (sinkerW + 8.0)));
    } else {
      const safeSinkerWeight = Math.max(0.5, Math.min(160, weightGrams));
      safeTotalWeight = Math.max(0.5, Math.min(180, safeSinkerWeight + baitConfig.weightGrams));
      // 소프트웜은 저밀도·플랩 항력으로 인해 비거리 추진에는 납 싱커가 주체, 형상/길이 공기저항 정밀 반영
      ballisticWeightG = safeSinkerWeight;
      const { areaCm2: tableArea } = getWormGeometry(baitConfig.shape, baitConfig.lengthInches);
      const effectiveWormArea = Math.max(0.5, baitConfig.surfaceAreaCm2 || tableArea);
      const wormAirCd = LURE_AIR_DRAG_CD[baitConfig.shape] ?? LURE_AIR_DRAG_CD.GRUB;
      const wormDragProduct = wormAirCd * effectiveWormArea; // 2인치 그럽웜 기준: 0.42 * 2.0 = 0.84
      baitAirFactor = Math.pow(0.84 / Math.max(0.2, wormDragProduct), 0.12);
    }
  }

  const safePE = Math.max(0.4, Math.min(3.0, peLineSize));

  if (rodPower === 'SURF') {
    // [원투대 비거리 연산 엔진]
    const safeSurfLengthM = Math.max(2.5, Math.min(6.0, rodLengthM));

    const lengthFactor = Math.pow(safeSurfLengthM / 4.2, 0.70);
    const optWeight = 95.0;
    const weightFactor =
      Math.pow(ballisticWeightG / optWeight, 0.35) *
      Math.exp(-Math.pow(Math.log(ballisticWeightG) - Math.log(optWeight), 2) / (2 * 0.95 * 0.95));

    const lineFactor = Math.pow(1.5 / safePE, 0.20);
    const rawDist = 95.0 * lengthFactor * weightFactor * lineFactor * baitAirFactor;
    const distanceMeters = Math.round(Math.max(20, Math.min(150, rawDist)));

    return {
      distanceMeters,
      elasticityEfficiency: Math.round(Math.min(1.0, weightFactor) * 100) / 100,
      lengthFactor: Math.round(lengthFactor * 100) / 100,
      totalWeightGrams: Math.round(safeTotalWeight * 10) / 10,
    };
  }

  // [루어대 비거리 연산 엔진]
  const rodLengthFt = rodLengthM * 3.28084;
  const safeLengthFt = Math.max(5.0, Math.min(11.0, rodLengthFt));

  const lengthFactor = Math.pow(safeLengthFt / 8.6, 0.65);
  const massPotential = 78.0 * (1 - Math.exp(-0.31 * Math.pow(ballisticWeightG, 0.58)));

  const spec = ROD_POWER_SPECS[rodPower] || ROD_POWER_SPECS.M;
  const optW = spec.optWeightG;

  let sigma = 0.55;
  if (rodPower === 'ML') {
    sigma = 0.65;
  } else if (rodPower === 'MH' || rodPower === 'H') {
    sigma = 0.62;
  }

  const logRatio = Math.log(ballisticWeightG) - Math.log(optW);
  const elasticityEfficiency = Math.exp(-(logRatio * logRatio) / (2 * sigma * sigma));
  const rodEfficiencyFactor = 0.62 + 0.38 * elasticityEfficiency;

  const lineAirFactor = Math.pow(0.8 / safePE, 0.18);

  let spoolGuideFactor = 1.0;
  if (ballisticWeightG < 5.5) {
    const lightDeficit = (5.5 - ballisticWeightG) / 5.0;
    const lineStiffnessPenalty = Math.max(0, safePE - 0.3) / 0.5;
    const loss = 0.38 * Math.pow(lightDeficit, 1.1) * Math.pow(lineStiffnessPenalty, 0.85);
    spoolGuideFactor = Math.max(0.20, 1.0 - loss);
  }

  const rawDist = massPotential * lengthFactor * rodEfficiencyFactor * lineAirFactor * spoolGuideFactor * baitAirFactor;
  const distanceMeters = Math.round(Math.max(3, Math.min(125, rawDist)));

  return {
    distanceMeters,
    elasticityEfficiency: Math.round(elasticityEfficiency * 100) / 100,
    lengthFactor: Math.round(lengthFactor * 100) / 100,
    totalWeightGrams: Math.round(safeTotalWeight * 100) / 100,
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

  const windVectorDeg = (windDirectionDeg + 180) % 360;

  let angleDiff = (windVectorDeg - targetBearingDeg) % 360;
  if (angleDiff > 180) angleDiff -= 360;
  if (angleDiff < -180) angleDiff += 360;
  const alphaRad = (angleDiff * Math.PI) / 180;

  const headwindMps = safeWindSpeed * Math.cos(alphaRad);
  const crosswindMps = safeWindSpeed * Math.sin(alphaRad);

  const weightPenalty = Math.pow(18 / (safeWeight + 5), 0.4);
  const peWindResistance = Math.pow(safePE, 0.2);
  let distRatio = 1.0;
  if (headwindMps >= 0) {
    distRatio += Math.min(0.35, ((headwindMps / 10) * 0.25) / weightPenalty);
  } else {
    distRatio -= Math.min(0.40, (Math.abs(headwindMps) / 10) * 0.28 * weightPenalty * peWindResistance);
  }
  const effectiveDist = Math.max(8, Math.round(baseDistanceM * distRatio));

  const flightTimeSec = Math.round(0.38 * Math.sqrt(effectiveDist) * 10) / 10;

  const rigSideArea = wormLengthInches * 0.0254 * 0.008 + 0.00015;
  const lineDiam = 0.000165 * Math.sqrt(safePE);
  const lineArea = effectiveDist * 1.08 * lineDiam;

  const absCross = Math.abs(crosswindMps);
  const dynamicPressure = 0.5 * 1.225 * absCross * absCross;
  const fCross = dynamicPressure * (0.65 * rigSideArea + 0.35 * 1.1 * lineArea);
  const mKg = safeWeight / 1000;
  const aCross = fCross / mKg;

  const tensionDamping = 0.38;
  let driftM =
    0.5 * aCross * flightTimeSec * flightTimeSec * tensionDamping +
    absCross * flightTimeSec * 0.06 * Math.sqrt(safePE);
  driftM = Math.min(effectiveDist * 0.35, driftM);
  const signedDrift = crosswindMps >= 0 ? driftM : -driftM;

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
  let sinkingWeightG: number;
  let hydroDragFactor: number;

  if (baitConfig.type === 'CASTING_BALL') {
    // 2.1 구멍찌/던질찌 제외: 착수 후 수중 침강은 지그헤드 무게와 트레일러(길이·형상) 저항만으로 계산
    const jhW = baitConfig.jigheadWeightGrams ?? 1.0;
    sinkingWeightG = Math.max(0.3, Math.min(30, jhW));
    const { areaCm2: wormArea } = getWormGeometry(baitConfig.shape, baitConfig.lengthInches);
    const wormHydroCd = LURE_HYDRO_DRAG_CD[baitConfig.shape] ?? LURE_HYDRO_DRAG_CD.GRUB;
    const wormHydroDrag = wormHydroCd * wormArea; // 2인치 그럽 기준: 1.12 * 2.0 = 2.24
    hydroDragFactor = Math.pow(2.24 / Math.max(0.5, wormHydroDrag), 0.24);
  } else if (baitConfig.type === 'METAL') {
    const metalW = baitConfig.metalWeightGrams ?? weightGrams;
    sinkingWeightG = Math.max(1.0, Math.min(200, metalW));
    const areaPerMassExp = Math.max(0.5, baitConfig.surfaceAreaCm2) / Math.pow(Math.max(1, metalW), 2 / 3);
    const metalHydroDrag = BODY_HYDRO_DRAG_CD.METAL_JIG * (0.85 + 0.10 * areaPerMassExp);
    hydroDragFactor = Math.pow(0.75 / Math.max(0.15, metalHydroDrag), 0.35);
  } else {
    if (baitConfig.lureSubMode === 'JUKKUMI') {
      const egiW = baitConfig.egiWeightGrams ?? 15.0;
      const sinkerW = Math.max(0.0, baitConfig.sinkerWeightGrams ?? 0.0);
      // 에기 부력 상쇄 후 유효 수중 침강 중량(~25%) + 납 봉돌(100%)
      sinkingWeightG = Math.max(1.5, Math.min(200, 0.25 * egiW + sinkerW));
      hydroDragFactor = 0.65 + 0.45 * (sinkerW / (sinkerW + 8.0));
    } else {
      // 일반 루어(JIG/OZ): 소프트웜은 해수 비중(~1.03)과 유사하여 싱커/지그헤드 무게만 침강 동력으로 작용하고 웜 길이·형상은 유체저항으로만 작용
      const safeSinkerWeight = Math.max(0.5, Math.min(160, weightGrams));
      sinkingWeightG = safeSinkerWeight;
      const { areaCm2: tableArea } = getWormGeometry(baitConfig.shape, baitConfig.lengthInches);
      const effectiveWormArea = Math.max(0.5, baitConfig.surfaceAreaCm2 || tableArea);
      const wormHydroCd = LURE_HYDRO_DRAG_CD[baitConfig.shape] ?? LURE_HYDRO_DRAG_CD.GRUB;
      const wormHydroDrag = wormHydroCd * effectiveWormArea;
      hydroDragFactor = Math.pow(2.24 / Math.max(0.5, wormHydroDrag), 0.24);
    }
  }

  const safeDepth = Math.max(1.0, Math.min(60, depthMeters));
  const safeCurrent = Math.max(0.0, Math.min(3.0, currentVelocityMps));

  const rawSinkSpeed = 0.26 * Math.sqrt(sinkingWeightG) * hydroDragFactor;
  const sinkSpeedMps = Math.round(Math.max(0.08, Math.min(4.0, rawSinkSpeed)) * 100) / 100;

  const currentRatio = safeCurrent / (0.8 * sinkSpeedMps);
  const effSinkSpeedMps = Math.round(Math.max(0.06, sinkSpeedMps / Math.sqrt(1 + currentRatio * currentRatio)) * 100) / 100;
  const fallTimeSec = Math.max(0.5, Math.round((safeDepth / Math.max(0.06, effSinkSpeedMps)) * 10) / 10);
  const driftDistanceM = Math.round(safeCurrent * fallTimeSec * 10) / 10;

  return {
    sinkSpeedMps,
    effSinkSpeedMps,
    fallTimeSec,
    driftDistanceM,
    totalWeightGrams: Math.round(sinkingWeightG * 100) / 100,
  };
}

interface InternalTackleState {
  weightGrams: number;
  peLineSize: number;
  rodPower: RodPower;
  rodLengthM: number;
  baitType: BaitType;
  lureSubMode: LureSubMode;
  baitLength: number;
  baitLengthCm: number;
  baitShape: LureShape;
  castingBallSubMode: CastingBallSubMode;
  castingBallWeightGrams: number;
  castingBallHo: number;
  jigheadWeightGrams: number;
  metalWeightGrams: number;
  egiWeightGrams: number;
  sinkerWeightGrams: number;
}

const DEFAULT_TACKLE_STATE: InternalTackleState = {
  weightGrams: 10.6,
  peLineSize: 1.0,
  rodPower: 'M',
  rodLengthM: 2.6,
  baitType: 'LURE',
  lureSubMode: 'OZ',
  baitLength: 2,
  baitLengthCm: 6.0,
  baitShape: 'GRUB',
  castingBallSubMode: 'REAL_BALL',
  castingBallWeightGrams: 10.0,
  castingBallHo: 1.0,
  jigheadWeightGrams: 1.0,
  metalWeightGrams: 20.0,
  egiWeightGrams: 15.0,
  sinkerWeightGrams: 0.0,
};

// localStorage 5MB 쿼터 초과 시에도 UI 상태가 즉시 반영되도록 보장하는 인메모리 권위 상태
let memoryTackleState: InternalTackleState | null = null;

function getSafeLocalStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {}
  return null;
}

function readInitialTackleStateFromStorage(): InternalTackleState {
  const s: InternalTackleState = { ...DEFAULT_TACKLE_STATE };
  const storage = getSafeLocalStorage();
  if (!storage) {
    return normalizeTackleState(s);
  }
  try {
    const savedW = storage.getItem(KEY_RIG_WEIGHT);
    const savedPE = storage.getItem(KEY_PE_LINE);
    const savedPower = storage.getItem(KEY_ROD_POWER) as string | null;
    const savedLenM = storage.getItem(KEY_ROD_LENGTH_M);
    const savedLenFt = storage.getItem(KEY_ROD_LENGTH);
    const savedBaitType = storage.getItem(KEY_BAIT_TYPE) as BaitType | null;
    const savedLureSub = storage.getItem(KEY_LURE_SUBMODE) as LureSubMode | null;
    const savedBaitLen = storage.getItem(KEY_BAIT_LENGTH);
    const savedBaitLenCm = storage.getItem(KEY_BAIT_LENGTH_CM);
    const savedBaitShape = storage.getItem(KEY_BAIT_SHAPE) as LureShape | null;
    const savedCastingSub = storage.getItem(KEY_CASTING_BALL_SUBMODE) as CastingBallSubMode | null;
    const savedBallWeight = storage.getItem(KEY_CASTING_BALL_WEIGHT);
    const savedBallHo = storage.getItem(KEY_CASTING_BALL_HO);
    const savedJH = storage.getItem(KEY_JIGHEAD_WEIGHT);
    const savedMetalW = storage.getItem(KEY_METAL_WEIGHT);
    const savedEgiW = storage.getItem(KEY_EGI_WEIGHT);
    const savedSinkerW = storage.getItem(KEY_SINKER_WEIGHT);

    if (savedW) s.weightGrams = parseFloat(savedW) || DEFAULT_TACKLE_STATE.weightGrams;
    if (savedPE) s.peLineSize = parseFloat(savedPE) || 1.0;

    if (savedPower === 'XH' || savedPower === 'SURF') {
      s.rodPower = 'SURF';
    } else if (savedPower && ROD_POWER_SPECS[savedPower as RodPower]) {
      s.rodPower = savedPower as RodPower;
    }

    if (savedLenM) {
      s.rodLengthM = parseFloat(savedLenM) || (s.rodPower === 'SURF' ? 4.2 : 2.6);
    } else if (savedLenFt) {
      const ft = parseFloat(savedLenFt) || 8.6;
      s.rodLengthM = Math.round(ft * 0.3048 * 10) / 10;
    }

    if (savedBaitType === 'LIVE' || savedBaitType === 'LURE' || savedBaitType === 'CASTING_BALL' || savedBaitType === 'METAL') {
      s.baitType = savedBaitType;
    }
    if (savedLureSub && ['JIG', 'OZ', 'JUKKUMI'].includes(savedLureSub)) {
      s.lureSubMode = savedLureSub;
    }
    if (savedCastingSub && ['REAL_BALL', 'VARIANT_FLOAT'].includes(savedCastingSub)) {
      s.castingBallSubMode = savedCastingSub;
    }
    if (savedBaitLen) s.baitLength = parseInt(savedBaitLen, 10) || 2;
    if (savedBaitLenCm) s.baitLengthCm = parseFloat(savedBaitLenCm) || 6.0;
    if (savedBaitShape && ['GRUB', 'SHAD', 'STRAIGHT'].includes(savedBaitShape)) {
      s.baitShape = savedBaitShape;
    } else if (savedBaitShape === 'MINNOW') {
      s.baitShape = 'GRUB';
    }
    if (savedBallWeight) {
      const parsed = parseFloat(savedBallWeight);
      if (!Number.isNaN(parsed)) s.castingBallWeightGrams = parsed;
    }
    if (savedBallHo) s.castingBallHo = parseFloat(savedBallHo) || 1.0;
    if (s.castingBallSubMode === 'VARIANT_FLOAT' && !savedBallWeight) {
      s.castingBallWeightGrams = getVariantFloatWeightByHo(s.castingBallHo);
    }
    if (savedJH) s.jigheadWeightGrams = parseFloat(savedJH) || 1.0;
    if (savedMetalW) s.metalWeightGrams = parseFloat(savedMetalW) || 20.0;
    if (savedEgiW) s.egiWeightGrams = parseFloat(savedEgiW) || 15.0;
    if (savedSinkerW !== null && savedSinkerW !== undefined) {
      const parsed = parseFloat(savedSinkerW);
      if (!Number.isNaN(parsed)) s.sinkerWeightGrams = parsed;
    }
  } catch {
    // ignore storage read error
  }
  return normalizeTackleState(s);
}

function normalizeTackleState(raw: InternalTackleState): InternalTackleState {
  const s: InternalTackleState = { ...raw };
  if (s.baitShape === 'MINNOW') {
    s.baitShape = 'GRUB';
  }
  if (s.rodPower === 'SURF') {
    if (!SURF_ROD_LENGTHS_M.includes(s.rodLengthM as any)) {
      s.rodLengthM = 4.2;
    }
    s.baitType = 'LIVE';
    if (s.weightGrams < 30) s.weightGrams = 93.8;
  } else {
    s.rodLengthM = Math.max(1.6, Math.min(3.0, s.rodLengthM));
    if (s.baitType === 'LIVE') s.baitType = 'LURE';
    if (s.baitType === 'METAL') {
      s.metalWeightGrams = Math.max(1, Math.min(80, s.metalWeightGrams));
      s.weightGrams = s.metalWeightGrams;
    } else if (s.baitType === 'CASTING_BALL') {
      s.castingBallWeightGrams = Math.max(1, Math.min(40, Math.round(s.castingBallWeightGrams * 100) / 100));
      s.jigheadWeightGrams = Math.max(0.5, Math.min(20, Math.round(s.jigheadWeightGrams * 10) / 10));
      s.weightGrams = Math.round((s.castingBallWeightGrams + s.jigheadWeightGrams) * 100) / 100;
    } else if (s.baitType === 'LURE' && s.lureSubMode === 'JUKKUMI') {
      s.sinkerWeightGrams = Math.max(0, Math.min(22.5, Math.round(s.sinkerWeightGrams * 10) / 10));
      s.weightGrams = Math.round((s.egiWeightGrams + s.sinkerWeightGrams) * 10) / 10;
    }
  }
  return s;
}

function ensureMemoryTackleState(): InternalTackleState {
  if (!memoryTackleState) {
    memoryTackleState = readInitialTackleStateFromStorage();
  }
  return memoryTackleState;
}

function evictNonEssentialCachesFromStorage(): void {
  const storage = getSafeLocalStorage();
  if (!storage) return;
  const keysToRemove: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && (k.startsWith('khoa_c_') || k === 'exfish_offline_spots')) {
      keysToRemove.push(k);
    }
  }
  for (const k of keysToRemove) {
    storage.removeItem(k);
  }
}

function persistTackleStateToStorage(state: InternalTackleState): void {
  const storage = getSafeLocalStorage();
  if (!storage) return;
  const entries: [string, string][] = [
    [KEY_RIG_WEIGHT, String(state.weightGrams)],
    [KEY_PE_LINE, String(state.peLineSize)],
    [KEY_ROD_POWER, state.rodPower],
    [KEY_ROD_LENGTH_M, String(state.rodLengthM)],
    [KEY_ROD_LENGTH, String(Math.round(state.rodLengthM * 3.28084 * 10) / 10)],
    [KEY_BAIT_TYPE, state.baitType],
    [KEY_LURE_SUBMODE, state.lureSubMode],
    [KEY_BAIT_LENGTH, String(state.baitLength)],
    [KEY_BAIT_LENGTH_CM, String(state.baitLengthCm)],
    [KEY_BAIT_SHAPE, state.baitShape],
    [KEY_CASTING_BALL_SUBMODE, state.castingBallSubMode],
    [KEY_CASTING_BALL_WEIGHT, String(state.castingBallWeightGrams)],
    [KEY_CASTING_BALL_HO, String(state.castingBallHo)],
    [KEY_JIGHEAD_WEIGHT, String(state.jigheadWeightGrams)],
    [KEY_METAL_WEIGHT, String(state.metalWeightGrams)],
    [KEY_EGI_WEIGHT, String(state.egiWeightGrams)],
    [KEY_SINKER_WEIGHT, String(state.sinkerWeightGrams)],
  ];

  const writeAll = () => {
    for (const [k, v] of entries) {
      storage.setItem(k, v);
    }
  };

  try {
    writeAll();
  } catch {
    try {
      evictNonEssentialCachesFromStorage();
      writeAll();
    } catch {
      // Storage quota exhausted or restricted; in-memory state remains authoritative
    }
  }
}

function buildTackleRigConfig(state: InternalTackleState): TackleRigConfig {
  const rodType: RodType = state.rodPower === 'SURF' ? 'SURF' : 'LURE';
  const baitConfig = getBaitSpecs(
    state.baitType,
    state.baitLength,
    state.baitShape,
    state.baitLengthCm,
    state.castingBallHo,
    state.jigheadWeightGrams,
    state.metalWeightGrams,
    state.lureSubMode,
    state.castingBallSubMode,
    state.castingBallWeightGrams,
    state.egiWeightGrams,
    state.sinkerWeightGrams
  );

  const { distanceMeters, elasticityEfficiency, lengthFactor, totalWeightGrams } = calculateCalibratedDistance(
    state.weightGrams,
    state.peLineSize,
    state.rodPower,
    state.rodLengthM,
    baitConfig
  );

  const rodLengthFt = Math.round(state.rodLengthM * 3.28084 * 10) / 10;
  const r1 = Math.round(distanceMeters * 0.5);
  const r2 = distanceMeters;
  const r3 = Math.round(distanceMeters * 1.5);

  return {
    weightGrams: state.weightGrams,
    totalWeightGrams,
    baitConfig,
    peLineSize: state.peLineSize,
    rodType,
    rodPower: state.rodPower,
    rodLengthM: state.rodLengthM,
    rodLengthFt,
    calibratedDistanceMeters: distanceMeters,
    radii: [r1, r2, r3],
    rodElasticityEfficiency: elasticityEfficiency,
    rodLengthFactor: lengthFactor,
  };
}

export function resetTackleConfigState(): void {
  memoryTackleState = normalizeTackleState({ ...DEFAULT_TACKLE_STATE });
}

export function getSavedTackleConfig(): TackleRigConfig {
  return buildTackleRigConfig(ensureMemoryTackleState());
}

export interface TackleUpdateParams {
  weightGrams?: number;
  peLineSize?: number;
  rodPower?: RodPower;
  rodLengthM?: number;
  rodLength?: number;
  baitType?: BaitType;
  lureSubMode?: LureSubMode;
  baitLength?: number;
  baitShape?: LureShape;
  baitLengthCm?: number;
  castingBallSubMode?: CastingBallSubMode;
  castingBallWeightGrams?: number;
  castingBallHo?: number;
  jigheadWeightGrams?: number;
  metalWeightGrams?: number;
  egiWeightGrams?: number;
  sinkerWeightGrams?: number;
}

export function saveTackleConfig(
  weightGramsOrParams: number | TackleUpdateParams,
  peLineSize?: number,
  rodPower?: RodPower,
  rodLength?: number,
  baitType?: BaitType,
  baitLength?: number,
  baitShape?: LureShape,
  baitLengthCm?: number,
  castingBallHo?: number,
  jigheadWeightGrams?: number,
  metalWeightGrams?: number
): TackleRigConfig {
  const params: TackleUpdateParams = typeof weightGramsOrParams === 'object'
    ? weightGramsOrParams
    : {
        weightGrams: weightGramsOrParams,
        peLineSize,
        rodPower,
        rodLength,
        baitType,
        baitLength,
        baitShape,
        baitLengthCm,
        castingBallHo,
        jigheadWeightGrams,
        metalWeightGrams,
      };

  const prev = ensureMemoryTackleState();
  const next: InternalTackleState = { ...prev };

  // 1. 로드 파워 및 전장 반영
  if (params.rodPower) {
    next.rodPower = params.rodPower === ('XH' as any) ? 'SURF' : params.rodPower;
  }

  const rawLen = params.rodLengthM ?? params.rodLength;
  if (rawLen !== undefined) {
    let lengthM = rawLen;
    if (rawLen > 6.0) {
      lengthM = Math.round(rawLen * 0.3048 * 10) / 10;
    }
    next.rodLengthM = lengthM;
  }

  // 2. 미끼 타입 결정
  if (next.rodPower === 'SURF') {
    next.baitType = 'LIVE';
  } else if (params.baitType) {
    next.baitType = params.baitType === 'LIVE' ? 'LURE' : params.baitType;
  } else if (next.baitType === 'LIVE') {
    next.baitType = 'LURE';
  }

  // 3. 세부 옵션 반영
  if (params.lureSubMode) next.lureSubMode = params.lureSubMode;
  if (params.baitLength !== undefined) next.baitLength = params.baitLength;
  if (params.baitLengthCm !== undefined) next.baitLengthCm = params.baitLengthCm;
  if (params.baitShape) next.baitShape = params.baitShape;
  if (params.castingBallSubMode) next.castingBallSubMode = params.castingBallSubMode;
  if (params.castingBallWeightGrams !== undefined) next.castingBallWeightGrams = params.castingBallWeightGrams;
  if (params.castingBallHo !== undefined) next.castingBallHo = params.castingBallHo;
  if (params.jigheadWeightGrams !== undefined) next.jigheadWeightGrams = params.jigheadWeightGrams;
  if (params.metalWeightGrams !== undefined) next.metalWeightGrams = params.metalWeightGrams;
  if (params.egiWeightGrams !== undefined) next.egiWeightGrams = params.egiWeightGrams;
  if (params.sinkerWeightGrams !== undefined) next.sinkerWeightGrams = params.sinkerWeightGrams;
  if (params.peLineSize !== undefined) next.peLineSize = params.peLineSize;

  // 4. 무게 동기화 (서브모드/미끼 타입 전환 시 기본 유효 무게 자동 맞춤)
  if (params.weightGrams !== undefined) {
    next.weightGrams = params.weightGrams;
  }

  if (next.rodPower !== 'SURF' && next.baitType === 'METAL') {
    if (params.weightGrams !== undefined && params.metalWeightGrams === undefined) {
      next.metalWeightGrams = Math.max(1, Math.min(80, params.weightGrams));
    }
    next.weightGrams = next.metalWeightGrams;
  } else if (next.rodPower !== 'SURF' && next.baitType === 'CASTING_BALL') {
    if (next.castingBallSubMode === 'VARIANT_FLOAT') {
      if (params.castingBallHo !== undefined && params.castingBallWeightGrams === undefined) {
        next.castingBallWeightGrams = getVariantFloatWeightByHo(next.castingBallHo);
      } else if (
        params.castingBallSubMode === 'VARIANT_FLOAT' &&
        prev.castingBallSubMode !== 'VARIANT_FLOAT' &&
        params.castingBallWeightGrams === undefined
      ) {
        if (!VARIANT_FLOAT_HO_PRESETS.some((p) => Math.abs(p.ho - next.castingBallHo) < 0.05)) {
          next.castingBallHo = 1.0;
        }
        next.castingBallWeightGrams = getVariantFloatWeightByHo(next.castingBallHo);
      }
    } else if (next.castingBallSubMode === 'REAL_BALL') {
      if (params.castingBallHo !== undefined && params.castingBallWeightGrams === undefined) {
        next.castingBallWeightGrams = Math.max(1, Math.min(40, Math.round(next.castingBallHo * 3.75 * 10) / 10));
      } else if (
        params.castingBallSubMode === 'REAL_BALL' &&
        prev.castingBallSubMode !== 'REAL_BALL' &&
        params.castingBallWeightGrams === undefined
      ) {
        next.castingBallWeightGrams = 10.0;
        next.castingBallHo = Math.round((10.0 / 3.75) * 10) / 10;
      }
    }
  } else if (next.rodPower !== 'SURF' && next.baitType === 'LURE' && params.weightGrams === undefined) {
    if (params.lureSubMode === 'JIG') {
      const matchesJig = WEIGHT_PRESETS.some(
        (p) => p.category === 'JIG' && Math.abs(p.weightGrams - next.weightGrams) < 0.15
      );
      if (!matchesJig) {
        next.weightGrams = 3;
      }
    } else if (params.lureSubMode === 'OZ') {
      const matchesOz = WEIGHT_PRESETS.some(
        (p) => p.category === 'OZ' && Math.abs(p.weightGrams - next.weightGrams) < 0.15
      );
      if (!matchesOz) {
        next.weightGrams = 10.6;
      }
    } else if (next.baitType === 'LURE' && prev.baitType !== 'LURE') {
      if (next.lureSubMode === 'JIG' && next.weightGrams > 10) {
        next.weightGrams = 3;
      } else if (next.lureSubMode === 'OZ' && next.weightGrams > 60) {
        next.weightGrams = 10.6;
      }
    }
  }

  const normalized = normalizeTackleState(next);
  memoryTackleState = normalized;
  persistTackleStateToStorage(normalized);

  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(
        new CustomEvent('exfish_tackle_updated', {
          detail: { ...normalized },
        })
      );
    } catch {
      // ignore
    }
  }

  return buildTackleRigConfig(normalized);
}
