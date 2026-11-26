import { describe, it, expect } from 'vitest';
import { generatePostMortemReport, inferRigWeightGrams } from './postMortemEngine';
import type { WeatherData, MarineData, TideDayInfo, BiteScoreBreakdown } from '../types';

const makeWeather = (overrides: Partial<WeatherData> = {}): WeatherData => ({
  temp: 18,
  apparentTemp: 18,
  humidity: 60,
  weatherCode: 0,
  weatherText: '맑음',
  windSpeed: 2.5,
  windDirection: 180,
  windGust: 3.5,
  hourly: { time: [], temp: [], windSpeed: [], windDirection: [], pop: [] },
  ...overrides,
});

const makeMarine = (overrides: Partial<MarineData> = {}): MarineData => ({
  seaSurfaceTemp: 16.5,
  waveHeight: 0.4,
  waveDirection: 180,
  wavePeriod: 5,
  currentVelocity: 0.35,
  currentDirection: 90,
  hourly: { time: [], seaSurfaceTemp: [], waveHeight: [], currentVelocity: [], currentDirection: [] },
  ...overrides,
});

const makeTide = (overrides: Partial<TideDayInfo> = {}): TideDayInfo => ({
  lunarDateStr: '음력 5일',
  mulNumber: 5,
  mulText: '5물',
  sunrise: '06:30',
  sunset: '18:00',
  dawn: '06:00',
  dusk: '18:30',
  highTides: [{ time: '09:00', height: 550 }],
  lowTides: [{ time: '15:00', height: 150 }],
  hourlyCurve: [],
  hourly72Curve: [],
  threeDays: [],
  feedingTimes: [
    {
      label: '중들물 피딩',
      timeRange: '11:00 ~ 13:00',
      reason: '조류 활성 구간',
      startHour: 11,
      endHour: 13,
      startTimeStr: '11:00',
      endTimeStr: '13:00',
    },
  ],
  ...overrides,
});

describe('postMortemEngine refined failure decomposition', () => {
  it('identifies extreme water temperature disparity as top negative factor', () => {
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
      weather: makeWeather({ temp: 10, apparentTemp: 8, windSpeed: 3.5 }),
      marine: makeMarine({ seaSurfaceTemp: 5.0, waveHeight: 0.5, currentVelocity: 0.4 }),
      tide: makeTide({ mulNumber: 2, mulText: '2물', feedingTimes: undefined }),
      biteScore: mockBiteScore,
      castingBearingDeg: 180,
    });

    expect(report.isSkunk).toBe(true);
    expect(report.topFactors.length).toBeGreaterThan(0);
    const tempFactor = report.topFactors.find((f) => f.id === 'temp_deviation');
    expect(tempFactor).toBeDefined();
    expect(tempFactor?.severity).toBe('HIGH');
  });

  it('converts m/s current velocity to knots accurately and detects feeding window time overlap', () => {
    const goodMarine = makeMarine({ seaSurfaceTemp: 17.0, currentVelocity: 0.4 }); // 0.78kt
    const stagnantMarine = makeMarine({ seaSurfaceTemp: 17.0, currentVelocity: 0.1 }); // 0.19kt
    const feedTide = makeTide();

    const goodReport = generatePostMortemReport({
      targetSpecies: '광어',
      catchTime: '12:00',
      weather: makeWeather({ windSpeed: 2.0 }),
      marine: goodMarine,
      tide: feedTide,
      biteScore: null,
    });
    const stagnantReport = generatePostMortemReport({
      targetSpecies: '광어',
      catchTime: '20:00',
      weather: makeWeather({ windSpeed: 2.0 }),
      marine: stagnantMarine,
      tide: feedTide,
      biteScore: null,
    });

    const curGood = goodReport.allFactors.find((f) => f.id === 'current_stagnation');
    const curStag = stagnantReport.allFactors.find((f) => f.id === 'current_stagnation');
    expect(curGood?.metricLabel).toContain('0.78kt');
    expect(curStag?.metricLabel).toContain('0.19kt');
    expect(curStag!.contributionPercent).toBeGreaterThan(curGood!.contributionPercent);

    const feedGood = goodReport.allFactors.find((f) => f.id === 'feeding_mismatch');
    const feedMiss = stagnantReport.allFactors.find((f) => f.id === 'feeding_mismatch');
    expect(feedMiss!.contributionPercent).toBeGreaterThan(feedGood!.contributionPercent);
  });

  it('elevates spring-tide turbidity during spring tide overturning and differentiates species sensitivity', () => {
    const springTide = makeTide({ mulNumber: 8, mulText: '8물 (사리)' });
    const neapTide = makeTide({ mulNumber: 15, mulText: '조금' });
    const overturnedMarine = makeMarine({
      seaSurfaceTemp: 17.0,
      currentVelocity: 0.55, // 서해 탁수 임계(0.28 m/s) 크게 초과
      waveHeight: 0.9,
      wavePeriod: 5.5,
    });

    const springFlounder = generatePostMortemReport({
      targetSpecies: '광어',
      catchTime: '12:00',
      weather: makeWeather(),
      marine: overturnedMarine,
      tide: springTide,
      biteScore: null,
      region: 'WEST',
      lureBait: '다운샷 1oz', // 충분한 무게로 채비 안착 변수 분리
    });

    const neapFlounder = generatePostMortemReport({
      targetSpecies: '광어',
      catchTime: '12:00',
      weather: makeWeather(),
      marine: overturnedMarine,
      tide: neapTide,
      biteScore: null,
      region: 'WEST',
      lureBait: '다운샷 1oz',
    });

    const springSeabass = generatePostMortemReport({
      targetSpecies: '농어',
      catchTime: '12:00',
      weather: makeWeather(),
      marine: makeMarine({
        seaSurfaceTemp: 18.5,
        currentVelocity: 0.42, // 경미 탁수
        waveHeight: 0.5,
      }),
      tide: makeTide({ mulNumber: 6, mulText: '6물' }),
      biteScore: null,
      region: 'WEST',
    });

    const springCuttlefish = generatePostMortemReport({
      targetSpecies: '갑오징어',
      catchTime: '12:00',
      weather: makeWeather(),
      marine: makeMarine({
        seaSurfaceTemp: 18.5,
        currentVelocity: 0.42,
        waveHeight: 0.5,
      }),
      tide: makeTide({ mulNumber: 6, mulText: '6물' }),
      biteScore: null,
      region: 'WEST',
    });

    const turbSpring = springFlounder.allFactors.find((f) => f.id === 'spring_turbidity')!;
    const turbNeap = neapFlounder.allFactors.find((f) => f.id === 'spring_turbidity')!;
    expect(turbSpring.contributionPercent).toBeGreaterThan(turbNeap.contributionPercent * 3);
    expect(springFlounder.topFactors.some((f) => f.id === 'spring_turbidity')).toBe(true);

    const turbCuttle = springCuttlefish.allFactors.find((f) => f.id === 'spring_turbidity')!;
    const turbBass = springSeabass.allFactors.find((f) => f.id === 'spring_turbidity')!;
    expect(turbCuttle.contributionPercent).toBeGreaterThan(turbBass.contributionPercent);
  });

  it('prioritizes current bottom-contact loss for demersal fish over pelagic fish and headwind', () => {
    // 정면 맞바람 6.5 m/s (castingBearingDeg=180, windDirection=180 -> windVectorDeg=0 -> diff=180도 정면 맞바람)
    const headwindWeather = makeWeather({ windSpeed: 6.5, windDirection: 180 });
    const fastCurrentMarine = makeMarine({
      seaSurfaceTemp: 15.0,
      currentVelocity: 0.78, // ~1.52 kt 강조류
      waveHeight: 0.5,
    });
    const midTide = makeTide({ mulNumber: 5, mulText: '5물' });

    const rockfishReport = generatePostMortemReport({
      targetSpecies: '우럭', // 저서 어류 (BOTTOM)
      catchTime: '12:00',
      weather: headwindWeather,
      marine: fastCurrentMarine,
      tide: midTide,
      biteScore: null,
      castingBearingDeg: 180,
      spotType: 'BREAKWATER',
      lureBait: '지그헤드 1/4oz + 웜', // 7.1g -> 7m 수심·0.78m/s에서 바닥 감도 상실
    });

    const mackerelReport = generatePostMortemReport({
      targetSpecies: '삼치', // 표층 회유어 (SURFACE)
      catchTime: '12:00',
      weather: headwindWeather,
      marine: makeMarine({ ...fastCurrentMarine, seaSurfaceTemp: 21.0 }),
      tide: midTide,
      biteScore: null,
      castingBearingDeg: 180,
      spotType: 'BREAKWATER',
      lureBait: '지그헤드 1/4oz + 웜',
    });

    const bottomLossRockfish = rockfishReport.allFactors.find((f) => f.id === 'current_bottom_loss')!;
    const headwindRockfish = rockfishReport.allFactors.find((f) => f.id === 'headwind_cast')!;
    const bottomLossPelagic = mackerelReport.allFactors.find((f) => f.id === 'current_bottom_loss')!;

    expect(rockfishReport.topFactors[0].id).toBe('current_bottom_loss');
    expect(bottomLossRockfish.severity).toBe('HIGH');
    // 강조류 바닥 안착 불량이 맞바람보다 압도적으로 커야 함
    expect(bottomLossRockfish.contributionPercent).toBeGreaterThan(headwindRockfish.contributionPercent * 3);
    // 저서 어류가 표층 회유어보다 바닥 안착 불량 비중이 훨씬 커야 함
    expect(bottomLossRockfish.contributionPercent).toBeGreaterThan(bottomLossPelagic.contributionPercent * 2);
    // 차기 전술 팁에 구체적 증량 무게(g)가 포함되어야 함
    expect(rockfishReport.tacticalAdvice).toMatch(/최소 \d+(\.\d+)?g 이상/);
  });

  it('parses rig weights accurately and increases bottom-loss penalty for lighter rigs', () => {
    expect(inferRigWeightGrams(null, '지그헤드 1/8oz + 웜').weightGrams).toBeCloseTo(3.5, 1);
    expect(inferRigWeightGrams(null, '메탈지그 30g').weightGrams).toBe(30);
    expect(inferRigWeightGrams(null, '원투 20호 봉돌', 'SURF').weightGrams).toBe(75);

    const fastMarine = makeMarine({ seaSurfaceTemp: 15.0, currentVelocity: 0.65 });
    const lightRig = generatePostMortemReport({
      targetSpecies: '도다리',
      catchTime: '12:00',
      weather: makeWeather(),
      marine: fastMarine,
      tide: makeTide(),
      biteScore: null,
      depthMeters: 8,
      lureBait: '지그헤드 1/8oz',
    });
    const heavyRig = generatePostMortemReport({
      targetSpecies: '도다리',
      catchTime: '12:00',
      weather: makeWeather(),
      marine: fastMarine,
      tide: makeTide(),
      biteScore: null,
      depthMeters: 8,
      lureBait: '원투 30호 봉돌',
      catchMethod: 'SURF',
    });

    const lightLoss = lightRig.allFactors.find((f) => f.id === 'current_bottom_loss')!;
    const heavyLoss = heavyRig.allFactors.find((f) => f.id === 'current_bottom_loss')!;
    expect(lightLoss.contributionPercent).toBeGreaterThan(heavyLoss.contributionPercent);
  });
});
