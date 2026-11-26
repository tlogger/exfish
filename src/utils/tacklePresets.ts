// 개인별 멀티 채비 프리셋 저장소 (localStorage 기반, 최대 8개 슬롯)
import { getSavedTackleConfig, saveTackleConfig, type TackleRigConfig } from './tackleCalibration';

export const TACKLE_PRESETS_STORAGE_KEY = 'exfish_tackle_presets_v1';
export const MAX_TACKLE_PRESETS = 8;

export interface TacklePreset {
  id: string;
  name: string;
  rig: TackleRigConfig;
  updatedAt: string;
}

export interface TacklePresetStore {
  activePresetId: string | null;
  presets: TacklePreset[];
}

// Node/테스트 환경에서 localStorage 미지원 시 폴백 인메모리 저장소
let memoryPresetStore: TacklePresetStore | null = null;

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildDefaultPresetName(rig: TackleRigConfig): string {
  const bType = rig.baitConfig?.type || 'LURE';
  if (bType === 'LURE') {
    const w = rig.baitConfig.jigheadWeightGrams || rig.weightGrams;
    const worm = rig.baitConfig.lengthInches ? ` + ${rig.baitConfig.lengthInches}인치` : '';
    return `${rig.rodPower} 루어 ${w}g${worm}`;
  }
  if (bType === 'METAL') {
    return `${rig.rodPower} 메탈 ${rig.weightGrams}g`;
  }
  if (bType === 'CASTING_BALL') {
    return `${rig.rodPower} 캐스팅볼 ${rig.weightGrams}g`;
  }
  return `${rig.rodPower} 원투/생미끼 ${rig.weightGrams}g`;
}

function getStorageSafe(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') return localStorage;
  } catch {}
  return null;
}

export function loadTacklePresetStore(): TacklePresetStore {
  const ls = getStorageSafe();
  if (ls) {
    try {
      const raw = ls.getItem(TACKLE_PRESETS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as TacklePresetStore;
        if (parsed && Array.isArray(parsed.presets) && parsed.presets.length > 0) {
          memoryPresetStore = {
            activePresetId: parsed.activePresetId || parsed.presets[0].id,
            presets: parsed.presets.slice(0, MAX_TACKLE_PRESETS),
          };
          return memoryPresetStore;
        }
      }
    } catch {}
  } else if (memoryPresetStore && memoryPresetStore.presets.length > 0) {
    return memoryPresetStore;
  }

  // 최초 1회: 현재 채비(기존 localStorage 17키 또는 구 쿠키에서 자동 복원됨)를 기본 프리셋으로 등록
  const current = getSavedTackleConfig();
  const initial: TacklePreset = {
    id: createId(),
    name: buildDefaultPresetName(current),
    rig: current,
    updatedAt: new Date().toISOString(),
  };
  const store: TacklePresetStore = { activePresetId: initial.id, presets: [initial] };
  saveTacklePresetStore(store);
  return store;
}

export function saveTacklePresetStore(store: TacklePresetStore): void {
  const trimmed: TacklePresetStore = {
    activePresetId: store.activePresetId,
    presets: store.presets.slice(0, MAX_TACKLE_PRESETS),
  };
  memoryPresetStore = trimmed;
  const ls = getStorageSafe();
  if (ls) {
    try {
      ls.setItem(TACKLE_PRESETS_STORAGE_KEY, JSON.stringify(trimmed));
    } catch {}
  }
}

export function resetMemoryPresetStoreForTest(): void {
  memoryPresetStore = null;
}

export function saveCurrentRigAsPreset(name: string, rigOverride?: TackleRigConfig): TacklePresetStore {
  const store = loadTacklePresetStore();
  const rig = rigOverride || getSavedTackleConfig();
  const cleanName = name.trim() || buildDefaultPresetName(rig);

  const existingIdx = store.presets.findIndex((p) => p.name === cleanName);
  const now = new Date().toISOString();
  if (existingIdx >= 0) {
    store.presets[existingIdx] = { ...store.presets[existingIdx], rig, updatedAt: now };
    store.activePresetId = store.presets[existingIdx].id;
  } else {
    const next: TacklePreset = { id: createId(), name: cleanName, rig, updatedAt: now };
    store.presets = [next, ...store.presets].slice(0, MAX_TACKLE_PRESETS);
    store.activePresetId = next.id;
  }

  saveTacklePresetStore(store);
  return store;
}

export function deleteTacklePreset(presetId: string): TacklePresetStore {
  const store = loadTacklePresetStore();
  const filtered = store.presets.filter((p) => p.id !== presetId);
  if (filtered.length === 0) return store; // 최소 1개 유지
  const nextActive = store.activePresetId === presetId ? filtered[0].id : store.activePresetId;
  const nextStore: TacklePresetStore = { activePresetId: nextActive, presets: filtered };
  saveTacklePresetStore(nextStore);
  return nextStore;
}

export function selectTacklePreset(presetId: string): TackleRigConfig | null {
  const store = loadTacklePresetStore();
  const found = store.presets.find((p) => p.id === presetId);
  if (!found) return null;

  store.activePresetId = found.id;
  saveTacklePresetStore(store);

  const r = found.rig;
  return saveTackleConfig({
    weightGrams: r.weightGrams,
    peLineSize: r.peLineSize,
    rodLengthM: r.rodLengthM,
    rodPower: r.rodPower,
    baitType: r.baitConfig.type,
    baitLength: r.baitConfig.lengthInches,
    baitShape: r.baitConfig.shape,
    lureSubMode: r.baitConfig.lureSubMode,
    castingBallSubMode: r.baitConfig.castingBallSubMode,
    castingBallWeightGrams: r.baitConfig.castingBallWeightGrams,
    castingBallHo: r.baitConfig.castingBallHo,
    jigheadWeightGrams: r.baitConfig.jigheadWeightGrams,
    egiWeightGrams: r.baitConfig.egiWeightGrams,
    sinkerWeightGrams: r.baitConfig.sinkerWeightGrams,
  });
}

export function getActiveTacklePreset(): TacklePreset {
  const store = loadTacklePresetStore();
  return store.presets.find((p) => p.id === store.activePresetId) || store.presets[0];
}
