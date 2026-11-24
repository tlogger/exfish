// Vercel Serverless 통합 타일 프록시 (/api/haeroad-tile, /api/vworld-tile -> rewrite)
// 1) 해로드 지센 전자해도(ENC) XYZ 래스터 타일 (z: 8~16)
// 2) VWorld(국토정보플랫폼) EPSG:3857 타일 (z: 6~19, VWORLD_API_KEY 우선 사용 -> xdworld 폴백)
// 한반도 해역/육지 bbox 화이트리스트 및 30일 Edge CDN 캐싱을 적용합니다.

const TRANSPARENT_1X1_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

const ALLOWED_VWORLD_LAYERS = new Set(['Base', 'Satellite', 'Hybrid', 'midnight']);

const KOREA_BBOX = {
  minLat: 31.5,
  maxLat: 39.8,
  minLng: 123.0,
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

export function isAllowedKoreaTile(z: number, x: number, y: number, minZ = 8, maxZ = 16): boolean {
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (z < minZ || z > maxZ) return false;
  const minX = lngToTileX(KOREA_BBOX.minLng, z);
  const maxX = lngToTileX(KOREA_BBOX.maxLng, z);
  const minY = latToTileY(KOREA_BBOX.maxLat, z);
  const maxY = latToTileY(KOREA_BBOX.minLat, z);
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
}

async function fetchTileCandidate(url: string, headers?: Record<string, string>) {
  const upstream = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(8000),
  });
  if (!upstream.ok) {
    throw new Error(`HTTP_${upstream.status}`);
  }
  const ct = upstream.headers.get('content-type') || '';
  if (ct && !ct.startsWith('image/')) {
    throw new Error(`NON_IMAGE_${ct.slice(0, 32)}`);
  }
  const buf = Buffer.from(await upstream.arrayBuffer());
  if (buf.length === 0) {
    throw new Error('EMPTY_BODY');
  }
  return { buf, contentType: ct || 'image/png' };
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

  const isVWorld = req.query?.__provider === 'vworld' || Boolean(req.query?.layer);
  const z = Number(req.query?.z);
  const x = Number(req.query?.x);
  const y = Number(req.query?.y);

  const candidates: Array<{ url: string; headers?: Record<string, string> }> = [];
  let defaultContentType = 'image/png';

  if (isVWorld) {
    const layer = String(req.query?.layer || 'Base');
    if (!ALLOWED_VWORLD_LAYERS.has(layer) || !isAllowedKoreaTile(z, x, y, 6, 19)) {
      return res.status(400).json({ error: 'Invalid VWorld tile parameters or out of bounds (z: 6-19)' });
    }
    const ext = layer === 'Satellite' ? 'jpeg' : 'png';
    defaultContentType = `image/${ext}`;
    const vworldKey = (process.env.VWORLD_API_KEY || '').trim();
    if (vworldKey) {
      candidates.push({
        url: `https://api.vworld.kr/req/wmts/1.0.0/${encodeURIComponent(vworldKey)}/${layer}/${z}/${y}/${x}.${ext}`,
        headers: { Referer: 'https://exfish.vercel.app/' },
      });
    }
    candidates.push({
      url: `https://xdworld.vworld.kr/2d/${layer}/service/${z}/${x}/${y}.${ext}`,
    });
  } else {
    if (!isAllowedKoreaTile(z, x, y, 8, 16)) {
      return res.status(400).json({ error: 'Tile coordinates out of allowed Korea coastal bounds (z: 8-16)' });
    }
    candidates.push({
      url: `https://haeroadgis.nmpnt.go.kr:39923/gcen/mapset/tile/${z}/${x}/${y}?mapset=vt_maplabel_enc`,
    });
  }

  let lastErr = 'unknown';
  for (const cand of candidates) {
    try {
      const { buf, contentType } = await fetchTileCandidate(cand.url, cand.headers);
      res.setHeader('Content-Type', contentType || defaultContentType);
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=2592000');
      res.setHeader('CDN-Cache-Control', 'public, s-maxage=2592000, stale-while-revalidate=2592000');
      res.setHeader('Vercel-CDN-Cache-Control', 'public, s-maxage=2592000, stale-while-revalidate=2592000');
      res.setHeader('X-Tile-Status', 'ok');
      return res.status(200).send(buf);
    } catch (err: any) {
      lastErr = String(err?.cause?.code || err?.message || 'err').slice(0, 80);
    }
  }

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Tile-Status', 'error_fallback');
  res.setHeader('X-Tile-Error', lastErr);

  if (isVWorld) {
    // Return 502 so Leaflet fires tileerror and seamlessly falls back to direct browser tile load
    return res.status(502).json({ error: 'VWorld upstream unreachable', detail: lastErr });
  }

  res.setHeader('Content-Type', 'image/png');
  return res.status(200).send(TRANSPARENT_1X1_PNG);
}
