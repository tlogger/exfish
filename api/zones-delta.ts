import { SUPABASE_URL, setCorsHeaders } from './_lib/auth.js';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!serviceRoleKey) {
    return res.status(500).json({ error: 'Supabase key not configured' });
  }

  const sinceParam = typeof req.query?.since === 'string' ? req.query.since.trim() : '';
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  };

  try {
    const activeFilter = sinceParam
      ? `status=eq.active&created_at=gt.${encodeURIComponent(sinceParam)}`
      : `status=eq.active`;

    const [zonesRes, suppressedRes] = await Promise.all([
      fetch(
        `${SUPABASE_URL}/rest/v1/user_prohibited_zones?select=id,zone_name,restriction_scope,source_note,geometry_geojson,bbox,area_sqm,created_at&${activeFilter}&order=created_at.desc&limit=2000`,
        { headers, signal: AbortSignal.timeout(5000) }
      ),
      fetch(
        `${SUPABASE_URL}/rest/v1/suppressed_zones?select=zone_id&restored_at=is.null&limit=5000`,
        { headers, signal: AbortSignal.timeout(5000) }
      ),
    ]);

    if (!zonesRes.ok || !suppressedRes.ok) {
      return res.status(502).json({ error: 'Failed to load zone deltas from Supabase' });
    }

    const rawZones = (await zonesRes.json()) as any[];
    const rawSuppressed = (await suppressedRes.json()) as Array<{ zone_id: string }>;

    const activeZones = rawZones.map((row) => ({
      type: 'Feature',
      geometry: row.geometry_geojson,
      properties: {
        zone_id: `usr_${row.id}`,
        raw_id: row.id,
        tier: 'community_reported',
        zone_name: row.zone_name,
        restriction_scope: row.restriction_scope || 'all_year',
        reason: row.source_note || '사용자 제보 낚시금지구역 (공식 고시 미확인)',
        source_agency: '사용자 제보',
        verified_at: String(row.created_at || '').slice(0, 10),
      },
    }));

    const suppressedZoneIds = rawSuppressed.map((r) => r.zone_id);
    const generatedAt = new Date().toISOString();

    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=15');
    return res.status(200).json({ activeZones, suppressedZoneIds, generatedAt });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Delta fetch error' });
  }
}
