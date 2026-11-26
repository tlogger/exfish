import { describe, it, expect } from 'vitest';
import {
  classifyRelativeWind,
  computeSpotComparisonMetric,
  resolveCastCenterDeg,
  sortComparisonMetrics,
} from './spotComparison';
import type { FishingSpot, MarineData, WeatherData } from '../types';
import { getSavedTackleConfig } from './tackleCalibration';

const baseSpot: FishingSpot = {
  id: 's1',
  user_id: 'u1',
  author_name: 'tester',
  is_public: true,
  name: '영흥도 테스트',
  spot_type: 'ROCK',
  lat: 37.25,
  lng: 126.49,
  directions: '',
  photo_urls: [],
  fishing_methods: ['LURE'],
  target_species: ['우럭'],
  casting_start_deg: 315,
  casting_end_deg: 45,
  created_at: '2026-11-01T00:00:00Z',
};

const mockWeather: WeatherData = {
  temp: 14,
  apparentTemp: 12,
  humidity: 60,
  weatherCode: 0,
  weatherText: '맑음',
  windSpeed: 5,
  windDirection: 180,
  windGust: 7,
  hourly: {
    time: Array.from({ length: 48 }, (_, i) => `2026-11-22T${String(i % 24).padStart(2, '0')}:00`),
    temp: Array(48).fill(15),
    windSpeed: Array(48).fill(6.0),
    windDirection: Array(48).fill(180), // 남풍 (북쪽 0° 캐스팅 기준 등바람 180°)
    pop: Array(48).fill(0),
    weatherCode: Array(48).fill(0),
  },
};

const mockMarine: MarineData = {
  seaSurfaceTemp: 16.5,
  waveHeight: 0.6,
  waveDirection: 180,
  wavePeriod: 5,
  currentVelocity: 0.35,
  currentDirection: 90,
  hourly: {
    time: mockWeather.hourly.time,
    seaSurfaceTemp: Array(48).fill(16.5),
    waveHeight: Array(48).fill(0.7),
    wavePeriod: Array(48).fill(6.0),
    currentVelocity: Array(48).fill(0.35),
    currentDirection: Array(48).fill(90),
  },
};

describe('spotComparison', () => {
  it('resolves circular midpoint across 0/360 boundary (315~45 -> 0)', () => {
    expect(resolveCastCenterDeg({ casting_start_deg: 315, casting_end_deg: 45 })).toBe(0);
    expect(resolveCastCenterDeg({ casting_start_deg: 45, casting_end_deg: 135 })).toBe(90);
  });

  it('falls back to legacy casting_directions when arc degrees are absent', () => {
    expect(resolveCastCenterDeg({ casting_directions: ['북', '동'] })).toBe(45);
    expect(resolveCastCenterDeg({})).toBeNull();
  });

  it('classifies relative wind accurately (<=60 headwind, >=120 tailwind)', () => {
    expect(classifyRelativeWind(0, 10).windClass).toBe('HEADWIND');
    expect(classifyRelativeWind(0, 90).windClass).toBe('CROSSWIND');
    expect(classifyRelativeWind(0, 175).windClass).toBe('TAILWIND');
    expect(classifyRelativeWind(null, 180).windClass).toBe('NO_ARC');
  });

  it('computes +6h metric without extra API calls and ranks tailwind spot higher in WIND_AVOID', () => {
    const rig = getSavedTackleConfig();
    const tailSpot = computeSpotComparisonMetric({
      spot: baseSpot, // castCenter 0°, wind 180° -> TAILWIND
      weather: mockWeather,
      marine: mockMarine,
      offsetHours: 6,
      rig,
      depthMeters: 8,
    });
    const headSpot = computeSpotComparisonMetric({
      spot: { ...baseSpot, id: 's2', name: '맞바람 포인트', casting_start_deg: 135, casting_end_deg: 225 }, // castCenter 180°, wind 180° -> HEADWIND
      weather: mockWeather,
      marine: mockMarine,
      offsetHours: 6,
      rig,
      depthMeters: 8,
    });

    expect(tailSpot.relativeWindClass).toBe('TAILWIND');
    expect(headSpot.relativeWindClass).toBe('HEADWIND');
    const sorted = sortComparisonMetrics([headSpot, tailSpot], 'WIND_AVOID');
    expect(sorted[0].spot.id).toBe('s1');
  });
});
