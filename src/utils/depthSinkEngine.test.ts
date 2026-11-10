import { describe, it, expect } from 'vitest';
import {
  calculateRealWaterDepth,
  calculateSinkTimeToBottom,
  COMMON_SINKER_SPECS,
} from './depthSinkEngine';

describe('depthSinkEngine depth datum calibration and sink times', () => {
  it('correctly calculates real water depth from MSL depth, datum Z0, and tide height', () => {
    // mslDepth = 8.5m, datumZ0 = 3.5m, tideHeight = 450cm (4.5m above DL)
    // D_real = (8.5 - 3.5) + 4.5 = 9.5m
    const res = calculateRealWaterDepth(8.5, 3.5, 450);
    expect(res.chartedDepth).toBe(5.0);
    expect(res.realDepthM).toBe(9.5);
    expect(res.isExposed).toBe(false);
    expect(res.statusText).toContain('깊은 물골');
  });

  it('detects exposed mudflat/rock (간출) when tide drops below ground level', () => {
    // mslDepth = 3.0m, datumZ0 = 3.5m, tideHeight = 30cm (0.3m)
    // D_real = (3.0 - 3.5) + 0.3 = -0.2m -> exposed
    const res = calculateRealWaterDepth(3.0, 3.5, 30);
    expect(res.isExposed).toBe(true);
    expect(res.realDepthM).toBe(0);
    expect(res.statusText).toContain('간출');
  });

  it('calculates sink time and drift offset based on sinker and current velocity', () => {
    const sinker = COMMON_SINKER_SPECS['원투 25호 (94g)'];
    expect(sinker).toBeDefined();

    const result = calculateSinkTimeToBottom(10, sinker.sinkSpeedMPerS, 0.5);
    expect(result.sinkSeconds).toBeGreaterThan(5);
    expect(result.sinkSeconds).toBeLessThan(15);
    expect(result.driftOffsetM).toBeGreaterThan(0);
  });
});
