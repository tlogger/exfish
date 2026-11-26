// Vercel Serverless 관리자 전용 낚시점(fishing_shops) CUD 엔드포인트
// Google OAuth 액세스 토큰으로 paedros@gmail.com 신원을 검증한 뒤 SUPABASE_SERVICE_ROLE_KEY로 기록합니다.
import { SUPABASE_URL, setCorsHeaders, verifyAdminToken } from '../_lib/auth.js';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res, 'POST, PUT, DELETE, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not configured on server' });
  }

  const auth = await verifyAdminToken(req.headers?.authorization);
  if (!auth.ok) {
    return res.status(403).json({ error: auth.error || 'Forbidden' });
  }

  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=representation',
  };

  try {
    if (req.method === 'POST' || req.method === 'PUT') {
      const body = req.body || {};
      const record = {
        id: String(body.id || ''),
        user_id: String(body.user_id || auth.email),
        author_name: String(body.author_name || '관리자'),
        is_public: body.is_public !== false,
        name: String(body.name || '').trim(),
        lat: Number(body.lat),
        lng: Number(body.lng),
        navi_name: body.navi_name ? String(body.navi_name).trim() : null,
        navi_url: body.navi_url ? String(body.navi_url).trim() : null,
        kakao_place_id: body.kakao_place_id ? String(body.kakao_place_id).trim() : null,
        has_restroom: Boolean(body.has_restroom),
        has_store: Boolean(body.has_store),
        is_deleted: false,
        updated_at: new Date().toISOString(),
        ...(req.method === 'POST' && body.created_at ? { created_at: String(body.created_at) } : {}),
      };

      if (!record.id || record.name.length < 2 || !Number.isFinite(record.lat) || !Number.isFinite(record.lng)) {
        return res.status(400).json({ error: 'Invalid fishing_shop payload' });
      }

      const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/fishing_shops`, {
        method: 'POST',
        headers,
        body: JSON.stringify(record),
        signal: AbortSignal.timeout(5000),
      });

      const text = await sbRes.text();
      if (!sbRes.ok) {
        return res.status(sbRes.status).send(text);
      }
      return res.status(200).send(text);
    }

    if (req.method === 'DELETE') {
      const shopId = String(req.query?.id || req.body?.id || '').trim();
      if (!shopId) {
        return res.status(400).json({ error: 'Missing shop id' });
      }
      const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/fishing_shops?id=eq.${encodeURIComponent(shopId)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ is_deleted: true, updated_at: new Date().toISOString() }),
        signal: AbortSignal.timeout(5000),
      });
      const text = await sbRes.text();
      return res.status(sbRes.status).send(text || JSON.stringify({ ok: true }));
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Admin shop write failed' });
  }
}
