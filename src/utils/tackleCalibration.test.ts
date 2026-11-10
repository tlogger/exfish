import { describe, it, expect } from 'vitest';
import {
  calculateAerodynamicCastingDrift,
  calculateSinkingPhysics,
  getBaitSpecs,
  ROD_POWER_SPECS,
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

    const metal = getBaitSpecs('METAL', 2, 'GRUB', 6.0);
    expect(metal.type).toBe('METAL');
    expect(metal.lengthCm).toBe(6.0);
    expect(metal.weightGrams).toBeGreaterThan(10);

    const lure = getBaitSpecs('LURE', 3, 'SHAD');
    expect(lure.shape).toBe('SHAD');
    expect(lure.lengthInches).toBe(3);
    expect(lure.weightGrams).toBe(6.8);
  });
});
