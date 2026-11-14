import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  calculateAerodynamicCastingDrift,
  calculateCalibratedDistance,
  calculateSinkingPhysics,
  getBaitSpecs,
  getSavedTackleConfig,
  getWeightDescription,
  METAL_WEIGHT_PRESETS,
  resetTackleConfigState,
  ROD_POWER_SPECS,
  saveTackleConfig,
} from './tackleCalibration';

describe('tackleCalibration physics engine', () => {
  it('calculates lure aerodynamic casting distance and drift within physical limits', () => {
    // 8.6ft M 로드, 22g 지그헤드, PE 1.0호, 타깃 방위각 90도(동쪽), 서풍(270도) 5m/s
    const result = calculateAerodynamicCastingDrift(
      90,    // target bearing
      55,    // base distance
      5,     // wind speed 5 m/s
      270,   // wind direction from west (tailwind for east cast)
      22,    // weight 22g
      1.0,   // PE 1.0
      2.0    // worm length 2 inches
    );

    expect(result.targetBearingDeg).toBe(90);
    expect(result.actualDistanceM).toBeGreaterThanOrEqual(10);
    expect(result.actualDistanceM).toBeLessThanOrEqual(125);
    expect(result.flightTimeSec).toBeGreaterThan(0);
    expect(result.flightTimeSec).toBeLessThan(5);
  });

  it('clamps crosswind drift during extreme gale winds (>12m/s)', () => {
    const galeResult = calculateAerodynamicCastingDrift(
      0,    // North
      50,   // 50m
      15,   // 15 m/s crosswind
      90,   // East wind (perpendicular)
      14,   // 14g
      1.2,
      2.0
    );

    // Lateral drift should be clamped and not diverge to infinity
    expect(galeResult.driftDistanceM).toBeLessThanOrEqual(50 * 0.45);
    expect(galeResult.actualDistanceM).toBeGreaterThan(0);
  });

  it('calculates sinking physics and terminal velocity correctly', () => {
    const physics = calculateSinkingPhysics(
      25,     // weight 25g
      10,     // water depth 10m
      0.5,    // current velocity 0.5 m/s
      getBaitSpecs('LURE', 2, 'GRUB')
    );

    expect(physics.sinkSpeedMps).toBeGreaterThan(0.2);
    expect(physics.sinkSpeedMps).toBeLessThan(3.5);
    expect(physics.fallTimeSec).toBeGreaterThan(0);
    expect(physics.driftDistanceM).toBeGreaterThanOrEqual(0);
  });

  it('returns valid bait specs for live, metal, and plastic lures', () => {
    const live = getBaitSpecs('LIVE');
    expect(live.type).toBe('LIVE');
    expect(live.weightGrams).toBe(2.5);

    const metal = getBaitSpecs('METAL', 2, 'GRUB', 6.0, 3.0, 1.0, 40.0);
    expect(metal.type).toBe('METAL');
    expect(metal.lengthCm).toBe(6.0);
    expect(metal.weightGrams).toBe(40.0);
    expect(metal.metalWeightGrams).toBe(40.0);

    const castingBall = getBaitSpecs('CASTING_BALL', 2, 'GRUB', 6.0, 3.0, 1.5);
    expect(castingBall.type).toBe('CASTING_BALL');
    expect(castingBall.castingBallHo).toBe(3.0);
    expect(castingBall.castingBallWeightGrams).toBe(11.3);
    expect(castingBall.jigheadWeightGrams).toBe(1.5);
    expect(castingBall.weightGrams).toBe(2.5); // 2-inch grub worm weight

    const lure = getBaitSpecs('LURE', 3, 'SHAD');
    expect(lure.shape).toBe('SHAD');
    expect(lure.lengthInches).toBe(3);
    expect(lure.weightGrams).toBe(6.8);
  });

  it('calculates casting ball distance and sinking physics correctly', () => {
    // 캐스팅볼 3호(11.3g) + 지그헤드 1g + 2인치 그럽웜(2.5g) = 총 14.8g
    const bait = getBaitSpecs('CASTING_BALL', 2, 'GRUB', 6.0, 3.0, 1.0);
    const result = calculateCalibratedDistance(12.3, 0.8, 'ML', 2.6, bait);

    expect(result.totalWeightGrams).toBeCloseTo(14.8, 1);
    expect(result.distanceMeters).toBeGreaterThan(30);
    expect(result.distanceMeters).toBeLessThan(100);

    const sink = calculateSinkingPhysics(12.3, 5, 0.3, bait);
    expect(sink.totalWeightGrams).toBeCloseTo(14.8, 1);
    expect(sink.fallTimeSec).toBeGreaterThan(0);
  });

  it('calculates metal jig distance with user-selected 1~80g weight correctly', () => {
    // 메탈 40g, 7cm, MH 로드, PE 1.2호
    const metalBait = getBaitSpecs('METAL', 2, 'GRUB', 7.0, 3.0, 1.0, 40.0);
    const result = calculateCalibratedDistance(40.0, 1.2, 'MH', 2.7, metalBait);

    expect(result.totalWeightGrams).toBe(40.0);
    expect(result.distanceMeters).toBeGreaterThan(50);

    const sink = calculateSinkingPhysics(40.0, 10, 0.5, metalBait);
    expect(sink.sinkSpeedMps).toBeGreaterThan(1.5); // 메탈은 고속 침강
  });

  it('calculates jukkumi egi + sinker rig physics including 0g no-sinker squid casting', () => {
    // 1. 무늬오징어/문어 에기 15g 단독 (0g 노싱커)
    const noSinkerBait = getBaitSpecs('LURE', 3, 'MINNOW', 8.5, 1.0, 1.0, 28, 'JUKKUMI', 'REAL_BALL', 10, 15.0, 0.0);
    expect(noSinkerBait.egiWeightGrams).toBe(15.0);
    expect(noSinkerBait.sinkerWeightGrams).toBe(0.0);

    const noSinkerDist = calculateCalibratedDistance(15.0, 0.8, 'ML', 2.6, noSinkerBait);
    expect(noSinkerDist.totalWeightGrams).toBe(15.0);
    expect(noSinkerDist.distanceMeters).toBeGreaterThan(25);

    // 2. 주꾸미 에기 10g + 5호 봉돌(18.8g) = 총 28.8g
    const weightedBait = getBaitSpecs('LURE', 3, 'MINNOW', 8.5, 1.0, 1.0, 28, 'JUKKUMI', 'REAL_BALL', 10, 10.0, 18.8);
    const weightedDist = calculateCalibratedDistance(28.8, 0.8, 'ML', 2.6, weightedBait);
    expect(weightedDist.totalWeightGrams).toBe(28.8);
    expect(weightedDist.distanceMeters).toBeGreaterThan(noSinkerDist.distanceMeters);
  });

  it('compares real casting ball vs variant float (구멍찌) aerodynamics and weight', () => {
    // 진짜 캐스팅볼 15g + 지그헤드 1g + 2인치 그럽(2.5g) = 총 18.5g
    const realBall = getBaitSpecs('CASTING_BALL', 2, 'GRUB', 6.0, 1.0, 1.0, 28, 'OZ', 'REAL_BALL', 15.0);
    const realResult = calculateCalibratedDistance(16.0, 0.8, 'ML', 2.6, realBall);
    expect(realResult.totalWeightGrams).toBeCloseTo(18.5, 1);

    // 변태채비 구멍찌 2호(7.5g) + 지그헤드 1g + 2인치 그럽(2.5g) = 총 11.0g
    const variantFloat = getBaitSpecs('CASTING_BALL', 2, 'GRUB', 6.0, 2.0, 1.0, 28, 'OZ', 'VARIANT_FLOAT');
    const variantResult = calculateCalibratedDistance(8.5, 0.8, 'ML', 2.6, variantFloat);
    expect(variantResult.totalWeightGrams).toBeCloseTo(11.0, 1);
    expect(variantFloat.castingBallHo).toBe(2.0);
  });
});

describe('tackleConfig state management & UI requirements', () => {
  beforeEach(() => {
    resetTackleConfigState();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetTackleConfigState();
  });

  it('switches to CASTING_BALL (REAL_BALL / VARIANT_FLOAT) and persists sub-options', () => {
    const realBall = saveTackleConfig({
      baitType: 'CASTING_BALL',
      castingBallSubMode: 'REAL_BALL',
      castingBallWeightGrams: 15,
      jigheadWeightGrams: 1.5,
    });
    expect(realBall.baitConfig?.type).toBe('CASTING_BALL');
    expect(realBall.baitConfig?.castingBallSubMode).toBe('REAL_BALL');
    expect(realBall.weightGrams).toBeCloseTo(16.5, 1);
    expect(getSavedTackleConfig().baitConfig?.type).toBe('CASTING_BALL');

    const variantFloat = saveTackleConfig({
      castingBallSubMode: 'VARIANT_FLOAT',
      castingBallHo: 2.0,
      jigheadWeightGrams: 1.0,
    });
    expect(variantFloat.baitConfig?.type).toBe('CASTING_BALL');
    expect(variantFloat.baitConfig?.castingBallSubMode).toBe('VARIANT_FLOAT');
    expect(variantFloat.weightGrams).toBeCloseTo(8.5, 1);
  });

  it('transitions cleanly across LURE sub-modes (JIG, OZ, JUKKUMI) and weight presets', () => {
    const jigInit = saveTackleConfig({ baitType: 'LURE', lureSubMode: 'JIG' });
    expect(jigInit.baitConfig?.type).toBe('LURE');
    expect(jigInit.baitConfig?.lureSubMode).toBe('JIG');
    expect(jigInit.weightGrams).toBe(3);

    const jigCustom = saveTackleConfig({ weightGrams: 5 });
    expect(jigCustom.weightGrams).toBe(5);

    const ozInit = saveTackleConfig({ lureSubMode: 'OZ' });
    expect(ozInit.baitConfig?.lureSubMode).toBe('OZ');
    expect(ozInit.weightGrams).toBe(10.6);

    const ozPreset = saveTackleConfig({ weightGrams: 28.3 });
    expect(ozPreset.weightGrams).toBe(28.3);

    const jukkumi = saveTackleConfig({
      lureSubMode: 'JUKKUMI',
      egiWeightGrams: 15,
      sinkerWeightGrams: 18.8,
    });
    expect(jukkumi.baitConfig?.lureSubMode).toBe('JUKKUMI');
    expect(jukkumi.weightGrams).toBeCloseTo(33.8, 1);

    const noSinker = saveTackleConfig({ egiWeightGrams: 20, sinkerWeightGrams: 0 });
    expect(noSinker.weightGrams).toBe(20);
  });

  it('supports METAL 10~40g presets, 1~80g range, and omits jig length from description', () => {
    expect([...METAL_WEIGHT_PRESETS]).toEqual([10, 20, 30, 40]);

    const metalDefault = saveTackleConfig({ baitType: 'METAL' });
    expect(metalDefault.baitConfig?.type).toBe('METAL');
    expect(metalDefault.baitConfig?.metalWeightGrams).toBe(20);
    expect(metalDefault.weightGrams).toBe(20);
    expect(getWeightDescription(metalDefault.weightGrams, metalDefault.baitConfig)).toBe('메탈지그 20g');
    expect(getWeightDescription(metalDefault.weightGrams, metalDefault.baitConfig)).not.toContain('cm');

    const metal40 = saveTackleConfig({ metalWeightGrams: 40, weightGrams: 40 });
    expect(metal40.weightGrams).toBe(40);

    const metal80 = saveTackleConfig({ metalWeightGrams: 80, weightGrams: 80 });
    expect(metal80.weightGrams).toBe(80);

    const metal1 = saveTackleConfig({ metalWeightGrams: 1, weightGrams: 1 });
    expect(metal1.weightGrams).toBe(1);
    expect(getWeightDescription(metal1.weightGrams, metal1.baitConfig)).toBe('메탈지그 1g');
  });

  it('supports SURF rod selection and reverts cleanly back to LURE rod', () => {
    const surf = saveTackleConfig({
      rodPower: 'SURF',
      rodLengthM: 4.5,
      weightGrams: 112.5,
    });
    expect(surf.rodType).toBe('SURF');
    expect(surf.rodPower).toBe('SURF');
    expect(surf.rodLengthM).toBe(4.5);
    expect(surf.baitConfig?.type).toBe('LIVE');
    expect(surf.weightGrams).toBe(112.5);

    const backToLure = saveTackleConfig({ rodPower: 'ML', baitType: 'LURE' });
    expect(backToLure.rodType).toBe('LURE');
    expect(backToLure.rodPower).toBe('ML');
    expect(backToLure.baitConfig?.type).toBe('LURE');
  });

  it('updates authoritative in-memory state and evicts caches even when localStorage throws QuotaExceededError', () => {
    const store = new Map<string, string>([
      ['khoa_c_tide_sample', 'cached-payload'],
      ['exfish_offline_spots', '[{"id":"1"}]'],
      ['unrelated_key', 'keep-me'],
    ]);

    const mockStorage = {
      get length() {
        return store.size;
      },
      key(index: number) {
        return Array.from(store.keys())[index] ?? null;
      },
      getItem(k: string) {
        return store.get(k) ?? null;
      },
      setItem() {
        throw new Error('QuotaExceededError');
      },
      removeItem(k: string) {
        store.delete(k);
      },
      clear() {
        store.clear();
      },
    };

    const dispatchEventMock = vi.fn();
    vi.stubGlobal('localStorage', mockStorage);
    vi.stubGlobal('window', {
      localStorage: mockStorage,
      dispatchEvent: dispatchEventMock,
    });

    const updated = saveTackleConfig({
      baitType: 'CASTING_BALL',
      castingBallSubMode: 'REAL_BALL',
      castingBallWeightGrams: 20,
      jigheadWeightGrams: 2,
    });

    // 비핵심 캐시는 정리되고 핵심 키는 보존되며 인메모리 상태는 정상 갱신되어야 함
    expect(store.has('khoa_c_tide_sample')).toBe(false);
    expect(store.has('exfish_offline_spots')).toBe(false);
    expect(store.has('unrelated_key')).toBe(true);
    expect(updated.baitConfig?.type).toBe('CASTING_BALL');
    expect(updated.weightGrams).toBeCloseTo(22, 1);
    expect(getSavedTackleConfig().baitConfig?.type).toBe('CASTING_BALL');
    expect(getSavedTackleConfig().weightGrams).toBeCloseTo(22, 1);
  });
});
