import { describe, it, expect } from 'vitest';
import {
  calculateRealWaterDepth,
  calculateSinkTimeToBottom,
  COMMON_SINKER_SPECS,
  resolveUnifiedWaterDepth,
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

  it('resolves unified water depth with distance slope, barometer surge, and BEACH surf-zone floor', () => {
    // 1. 저기압(995 hPa) 예측 조위일 때 약 +18cm 역기압 상승 반영
    const resNormal = resolveUnifiedWaterDepth({
      spotLat: 36.4,
      spotLng: 126.48,
      spotType: 'ROCK',
      khoaDpwt: 8.5,
      datumZ0: 3.9,
      tideHeightCm: 400,
      pressureHpa: 1013.25,
      isPredictedTide: true,
    });
    const resLowPress = resolveUnifiedWaterDepth({
      spotLat: 36.4,
      spotLng: 126.48,
      spotType: 'ROCK',
      khoaDpwt: 8.5,
      datumZ0: 3.9,
      tideHeightCm: 400,
      pressureHpa: 995,
      isPredictedTide: true,
    });
    expect(resLowPress.meteoSurgeCm).toBeGreaterThan(15);
    expect(resLowPress.realDepthM).toBeGreaterThan(resNormal.realDepthM);

    // 2. 백사장 원투(40m 투척) 시 일반 간조에서 0.8m 최소 서프 수심 보호
    const beachCast = resolveUnifiedWaterDepth({
      spotLat: 36.6,
      spotLng: 126.2,
      targetLat: 36.6 + 40 / 111000,
      targetLng: 126.2,
      spotType: 'BEACH',
      khoaDpwt: null,
      datumZ0: 3.8,
      tideHeightCm: 150,
    });
    expect(beachCast.isExposed).toBe(false);
    expect(beachCast.realDepthM).toBeGreaterThanOrEqual(0.8);
  });

  it('accounts for cast vs current relative angle deltaTheta in calculateSinkTimeToBottom', () => {
    const cross = calculateSinkTimeToBottom(10, 0.8, 0.6, 0, 90);
    const oncoming = calculateSinkTimeToBottom(10, 0.8, 0.6, 0, 180);
    expect(cross.deltaThetaDeg).toBe(90);
    expect(oncoming.deltaThetaDeg).toBe(180);
    // 횡조류/뒷조류는 맞조류보다 유효 부력 항력이 커져 침강 지연
    expect(cross.sinkSeconds).toBeGreaterThan(oncoming.sinkSeconds);
    expect(cross.recommendedMinWeightG).toBeGreaterThan(2);
  });
});
