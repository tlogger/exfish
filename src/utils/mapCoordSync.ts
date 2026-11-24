/**
 * Kakao Map (EPSG:5181, level 1~14) <-> VWorld / Leaflet (EPSG:3857, zoom 6~19)
 * 지도 엔진 전환 시 WGS84 중심 좌표 및 축척(줌 레벨) 동기화 유틸리티
 */

export function kakaoLevelToLeafletZoom(level: number): number {
  if (!Number.isFinite(level)) return 14;
  return Math.max(6, Math.min(19, Math.round(20 - level)));
}

export function leafletZoomToKakaoLevel(zoom: number): number {
  if (!Number.isFinite(zoom)) return 6;
  return Math.max(1, Math.min(14, Math.round(20 - zoom)));
}

export function normalizeWgs84Center(center: { lat: number; lng: number }): { lat: number; lng: number } {
  const lat = Number.isFinite(center.lat) ? Math.max(-85, Math.min(85, center.lat)) : 36.3;
  const lng = Number.isFinite(center.lng) ? Math.max(-180, Math.min(180, center.lng)) : 127.8;
  return {
    lat: Math.round(lat * 1e7) / 1e7,
    lng: Math.round(lng * 1e7) / 1e7,
  };
}

/**
 * 현재 중심 좌표와 카카오 줌 레벨(1~14) 기준 근사 뷰포트 바운딩 박스(WGS84) 산출
 * - KakaoMap / VWorld 공용 금지구역(prohibitedZones) 조회에 사용
 */
export function computeApproxViewportBounds(
  center: { lat: number; lng: number },
  level: number
): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const zoom = kakaoLevelToLeafletZoom(level);
  // zoom 14 기준 약 ±0.035도(~4km), 줌이 1단계 줄어들 때마다 2배 확장
  const halfSpan = Math.min(4.5, Math.max(0.005, 0.035 * Math.pow(2, 14 - zoom)));
  return {
    minLat: center.lat - halfSpan,
    maxLat: center.lat + halfSpan,
    minLng: center.lng - halfSpan * 1.25,
    maxLng: center.lng + halfSpan * 1.25,
  };
}
