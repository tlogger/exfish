// Vercel Serverless 비공개 데이터 전용 인증 프록시 (/api/my-private-data)
// HMAC-SHA256 세션 검증 후 본인 소유 비공개 fishing_spots, catch_logs, 비공개 포인트 소속 spot_memos만 반환합니다.
import { SUPABASE_URL, setCorsHeaders, verifySessionFromRequest } from './_lib/auth.js';

const WRITABLE_TABLES = new Set(['fishing_spots', 'catch_logs', 'spot_memos']);

function getServiceHeaders(): Record<string, string> | null {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!serviceKey) return null;
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

export default async function handler(req: any, res: any) {
  setCorsHeaders(res, 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const auth = verifySessionFromRequest(req);
  if (!auth.ok || !auth.claims?.userId) {
    return res.status(401).json({ error: auth.error || 'Unauthorized' });
  }

  const headers = getServiceHeaders();
  if (!headers) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not configured' });
  }

  const userId = auth.claims.userId;

  if (req.method === 'GET') {
    try {
      const spotsUrl = `${SUPABASE_URL}/rest/v1/fishing_spots?select=*&user_id=eq.${encodeURIComponent(userId)}&is_public=eq.false&is_deleted=neq.true&order=created_at.desc&limit=500`;
      const logsUrl = `${SUPABASE_URL}/rest/v1/catch_logs?select=*&user_id=eq.${encodeURIComponent(userId)}&is_public=eq.false&is_deleted=neq.true&order=created_at.desc&limit=500`;

      const [spotsRes, logsRes] = await Promise.all([
        fetch(spotsUrl, { headers, signal: AbortSignal.timeout(8000) }),
        fetch(logsUrl, { headers, signal: AbortSignal.timeout(8000) }),
      ]);

      const spots = spotsRes.ok ? await spotsRes.json() : [];
      const catchLogs = logsRes.ok ? await logsRes.json() : [];

      let spotMemos: any[] = [];
      if (Array.isArray(spots) && spots.length > 0) {
        const spotIds = spots.map((s: any) => s.id).filter(Boolean);
        if (spotIds.length > 0) {
          const inList = spotIds.map((id: string) => `"${id.replace(/"/g, '')}"`).join(',');
          const memosUrl = `${SUPABASE_URL}/rest/v1/spot_memos?select=*&spot_id=in.(${encodeURIComponent(inList)})&is_deleted=neq.true&order=created_at.desc&limit=300`;
          const memosRes = await fetch(memosUrl, { headers, signal: AbortSignal.timeout(8000) });
          if (memosRes.ok) {
            spotMemos = await memosRes.json();
          }
        }
      }

      return res.status(200).json({
        spots: Array.isArray(spots) ? spots : [],
        catch_logs: Array.isArray(catchLogs) ? catchLogs : [],
        spot_memos: Array.isArray(spotMemos) ? spotMemos : [],
      });
    } catch (err: any) {
      return res.status(502).json({ error: err?.message || 'Private data fetch failed' });
    }
  }

  if (req.method === 'POST') {
    const table = String(req.body?.table || '').trim();
    const record = req.body?.record;
    if (!WRITABLE_TABLES.has(table) || !record || typeof record !== 'object') {
      return res.status(400).json({ error: 'Invalid table or record' });
    }
    // 서버 측에서 소유자 user_id 강제 고정
    const safeRecord = { ...record, user_id: userId, updated_at: new Date().toISOString() };
    try {
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(safeRecord),
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) {
        const detail = await resp.text().catch(() => '');
        return res.status(resp.status).json({ error: 'Upsert failed', detail });
      }
      const saved = await resp.json();
      return res.status(200).json({ ok: true, data: saved });
    } catch (err: any) {
      return res.status(502).json({ error: err?.message || 'Private write failed' });
    }
  }

  if (req.method === 'DELETE') {
    const table = String(req.query?.table || req.body?.table || '').trim();
    const id = String(req.query?.id || req.body?.id || '').trim();
    if (!WRITABLE_TABLES.has(table) || !id) {
      return res.status(400).json({ error: 'Invalid table or id' });
    }
    try {
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ is_deleted: true, updated_at: new Date().toISOString() }),
          signal: AbortSignal.timeout(8000),
        }
      );
      if (!resp.ok) {
        const detail = await resp.text().catch(() => '');
        return res.status(resp.status).json({ error: 'Soft delete failed', detail });
      }
      return res.status(200).json({ ok: true });
    } catch (err: any) {
      return res.status(502).json({ error: err?.message || 'Private delete failed' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
