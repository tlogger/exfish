import { Capacitor } from '@capacitor/core';
import type {
  PendingZoneMutation,
  ProhibitedZoneFeature,
  RestrictionScope,
  ZoneManifest,
  ZonesDeltaResponse,
} from '../types/prohibitedZone';
import { getCellsForBounds } from './zoneSpatial';
import { GOOGLE_ACCESS_TOKEN_STORAGE_KEY } from '../services/oauthService';

const IDB_NAME = 'exfish_zones_db';
const IDB_STORE = 'kv';
const SESSION_TOKEN_KEY = 'exfish_zone_session_token_v1';

const memoryCells = new Map<string, ProhibitedZoneFeature[]>();
let memoryManifest: ZoneManifest | null = null;
let memoryDelta: ZonesDeltaResponse | null = null;
let memoryPending: PendingZoneMutation[] | null = null;

export function getZonesBaseUrl(): string {
  return Capacitor.isNativePlatform() ? 'https://exfish.vercel.app' : '';
}

function openZonesDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openZonesDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openZonesDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function evictOldVersionCells(currentVersion: string): Promise<void> {
  const db = await openZonesDb();
  if (!db) return;
  try {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    const keysReq = store.getAllKeys();
    keysReq.onsuccess = () => {
      for (const k of keysReq.result) {
        if (typeof k === 'string' && k.startsWith('cell:') && !k.startsWith(`cell:${currentVersion}:`)) {
          store.delete(k);
        }
      }
    };
  } catch {
    // ignore cleanup failures
  }
}

export async function ensureZoneSessionToken(user: { id: string; provider?: string }): Promise<string | null> {
  const cached = localStorage.getItem(SESSION_TOKEN_KEY);
  if (cached) {
    try {
      const payload = JSON.parse(atob(cached.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload?.userId === user.id && payload?.exp > Math.floor(Date.now() / 1000) + 60) {
        return cached;
      }
    } catch {
      // fall through and re-issue
    }
  }

  const provider = user.provider || user.id.split('_')[0];
  try {
    const res = await fetch(`${getZonesBaseUrl()}/api/auth-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, provider }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { token?: string };
    if (data.token) {
      localStorage.setItem(SESSION_TOKEN_KEY, data.token);
      return data.token;
    }
  } catch {
    // offline
  }
  return null;
}

async function loadManifest(): Promise<ZoneManifest | null> {
  if (memoryManifest) return memoryManifest;
  const cached = await idbGet<ZoneManifest>('manifest');
  if (cached) memoryManifest = cached;

  try {
    const res = await fetch(`${getZonesBaseUrl()}/zones/manifest.json`);
    const ctype = res.headers.get('content-type') || '';
    if (res.ok && ctype.includes('application/json')) {
      const fresh = (await res.json()) as ZoneManifest;
      if (cached && cached.version !== fresh.version) {
        memoryCells.clear();
        void evictOldVersionCells(fresh.version);
      }
      memoryManifest = fresh;
      await idbSet('manifest', fresh);
    }
  } catch {
    // use stale IDB manifest offline
  }
  return memoryManifest;
}

async function loadDelta(): Promise<ZonesDeltaResponse> {
  if (!memoryDelta) {
    const cached = await idbGet<ZonesDeltaResponse>('delta');
    if (cached) memoryDelta = cached;
  }
  try {
    const res = await fetch(`${getZonesBaseUrl()}/api/zones-delta`, {
      signal: AbortSignal.timeout(3500),
    });
    const ctype = res.headers.get('content-type') || '';
    if (res.ok && ctype.includes('application/json')) {
      const fresh = (await res.json()) as ZonesDeltaResponse;
      memoryDelta = fresh;
      await idbSet('delta', fresh);
    }
  } catch {
    // offline stale-first fallback
  }
  return memoryDelta || { activeZones: [], suppressedZoneIds: [], generatedAt: '1970-01-01T00:00:00Z' };
}

async function loadPendingMutations(): Promise<PendingZoneMutation[]> {
  if (memoryPending) return memoryPending;
  memoryPending = (await idbGet<PendingZoneMutation[]>('pending_mutations')) || [];
  return memoryPending;
}

async function addPendingMutation(mut: PendingZoneMutation): Promise<void> {
  const list = await loadPendingMutations();
  memoryPending = [...list.filter((m) => m.id !== mut.id), mut];
  await idbSet('pending_mutations', memoryPending);
}

async function loadCell(version: string, cellId: string): Promise<ProhibitedZoneFeature[]> {
  const key = `${version}:${cellId}`;
  if (memoryCells.has(key)) return memoryCells.get(key)!;

  const idbKey = `cell:${key}`;
  const cached = await idbGet<ProhibitedZoneFeature[]>(idbKey);
  if (cached) {
    memoryCells.set(key, cached);
    return cached;
  }

  try {
    const res = await fetch(`${getZonesBaseUrl()}/zones/${encodeURIComponent(version)}/${encodeURIComponent(cellId)}.json`);
    const ctype = res.headers.get('content-type') || '';
    if (!res.ok || !ctype.includes('application/json')) return [];
    const fc = (await res.json()) as { features?: ProhibitedZoneFeature[] };
    const feats = Array.isArray(fc.features) ? fc.features : [];
    memoryCells.set(key, feats);
    await idbSet(idbKey, feats);
    return feats;
  } catch {
    return [];
  }
}

export async function loadZonesForBounds(
  swLat: number,
  swLng: number,
  neLat: number,
  neLng: number
): Promise<ProhibitedZoneFeature[]> {
  const [manifest, delta, pending] = await Promise.all([
    loadManifest(),
    loadDelta(),
    loadPendingMutations(),
  ]);

  // Prune pending mutations already reflected in delta.generatedAt
  const activePending = pending.filter((m) => m.committedAt > delta.generatedAt);
  if (activePending.length !== pending.length) {
    memoryPending = activePending;
    void idbSet('pending_mutations', activePending);
  }

  const suppressed = new Set<string>(delta.suppressedZoneIds);
  for (const m of activePending) {
    if (m.kind === 'delete' && m.zoneId) suppressed.add(m.zoneId);
  }

  const dedup = new Map<string, ProhibitedZoneFeature>();

  if (manifest && Array.isArray(manifest.availableCells)) {
    const available = new Set(manifest.availableCells);
    const neededCells = getCellsForBounds(swLat, swLng, neLat, neLng, manifest.cellSizeDeg || 0.25).filter((c) =>
      available.has(c)
    );
    const cellResults = await Promise.all(neededCells.map((c) => loadCell(manifest.version, c)));
    for (const list of cellResults) {
      for (const feat of list) {
        const zid = feat.properties?.zone_id;
        if (zid && !suppressed.has(zid)) {
          dedup.set(zid, feat);
        }
      }
    }
  }

  for (const feat of delta.activeZones) {
    const zid = feat.properties?.zone_id;
    if (zid && !suppressed.has(zid)) {
      dedup.set(zid, feat);
    }
  }

  for (const m of activePending) {
    if (m.kind === 'add' && m.feature) {
      const zid = m.feature.properties?.zone_id;
      if (zid && !suppressed.has(zid)) {
        dedup.set(zid, m.feature);
      }
    }
  }

  return Array.from(dedup.values());
}

export async function createUserProhibitedZone(params: {
  user: { id: string; provider?: string };
  zoneName: string;
  restrictionScope: RestrictionScope;
  sourceNote: string;
  closedRing: number[][];
}): Promise<{ ok: boolean; feature?: ProhibitedZoneFeature; error?: string }> {
  const token = await ensureZoneSessionToken(params.user);
  if (!token) {
    return { ok: false, error: '로그인 세션을 확인할 수 없습니다. 다시 로그인해 주세요.' };
  }

  try {
    const res = await fetch(`${getZonesBaseUrl()}/api/zones`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        zone_name: params.zoneName,
        restriction_scope: params.restrictionScope,
        source_note: params.sourceNote,
        geometry_geojson: { type: 'Polygon', coordinates: [params.closedRing] },
      }),
    });
    const data = (await res.json()) as { zone?: ProhibitedZoneFeature; committedAt?: string; error?: string };
    if (!res.ok || !data.zone) {
      return { ok: false, error: data.error || `등록 실패 (${res.status})` };
    }
    await addPendingMutation({
      id: `add_${data.zone.properties.zone_id}`,
      kind: 'add',
      committedAt: data.committedAt || new Date().toISOString(),
      feature: data.zone,
    });
    return { ok: true, feature: data.zone };
  } catch (err: any) {
    return { ok: false, error: err?.message || '네트워크 오류가 발생했습니다.' };
  }
}

export async function flagProhibitedZone(params: {
  user: { id: string; provider?: string };
  zoneId: string;
  reason: string;
}): Promise<{ ok: boolean; flagged?: boolean; error?: string }> {
  const token = await ensureZoneSessionToken(params.user);
  if (!token) {
    return { ok: false, error: '로그인이 필요합니다.' };
  }
  try {
    const res = await fetch(`${getZonesBaseUrl()}/api/zones?action=flag`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ zoneId: params.zoneId, reason: params.reason }),
    });
    const data = (await res.json()) as { ok?: boolean; flagged?: boolean; error?: string };
    if (!res.ok) {
      return { ok: false, error: data.error || `신고 실패 (${res.status})` };
    }
    if (data.flagged) {
      await addPendingMutation({
        id: `del_${params.zoneId}`,
        kind: 'delete',
        committedAt: new Date().toISOString(),
        zoneId: params.zoneId,
      });
    }
    return { ok: true, flagged: data.flagged };
  } catch (err: any) {
    return { ok: false, error: err?.message || '신고 요청 실패' };
  }
}

export async function adminDeleteProhibitedZone(params: {
  zoneId: string;
  targetType: 'user' | 'public';
  reason?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const googleToken = localStorage.getItem(GOOGLE_ACCESS_TOKEN_STORAGE_KEY);
  if (!googleToken) {
    return { ok: false, error: '관리자 Google 인증 토큰이 없습니다. 다시 로그인해 주세요.' };
  }
  try {
    const res = await fetch(`${getZonesBaseUrl()}/api/admin/zones`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${googleToken}`,
      },
      body: JSON.stringify(params),
    });
    const data = (await res.json()) as { ok?: boolean; committedAt?: string; error?: string };
    if (!res.ok) {
      return { ok: false, error: data.error || `삭제 실패 (${res.status})` };
    }
    await addPendingMutation({
      id: `del_${params.zoneId}`,
      kind: 'delete',
      committedAt: data.committedAt || new Date().toISOString(),
      zoneId: params.zoneId,
    });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || '관리자 삭제 요청 실패' };
  }
}
