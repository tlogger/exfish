// Vercel Serverless CDN 캐싱 프록시 (/api-openmeteo/:path* -> /api/openmeteo-proxy?__path=:path*)
// 웹(Vercel) 및 네이티브 APK(https://localhost) 모두 동일한 Edge CDN 캐시를 공유하여
// Open-Meteo 단일 오리진 버스트/타임아웃 및 IP 레이트 리밋을 방지합니다.

const UPSTREAM_MAP: Record<string, string> = {
  forecast: 'https://api.open-meteo.com/v1/forecast',
  marine: 'https://marine-api.open-meteo.com/v1/marine',
};

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawPath = req.query?.__path;
  const apiPath = (Array.isArray(rawPath) ? rawPath.join('/') : String(rawPath || '')).replace(/^\/+/, '');
  const upstreamBase = UPSTREAM_MAP[apiPath];

  if (!upstreamBase) {
    return res.status(403).json({ error: 'Forbidden Open-Meteo API path' });
  }

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query || {})) {
    if (k === '__path' || v === undefined) continue;
    params.set(k, Array.isArray(v) ? String(v[0]) : String(v));
  }

  const targetUrl = `${upstreamBase}?${params.toString()}`;

  try {
    const upstream = await fetch(targetUrl, {
      signal: AbortSignal.timeout(7000),
    });

    const bodyText = await upstream.text();
    const contentType = upstream.headers.get('content-type') || 'application/json; charset=utf-8';
    res.setHeader('Content-Type', contentType);

    if (upstream.ok) {
      // 확정된 과거 날짜(end_date < 오늘)는 불변 데이터이므로 24시간 Edge CDN 캐싱
      const endDateStr = params.get('end_date');
      const todayStr = new Date().toISOString().slice(0, 10);
      if (endDateStr && /^\d{4}-\d{2}-\d{2}$/.test(endDateStr) && endDateStr < todayStr) {
        res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
      } else {
        // 30분 Edge CDN 캐시 + 1시간 Stale-While-Revalidate
        res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=3600');
      }
    } else {
      res.setHeader('Cache-Control', 'no-store');
    }

    return res.status(upstream.status).send(bodyText);
  } catch (err: any) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(504).json({
      error: 'Open-Meteo upstream timeout or fetch error',
      message: err?.message || 'Unknown error',
    });
  }
}
