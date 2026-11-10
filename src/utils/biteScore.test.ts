import { describe, it, expect } from 'vitest';
import {
  estimateTargetWaterTemp,
  calculateSmoothTempScore,
} from './biteScore';

describe('biteScore temperature and ecological scoring', () => {
  it('correctly applies bottom layer temperature buffer during summer and winter', () => {
    // Summer (August, month 8): Surface temp 25°C, depth 15m (12m effective -> -3.0°C)
    const summer = estimateTargetWaterTemp(25.0, 'BOTTOM', 15.0, 8);
    expect(summer.isBottomCorrected).toBe(true);
    expect(summer.effectiveTemp).toBeLessThan(25.0);
    expect(summer.effectiveTemp).toBeCloseTo(22.0, 0.5);

    // Winter (January, month 1): Surface temp 6°C, depth 15m -> bottom is slightly warmer (+1.2°C)
    const winter = estimateTargetWaterTemp(6.0, 'BOTTOM', 15.0, 1);
    expect(winter.isBottomCorrected).toBe(true);
    expect(winter.effectiveTemp).toBeGreaterThan(6.0);

    // Surface fish (SURFACE/MID): No bottom correction
    const pelagic = estimateTargetWaterTemp(22.0, 'MID', 15.0, 8);
    expect(pelagic.isBottomCorrected).toBe(false);
    expect(pelagic.effectiveTemp).toBe(22.0);
  });

  it('calculates smooth trapezoidal cosine temperature score', () => {
    const tempRange = { min: 10, optMin: 15, optMax: 20, max: 25 };

    // Optimal zone: 30 points
    const optimal = calculateSmoothTempScore(17.5, tempRange);
    expect(optimal.score).toBe(30);
    expect(optimal.isStress).toBe(false);

    // Below optimal but above min: between 10 and 30 points
    const subOpt = calculateSmoothTempScore(12.5, tempRange);
    expect(subOpt.score).toBeGreaterThan(10);
    expect(subOpt.score).toBeLessThan(30);

    // Severe stress (< min): 5 points
    const frozen = calculateSmoothTempScore(5.0, tempRange);
    expect(frozen.score).toBe(5);
    expect(frozen.isStress).toBe(true);
  });
});
