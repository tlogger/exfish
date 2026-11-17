// Vercel Serverless CDN 캐싱 프록시 (/api/swtc-proxy?obsPostId=...&stDate=...)
// GET 요청을 KHOA 모바일 조석예보 POST 엔드포인트로 중계하여 Vercel Edge CDN(s-maxage=6시간)에서 공유 캐싱합니다.

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

  const obsPostId = String(req.query?.obsPostId || '').trim();
  const stDate = String(req.query?.stDate || '').trim();

  if (!obsPostId || !stDate) {
    return res.status(400).json({ error: 'obsPostId and stDate are required' });
  }

  try {
    const body = new URLSearchParams({ stDate, obsPostId });
    const upstream = await fetch('https://www.khoa.go.kr/swtc/getWeeklyData.do', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(9000),
    });

    const bodyText = await upstream.text();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (upstream.ok) {
      res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
    } else {
      res.setHeader('Cache-Control', 'no-store');
    }

    return res.status(upstream.status).send(bodyText);
  } catch (err: any) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: err?.message || 'KHOA SWTC upstream failed' });
  }
}
