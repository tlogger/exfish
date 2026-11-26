// Vercel Serverless 사진 업로드 엔드포인트 (/api/upload-photo)
// HMAC 세션 검증 + MIME 화이트리스트 + 300KB 크기 제한 + 인스턴스 단위 best-effort 버스트 방어 후 Vercel Blob에 직접 업로드합니다.
// 전역 악용 차단은 Vercel Dashboard WAF 규칙으로 보완합니다.
import crypto from 'node:crypto';
import { put } from '@vercel/blob';
import { setCorsHeaders, verifySessionFromRequest } from './_lib/auth.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_BYTES = 300 * 1024; // 300KB
const ALLOWED_MIME = new Set(['image/webp', 'image/jpeg', 'image/png']);
const ALLOWED_FOLDERS = new Set(['spots', 'catches']);

// 인스턴스 단위 best-effort 버스트 방어 (분당 15건)
const rateMap = new Map<string, { count: number; resetAt: number }>();

function checkBestEffortRateLimit(key: string, maxPerMin = 15): boolean {
  const now = Date.now();
  const entry = rateMap.get(key);
  if (!entry || entry.resetAt <= now) {
    rateMap.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= maxPerMin) return false;
  entry.count += 1;
  return true;
}

async function readRawBody(req: any, maxBytes: number): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > maxBytes) throw new Error('PAYLOAD_TOO_LARGE');
    return req.body;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      throw new Error('PAYLOAD_TOO_LARGE');
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req: any, res: any) {
  setCorsHeaders(res, 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Photo-Folder');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = verifySessionFromRequest(req);
  if (!auth.ok || !auth.claims?.userId) {
    return res.status(401).json({ error: auth.error || 'Unauthorized' });
  }

  if (!checkBestEffortRateLimit(auth.claims.userId)) {
    return res.status(429).json({ error: 'Too many photo uploads. Please wait a minute.' });
  }

  const contentTypeRaw = String(req.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_MIME.has(contentTypeRaw)) {
    return res.status(415).json({ error: `Unsupported Content-Type: ${contentTypeRaw || 'none'}` });
  }

  const folderRaw = String(req.headers?.['x-photo-folder'] || req.query?.folder || 'spots').trim().toLowerCase();
  const folder = ALLOWED_FOLDERS.has(folderRaw) ? folderRaw : 'spots';

  let buffer: Buffer;
  try {
    buffer = await readRawBody(req, MAX_BYTES);
  } catch (err: any) {
    if (err?.message === 'PAYLOAD_TOO_LARGE') {
      return res.status(413).json({ error: 'Image exceeds 300KB limit' });
    }
    return res.status(400).json({ error: 'Failed to read upload body' });
  }

  if (!buffer || buffer.length === 0) {
    return res.status(400).json({ error: 'Empty image payload' });
  }

  const ext = contentTypeRaw === 'image/webp' ? 'webp' : contentTypeRaw === 'image/png' ? 'png' : 'jpg';
  const rand = crypto.randomBytes(6).toString('hex');
  const pathname = `exfish/${folder}/${Date.now()}_${rand}.${ext}`;

  try {
    const blob = await put(pathname, buffer, {
      access: 'public',
      contentType: contentTypeRaw,
      addRandomSuffix: false,
      cacheControlMaxAge: 31536000,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return res.status(200).json({ url: blob.url });
  } catch (err: any) {
    return res.status(502).json({ error: err?.message || 'Blob upload failed' });
  }
}
