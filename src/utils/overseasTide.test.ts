import { describe, it, expect } from 'vitest';
import { extractTideFromSeaLevelSeries, isOverseasCoordinate } from './tideService';

describe('overseas coordinate detection and global Open-Meteo tide extraction', () => {
  it('distinguishes overseas spots (e.g. Hitakatsu, Tsushima) from Korean domestic coasts and islands', () => {
    // 대마도 히타카츠항 (부산에서 약 55km) -> 해외
    expect(isOverseasCoordinate(34.655, 129.473)).toBe(true);
    // 일본 오키나와 -> 해외
    expect(isOverseasCoordinate(26.212, 127.679)).toBe(true);

    // 국내 주요 연안 및 도서 (부산, 제주 서귀포, 울릉도, 시화호) -> 국내
    expect(isOverseasCoordinate(35.096, 129.038)).toBe(false);
    expect(isOverseasCoordinate(33.24, 126.56)).toBe(false);
    expect(isOverseasCoordinate(37.49, 130.91)).toBe(false);
    expect(isOverseasCoordinate(37.31, 126.62)).toBe(false);
  });

  it('extracts 24h tide curve and high/low extremes from Open-Meteo sea_level_height_msl', () => {
    const baseDate = new Date('2026-11-28T10:00:00+09:00');
    const times: string[] = [];
    const heightsM: number[] = [];

    // 48시간 코사인 조석 시계열 생성 (주기 12시간, 06:00 만조 / 12:00 간조 / 18:00 만조)
    for (let h = 0; h < 48; h++) {
      const day = h < 24 ? '28' : '29';
      const hh = String(h % 24).padStart(2, '0');
      times.push(`2026-11-${day}T${hh}:00`);
      const rad = ((h - 6) / 12) * 2 * Math.PI;
      heightsM.push(Math.round(Math.cos(rad) * 80) / 100); // -0.80m ~ +0.80m (조차 160cm)
    }

    const extracted = extractTideFromSeaLevelSeries(times, heightsM, baseDate);
    expect(extracted).not.toBeNull();
    expect(extracted!.hourlyCurve).toHaveLength(24);
    expect(extracted!.rangeCm).toBeGreaterThanOrEqual(155);

    const highs = extracted!.events.filter((e) => e.type === 'HIGH');
    const lows = extracted!.events.filter((e) => e.type === 'LOW');
    expect(highs.length).toBeGreaterThanOrEqual(2);
    expect(lows.length).toBeGreaterThanOrEqual(1);
    expect(highs[0].time).toBe('06:00');
    expect(lows[0].time).toBe('12:00');
    expect(highs[1].time).toBe('18:00');
  });
});
