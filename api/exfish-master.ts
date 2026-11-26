// Vercel Serverless CDN 캐싱 프록시 (/api/exfish-master?table=fishing_spots|fishing_shops|catch_logs|spot_memos|shop_memos)
// 공개·미삭제 행만 서버 측에서 강제 필터링하고 단일 캐시 키(s-maxage=300) + ETag(304)로 공유 Supabase Egress를 억제합니다.
import crypto from 'node:crypto';

const DEFAULT_SUPABASE_URL = 'https://johtqemdlprtbpohdkgu.supabase.co';
const DEFAULT_SUPABASE_KEY = 'sb_publishable_Aj8gNxqXefjkBg6H6zsCxw_icac_-2G';

const ALLOWED_TABLES = new Set([
  'fishing_spots',
  'fishing_shops',
  'catch_logs',
  'spot_memos',
  'shop_memos',
]);

function buildUpstreamUrl(supabaseUrl: string, table: string, reqQuery: Record<string, any>): string | null {
  const params = new URLSearchParams();

  if (table === 'fishing_spots') {
    params.set('select', '*');
    params.set('is_public', 'eq.true');
    params.set('is_deleted', 'neq.true');
    params.set('order', 'created_at.desc');
    params.set('limit', '1000');
    return `${supabaseUrl}/rest/v1/fishing_spots?${params.toString()}`;
  }

  if (table === 'fishing_shops') {
    params.set('select', '*');
    params.set('is_public', 'eq.true');
    params.set('is_deleted', 'neq.true');
    params.set('order', 'created_at.desc');
    params.set('limit', '1000');
    return `${supabaseUrl}/rest/v1/fishing_shops?${params.toString()}`;
  }

  if (table === 'catch_logs') {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    params.set('select', '*');
    params.set('is_public', 'eq.true');
    params.set('is_deleted', 'neq.true');
    params.set('catch_date', `gte.${cutoff}`);
    params.set('order', 'created_at.desc');
    params.set('limit', '500');
    return `${supabaseUrl}/rest/v1/catch_logs?${params.toString()}`;
  }

  if (table === 'spot_memos') {
    const spotId = String(reqQuery?.spot_id || '').trim();
    if (!spotId) return null;
    // 비공개 포인트에 속한 메모 노출 차단 (!inner 조인)
    params.set('select', 'id,spot_id,user_id,user_name,content,created_at,fishing_spots!inner(is_public,is_deleted)');
    params.set('spot_id', `eq.${spotId}`);
    params.set('is_deleted', 'neq.true');
    params.set('fishing_spots.is_public', 'eq.true');
    params.set('fishing_spots.is_deleted', 'neq.true');
    params.set('order', 'created_at.desc');
    params.set('limit', '100');
    return `${supabaseUrl}/rest/v1/spot_memos?${params.toString()}`;
  }

  if (table === 'shop_memos') {
    const shopId = String(reqQuery?.shop_id || '').trim();
    if (!shopId) return null;
    params.set('select', 'id,shop_id,user_id,user_name,content,created_at,fishing_shops!inner(is_public,is_deleted)');
    params.set('shop_id', `eq.${shopId}`);
    params.set('is_deleted', 'neq.true');
    params.set('fishing_shops.is_public', 'eq.true');
    params.set('fishing_shops.is_deleted', 'neq.true');
    params.set('order', 'created_at.desc');
    params.set('limit', '100');
    return `${supabaseUrl}/rest/v1/shop_memos?${params.toString()}`;
  }

  return null;
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-None-Match');
  res.setHeader('Access-Control-Expose-Headers', 'ETag');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const table = String(req.query?.table || '').trim();
  if (!ALLOWED_TABLES.has(table)) {
    return res.status(400).json({ error: 'Invalid table parameter' });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_KEY;

  const targetUrl = buildUpstreamUrl(supabaseUrl, table, req.query || {});
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing required filter parameter (spot_id or shop_id)' });
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(9000),
    });

    if (!upstream.ok) {
      res.setHeader('Cache-Control', 'no-store');
      const errText = await upstream.text().catch(() => '');
      return res.status(upstream.status).json({ error: `Supabase error ${upstream.status}`, detail: errText });
    }

    let data = await upstream.json();
    // !inner 조인 보조 객체 제거하여 깔끔한 메모 배열 반환
    if ((table === 'spot_memos' || table === 'shop_memos') && Array.isArray(data)) {
      data = data.map((row: any) => {
        const { fishing_spots: _fs, fishing_shops: _fsh, ...rest } = row;
        return rest;
      });
    }

    const bodyStr = JSON.stringify(data);
    const etag = `"${crypto.createHash('sha256').update(bodyStr).digest('base64url').slice(0, 24)}"`;

    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400');

    const ifNoneMatch = req.headers?.['if-none-match'] || req.headers?.['If-None-Match'];
    if (ifNoneMatch && String(ifNoneMatch).trim() === etag) {
      return res.status(304).end();
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).send(bodyStr);
  } catch (err: any) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: err?.message || 'Upstream fetch failed' });
  }
}
