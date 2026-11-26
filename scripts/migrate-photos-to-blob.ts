/**
 * ExFish 불량/샘플 사진 정리 및 Supabase Storage(exfish-photos) -> Vercel Blob 일괄 이관 CLI
 *
 * 사용법:
 *   기본 (Dry-run, DB 수정 없음):
 *     node --experimental-strip-types scripts/migrate-photos-to-blob.ts --dry-run
 *   실제 이관 실행:
 *     node --experimental-strip-types scripts/migrate-photos-to-blob.ts --apply
 *
 * 필요 환경변수:
 *   VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BLOB_READ_WRITE_TOKEN
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { put } from '@vercel/blob';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://johtqemdlprtbpohdkgu.supabase.co';
const RAW_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SERVICE_KEY = (RAW_SERVICE_KEY && RAW_SERVICE_KEY !== '[SENSITIVE]')
  ? RAW_SERVICE_KEY
  : (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_Aj8gNxqXefjkBg6H6zsCxw_icac_-2G');
const DRY_RUN = !process.argv.includes('--apply');

function isBadOrSampleUrl(url: string): 'unsplash' | 'empty' | null {
  const trimmed = (url || '').trim();
  if (!trimmed) return 'empty';
  if (trimmed.includes('images.unsplash.com')) return 'unsplash';
  return null;
}

function parseBase64DataUrl(url: string): { mime: string; ext: string; buffer: Buffer } | null {
  const m = /^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/i.exec((url || '').trim());
  if (!m) return null;
  const mime = m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase();
  const ext = mime === 'image/webp' ? 'webp' : mime === 'image/png' ? 'png' : 'jpg';
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.byteLength < 100) return null;
  return { mime, ext, buffer };
}

function isSupabaseStorageUrl(url: string): boolean {
  return url.includes('/storage/v1/object/public/exfish-photos/');
}

async function fetchJson(endpoint: string): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Supabase GET ${endpoint} failed: ${res.status}`);
  return (await res.json()) as any[];
}

async function patchRecord(table: string, id: string, patch: Record<string, any>): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${table}/${id} failed: ${res.status}`);
}

async function checkAndMigrateUrl(
  url: string,
  folder: 'spots' | 'catches'
): Promise<{ status: 'keep' | 'drop' | 'migrated'; reason?: string; nextUrl?: string }> {
  const bad = isBadOrSampleUrl(url);
  if (bad) return { status: 'drop', reason: bad };

  // 이미 Vercel Blob인 경우 유지
  if (url.includes('.blob.vercel-storage.com/')) {
    return { status: 'keep', nextUrl: url };
  }

  // 유효한 Base64 실제 사용자 사진은 Vercel Blob으로 이관 (DB Base64 비대화 제거 + 사진 보존)
  if (url.startsWith('data:image/')) {
    const parsed = parseBase64DataUrl(url);
    if (!parsed) return { status: 'drop', reason: 'invalid_base64' };
    const hash = crypto.createHash('sha1').update(parsed.buffer).digest('hex').slice(0, 12);
    const pathname = `exfish/${folder}/migrated_b64_${hash}.${parsed.ext}`;
    if (DRY_RUN) {
      return { status: 'migrated', nextUrl: `[DRY_RUN_BLOB]/${pathname}` };
    }
    const blob = await put(pathname, parsed.buffer, {
      access: 'public',
      contentType: parsed.mime,
      addRandomSuffix: false,
      cacheControlMaxAge: 31536000,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return { status: 'migrated', nextUrl: blob.url };
  }

  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) {
      return { status: 'drop', reason: `http_${resp.status}` };
    }
    if (!isSupabaseStorageUrl(url)) {
      return { status: 'keep', nextUrl: url };
    }

    const arrayBuf = await resp.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    const contentType = (resp.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    const ext = contentType === 'image/webp' ? 'webp' : contentType === 'image/png' ? 'png' : 'jpg';
    const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 12);
    const pathname = `exfish/${folder}/migrated_${hash}.${ext}`;

    if (DRY_RUN) {
      return { status: 'migrated', nextUrl: `[DRY_RUN_BLOB]/${pathname}` };
    }

    const blob = await put(pathname, buf, {
      access: 'public',
      contentType,
      addRandomSuffix: false,
      cacheControlMaxAge: 31536000,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return { status: 'migrated', nextUrl: blob.url };
  } catch {
    return { status: 'drop', reason: 'network_error' };
  }
}

async function main() {
  if (!SERVICE_KEY) {
    console.error('Missing SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  console.log(`[migrate-photos-to-blob] mode=${DRY_RUN ? 'DRY_RUN' : 'APPLY'}`);

  const backup: Array<{ table: string; id: string; old_url: string; new_url: string | null; action: string }> = [];

  // 1. fishing_spots.photo_urls
  const spots = await fetchJson('fishing_spots?select=id,photo_urls&limit=1000');
  for (const spot of spots) {
    const urls: string[] = Array.isArray(spot.photo_urls) ? spot.photo_urls : [];
    if (urls.length === 0) continue;

    const nextUrls: string[] = [];
    let changed = false;
    for (const u of urls) {
      const result = await checkAndMigrateUrl(u, 'spots');
      if (result.status === 'drop') {
        changed = true;
        backup.push({ table: 'fishing_spots', id: spot.id, old_url: u, new_url: null, action: `drop:${result.reason}` });
      } else if (result.status === 'migrated' && result.nextUrl) {
        changed = true;
        nextUrls.push(result.nextUrl);
        backup.push({ table: 'fishing_spots', id: spot.id, old_url: u, new_url: result.nextUrl, action: 'migrated' });
      } else if (result.nextUrl) {
        nextUrls.push(result.nextUrl);
      }
    }
    if (changed && !DRY_RUN) {
      await patchRecord('fishing_spots', spot.id, { photo_urls: nextUrls });
    }
  }

  // 2. catch_logs.photo_url
  const logs = await fetchJson('catch_logs?select=id,photo_url&limit=1000');
  for (const log of logs) {
    if (!log.photo_url) continue;
    const result = await checkAndMigrateUrl(log.photo_url, 'catches');
    if (result.status === 'drop') {
      backup.push({ table: 'catch_logs', id: log.id, old_url: log.photo_url, new_url: null, action: `drop:${result.reason}` });
      if (!DRY_RUN) await patchRecord('catch_logs', log.id, { photo_url: null });
    } else if (result.status === 'migrated' && result.nextUrl) {
      backup.push({ table: 'catch_logs', id: log.id, old_url: log.photo_url, new_url: result.nextUrl, action: 'migrated' });
      if (!DRY_RUN) await patchRecord('catch_logs', log.id, { photo_url: result.nextUrl });
    }
  }

  const outPath = path.resolve(process.cwd(), `photo_migration_backup_${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(backup, null, 2), 'utf8');
  console.log(`[migrate-photos-to-blob] done. total actions=${backup.length}, backup=${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
