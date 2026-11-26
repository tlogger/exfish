import { SUPABASE_URL, setCorsHeaders, verifyUserSessionToken } from './_lib/auth.js';

const LAT_MIN = 32.0;
const LAT_MAX = 39.0;
const LNG_MIN = 124.0;
const LNG_MAX = 132.0;
const MIN_AREA_SQM = 100;
const MAX_AREA_SQM = 5_000_000;
const FLAG_QUARANTINE_THRESHOLD = 3;

function sanitizePlainText(input: unknown, maxLen: number): string {
  return String(input || '')
    .replace(/<[^>]*>/g, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function approxRingAreaSqm(ring: number[][]): number {
  if (ring.length < 4) return 0;
  const meanLatRad = ((ring.reduce((s, p) => s + p[1], 0) / ring.length) * Math.PI) / 180;
  const mPerDegLat = 111_132.92;
  const mPerDegLng = 111_412.84 * Math.cos(meanLatRad);
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const x1 = ring[i][0] * mPerDegLng;
    const y1 = ring[i][1] * mPerDegLat;
    const x2 = ring[i + 1][0] * mPerDegLng;
    const y2 = ring[i + 1][1] * mPerDegLat;
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

function segmentsIntersect(a1: number[], a2: number[], b1: number[], b2: number[]): boolean {
  const ccw = (p1: number[], p2: number[], p3: number[]) =>
    (p3[1] - p1[1]) * (p2[0] - p1[0]) > (p2[1] - p1[1]) * (p3[0] - p1[0]);
  return ccw(a1, b1, b2) !== ccw(a2, b1, b2) && ccw(a1, a2, b1) !== ccw(a1, a2, b2);
}

function hasSelfIntersection(ring: number[][]): boolean {
  const n = ring.length - 1;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsIntersect(ring[i], ring[i + 1], ring[j], ring[j + 1])) {
        return true;
      }
    }
  }
  return false;
}

export default async function handler(req: any, res: any) {
  setCorsHeaders(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not configured' });
  }

  const auth = verifyUserSessionToken(req.headers?.authorization);
  if (!auth.ok || !auth.claims) {
    return res.status(401).json({ error: auth.error || 'Unauthorized' });
  }

  const sbHeaders = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };

  try {
    // Action: community flag report
    if (req.query?.action === 'flag') {
      const zoneId = String(req.body?.zoneId || '').replace(/^usr_/, '').trim();
      const reason = sanitizePlainText(req.body?.reason, 120) || '오탐/허위 신고';
      if (!zoneId) return res.status(400).json({ error: 'Missing zoneId' });

      const flagRes = await fetch(`${SUPABASE_URL}/rest/v1/zone_flags`, {
        method: 'POST',
        headers: sbHeaders,
        body: JSON.stringify({
          zone_id: zoneId,
          reporter_user_id: auth.claims.userId,
          reason,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (flagRes.status === 409) {
        return res.status(409).json({ error: '이미 신고한 구역입니다.' });
      }
      if (!flagRes.ok) {
        return res.status(flagRes.status).send(await flagRes.text());
      }

      const countRes = await fetch(
        `${SUPABASE_URL}/rest/v1/zone_flags?zone_id=eq.${encodeURIComponent(zoneId)}&select=reporter_user_id`,
        { headers: sbHeaders, signal: AbortSignal.timeout(5000) }
      );
      const flags = (countRes.ok ? await countRes.json() : []) as Array<{ reporter_user_id: string }>;
      const flagged = flags.length >= FLAG_QUARANTINE_THRESHOLD;
      if (flagged) {
        await fetch(`${SUPABASE_URL}/rest/v1/user_prohibited_zones?id=eq.${encodeURIComponent(zoneId)}`, {
          method: 'PATCH',
          headers: sbHeaders,
          body: JSON.stringify({ status: 'flagged' }),
          signal: AbortSignal.timeout(5000),
        });
      }
      return res.status(200).json({ ok: true, flagged });
    }

    // Action: create new user-drawn zone
    const body = req.body || {};
    const zoneName = sanitizePlainText(body.zone_name, 60);
    const restrictionScope = ['all_year', 'seasonal', 'night_only'].includes(body.restriction_scope)
      ? body.restriction_scope
      : 'all_year';
    const sourceNote = sanitizePlainText(body.source_note, 200);
    const geom = body.geometry_geojson;

    if (zoneName.length < 2) {
      return res.status(400).json({ error: '구역명은 2자 이상이어야 합니다.' });
    }
    if (!geom || geom.type !== 'Polygon' || !Array.isArray(geom.coordinates) || !Array.isArray(geom.coordinates[0])) {
      return res.status(422).json({ error: '유효한 GeoJSON Polygon이 아닙니다.' });
    }

    const rawRing = geom.coordinates[0] as number[][];
    const ring = rawRing.map((pt) => [Math.round(Number(pt[0]) * 1e5) / 1e5, Math.round(Number(pt[1]) * 1e5) / 1e5]);
    if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
      ring.push([...ring[0]]);
    }
    const uniqueCount = ring.length - 1;
    if (uniqueCount < 3 || uniqueCount > 60) {
      return res.status(422).json({ error: '꼭짓점은 3~60개여야 합니다.' });
    }
    for (const [lng, lat] of ring) {
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || lat < LAT_MIN || lat > LAT_MAX || lng < LNG_MIN || lng > LNG_MAX) {
        return res.status(422).json({ error: '한반도 연안 좌표 범위를 벗어났습니다.' });
      }
    }
    if (hasSelfIntersection(ring)) {
      return res.status(422).json({ error: '경계선이 서로 교차하는 다각형은 등록할 수 없습니다.' });
    }
    const areaSqm = approxRingAreaSqm(ring);
    if (areaSqm < MIN_AREA_SQM || areaSqm > MAX_AREA_SQM) {
      return res.status(422).json({ error: '구역 면적은 100㎡ 이상 5㎢ 이하여야 합니다.' });
    }

    // Check per-user total active (<=20) and daily (<=2) quota
    const quotaRes = await fetch(
      `${SUPABASE_URL}/rest/v1/user_prohibited_zones?user_id=eq.${encodeURIComponent(auth.claims.userId)}&status=eq.active&select=id,created_at`,
      { headers: sbHeaders, signal: AbortSignal.timeout(5000) }
    );
    const existing = (quotaRes.ok ? await quotaRes.json() : []) as Array<{ id: string; created_at: string }>;
    if (existing.length >= 20) {
      return res.status(429).json({ error: '계정당 최대 20개의 활성 금지구역만 등록할 수 있습니다.' });
    }
    const dayAgo = Date.now() - 86_400_000;
    const recentCount = existing.filter((r) => new Date(r.created_at).getTime() >= dayAgo).length;
    if (recentCount >= 2) {
      return res.status(429).json({ error: '하루 최대 2건까지만 등록할 수 있습니다.' });
    }

    const lngs = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    const bbox = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];

    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/user_prohibited_zones`, {
      method: 'POST',
      headers: sbHeaders,
      body: JSON.stringify({
        user_id: auth.claims.userId,
        status: 'active',
        zone_name: zoneName,
        restriction_scope: restrictionScope,
        source_note: sourceNote || null,
        geometry_geojson: { type: 'Polygon', coordinates: [ring] },
        bbox,
        area_sqm: Math.round(areaSqm),
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!insertRes.ok) {
      return res.status(insertRes.status).send(await insertRes.text());
    }
    const inserted = (await insertRes.json()) as any[];
    const row = inserted[0];
    const committedAt = new Date().toISOString();

    return res.status(201).json({
      zone: {
        type: 'Feature',
        geometry: row.geometry_geojson,
        properties: {
          zone_id: `usr_${row.id}`,
          raw_id: row.id,
          tier: 'community_reported',
          zone_name: row.zone_name,
          restriction_scope: row.restriction_scope,
          reason: row.source_note || '사용자 제보 낚시금지구역 (공식 고시 미확인)',
          source_agency: '사용자 제보',
          verified_at: String(row.created_at || committedAt).slice(0, 10),
        },
      },
      committedAt,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Zone write failed' });
  }
}
