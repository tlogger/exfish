import { SUPABASE_URL, setCorsHeaders, verifyAdminToken } from '../_lib/auth.js';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res, 'DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not configured' });
  }

  const auth = await verifyAdminToken(req.headers?.authorization);
  if (!auth.ok || !auth.email) {
    return res.status(403).json({ error: auth.error || 'Forbidden' });
  }

  const body = req.body || {};
  const targetType = body.targetType === 'user' || body.targetType === 'public' ? body.targetType : null;
  const rawZoneId = String(body.zoneId || '').trim();
  const reason = body.reason ? String(body.reason).trim().slice(0, 200) : '관리자 사후 삭제';

  if (!targetType || !rawZoneId) {
    return res.status(400).json({ error: 'Invalid targetType or zoneId' });
  }

  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=representation',
  };

  try {
    const committedAt = new Date().toISOString();
    if (targetType === 'user') {
      const uuid = rawZoneId.replace(/^usr_/, '');
      const sbRes = await fetch(
        `${SUPABASE_URL}/rest/v1/user_prohibited_zones?id=eq.${encodeURIComponent(uuid)}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            status: 'deleted',
            deleted_at: committedAt,
            deleted_by: auth.email,
          }),
          signal: AbortSignal.timeout(5000),
        }
      );
      if (!sbRes.ok) {
        return res.status(sbRes.status).send(await sbRes.text());
      }
      return res.status(200).json({ ok: true, committedAt });
    }

    const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/suppressed_zones`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        zone_id: rawZoneId,
        reason,
        deleted_by: auth.email,
        restored_at: null,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!sbRes.ok) {
      return res.status(sbRes.status).send(await sbRes.text());
    }
    return res.status(200).json({ ok: true, committedAt });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Admin zone delete failed' });
  }
}
