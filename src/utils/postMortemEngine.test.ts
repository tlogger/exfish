import { describe, it, expect } from 'vitest';
import { generatePostMortemReport } from './postMortemEngine';
import type { WeatherData, MarineData, TideDayInfo, BiteScoreBreakdown } from '../types';

describe('postMortemEngine 7-factor failure decomposition', () => {
  it('identifies extreme water temperature disparity as top negative factor', () => {
    // Target: 광어 (opt: 16.5°C), current SST: 5°C (severe cold shock)
    const mockWeather: WeatherData = {
      temp: 10,
      apparentTemp: 8,
      humidity: 60,
      weatherCode: 1,
      weatherText: '맑음',
      windSpeed: 3.5,
      windDirection: 180,
      windGust: 4.0,
      hourly: {
        time: [],
        temp: [],
        windSpeed: [],
        windDirection: [],
        pop: [],
      },
    };

    const mockMarine: MarineData = {
      seaSurfaceTemp: 5.0, // Low temp
      waveHeight: 0.5,
      waveDirection: 180,
      wavePeriod: 5,
      currentVelocity: 0.4,
      currentDirection: 180,
      hourly: {
        time: [],
        seaSurfaceTemp: [],
        waveHeight: [],
        currentVelocity: [],
        currentDirection: [],
      },
    };

    const mockTide: TideDayInfo = {
      lunarDateStr: '음력 2일',
      mulNumber: 2,
      mulText: '2물',
      sunrise: '07:05',
      sunset: '17:28',
      dawn: '06:40',
      dusk: '17:55',
      highTides: [{ time: '09:00', height: 600 }],
      lowTides: [{ time: '15:00', height: 100 }],
      hourlyCurve: [],
      hourly72Curve: [],
      threeDays: [],
    };

    const mockBiteScore: BiteScoreBreakdown = {
      totalScore: 25,
      mulScore: 10,
      windScore: 5,
      tempScore: 5,
      timeScore: 5,
      windRelation: '등바람 (최적)',
      verdict: '주의',
      speciesScores: [],
    };

    const report = generatePostMortemReport({
      targetSpecies: '광어',
      catchTime: '12:00',
      weather: mockWeather,
      marine: mockMarine,
      tide: mockTide,
      biteScore: mockBiteScore,
      castingBearingDeg: 180,
    });

    expect(report.isSkunk).toBe(true);
    expect(report.topFactors.length).toBeGreaterThan(0);
    const tempFactor = report.topFactors.find((f) => f.id === 'temp_deviation');
    expect(tempFactor).toBeDefined();
    expect(tempFactor?.severity).toBe('HIGH');
  });
});
