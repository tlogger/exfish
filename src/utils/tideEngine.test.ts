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

  it('matches Badatime and KHOA official mul and lunar days across 29-day small months without drift', () => {
    // 2026-11-10 군산 (서해): 음력 10월 2일 -> 8물
    const gunsanDate = new Date('2026-11-10T12:00:00+09:00');
    const gunsanTide = calculateTideDay(35.976, 126.554, gunsanDate);
    expect(gunsanTide.mulNumber).toBe(8);
    expect(gunsanTide.mulText).toBe('8물');
    expect(gunsanTide.lunarDateStr).toBe('음력 2일');

    // 2026-11-10 통영 (남해): 음력 10월 2일 -> 9물
    const tongyeongDate = new Date('2026-11-10T12:00:00+09:00');
    const tongyeongTide = calculateTideDay(34.84, 128.43, tongyeongDate);
    expect(tongyeongTide.mulNumber).toBe(9);
    expect(tongyeongTide.mulText).toBe('9물');

    // 2026-10-27 과거 검증일: 서해 8물, 남해 9물 보존
    const oct27Date = new Date('2026-10-27T12:00:00+09:00');
    const oct27West = calculateTideDay(35.976, 126.554, oct27Date);
    const oct27South = calculateTideDay(34.84, 128.43, oct27Date);
    expect(oct27West.mulNumber).toBe(8);
    expect(oct27South.mulNumber).toBe(9);

    // 2026-11-09 합삭 당일: 서해 7물(사리), 남해 8물(사리)
    const nov09Date = new Date('2026-11-09T12:00:00+09:00');
    const nov09West = calculateTideDay(35.976, 126.554, nov09Date);
    const nov09South = calculateTideDay(34.84, 128.43, nov09Date);
    expect(nov09West.mulNumber).toBe(7);
    expect(nov09West.mulText).toContain('7물 (사리)');
    expect(nov09South.mulNumber).toBe(8);
    expect(nov09South.mulText).toContain('8물 (사리)');
  });

  it('prioritizes KHOA official SWTC mool7/mool8 and dateMoon when provided', () => {
    const gunsanDate = new Date('2026-11-10T12:00:00+09:00');
    const mockSwtc: any = {
      obsPostId: 'DT_0018',
      stDate: '2026-11-10',
      days: [
        {
          searchDate: '2026-11-10',
          dateMoon: '10.02',
          mool7: '여덟매',
          mool8: '아홉물',
          moolNormal: '한사리',
          events: [
            { type: 'HIGH', time: '04:12', height: 680, diff: 500, minutesFromMidnight: 252 },
            { type: 'LOW', time: '10:45', height: 180, diff: 500, minutesFromMidnight: 645 },
          ],
        },
      ],
      allExtremums: [
        { dayIdx: 0, date: '2026-11-10', type: 'HIGH', typeLabel: '만조', time: '04:12', height: 680, totalMinutesFromStart: 252 },
        { dayIdx: 0, date: '2026-11-10', type: 'LOW', typeLabel: '간조', time: '10:45', height: 180, totalMinutesFromStart: 645 },
      ],
    };

    const tide = calculateTideDay(35.976, 126.554, gunsanDate, { swtcWeekly: mockSwtc });
    expect(tide.mulNumber).toBe(8);
    expect(tide.mulText).toBe('8물');
    expect(tide.lunarDateStr).toBe('음력 10.02');
    expect(tide.threeDays[0].mulText).toBe('8물');
  });

  it('accurately predicts high and low tide times matching Badatime within minutes without 1-hour delay', () => {
    // 2026-11-11 인천: 바다타임 공식 기준 만조 05:35 / 18:00, 간조 11:46
    const nov11Date = new Date('2026-11-11T12:00:00+09:00');
    const incheonTide = calculateTideDay(37.452, 126.592, nov11Date);

    expect(incheonTide.highTides.length).toBeGreaterThanOrEqual(1);
    expect(incheonTide.lowTides.length).toBeGreaterThanOrEqual(1);

    const high1 = incheonTide.highTides[0];
    const [h1Hour, h1Min] = high1.time.split(':').map(Number);
    const h1Minutes = h1Hour * 60 + h1Min;
    // 05:35 is 335 minutes. Must be within 10 minutes of Badatime (not 06:40)
    expect(Math.abs(h1Minutes - 335)).toBeLessThanOrEqual(10);

    const low1 = incheonTide.lowTides[0];
    const [l1Hour, l1Min] = low1.time.split(':').map(Number);
    const l1Minutes = l1Hour * 60 + l1Min;
    // 11:46 is 706 minutes. Must be within 10 minutes of Badatime (not 13:06)
    expect(Math.abs(l1Minutes - 706)).toBeLessThanOrEqual(10);

    if (incheonTide.highTides.length >= 2) {
      const high2 = incheonTide.highTides[1];
      const [h2Hour, h2Min] = high2.time.split(':').map(Number);
      const h2Minutes = h2Hour * 60 + h2Min;
      // 18:00 is 1080 minutes. Must be within 10 minutes of Badatime (not 19:33)
      expect(Math.abs(h2Minutes - 1080)).toBeLessThanOrEqual(10);
    }
  });
});
