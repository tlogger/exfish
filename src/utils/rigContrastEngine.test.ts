import { describe, it, expect } from 'vitest';
import { buildRigContrastInsight } from './rigContrastEngine';
import { getSavedTackleConfig } from './tackleCalibration';
import type { CatchLog } from '../types';

function makeLog(overrides: Partial<CatchLog>): CatchLog {
  return {
    id: 'l1',
    spot_id: 's1',
    user_id: 'u1',
    user_name: 'tester',
    catch_date: '2026-11-21',
    catch_time: '18:00',
    fish_species: '우럭',
    fish_count: 0,
    is_hitless: true,
    catch_method: 'LURE',
    lure_bait: '5g 지그헤드',
    catch_mul: '8물',
    tide_state: '중들물',
    water_temp: 16.5,
    wind_speed: 3.5,
    current_velocity: 0.45,
    created_at: '2026-11-21T18:30:00Z',
    ...overrides,
  };
}

describe('rigContrastEngine', () => {
  it('generates AB_CONTRAST insight when hit and skunk coexist in a session', () => {
    const baseRig = getSavedTackleConfig();
    const hitRig = { ...baseRig, weightGrams: 5 };
    const skunkRig = { ...baseRig, weightGrams: 14 };

    const res = buildRigContrastInsight([
      makeLog({ id: 'h1', fish_count: 2, is_hitless: false, lure_bait: '5g 지그헤드', tackle_snapshot: hitRig as any }),
      makeLog({ id: 's1', fish_count: 0, is_hitless: true, lure_bait: '14g 다운샷', tackle_snapshot: skunkRig as any }),
    ], 8.0);

    expect(res.mode).toBe('AB_CONTRAST');
    expect(res.summary).toContain('히트');
    expect(res.summary).toContain('꽝');
  });

  it('generates ALL_SKUNK_PHYSICS insight when all trials in a session are skunks', () => {
    const baseRig = getSavedTackleConfig();
    const lightRig = { ...baseRig, weightGrams: 2 };
    const res = buildRigContrastInsight([
      makeLog({ id: 's1', fish_count: 0, is_hitless: true, current_velocity: 0.85, tackle_snapshot: lightRig as any }),
    ], 10.0);

    expect(res.mode).toBe('ALL_SKUNK_PHYSICS');
    expect(res.summary.length).toBeGreaterThan(10);
  });
});
