// Vercel Serverless CDN 캐싱 프록시 (/api/exfish-master?table=fishing_spots|fishing_shops)
// 인앱 브라우저(Barcelona 등) 및 신규 방문자의 초기 전체 조회 트래픽을 Vercel Edge CDN(s-maxage=300)으로 흡수하여 Supabase Egress를 절감합니다.

const DEFAULT_SUPABASE_URL = 'https://johtqemdlprtbpohdkgu.supabase.co';
const DEFAULT_SUPABASE_KEY = 'sb_publishable_Aj8gNxqXefjkBg6H6zsCxw_icac_-2G';

const ALLOWED_TABLES = new Set(['fishing_spots', 'fishing_shops']);

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

  const table = String(req.query?.table || '').trim();
  if (!ALLOWED_TABLES.has(table)) {
    return res.status(400).json({ error: 'Invalid table parameter' });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_KEY;

  const targetUrl = `${supabaseUrl}/rest/v1/${table}?select=*&order=created_at.desc`;

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

    const data = await upstream.json();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    return res.status(200).json(data);
  } catch (err: any) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: err?.message || 'Upstream fetch failed' });
  }
}
