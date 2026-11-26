import { describe, it, expect } from 'vitest';
import { getMinAllowedCatchDateStr, isWithinAllowedCatchWindow, syncCatchEnvironment } from './catchSync';

describe('catchSync (90-day lookback guard)', () => {
  it('allows dates within 90 days and rejects dates older than 90 days', () => {
    const fixedNow = new Date('2026-11-22T12:00:00Z');
    expect(getMinAllowedCatchDateStr(fixedNow)).toBe('2026-08-24');
    expect(isWithinAllowedCatchWindow('2026-11-21', fixedNow)).toBe(true);
    expect(isWithinAllowedCatchWindow('2026-08-25', fixedNow)).toBe(true);
    expect(isWithinAllowedCatchWindow('2026-08-01', fixedNow)).toBe(false);
  });

  it('throws clear error when attempting to sync an older-than-90-day date', async () => {
    await expect(syncCatchEnvironment('2025-01-01', '12:00', 37.25, 126.49)).rejects.toThrow('90일');
  });
});
