import { getSupabase } from './cloudDb';

export type KhoaApiType = 'TIDE' | 'DEPTH' | 'WIND' | 'WATER_TEMP' | 'ROMS';

export interface KhoaCacheEntry<T = unknown> {
  cacheKey: string;
  apiType: KhoaApiType;
  subKey?: string;
  payload: T;
  expiresAt: number; // Unix timestamp (ms)
}

// L1 인메모리 캐시 (초고속 재접근용)
const memoryCache = new Map<string, { expiresAt: number; payload: unknown }>();

// 동시 중복 요청 병합 (In-flight Request Deduplication)
const inFlightPromises = new Map<string, Promise<unknown>>();

// Supabase 테이블 존재 여부 플래그 (테이블 미생성 시 불필요한 반복 쿼리 방지)
let isSupabaseTableAvailable = true;

/**
 * KHOA 5대 공공데이터 전 종목 계층형 캐싱 파이프라인
 * L1 (메모리 + localStorage) -> L2 (Supabase 중앙 DB) -> L3 (fetchFn API 호출 & 중앙 DB 저장)
 */
export async function getOrFetchKhoaData<T>(
  cacheKey: string,
  apiType: KhoaApiType,
  subKey: string | undefined,
  ttlMs: number,
  fetchFn: () => Promise<T | null>
): Promise<T | null> {
  const now = Date.now();

  // 1. L1 인메모리 캐시 검사
  const memHit = memoryCache.get(cacheKey);
  if (memHit && memHit.expiresAt > now) {
    return memHit.payload as T;
  }

  // 2. L1 localStorage 캐시 검사
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(`khoa_c_${cacheKey}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.expiresAt > now && parsed.payload !== undefined) {
          memoryCache.set(cacheKey, { expiresAt: parsed.expiresAt, payload: parsed.payload });
          return parsed.payload as T;
        }
      }
    } catch {}
  }

  // 3. 동일 키에 대한 동시 진행 중인 요청 병합 (In-flight Deduplication)
  if (inFlightPromises.has(cacheKey)) {
    return inFlightPromises.get(cacheKey) as Promise<T | null>;
  }

  const queryPromise = (async (): Promise<T | null> => {
    // 4. L2 Supabase 중앙 DB 캐시 검사
    if (isSupabaseTableAvailable) {
      try {
        const sb = getSupabase();
        const { data, error } = await sb
          .from('khoa_global_cache')
          .select('payload, expires_at')
          .eq('cache_key', cacheKey)
          .limit(1)
          .maybeSingle();

        if (error) {
          if (error.code === 'PGRST205' || error.message?.includes('schema cache')) {
            isSupabaseTableAvailable = false;
          }
        } else if (data && data.payload) {
          const expMs = new Date(data.expires_at).getTime();
          if (expMs > now) {
            // L1에 동기화 저장
            saveToL1Cache(cacheKey, data.payload, expMs);
            return data.payload as T;
          }
        }
      } catch (err) {
        console.warn(`[KHOA DB Cache] Supabase lookup error for ${cacheKey}:`, err);
      }
    }

    // 5. L3 원천 API 호출 (KHOA OpenAPI)
    try {
      const freshData = await fetchFn();
      if (freshData == null) return null;

      const expiresAt = now + ttlMs;

      // L1 캐시 저장
      saveToL1Cache(cacheKey, freshData, expiresAt);

      // L2 Supabase 중앙 DB 비동기 Upsert (다른 모든 사용자와 즉시 공유)
      if (isSupabaseTableAvailable) {
        saveToSupabaseDb(cacheKey, apiType, subKey, freshData, expiresAt).catch(() => {});
      }

      return freshData;
    } catch (e) {
      console.error(`[KHOA DB Cache] fetchFn failed for ${cacheKey}:`, e);
      return null;
    } finally {
      inFlightPromises.delete(cacheKey);
    }
  })();

  inFlightPromises.set(cacheKey, queryPromise as Promise<unknown>);
  return queryPromise;
}

/** L1 로컬/메모리 저장 헬퍼 (쿼터 초과 시 오래된 KHOA 캐시 정리 후 재시도) */
function saveToL1Cache<T>(cacheKey: string, payload: T, expiresAt: number) {
  memoryCache.set(cacheKey, { expiresAt, payload });
  if (typeof window !== 'undefined') {
    const storageKey = `khoa_c_${cacheKey}`;
    const serialized = JSON.stringify({ expiresAt, payload });
    try {
      localStorage.setItem(storageKey, serialized);
    } catch {
      try {
        const now = Date.now();
        const khoaKeys: { key: string; expiresAt: number }[] = [];
        const allKhoaKeys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('khoa_c_')) {
            allKhoaKeys.push(k);
          }
        }
        for (const k of allKhoaKeys) {
          let exp = 0;
          try {
            const parsed = JSON.parse(localStorage.getItem(k) || '{}');
            exp = typeof parsed.expiresAt === 'number' ? parsed.expiresAt : 0;
          } catch {
            exp = 0;
          }
          if (exp <= now) {
            localStorage.removeItem(k);
          } else {
            khoaKeys.push({ key: k, expiresAt: exp });
          }
        }
        khoaKeys.sort((a, b) => a.expiresAt - b.expiresAt);
        const evictCount = Math.max(1, Math.ceil(khoaKeys.length / 2));
        for (let i = 0; i < Math.min(evictCount, khoaKeys.length); i++) {
          localStorage.removeItem(khoaKeys[i].key);
        }
        localStorage.setItem(storageKey, serialized);
      } catch {
        // ignore if storage remains unavailable or full
      }
    }
  }
}

/** L2 Supabase DB Upsert 헬퍼 */
async function saveToSupabaseDb<T>(
  cacheKey: string,
  apiType: KhoaApiType,
  subKey: string | undefined,
  payload: T,
  expiresAt: number
): Promise<void> {
  try {
    const sb = getSupabase();
    await sb.from('khoa_global_cache').upsert(
      {
        cache_key: cacheKey,
        api_type: apiType,
        sub_key: subKey || null,
        payload: payload as unknown as Record<string, unknown>,
        expires_at: new Date(expiresAt).toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'cache_key' }
    );
  } catch (err) {
    console.warn(`[KHOA DB Cache] Supabase upsert error (${cacheKey}):`, err);
  }
}
