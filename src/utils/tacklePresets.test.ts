import { describe, it, expect, beforeEach } from 'vitest';
import {
  deleteTacklePreset,
  loadTacklePresetStore,
  MAX_TACKLE_PRESETS,
  saveCurrentRigAsPreset,
  selectTacklePreset,
  TACKLE_PRESETS_STORAGE_KEY,
} from './tacklePresets';

describe('tacklePresets (localStorage multi-preset)', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(TACKLE_PRESETS_STORAGE_KEY);
    }
  });

  it('initializes default preset and caps store at MAX_TACKLE_PRESETS (8)', () => {
    const initial = loadTacklePresetStore();
    expect(initial.presets.length).toBe(1);

    for (let i = 1; i <= 10; i++) {
      saveCurrentRigAsPreset(`채비 ${i}`);
    }
    const store = loadTacklePresetStore();
    expect(store.presets.length).toBeLessThanOrEqual(MAX_TACKLE_PRESETS);

    const targetId = store.presets[0].id;
    const selected = selectTacklePreset(targetId);
    expect(selected).not.toBeNull();

    const afterDelete = deleteTacklePreset(targetId);
    expect(afterDelete.presets.some((p) => p.id === targetId)).toBe(false);
  });
});
