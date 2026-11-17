import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import type { CatchLog, FishingSpot, FishingShop, SpotMemo, ShopMemo } from '../types';
import { INITIAL_CATCH_LOGS, INITIAL_SPOTS } from './storage';

const STORAGE_KEY_URL = 'espfish_supabase_url';
const STORAGE_KEY_ANON = 'espfish_supabase_anon_key';
const STORAGE_KEY_MEMOS = 'espfish_spot_memos';
const STORAGE_KEY_SHOP_MEMOS = 'espfish_shop_memos';

// 사용자가 생성한 Supabase Project URL 및 Publishable Key 기본값 (tlogger's Project)
export const DEFAULT_SUPABASE_URL = 'https://johtqemdlprtbpohdkgu.supabase.co';
export const DEFAULT_SUPABASE_KEY = 'sb_publishable_Aj8gNxqXefjkBg6H6zsCxw_icac_-2G';

let supabaseInstance: SupabaseClient | null = null;

export interface CloudDbConfig {
  url: string;
  anonKey: string;
}

/** fishing_spots 테이블에 존재하는 컬럼만 추출하여 Supabase 스키마 불일치 에러 방지 */
function toDbSpotRecord(spot: FishingSpot): Record<string, unknown> {
  // description 필드 끝에 캐스팅 방향, 스위트 스팟(최대 3개), 관련 URL 정보를 안전하게 인코딩하여 스키마 변경 전/후 모두 무결성 유지
  let desc = spot.description || '';
  if (spot.casting_start_deg !== undefined && spot.casting_end_deg !== undefined) {
    const rangeTag = `[CASTING_RANGE:${spot.casting_start_deg},${spot.casting_end_deg}]`;
    if (!desc.includes('[CASTING_RANGE:')) {
      desc = desc ? `${desc}\n${rangeTag}` : rangeTag;
    }
  } else if (spot.casting_directions && spot.casting_directions.length > 0) {
    const castingTag = `[CASTING:${spot.casting_directions.join(',')}]`;
    if (!desc.includes('[CASTING:')) {
      desc = desc ? `${desc}\n${castingTag}` : castingTag;
    }
  }

  // 스위트 스팟 정보 인코딩 (요구사항 1: 리로드 시 소실 방지)
  if (spot.use_sweet_spot && spot.sweet_spots && spot.sweet_spots.length > 0) {
    try {
      const sweetTag = `[SWEET_SPOTS:${JSON.stringify(spot.sweet_spots)}]`;
      if (!desc.includes('[SWEET_SPOTS:')) {
        desc = desc ? `${desc}\n${sweetTag}` : sweetTag;
      }
    } catch {}
  }

  // 관련 URL 인코딩 (요구사항 3)
  if (spot.related_url && !desc.includes('[RELATED_URL:')) {
    const urlTag = `[RELATED_URL:${spot.related_url.trim()}]`;
    desc = desc ? `${desc}\n${urlTag}` : urlTag;
  }

  const record: Record<string, unknown> = {
    id: spot.id,
    user_id: spot.user_id || 'user-me',
    author_name: spot.author_name || '나의 포인트',
    is_public: spot.is_public ?? true,
    name: spot.name,
    spot_type: spot.spot_type,
    lat: spot.lat,
    lng: spot.lng,
    navi_name: spot.navi_name ?? null,
    navi_url: spot.navi_url ?? null,
    directions: spot.directions ?? '',
    photo_urls: spot.photo_urls ?? [],
    fishing_methods: spot.fishing_methods ?? [],
    target_species: spot.target_species ?? [],
    best_tides: spot.best_tides ?? [],
    best_times: spot.best_times ?? [],
    description: desc,
    created_at: spot.created_at || new Date().toISOString(),
  };

  return record;
}

/** catch_logs 테이블에 존재하는 컬럼만 추출 */
function toDbLogRecord(log: CatchLog): Record<string, unknown> {
  // 기존 시스템 태그들을 완벽히 정리한 후 최신 데이터로 다시 부착 (이전 태그 잔존으로 인한 수정 무시 버그 원천 방지)
  let memoText = (log.memo || '')
    .replace(/\s*\[CURRENT:[^\]]*\]/g, '')
    .replace(/\s*\[WIND_DIR:[^\]]*\]/g, '')
    .replace(/\s*\[TIME:[^\]]*\]/g, '')
    .replace(/\s*\[HITLESS\]/g, '')
    .trim();

  if (log.current_velocity != null) {
    const velTag = `[CURRENT:${log.current_velocity}${log.current_direction != null ? `@${log.current_direction}` : ''}]`;
    memoText = memoText ? `${memoText} ${velTag}` : velTag;
  }
  if (log.wind_direction != null) {
    const windTag = `[WIND_DIR:${log.wind_direction}]`;
    memoText = memoText ? `${memoText} ${windTag}` : windTag;
  }
  if (log.start_time || log.end_time || log.duration_minutes != null) {
    const timeTag = `[TIME:${log.start_time || ''}~${log.end_time || ''}(${log.duration_minutes ?? ''})]`;
    memoText = memoText ? `${memoText} ${timeTag}` : timeTag;
  }
  if (log.fish_count === 0 || log.is_hitless) {
    memoText = memoText ? `${memoText} [HITLESS]` : '[HITLESS]';
  }

  const isHitless = log.fish_count === 0 || log.is_hitless;

  const record: Record<string, unknown> = {
    id: log.id,
    spot_id: log.spot_id,
    user_id: log.user_id || 'user-me',
    user_name: log.user_name || '나의 조과',
    catch_date: log.catch_date,
    catch_time: log.catch_time,
    lat: log.lat ?? null,
    lng: log.lng ?? null,
    fish_species: log.fish_species,
    fish_size_cm: isHitless ? null : (log.fish_size_cm ?? null),
    fish_count: log.fish_count ?? 0,
    catch_method: log.catch_method,
    lure_bait: log.lure_bait ?? '',
    catch_mul: log.catch_mul,
    tide_state: log.tide_state,
    water_temp: log.water_temp,
    wind_speed: log.wind_speed,
    wind_direction: log.wind_direction ?? null,
    photo_url: log.photo_url ?? null,
    memo: memoText,
    created_at: log.created_at || new Date().toISOString(),
  };

  return record;
}

/** 클라우드 DB 설정 가져오기 (항상 Supabase 사용) */
export function getSavedCloudConfig(): CloudDbConfig {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const qUrl = params.get('sb_url');
    const qKey = params.get('sb_key');
    if (qUrl && qKey) {
      saveCloudConfig(qUrl, qKey);
      window.history.replaceState({}, document.title, window.location.pathname);
      return { url: qUrl, anonKey: qKey };
    }

    const savedUrl = localStorage.getItem(STORAGE_KEY_URL) || DEFAULT_SUPABASE_URL;
    const savedKey = localStorage.getItem(STORAGE_KEY_ANON) || DEFAULT_SUPABASE_KEY;
    return { url: savedUrl, anonKey: savedKey };
  }

  const envUrl = typeof import.meta !== 'undefined' && import.meta?.env ? import.meta.env.VITE_SUPABASE_URL : undefined;
  const envKey = typeof import.meta !== 'undefined' && import.meta?.env ? import.meta.env.VITE_SUPABASE_ANON_KEY : undefined;

  return {
    url: envUrl || DEFAULT_SUPABASE_URL,
    anonKey: envKey || DEFAULT_SUPABASE_KEY,
  };
}

/** 클라우드 DB 설정 저장 */
export function saveCloudConfig(url: string, anonKey: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_URL, url.trim());
    localStorage.setItem(STORAGE_KEY_ANON, anonKey.trim());
  }
  supabaseInstance = null;
}

/** 기본 Supabase 설정으로 초기화 */
export function clearCloudConfig(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY_URL);
    localStorage.removeItem(STORAGE_KEY_ANON);
  }
  supabaseInstance = null;
}

/** Supabase 클라이언트 초기화 */
export function getSupabase(): SupabaseClient {
  if (supabaseInstance) return supabaseInstance;

  const config = getSavedCloudConfig();
  supabaseInstance = createClient(config.url, config.anonKey, {
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });
  return supabaseInstance;
}

/** 클라우드 DB 연결 테스트 */
export async function testCloudConnection(url: string, anonKey: string): Promise<boolean> {
  try {
    const client = createClient(url.trim(), anonKey.trim());
    const { error } = await client.from('fishing_spots').select('id').limit(1);
    if (error) {
      console.error('Supabase connection test error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Test connection failed:', e);
    return false;
  }
}

/** DB 레코드로부터 FishingSpot 객체로 변환 (description 내 [CASTING_RANGE:...], [CASTING:...], [SWEET_SPOTS:...], [RELATED_URL:...] 태그 파싱) */
function fromDbSpotRecord(record: any): FishingSpot {
  let desc = record.description || '';
  let castingDirections: string[] = record.casting_directions || [];
  let castingStartDeg: number | undefined = record.casting_start_deg;
  let castingEndDeg: number | undefined = record.casting_end_deg;
  let useSweetSpot: boolean | undefined = record.use_sweet_spot;
  let sweetSpots: any[] | undefined = record.sweet_spots;
  let relatedUrl: string | undefined = record.related_url;

  if (desc && desc.includes('[CASTING_RANGE:')) {
    const match = desc.match(/\[CASTING_RANGE:(\d+),(\d+)\]/);
    if (match && match[1] && match[2]) {
      castingStartDeg = parseInt(match[1], 10);
      castingEndDeg = parseInt(match[2], 10);
      desc = desc.replace(/\n?\[CASTING_RANGE:[^\]]+\]/, '').trim();
    }
  }

  if (desc && desc.includes('[CASTING:')) {
    const match = desc.match(/\[CASTING:([^\]]+)\]/);
    if (match && match[1]) {
      castingDirections = match[1].split(',').filter(Boolean);
      desc = desc.replace(/\n?\[CASTING:[^\]]+\]/, '').trim();
    }
  }

  // 스위트 스팟 복원 (요구사항 1)
  if (desc && desc.includes('[SWEET_SPOTS:')) {
    const match = desc.match(/\[SWEET_SPOTS:(\[.*?\])\]/s);
    if (match && match[1]) {
      try {
        const parsed = JSON.parse(match[1]);
        if (Array.isArray(parsed) && parsed.length > 0) {
          sweetSpots = parsed;
          useSweetSpot = true;
        }
      } catch {}
      desc = desc.replace(/\n?\[SWEET_SPOTS:\[.*?\]\]/s, '').trim();
    }
  }

  // 관련 URL 복원 (요구사항 3)
  if (desc && desc.includes('[RELATED_URL:')) {
    const match = desc.match(/\[RELATED_URL:([^\]]+)\]/);
    if (match && match[1]) {
      relatedUrl = match[1].trim();
      desc = desc.replace(/\n?\[RELATED_URL:[^\]]+\]/, '').trim();
    }
  }

  return {
    ...record,
    description: desc,
    casting_directions: castingDirections,
    casting_start_deg: castingStartDeg,
    casting_end_deg: castingEndDeg,
    use_sweet_spot: useSweetSpot,
    sweet_spots: sweetSpots,
    related_url: relatedUrl,
  };
}

/** DB 레코드로부터 CatchLog 객체로 변환 (memo 내 [CURRENT:...], [TIME:...], [WIND_DIR:...], [HITLESS] 태그 파싱) */
function fromDbLogRecord(record: any): CatchLog {
  let memoText = record.memo || '';
  let currentVel = record.current_velocity ?? undefined;
  let currentDir = record.current_direction ?? undefined;
  let windDir = record.wind_direction ?? undefined;
  let startTime = record.start_time ?? undefined;
  let endTime = record.end_time ?? undefined;
  let durationMins = record.duration_minutes ?? undefined;
  let isHitless = (record.fish_count === 0) || (record.is_hitless === true);

  if (memoText && memoText.includes('[CURRENT:')) {
    const match = memoText.match(/\[CURRENT:([0-9.]+)(?:@([0-9.]+))?\]/);
    if (match) {
      if (match[1]) currentVel = parseFloat(match[1]);
      if (match[2]) currentDir = parseFloat(match[2]);
      memoText = memoText.replace(/\s*\[CURRENT:[^\]]*\]/g, '').trim();
    }
  }

  if (memoText && memoText.includes('[WIND_DIR:')) {
    const match = memoText.match(/\[WIND_DIR:([0-9.]+)\]/);
    if (match && match[1]) {
      windDir = parseFloat(match[1]);
      memoText = memoText.replace(/\s*\[WIND_DIR:[^\]]*\]/g, '').trim();
    }
  }

  if (memoText && memoText.includes('[TIME:')) {
    const match = memoText.match(/\[TIME:([^~]*?)~([^(]*?)(?:\(([0-9]+)\))?\]/);
    if (match) {
      if (match[1]) startTime = match[1];
      if (match[2]) endTime = match[2];
      if (match[3]) durationMins = parseInt(match[3], 10);
      memoText = memoText.replace(/\s*\[TIME:[^\]]*\]/g, '').trim();
    }
  }

  if (memoText && memoText.includes('[HITLESS]')) {
    isHitless = true;
    memoText = memoText.replace(/\s*\[HITLESS\]/g, '').trim();
  }

  return {
    ...record,
    memo: memoText,
    start_time: startTime,
    end_time: endTime,
    duration_minutes: durationMins,
    wind_direction: windDir,
    is_hitless: isHitless || record.fish_count === 0,
    fish_count: record.fish_count ?? 0,
    current_velocity: currentVel,
    current_direction: currentDir,
  };
}

export interface DeltaSyncResult<T> {
  rows: T[];
  deletedIds: string[];
  maxUpdatedAt: string | null;
  isFullSync: boolean;
}

function isMissingColumnError(error: any): boolean {
  const msg = String(error?.message || '');
  return error?.code === '42703' || error?.code === 'PGRST204' || msg.includes('updated_at') || msg.includes('is_deleted');
}

function extractMaxTimestamp(records: any[]): string | null {
  let maxIso: string | null = null;
  let maxMs = 0;
  for (const r of records) {
    const candidate = r?.updated_at || r?.created_at;
    if (!candidate) continue;
    const ms = new Date(candidate).getTime();
    if (!Number.isNaN(ms) && ms > maxMs) {
      maxMs = ms;
      maxIso = candidate;
    }
  }
  return maxIso;
}

async function fetchMasterViaEdgeProxy(table: 'fishing_spots' | 'fishing_shops'): Promise<Record<string, any>[] | null> {
  if (typeof fetch === 'undefined') return null;
  const baseUrl = Capacitor.isNativePlatform() ? 'https://exfish.vercel.app' : '';
  try {
    const res = await fetch(`${baseUrl}/api/exfish-master?table=${table}`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return Array.isArray(json) ? json : null;
  } catch {
    return null;
  }
}

/** 압축된 Base64 Data URL 이미지를 Supabase Storage(exfish-photos)에 업로드하고 Public URL 반환 (실패 시 원본 dataUrl 폴백) */
export async function uploadPhotoToStorage(
  dataUrl: string,
  folder: 'catch_logs' | 'fishing_spots',
  idHint?: string
): Promise<string> {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return dataUrl;
  try {
    const match = /^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/.exec(dataUrl);
    if (!match) return dataUrl;
    const mime = match[1];
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mime });
    const safeHint = (idHint || String(Date.now())).replace(/[^a-zA-Z0-9_-]/g, '');
    const objectPath = `${folder}/${safeHint}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const client = getSupabase();
    const { error } = await client.storage.from('exfish-photos').upload(objectPath, blob, {
      contentType: mime,
      upsert: true,
    });
    if (error) {
      console.warn('[Storage] 사진 업로드 실패, Base64 폴백 사용:', error.message);
      return dataUrl;
    }
    const { data } = client.storage.from('exfish-photos').getPublicUrl(objectPath);
    return data?.publicUrl || dataUrl;
  } catch (err) {
    console.warn('[Storage] 사진 업로드 예외, Base64 폴백 사용:', err);
    return dataUrl;
  }
}

/** Supabase로부터 포인트 증분/전체 조회 (updated_at 컬럼 존재 시 변경분만 다운로드, 미적용 시 자동 전체 폴백) */
export async function fetchCloudSpotsDelta(sinceIso?: string | null): Promise<DeltaSyncResult<FishingSpot>> {
  const client = getSupabase();

  if (sinceIso) {
    const { data, error } = await client
      .from('fishing_spots')
      .select('*')
      .gt('updated_at', sinceIso)
      .order('updated_at', { ascending: true });

    if (!error) {
      const records = data || [];
      const activeRows: FishingSpot[] = [];
      const deletedIds: string[] = [];
      for (const r of records) {
        if (r.is_deleted === true) {
          deletedIds.push(r.id);
        } else {
          activeRows.push(fromDbSpotRecord(r));
        }
      }
      return {
        rows: activeRows,
        deletedIds,
        maxUpdatedAt: extractMaxTimestamp(records) || sinceIso,
        isFullSync: false,
      };
    }

    if (!isMissingColumnError(error)) {
      throw error;
    }
  }

  // 초기 전체 동기화: Vercel Edge CDN 프록시 우선 조회로 인앱 브라우저/신규 방문 시 Supabase Egress 절감
  const edgeRows = await fetchMasterViaEdgeProxy('fishing_spots');
  if (edgeRows && edgeRows.length > 0) {
    const activeRecords = edgeRows.filter((r: any) => r.is_deleted !== true);
    return {
      rows: activeRecords.map(fromDbSpotRecord),
      deletedIds: [],
      maxUpdatedAt: extractMaxTimestamp(edgeRows),
      isFullSync: true,
    };
  }

  // Edge 프록시 미응답 시 직접 조회 폴백
  const { data, error } = await client
    .from('fishing_spots')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching Supabase spots:', error);
    throw error;
  }

  if (!data || data.length === 0) {
    const seedRecords = INITIAL_SPOTS.map(toDbSpotRecord);
    const { error: seedErr } = await client.from('fishing_spots').upsert(seedRecords);
    if (seedErr) {
      console.error('Error seeding initial spots to Supabase:', seedErr);
      return { rows: INITIAL_SPOTS, deletedIds: [], maxUpdatedAt: null, isFullSync: true };
    }
    return { rows: INITIAL_SPOTS, deletedIds: [], maxUpdatedAt: null, isFullSync: true };
  }

  const activeRecords = data.filter((r: any) => r.is_deleted !== true);
  return {
    rows: activeRecords.map(fromDbSpotRecord),
    deletedIds: [],
    maxUpdatedAt: extractMaxTimestamp(data),
    isFullSync: true,
  };
}

/** Supabase로부터 조과 증분/전체 조회 (updated_at 컬럼 존재 시 변경분만 다운로드, 최신 200건 상한) */
export async function fetchCloudLogsDelta(sinceIso?: string | null): Promise<DeltaSyncResult<CatchLog>> {
  const client = getSupabase();

  if (sinceIso) {
    const { data, error } = await client
      .from('catch_logs')
      .select('*')
      .gt('updated_at', sinceIso)
      .order('updated_at', { ascending: true })
      .limit(200);

    if (!error) {
      const records = data || [];
      const activeRows: CatchLog[] = [];
      const deletedIds: string[] = [];
      for (const r of records) {
        if (r.is_deleted === true) {
          deletedIds.push(r.id);
        } else {
          activeRows.push(fromDbLogRecord(r));
        }
      }
      return {
        rows: activeRows,
        deletedIds,
        maxUpdatedAt: extractMaxTimestamp(records) || sinceIso,
        isFullSync: false,
      };
    }

    if (!isMissingColumnError(error)) {
      throw error;
    }
  }

  const { data, error } = await client
    .from('catch_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('Error fetching Supabase logs:', error);
    throw error;
  }

  if (!data || data.length === 0) {
    const seedRecords = INITIAL_CATCH_LOGS.map(toDbLogRecord);
    const { error: seedErr } = await client.from('catch_logs').upsert(seedRecords);
    if (seedErr) {
      console.error('Error seeding initial logs to Supabase:', seedErr);
      return { rows: INITIAL_CATCH_LOGS, deletedIds: [], maxUpdatedAt: null, isFullSync: true };
    }
    return { rows: INITIAL_CATCH_LOGS, deletedIds: [], maxUpdatedAt: null, isFullSync: true };
  }

  const activeRecords = data.filter((r: any) => r.is_deleted !== true);
  return {
    rows: activeRecords.map(fromDbLogRecord),
    deletedIds: [],
    maxUpdatedAt: extractMaxTimestamp(data),
    isFullSync: true,
  };
}

/** Supabase로부터 포인트 목록 불러오기 (테이블이 비어있으면 기본 5대 포인트를 Supabase에 자동 시딩) */
export async function fetchCloudSpots(): Promise<FishingSpot[]> {
  const res = await fetchCloudSpotsDelta(null);
  return res.rows;
}

/** Supabase로부터 조과 목록 불러오기 (최신 200건 제한으로 대량 Egress 방지, 테이블이 비어있으면 기본 조과 시딩) */
export async function fetchCloudLogs(): Promise<CatchLog[]> {
  const res = await fetchCloudLogsDelta(null);
  return res.rows;
}

/** 포인트 Supabase 직접 저장 (신규 등록 및 업데이트) */
export async function saveCloudSpot(spot: FishingSpot): Promise<boolean> {
  const client = getSupabase();
  const { error } = await client.from('fishing_spots').upsert(toDbSpotRecord(spot));
  if (error) {
    console.error('Failed to save spot to Supabase:', error);
    throw error;
  }
  return true;
}

/** 포인트 Supabase 삭제 (Soft Delete 우선, is_deleted 미적용 시 Hard Delete 폴백) */
export async function deleteCloudSpot(spotId: string): Promise<boolean> {
  const client = getSupabase();
  const { error: softErr } = await client
    .from('fishing_spots')
    .update({ is_deleted: true })
    .eq('id', spotId);

  if (!softErr) return true;
  if (!isMissingColumnError(softErr)) {
    console.error('Failed to soft-delete spot from Supabase:', softErr);
    throw softErr;
  }

  const { error } = await client.from('fishing_spots').delete().eq('id', spotId);
  if (error) {
    console.error('Failed to delete spot from Supabase:', error);
    throw error;
  }
  return true;
}

/** 조과 기록 Supabase 직접 저장 (신규 등록 및 업데이트) */
export async function saveCloudCatchLog(log: CatchLog): Promise<boolean> {
  const client = getSupabase();
  const { error } = await client.from('catch_logs').upsert(toDbLogRecord(log));
  if (error) {
    console.error('Failed to save catch log to Supabase:', error);
    throw error;
  }
  return true;
}

/** 조과 기록 Supabase 삭제 (Soft Delete 우선, is_deleted 미적용 시 Hard Delete 폴백) */
export async function deleteCloudCatchLog(logId: string): Promise<boolean> {
  const client = getSupabase();
  const { error: softErr } = await client
    .from('catch_logs')
    .update({ is_deleted: true })
    .eq('id', logId);

  if (!softErr) return true;
  if (!isMissingColumnError(softErr)) {
    console.error('Failed to soft-delete catch log from Supabase:', softErr);
    throw softErr;
  }

  const { error } = await client.from('catch_logs').delete().eq('id', logId);
  if (error) {
    console.error('Failed to delete catch log from Supabase:', error);
    throw error;
  }
  return true;
}

/** 데이터 일괄 Supabase 업로드 */
export async function uploadLocalToCloud(
  spots: FishingSpot[],
  logs: CatchLog[]
): Promise<{ spotsCount: number; logsCount: number }> {
  const client = getSupabase();

  if (spots.length > 0) {
    const { error: sError } = await client.from('fishing_spots').upsert(spots.map(toDbSpotRecord));
    if (sError) throw sError;
  }
  if (logs.length > 0) {
    const { error: lError } = await client.from('catch_logs').upsert(logs.map(toDbLogRecord));
    if (lError) throw lError;
  }

  return { spotsCount: spots.length, logsCount: logs.length };
}

/** PC에서 모바일로 1초 자동 연동할 수 있는 공유 링크 생성 */
export function generateMobilePairingUrl(): string | null {
  const config = getSavedCloudConfig();
  const baseUrl = window.location.origin + window.location.pathname;
  return `${baseUrl}?sb_url=${encodeURIComponent(config.url)}&sb_key=${encodeURIComponent(config.anonKey)}`;
}

// -------------------------------------------------------------
// 포인트별 커뮤니티 현장 메모 (Spot Memos / 방명록 / 실시간 팁)
// -------------------------------------------------------------

const DEFAULT_SAMPLE_MEMOS: SpotMemo[] = [
  {
    id: 'memo-sample-1',
    spot_id: 'spot-seonjae-bridge',
    user_id: 'user-angler-kim',
    user_name: '바다사랑김조사',
    content: '간조 2시간 전부터 진입로 자갈길이 완전히 드러납니다. 갯바위 젖은 이끼가 매우 미끄러우니 펠트 갯바위화 필수입니다!',
    tag: 'SAFETY',
    created_at: new Date(Date.now() - 3600 * 1000 * 5).toISOString(),
  },
  {
    id: 'memo-sample-2',
    spot_id: 'spot-seonjae-bridge',
    user_id: 'user-angler-park',
    user_name: '인천루어맨',
    content: '다리 밑 공영주차장 주말 10시 이후 만차됩니다. 도로변 갓길은 주차단속 잦으니 안쪽 유료주차장 이용 권장드려요.',
    tag: 'PARKING',
    created_at: new Date(Date.now() - 3600 * 1000 * 24).toISOString(),
  },
  {
    id: 'memo-sample-3',
    spot_id: 'spot-yeongheung-jindu',
    user_id: 'user-angler-lee',
    user_name: '영흥도원투왕',
    content: '중들물 유속 강할 때 30호 봉돌도 굴러갑니다. 스파이크 봉돌 35호 이상 쓰시거나 물돌이 정조 타임 집중 공략 추천합니다.',
    tag: 'CONDITION',
    created_at: new Date(Date.now() - 3600 * 1000 * 12).toISOString(),
  },
];

function getLocalMemos(): SpotMemo[] {
  if (typeof window === 'undefined') return DEFAULT_SAMPLE_MEMOS;
  const raw = localStorage.getItem(STORAGE_KEY_MEMOS);
  if (!raw) {
    localStorage.setItem(STORAGE_KEY_MEMOS, JSON.stringify(DEFAULT_SAMPLE_MEMOS));
    return DEFAULT_SAMPLE_MEMOS;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return DEFAULT_SAMPLE_MEMOS;
  }
}

function saveLocalMemos(memos: SpotMemo[]): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_MEMOS, JSON.stringify(memos));
  }
}

const MEMO_CACHE_TTL_MS = 5 * 60 * 1000;
const memoCache = new Map<string, { expiresAt: number; data: SpotMemo[] }>();
const memoInFlight = new Map<string, Promise<SpotMemo[]>>();

/** 특정 포인트의 현장 메모 목록 조회 (5분 인메모리 TTL 캐시 및 동시 요청 병합 적용) */
export async function fetchCloudMemos(spotId: string): Promise<SpotMemo[]> {
  const now = Date.now();
  const cached = memoCache.get(spotId);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  const existingPromise = memoInFlight.get(spotId);
  if (existingPromise) {
    return existingPromise;
  }

  const request = (async (): Promise<SpotMemo[]> => {
    try {
      const client = getSupabase();
      const { data, error } = await client
        .from('spot_memos')
        .select('*')
        .eq('spot_id', spotId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (!error && data) {
        memoCache.set(spotId, { expiresAt: Date.now() + MEMO_CACHE_TTL_MS, data });
        if (data.length > 0) {
          return data;
        }
      }
    } catch {
      // Supabase 테이블이 아직 없거나 네트워크 오프라인 시 fallback
    }

    // Local fallback
    const allMemos = getLocalMemos();
    return allMemos.filter((m) => m.spot_id === spotId);
  })().finally(() => {
    memoInFlight.delete(spotId);
  });

  memoInFlight.set(spotId, request);
  return request;
}

/** 현장 메모 등록 */
export async function saveCloudMemo(memo: SpotMemo): Promise<boolean> {
  // 1. Supabase 시도
  try {
    const client = getSupabase();
    const { error } = await client.from('spot_memos').upsert({
      id: memo.id,
      spot_id: memo.spot_id,
      user_id: memo.user_id,
      user_name: memo.user_name,
      content: memo.content,
      tag: memo.tag || 'GENERAL',
      created_at: memo.created_at,
    });
    if (!error) {
      // Local 및 인메모리 캐시 즉시 동기화
      const local = getLocalMemos();
      const updated = [memo, ...local.filter((m) => m.id !== memo.id)];
      saveLocalMemos(updated);
      const cached = memoCache.get(memo.spot_id);
      if (cached) {
        memoCache.set(memo.spot_id, {
          expiresAt: Date.now() + MEMO_CACHE_TTL_MS,
          data: [memo, ...cached.data.filter((m) => m.id !== memo.id)],
        });
      }
      return true;
    }
  } catch {
    // ignore
  }

  // 2. Local fallback 저장
  const local = getLocalMemos();
  const updated = [memo, ...local.filter((m) => m.id !== memo.id)];
  saveLocalMemos(updated);
  memoCache.delete(memo.spot_id);
  return true;
}

/** 현장 메모 삭제 */
export async function deleteCloudMemo(memoId: string): Promise<boolean> {
  try {
    const client = getSupabase();
    await client.from('spot_memos').delete().eq('id', memoId);
  } catch {
    // ignore
  }

  const local = getLocalMemos();
  const updated = local.filter((m) => m.id !== memoId);
  saveLocalMemos(updated);
  memoCache.forEach((entry, key) => {
    if (entry.data.some((m) => m.id === memoId)) {
      memoCache.set(key, {
        expiresAt: entry.expiresAt,
        data: entry.data.filter((m) => m.id !== memoId),
      });
    }
  });
  return true;
}

// ==========================================
// 낚시점 (FishingShop) & 낚시점 누적 메모 (ShopMemo)
// ==========================================

function isMissingTableError(error: any): boolean {
  const msg = String(error?.message || '');
  return (
    error?.code === '42P01' ||
    error?.code === 'PGRST205' ||
    msg.includes('Could not find the table') ||
    msg.includes('does not exist')
  );
}

function fromDbShopRecord(raw: any): FishingShop {
  return {
    id: String(raw.id),
    user_id: String(raw.user_id || ''),
    author_name: String(raw.author_name || '관리자'),
    is_public: raw.is_public !== false,
    name: String(raw.name || ''),
    lat: Number(raw.lat),
    lng: Number(raw.lng),
    navi_name: raw.navi_name || undefined,
    navi_url: raw.navi_url || undefined,
    kakao_place_id: raw.kakao_place_id || undefined,
    has_restroom: Boolean(raw.has_restroom),
    has_store: Boolean(raw.has_store),
    is_promoted: Boolean(raw.is_promoted),
    promoted_until: raw.promoted_until || undefined,
    promo_badge_text: raw.promo_badge_text || undefined,
    is_deleted: Boolean(raw.is_deleted),
    created_at: raw.created_at || new Date().toISOString(),
    updated_at: raw.updated_at || raw.created_at || undefined,
  };
}

export async function fetchCloudShopsDelta(sinceIso?: string | null): Promise<DeltaSyncResult<FishingShop>> {
  const client = getSupabase();

  if (sinceIso) {
    const { data, error } = await client
      .from('fishing_shops')
      .select('*')
      .gt('updated_at', sinceIso)
      .order('updated_at', { ascending: true });

    if (!error) {
      const records = data || [];
      const activeRows: FishingShop[] = [];
      const deletedIds: string[] = [];
      for (const r of records) {
        if (r.is_deleted === true) deletedIds.push(r.id);
        else activeRows.push(fromDbShopRecord(r));
      }
      return {
        rows: activeRows,
        deletedIds,
        maxUpdatedAt: extractMaxTimestamp(records) || sinceIso,
        isFullSync: false,
      };
    }

    if (isMissingTableError(error)) {
      return { rows: [], deletedIds: [], maxUpdatedAt: null, isFullSync: true };
    }
    if (!isMissingColumnError(error)) {
      throw error;
    }
  }

  const edgeShopRows = await fetchMasterViaEdgeProxy('fishing_shops');
  if (edgeShopRows) {
    const activeRecords = edgeShopRows.filter((r: any) => r.is_deleted !== true);
    return {
      rows: activeRecords.map(fromDbShopRecord),
      deletedIds: [],
      maxUpdatedAt: extractMaxTimestamp(edgeShopRows),
      isFullSync: true,
    };
  }

  const { data, error } = await client
    .from('fishing_shops')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    if (isMissingTableError(error)) {
      console.warn('[Sync:shops] fishing_shops table not migrated yet; returning empty list');
      return { rows: [], deletedIds: [], maxUpdatedAt: null, isFullSync: true };
    }
    throw error;
  }

  const activeRecords = (data || []).filter((r: any) => r.is_deleted !== true);
  return {
    rows: activeRecords.map(fromDbShopRecord),
    deletedIds: [],
    maxUpdatedAt: extractMaxTimestamp(data || []),
    isFullSync: true,
  };
}

function getAdminShopsApiUrl(): string {
  return Capacitor.isNativePlatform() ? 'https://exfish.vercel.app/api/admin/shops' : '/api/admin/shops';
}

export async function saveCloudShop(shop: FishingShop): Promise<FishingShop> {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('exfish_google_access_token') : null;

  if (token) {
    try {
      const res = await fetch(getAdminShopsApiUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(shop),
      });

      if (res.ok) {
        const saved = await res.json();
        const row = Array.isArray(saved) ? saved[0] : saved;
        return row ? fromDbShopRecord(row) : shop;
      }

      const errText = await res.text().catch(() => '');
      // 서버에 SUPABASE_SERVICE_ROLE_KEY가 미설정된 경우 직접 Supabase REST(anon + RLS)로 폴백
      if (res.status !== 500 || !errText.includes('SUPABASE_SERVICE_ROLE_KEY')) {
        throw new Error(errText || `낚시점 저장 실패 (HTTP ${res.status})`);
      }
    } catch (err: any) {
      if (!String(err?.message || '').includes('Failed to fetch')) {
        throw err;
      }
    }
  }

  const client = getSupabase();
  const payload = {
    id: shop.id,
    user_id: shop.user_id,
    author_name: shop.author_name || '관리자',
    is_public: shop.is_public !== false,
    name: shop.name,
    lat: shop.lat,
    lng: shop.lng,
    navi_name: shop.navi_name ?? null,
    navi_url: shop.navi_url ?? null,
    kakao_place_id: shop.kakao_place_id ?? null,
    has_restroom: Boolean(shop.has_restroom),
    has_store: Boolean(shop.has_store),
    is_deleted: false,
    created_at: shop.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await client
    .from('fishing_shops')
    .upsert(payload, { onConflict: 'id' })
    .select('*')
    .single();

  if (error) {
    if (isMissingTableError(error)) {
      throw new Error('Supabase에 fishing_shops 테이블이 아직 생성되지 않았습니다. 마이그레이션 SQL을 실행해 주세요.');
    }
    throw error;
  }

  return data ? fromDbShopRecord(data) : shop;
}

export async function deleteCloudShop(shopId: string): Promise<void> {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('exfish_google_access_token') : null;

  if (token) {
    try {
      const res = await fetch(`${getAdminShopsApiUrl()}?id=${encodeURIComponent(shopId)}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.ok) return;

      const errText = await res.text().catch(() => '');
      if (res.status !== 500 || !errText.includes('SUPABASE_SERVICE_ROLE_KEY')) {
        throw new Error(errText || `낚시점 삭제 실패 (HTTP ${res.status})`);
      }
    } catch (err: any) {
      if (!String(err?.message || '').includes('Failed to fetch')) {
        throw err;
      }
    }
  }

  const client = getSupabase();
  const { error } = await client
    .from('fishing_shops')
    .update({ is_deleted: true, updated_at: new Date().toISOString() })
    .eq('id', shopId);

  if (error) {
    throw error;
  }
}

const shopMemoCache = new Map<string, { expiresAt: number; data: ShopMemo[] }>();
const shopMemoInFlight = new Map<string, Promise<ShopMemo[]>>();

function getLocalShopMemos(): ShopMemo[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SHOP_MEMOS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalShopMemos(memos: ShopMemo[]) {
  try {
    localStorage.setItem(STORAGE_KEY_SHOP_MEMOS, JSON.stringify(memos));
  } catch {
    // ignore
  }
}

export async function fetchShopMemos(shopId: string): Promise<ShopMemo[]> {
  const now = Date.now();
  const cached = shopMemoCache.get(shopId);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  const pending = shopMemoInFlight.get(shopId);
  if (pending) return pending;

  const task = (async () => {
    try {
      const client = getSupabase();
      const { data, error } = await client
        .from('shop_memos')
        .select('*')
        .eq('shop_id', shopId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (!error && Array.isArray(data)) {
        const list = data as ShopMemo[];
        shopMemoCache.set(shopId, { expiresAt: Date.now() + MEMO_CACHE_TTL_MS, data: list });
        return list;
      }
    } catch {
      // ignore -> local fallback
    }
    const localList = getLocalShopMemos().filter((m) => m.shop_id === shopId);
    shopMemoCache.set(shopId, { expiresAt: Date.now() + 60_000, data: localList });
    return localList;
  })();

  shopMemoInFlight.set(shopId, task);
  try {
    return await task;
  } finally {
    shopMemoInFlight.delete(shopId);
  }
}

export async function saveShopMemo(memo: ShopMemo): Promise<boolean> {
  try {
    const client = getSupabase();
    const { error } = await client.from('shop_memos').insert({
      id: memo.id,
      shop_id: memo.shop_id,
      user_id: memo.user_id,
      user_name: memo.user_name,
      content: memo.content,
      tag: memo.tag || 'GENERAL',
      created_at: memo.created_at,
    });
    if (!error) {
      const cached = shopMemoCache.get(memo.shop_id);
      if (cached) {
        shopMemoCache.set(memo.shop_id, {
          expiresAt: Date.now() + MEMO_CACHE_TTL_MS,
          data: [memo, ...cached.data.filter((m) => m.id !== memo.id)],
        });
      }
      return true;
    }
  } catch {
    // ignore -> local fallback
  }

  const local = getLocalShopMemos();
  saveLocalShopMemos([memo, ...local.filter((m) => m.id !== memo.id)]);
  shopMemoCache.delete(memo.shop_id);
  return true;
}

export async function deleteShopMemo(memoId: string): Promise<boolean> {
  try {
    const client = getSupabase();
    await client.from('shop_memos').delete().eq('id', memoId);
  } catch {
    // ignore
  }

  const local = getLocalShopMemos();
  saveLocalShopMemos(local.filter((m) => m.id !== memoId));
  shopMemoCache.forEach((entry, key) => {
    if (entry.data.some((m) => m.id === memoId)) {
      shopMemoCache.set(key, {
        expiresAt: entry.expiresAt,
        data: entry.data.filter((m) => m.id !== memoId),
      });
    }
  });
  return true;
}
