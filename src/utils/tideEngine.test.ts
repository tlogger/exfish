import { describe, it, expect } from 'vitest';
import {
  calculateTideDay,
  findNearestHarbor,
  getDistanceKm,
  getMoonAge,
  getMulInfo,
  KOREA_HARBORS,
} from './tideEngine';

describe('tideEngine astronomical and tidal calculations', () => {
  it('calculates distance between coordinates accurately via haversine', () => {
    // Seoul (37.5665, 126.9780) to Busan (35.1796, 129.0756) ~ 325 km
    const dist = getDistanceKm(37.5665, 126.978, 35.1796, 129.0756);
    expect(dist).toBeGreaterThan(310);
    expect(dist).toBeLessThan(340);
  });

  it('finds nearest harbor for given coordinates', () => {
    // Incheon port (37.45, 126.60)
    const harbor = findNearestHarbor(37.45, 126.6);
    expect(harbor.region).toBe('WEST');
    expect(harbor.name).toContain('인천');

    // Tongyeong (34.84, 128.43)
    const southHarbor = findNearestHarbor(34.84, 128.43);
    expect(southHarbor.region).toBe('SOUTH');
    expect(southHarbor.name).toBe('통영');
  });

  it('calculates moon age between 0 and 29.53', () => {
    const now = new Date('2026-11-10T12:00:00+09:00');
    const moonAge = getMoonAge(now);
    expect(moonAge).toBeGreaterThanOrEqual(0);
    expect(moonAge).toBeLessThan(29.54);
  });

  it('calculates correct Korean 7-mul (West) and 8-mul (South/East) water levels', () => {
    // 7-mul system for West
    const westInfo = getMulInfo(15, 'WEST');
    expect(westInfo.mulNumber).toBeGreaterThanOrEqual(1);
    expect(westInfo.mulNumber).toBeLessThanOrEqual(15);
    expect(westInfo.mulText).toBeTruthy();

    // 8-mul system for South
    const southInfo = getMulInfo(15, 'SOUTH');
    expect(southInfo.mulNumber).toBeGreaterThanOrEqual(1);
    expect(southInfo.mulNumber).toBeLessThanOrEqual(15);
  });

  it('generates 24-hour and 72-hour synchronized tide time series', () => {
    const testDate = new Date('2026-11-10T12:00:00+09:00');
    const tideData = calculateTideDay(37.45, 126.6, testDate);

    expect(tideData).toBeDefined();
    expect(tideData.hourlyCurve).toBeDefined();
    expect(tideData.hourlyCurve.length).toBeGreaterThanOrEqual(24);
    expect(tideData.hourly72Curve).toBeDefined();
    expect(tideData.hourly72Curve.length).toBeGreaterThanOrEqual(72);
    expect(tideData.highTides.length).toBeGreaterThanOrEqual(1);
    expect(tideData.lowTides.length).toBeGreaterThanOrEqual(1);
    expect(tideData.threeDays.length).toBe(3);
  });
});
