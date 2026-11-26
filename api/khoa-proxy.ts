// Vercel Serverless CDN 캐싱 프록시 (/api-khoa/:path* -> /api/khoa-proxy?__path=:path*)
// 웹(Vercel) 및 네이티브 APK(https://localhost) 모두 동일한 CDN 캐시를 공유하여 KHOA 일일 트래픽을 99% 절감합니다.

function getCacheTtlSeconds(apiPath: string): number {
  if (apiPath.includes('waterDepth')) return 86400; // 24시간
  if (apiPath.includes('surveyTideLevel')) return 21600; // 6시간
  if (apiPath.includes('roms')) return 10800; // 3시간
  if (apiPath.includes('surveyWaterTemp')) return 1800; // 30분
  if (apiPath.includes('surveyWind')) return 900; // 15분
  return 900;
}

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
  const apiPath = Array.isArray(rawPath) ? rawPath.join('/') : String(rawPath || '').replace(/^\/+/, '');

  // Open Relay 차단: KHOA 해양조사원(1192136) 경로만 허용
  if (!apiPath.startsWith('1192136/')) {
    return res.status(403).json({ error: 'Forbidden KHOA API path' });
  }

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query || {})) {
    if (k === '__path' || v === undefined) continue;
    params.set(k, Array.isArray(v) ? String(v[0]) : String(v));
  }

  // 서버 전용 환경변수가 설정된 경우 우선 주입
  if (process.env.KHOA_SERVICE_KEY) {
    params.set('serviceKey', process.env.KHOA_SERVICE_KEY);
  }

  const targetUrl = `https://apis.data.go.kr/${apiPath}?${params.toString()}`;

  try {
    const upstream = await fetch(targetUrl, {
      signal: AbortSignal.timeout(8500),
    });

    const bodyText = await upstream.text();
    const contentType = upstream.headers.get('content-type') || 'application/json; charset=utf-8';
    res.setHeader('Content-Type', contentType);

    if (upstream.ok) {
      const ttl = getCacheTtlSeconds(apiPath);
      res.setHeader('Cache-Control', `public, s-maxage=${ttl}, stale-while-revalidate=120`);
    } else {
      res.setHeader('Cache-Control', 'no-store');
    }

    return res.status(upstream.status).send(bodyText);
  } catch (err: any) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(504).json({
      error: 'KHOA upstream timeout or fetch error',
      message: err?.message || 'Unknown error',
    });
  }
}
