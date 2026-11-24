import { describe, it, expect } from 'vitest';
import {
  estimateTargetWaterTemp,
  calculateSmoothTempScore,
  findTopGoldenWindows48h,
  calculateBiteScore,
} from './biteScore';
import type { FishingSpot, WeatherData, MarineData, TideDayInfo } from '../types';

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

  it('attenuates summer bottom cooling in WEST tidal mixing zone and finds Top-3 48h golden windows', () => {
    const eastSummer = estimateTargetWaterTemp(26.0, 'BOTTOM', 18.0, 8, 'EAST');
    const westSummer = estimateTargetWaterTemp(26.0, 'BOTTOM', 18.0, 8, 'WEST');
    expect(westSummer.effectiveTemp).toBeGreaterThan(eastSummer.effectiveTemp);

    const mockSpot: FishingSpot = {
      id: 'test-spot',
      user_id: 'u1',
      author_name: 'tester',
      is_public: true,
      name: '테스트 포인트',
      spot_type: 'ROCK',
      lat: 36.6,
      lng: 126.2,
      directions: '',
      photo_urls: [],
      fishing_methods: ['LURE'],
      target_species: ['우럭', '광어'],
      created_at: '2026-11-14T00:00:00Z',
    };
    const baseTime = new Date('2026-11-14T06:00:00+09:00');
    const times = Array.from({ length: 48 }, (_, i) => {
      const d = new Date(baseTime.getTime() + i * 3600 * 1000);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const h = String(d.getHours()).padStart(2, '0');
      return `${y}-${m}-${day}T${h}:00`;
    });
    const mockWeather: WeatherData = {
      temp: 16,
      apparentTemp: 15,
      humidity: 60,
      weatherCode: 0,
      weatherText: '맑음',
      windSpeed: 3.0,
      windDirection: 180,
      windGust: 4.0,
      hourly: {
        time: times,
        temp: times.map(() => 16),
        windSpeed: times.map((_, i) => (i === 10 || i === 22 || i === 34 ? 2.0 : 5.5)),
        windDirection: times.map(() => 180),
        windGust: times.map(() => 6.0),
        pop: times.map(() => 10),
      },
    };
    const mockMarine: MarineData = {
      seaSurfaceTemp: 16.5,
      waveHeight: 0.4,
      waveDirection: 180,
      wavePeriod: 5,
      currentVelocity: 0.3,
      currentDirection: 90,
      hourly: {
        time: times,
        seaSurfaceTemp: times.map(() => 16.5),
        waveHeight: times.map(() => 0.4),
        currentVelocity: times.map(() => 0.3),
        currentDirection: times.map(() => 90),
      },
    };
    const mockTide: TideDayInfo = {
      lunarDateStr: '음력 5일',
      mulNumber: 8,
      mulText: '8물',
      sunrise: '07:05',
      sunset: '17:25',
      dawn: '06:35',
      dusk: '17:55',
      highTides: [{ time: '09:00', height: 600 }],
      lowTides: [{ time: '15:00', height: 150 }],
      hourlyCurve: times.slice(0, 24).map((_, i) => ({
        hour: (6 + i) % 24,
        timeStr: `${String((6 + i) % 24).padStart(2, '0')}:00`,
        height: 400,
        stateText: i % 6 === 0 ? '물돌이(정조)' : '들물',
        normalizedSlope: i % 6 === 0 ? 0.1 : 0.7,
        isFeedingTime: i === 10,
      })),
      hourly72Curve: times.map((_, i) => ({
        hour: 6 + i,
        timeStr: `${String((6 + i) % 24).padStart(2, '0')}:00`,
        height: 400,
        stateText: i % 6 === 0 ? '물돌이(정조)' : '들물',
        normalizedSlope: i % 6 === 0 ? 0.1 : 0.7,
        isFeedingTime: i === 10 || i === 22,
      })),
      threeDays: [],
    };

    const windows = findTopGoldenWindows48h(mockSpot, mockWeather, mockMarine, mockTide, ['우럭'], baseTime);
    expect(windows.length).toBe(3);
    expect(windows[0].score).toBeGreaterThanOrEqual(windows[1].score);
    expect(Math.abs(windows[0].offsetHours - windows[1].offsetHours)).toBeGreaterThanOrEqual(3);
  });

  it('caps nocturnal species (우럭) daytime bite score in shallow (<15m) water and allows deep (>=15m) daytime feeding', () => {
    const noonTime = new Date(2025, 4, 15, 12, 30, 0);
    const mockSpot: FishingSpot = {
      id: 'spot-rockfish',
      user_id: 'u1',
      author_name: 'tester',
      is_public: true,
      name: '테스트 방파제',
      lat: 35.87,
      lng: 126.5,
      spot_type: 'SEAWALL',
      directions: '',
      photo_urls: [],
      fishing_methods: ['LURE'],
      target_species: ['우럭'],
      created_at: '2026-11-14T00:00:00Z',
    };
    const mockWeather: WeatherData = {
      temp: 18,
      apparentTemp: 17,
      humidity: 60,
      pressureHpa: 1015,
      weatherCode: 0,
      weatherText: '맑음',
      windSpeed: 6.0,
      windDirection: 180,
      windGust: 7.0,
      hourly: {
        time: [],
        temp: [],
        windSpeed: [],
        windDirection: [],
        windGust: [],
        pop: [],
      },
    };
    const mockMarine: MarineData = {
      seaSurfaceTemp: 15.0,
      waveHeight: 0.3,
      waveDirection: 180,
      wavePeriod: 4,
      currentVelocity: 0.3,
      currentDirection: 90,
    };
    const mockTide: TideDayInfo = {
      lunarDateStr: '음력 8일',
      mulNumber: 1,
      mulText: '1물',
      sunrise: '05:30',
      sunset: '19:30',
      dawn: '05:00',
      dusk: '20:00',
      highTides: [{ time: '09:00', height: 550 }],
      lowTides: [{ time: '15:00', height: 150 }],
      hourlyCurve: [
        {
          hour: 12,
          timeStr: '12:00',
          height: 350,
          stateText: '날물',
          normalizedSlope: 0.5,
          isFeedingTime: false,
        },
      ],
      hourly72Curve: [],
      threeDays: [],
    };

    const shallowDay = calculateBiteScore(mockSpot, mockWeather, mockMarine, mockTide, ['우럭'], noonTime, 5.0);
    expect(shallowDay.speciesScores?.[0].score).toBeLessThanOrEqual(20);
    expect(shallowDay.totalScore).toBeLessThanOrEqual(20);

    const deepDay = calculateBiteScore(mockSpot, mockWeather, mockMarine, mockTide, ['우럭'], noonTime, 18.0);
    expect(deepDay.speciesScores?.[0].score).toBeGreaterThan(50);
    expect(deepDay.totalScore).toBeGreaterThan(45);
  });

  it('penalizes headwind, high waves, excessive current, and differentiates turbidity by species', () => {
    const spot: FishingSpot = {
      id: 'arc-spot',
      user_id: 'u1',
      author_name: 'tester',
      is_public: true,
      name: '방파제 테스트',
      spot_type: 'BREAKWATER',
      lat: 35.8,
      lng: 126.5,
      directions: '',
      photo_urls: [],
      fishing_methods: ['LURE'],
      target_species: ['감성돔', '무늬오징어'],
      casting_start_deg: 250,
      casting_end_deg: 290, // cast West (270 deg)
      created_at: '2026-10-15T00:00:00Z',
    };
    const evening = new Date('2026-10-15T17:30:00+09:00');
    const calmTide: TideDayInfo = {
      lunarDateStr: '음력 8일',
      mulNumber: 1,
      mulText: '1물',
      sunrise: '06:30',
      sunset: '17:50',
      dawn: '06:00',
      dusk: '18:20',
      highTides: [{ time: '18:00', height: 500 }],
      lowTides: [{ time: '12:00', height: 200 }],
      hourlyCurve: [{ hour: 17, timeStr: '17:00', height: 420, stateText: '들물', normalizedSlope: 0.4, isFeedingTime: true }],
      hourly72Curve: [],
      threeDays: [],
    };
    const springTide: TideDayInfo = { ...calmTide, mulNumber: 8, mulText: '8물' };

    const baseWeather: WeatherData = {
      temp: 19,
      apparentTemp: 19,
      humidity: 60,
      weatherCode: 0,
      weatherText: '맑음',
      windSpeed: 6.0,
      windDirection: 90, // blowing from East -> vector 270 (tailwind)
      windGust: 7.0,
      hourly: { time: [], temp: [], windSpeed: [], windDirection: [], windGust: [], pop: [] },
    };
    const headwindWeather: WeatherData = { ...baseWeather, windDirection: 270 }; // blowing from West -> vector 90 (headwind)
    const calmMarine: MarineData = { seaSurfaceTemp: 19, waveHeight: 0.4, waveDirection: 270, wavePeriod: 5, currentVelocity: 0.25, currentDirection: 180 };
    const extremeMarine: MarineData = { ...calmMarine, waveHeight: 1.9, currentVelocity: 1.1 };

    const tailwindRes = calculateBiteScore(spot, baseWeather, calmMarine, calmTide, ['감성돔'], evening);
    const headwindRes = calculateBiteScore(spot, headwindWeather, calmMarine, calmTide, ['감성돔'], evening);
    expect(headwindRes.totalScore).toBeLessThan(tailwindRes.totalScore);

    const extremeRes = calculateBiteScore(spot, headwindWeather, extremeMarine, calmTide, ['감성돔'], evening);
    expect(extremeRes.totalScore).toBeLessThan(headwindRes.totalScore - 15);

    // Turbidity differentiation: spring tide (8물) vs mid tide (5물) at identical 0.45 m/s current
    const turbidMarine: MarineData = { ...calmMarine, currentVelocity: 0.45 };
    const midTide: TideDayInfo = { ...calmTide, mulNumber: 5, mulText: '5물' };
    const squidTurbid = calculateBiteScore(spot, baseWeather, turbidMarine, springTide, ['무늬오징어'], evening);
    const squidMid = calculateBiteScore(spot, baseWeather, turbidMarine, midTide, ['무늬오징어'], evening);
    expect(squidTurbid.speciesScores?.[0].score).toBeLessThan(squidMid.speciesScores?.[0].score ?? 100);
  });
});
