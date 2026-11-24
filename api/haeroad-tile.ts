// Vercel Serverless PNG 타일 프록시 (/api/haeroad-tile?z=14&x=13949&y=6440)
// 해로드 지센 전자해도(ENC) XYZ 래스터 타일의 CORS 부재를 해결하고,
// 한반도 연안 해역 bbox 및 줌(8~16) 범위만 허용해 오픈 프록시 악용을 방지합니다.

const TRANSPARENT_1X1_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

const KOREA_BBOX = {
  minLat: 32.0,
  maxLat: 39.5,
  minLng: 123.5,
  maxLng: 132.5,
};

function lngToTileX(lng: number, z: number): number {
  return Math.floor(((lng + 180) / 360) * Math.pow(2, z));
}

function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z)
  );
}

export function isAllowedKoreaTile(z: number, x: number, y: number): boolean {
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (z < 8 || z > 16) return false;
  const minX = lngToTileX(KOREA_BBOX.minLng, z);
  const maxX = lngToTileX(KOREA_BBOX.maxLng, z);
  const minY = latToTileY(KOREA_BBOX.maxLat, z);
  const maxY = latToTileY(KOREA_BBOX.minLat, z);
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
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

  const z = Number(req.query?.z);
  const x = Number(req.query?.x);
  const y = Number(req.query?.y);

  if (!isAllowedKoreaTile(z, x, y)) {
    return res.status(400).json({ error: 'Tile coordinates out of allowed Korea coastal bounds (z: 8-16)' });
  }

  const upstreamUrl = `https://haeroadgis.nmpnt.go.kr:39923/gcen/mapset/tile/${z}/${x}/${y}?mapset=vt_maplabel_enc`;

  try {
    const upstream = await fetch(upstreamUrl, {
      signal: AbortSignal.timeout(4000),
    });

    if (!upstream.ok) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, s-maxage=3600');
      res.setHeader('X-Tile-Status', `upstream_${upstream.status}`);
      return res.status(200).send(TRANSPARENT_1X1_PNG);
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length === 0) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
      res.setHeader('X-Tile-Status', 'empty_fallback');
      return res.status(200).send(TRANSPARENT_1X1_PNG);
    }

    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=2592000');
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=2592000, stale-while-revalidate=2592000');
    res.setHeader('Vercel-CDN-Cache-Control', 'public, s-maxage=2592000, stale-while-revalidate=2592000');
    res.setHeader('X-Tile-Status', 'ok');
    return res.status(200).send(buf);
  } catch (err: any) {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Tile-Status', 'error_fallback');
    return res.status(200).send(TRANSPARENT_1X1_PNG);
  }
}
