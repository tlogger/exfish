import type { ProhibitedZoneFeature, ZoneGeometry, ZoneHitResult } from '../types/prohibitedZone';

export const ZONE_CELL_SIZE_DEG = 0.25;
export const DEFAULT_CAUTION_RADIUS_M = 150;
export const KOREA_LAT_MIN = 32.0;
export const KOREA_LAT_MAX = 39.0;
export const KOREA_LNG_MIN = 124.0;
export const KOREA_LNG_MAX = 132.0;
export const MIN_ZONE_AREA_SQM = 100;
export const MAX_ZONE_AREA_SQM = 5_000_000;

export function getCellId(lat: number, lng: number, cellSizeDeg = ZONE_CELL_SIZE_DEG): string {
  const latIdx = Math.floor(lat / cellSizeDeg);
  const lngIdx = Math.floor(lng / cellSizeDeg);
  return `cell_${latIdx}_${lngIdx}`;
}

export function getCellsForBounds(
  swLat: number,
  swLng: number,
  neLat: number,
  neLng: number,
  cellSizeDeg = ZONE_CELL_SIZE_DEG
): string[] {
  if (neLat < swLat || neLng < swLng) return [];
  const latStart = Math.floor(swLat / cellSizeDeg);
  const latEnd = Math.floor(neLat / cellSizeDeg);
  const lngStart = Math.floor(swLng / cellSizeDeg);
  const lngEnd = Math.floor(neLng / cellSizeDeg);
  const cells: string[] = [];
  for (let la = latStart; la <= latEnd; la++) {
    for (let ln = lngStart; ln <= lngEnd; ln++) {
      cells.push(`cell_${la}_${ln}`);
    }
  }
  return cells;
}

export function haversineDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pointInRing(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygonRings(lat: number, lng: number, rings: number[][][]): boolean {
  if (!rings.length || !pointInRing(lat, lng, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(lat, lng, rings[i])) return false;
  }
  return true;
}

export function computeGeometryBbox(geometry: ZoneGeometry): [number, number, number, number] {
  if (geometry.type === 'Point') {
    const [lng, lat] = geometry.coordinates;
    return [lng, lat, lng, lat];
  }
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const poly of polys) {
    for (const ring of poly) {
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  return [minLng, minLat, maxLng, maxLat];
}

export function isPointInZone(lat: number, lng: number, feature: ProhibitedZoneFeature): ZoneHitResult | null {
  const geom = feature.geometry;
  if (geom.type === 'Point') {
    const radius = feature.properties.radius_m ?? DEFAULT_CAUTION_RADIUS_M;
    const dist = haversineDistanceMeters(lat, lng, geom.coordinates[1], geom.coordinates[0]);
    return dist <= radius ? { feature, tier: feature.properties.tier, distanceM: Math.round(dist) } : null;
  }

  const [minLng, minLat, maxLng, maxLat] = computeGeometryBbox(geom);
  if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) return null;

  if (geom.type === 'Polygon') {
    return pointInPolygonRings(lat, lng, geom.coordinates)
      ? { feature, tier: feature.properties.tier }
      : null;
  }

  for (const poly of geom.coordinates) {
    if (pointInPolygonRings(lat, lng, poly)) {
      return { feature, tier: feature.properties.tier };
    }
  }
  return null;
}

export function findZoneHitsAtPoint(
  lat: number,
  lng: number,
  features: ProhibitedZoneFeature[]
): ZoneHitResult[] {
  const hits: ZoneHitResult[] = [];
  for (const feat of features) {
    const hit = isPointInZone(lat, lng, feat);
    if (hit) hits.push(hit);
  }
  const rank = { confirmed_polygon: 0, community_reported: 1, caution_point: 2 } as const;
  return hits.sort((a, b) => rank[a.tier] - rank[b.tier]);
}

export function approxRingAreaSqm(ring: number[][]): number {
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

export function hasSelfIntersection(ring: number[][]): boolean {
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

export function validateDrawnPoints(
  points: Array<{ lat: number; lng: number }>
): { ok: boolean; error?: string; closedRing?: number[][]; areaSqm?: number } {
  if (points.length < 3 || points.length > 60) {
    return { ok: false, error: '꼭짓점은 3개 이상 60개 이하로 입력해야 합니다.' };
  }
  for (const p of points) {
    if (p.lat < KOREA_LAT_MIN || p.lat > KOREA_LAT_MAX || p.lng < KOREA_LNG_MIN || p.lng > KOREA_LNG_MAX) {
      return { ok: false, error: '한반도 연안 범위(위도 32~39, 경도 124~132)를 벗어난 좌표입니다.' };
    }
  }
  const ring = points.map((p) => [Math.round(p.lng * 1e5) / 1e5, Math.round(p.lat * 1e5) / 1e5]);
  ring.push([...ring[0]]);

  if (hasSelfIntersection(ring)) {
    return { ok: false, error: '경계선이 서로 교차하지 않도록 꼭짓점을 순서대로 찍어주세요.' };
  }
  const areaSqm = approxRingAreaSqm(ring);
  if (areaSqm < MIN_ZONE_AREA_SQM) {
    return { ok: false, error: '면적이 너무 작거나 일직선입니다 (최소 100㎡ 이상).' };
  }
  if (areaSqm > MAX_ZONE_AREA_SQM) {
    return { ok: false, error: '1회 등록 면적은 5㎢ 이하만 가능합니다.' };
  }
  return { ok: true, closedRing: ring, areaSqm: Math.round(areaSqm) };
}

export interface KakaoLatLng {
  lat: number;
  lng: number;
}

/**
 * react-kakao-maps-sdk <Polygon path={...} /> 용 좌표 변환.
 * 홀(Hole)이 없는 단순 폴리곤은 KakaoLatLng[], 홀이 있으면 KakaoLatLng[][] 반환.
 */
export function toKakaoPolygonPaths(geometry: ZoneGeometry): Array<KakaoLatLng[] | KakaoLatLng[][]> {
  if (geometry.type === 'Point') return [];
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polys.map((rings) => {
    const mapped = rings.map((ring) => ring.map(([lng, lat]) => ({ lat, lng })));
    return mapped.length === 1 ? mapped[0] : mapped;
  });
}
