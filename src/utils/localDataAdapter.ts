// 무-Supabase 로컬 개발/테스트 어댑터 (VITE_DATA_MODE=local)
// 개발 및 수동 검증 중 supabase.co 네트워크 요청을 0건으로 차단합니다.
import { CatchLog, FishingShop, FishingSpot, ShopMemo, SpotMemo } from '../types';
import { INITIAL_CATCH_LOGS, INITIAL_SPOTS } from './storage';

const KEY_LOCAL_SPOTS = 'exfish_local_mode_spots_v1';
const KEY_LOCAL_LOGS = 'exfish_local_mode_logs_v1';
const KEY_LOCAL_SHOPS = 'exfish_local_mode_shops_v1';
const KEY_LOCAL_SPOT_MEMOS = 'exfish_local_mode_spot_memos_v1';
const KEY_LOCAL_SHOP_MEMOS = 'exfish_local_mode_shop_memos_v1';

function readList<T>(key: string, fallback: T[]): T[] {
  if (typeof localStorage === 'undefined') return [...fallback];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      localStorage.setItem(key, JSON.stringify(fallback));
      return [...fallback];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [...fallback];
  } catch {
    return [...fallback];
  }
}

function writeList<T>(key: string, items: T[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // ignore quota error in local dev mode
  }
}

export function localGetSpots(): FishingSpot[] {
  return readList<FishingSpot>(KEY_LOCAL_SPOTS, INITIAL_SPOTS).filter((s) => !s.is_deleted);
}

export function localUpsertSpot(spot: FishingSpot): boolean {
  const list = readList<FishingSpot>(KEY_LOCAL_SPOTS, INITIAL_SPOTS);
  const idx = list.findIndex((s) => s.id === spot.id);
  const next = { ...spot, updated_at: new Date().toISOString() };
  if (idx >= 0) list[idx] = next;
  else list.unshift(next);
  writeList(KEY_LOCAL_SPOTS, list);
  return true;
}

export function localDeleteSpot(spotId: string): boolean {
  const list = readList<FishingSpot>(KEY_LOCAL_SPOTS, INITIAL_SPOTS).filter((s) => s.id !== spotId);
  writeList(KEY_LOCAL_SPOTS, list);
  return true;
}

export function localGetLogs(): CatchLog[] {
  return readList<CatchLog>(KEY_LOCAL_LOGS, INITIAL_CATCH_LOGS).filter((l) => !l.is_deleted);
}

export function localUpsertLog(log: CatchLog): boolean {
  const list = readList<CatchLog>(KEY_LOCAL_LOGS, INITIAL_CATCH_LOGS);
  const idx = list.findIndex((l) => l.id === log.id);
  const next = { ...log, updated_at: new Date().toISOString() };
  if (idx >= 0) list[idx] = next;
  else list.unshift(next);
  writeList(KEY_LOCAL_LOGS, list);
  return true;
}

export function localDeleteLog(logId: string): boolean {
  const list = readList<CatchLog>(KEY_LOCAL_LOGS, INITIAL_CATCH_LOGS).filter((l) => l.id !== logId);
  writeList(KEY_LOCAL_LOGS, list);
  return true;
}

export function localGetShops(): FishingShop[] {
  return readList<FishingShop>(KEY_LOCAL_SHOPS, []).filter((s) => !s.is_deleted);
}

export function localGetSpotMemos(spotId: string): SpotMemo[] {
  return readList<SpotMemo>(KEY_LOCAL_SPOT_MEMOS, []).filter((m) => m.spot_id === spotId);
}

export function localSaveSpotMemo(memo: SpotMemo): boolean {
  const list = readList<SpotMemo>(KEY_LOCAL_SPOT_MEMOS, []);
  list.unshift(memo);
  writeList(KEY_LOCAL_SPOT_MEMOS, list);
  return true;
}

export function localDeleteSpotMemo(memoId: string): boolean {
  const list = readList<SpotMemo>(KEY_LOCAL_SPOT_MEMOS, []).filter((m) => m.id !== memoId);
  writeList(KEY_LOCAL_SPOT_MEMOS, list);
  return true;
}

export function localGetShopMemos(shopId: string): ShopMemo[] {
  return readList<ShopMemo>(KEY_LOCAL_SHOP_MEMOS, []).filter((m) => m.shop_id === shopId);
}

export function localSaveShopMemo(memo: ShopMemo): boolean {
  const list = readList<ShopMemo>(KEY_LOCAL_SHOP_MEMOS, []);
  list.unshift(memo);
  writeList(KEY_LOCAL_SHOP_MEMOS, list);
  return true;
}

export function localDeleteShopMemo(memoId: string): boolean {
  const list = readList<ShopMemo>(KEY_LOCAL_SHOP_MEMOS, []).filter((m) => m.id !== memoId);
  writeList(KEY_LOCAL_SHOP_MEMOS, list);
  return true;
}
