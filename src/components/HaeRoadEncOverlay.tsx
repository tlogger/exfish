import React from 'react';
import { getApiBaseUrl } from '../utils/apiBase';

export interface Epsg3857TileBox {
  key: string;
  z: number;
  x: number;
  y: number;
  leftPx: number;
  topPx: number;
  widthPx: number;
  heightPx: number;
  matrixCss?: string;
}

const MAX_LAT = 85.05112878;

export function lngToMercatorNormX(lng: number): number {
  return (lng + 180) / 360;
}

export function latToMercatorNormY(lat: number): number {
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const rad = (clamped * Math.PI) / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
}

/**
 * 카카오맵(EPSG:5181) 뷰포트 경계(LatLngBounds)를 Web Mercator(EPSG:3857) XYZ 타일 픽셀 좌표로 동기화 변환
 */
export function computeVisibleEpsg3857Tiles(
  swLat: number,
  swLng: number,
  neLat: number,
  neLng: number,
  viewportWidthPx: number,
  viewportHeightPx: number
): Epsg3857TileBox[] {
  if (viewportWidthPx <= 0 || viewportHeightPx <= 0) return [];
  if (neLat <= swLat || neLng <= swLng) return [];

  const normLeft = lngToMercatorNormX(swLng);
  const normRight = lngToMercatorNormX(neLng);
  const normTop = latToMercatorNormY(neLat);
  const normBottom = latToMercatorNormY(swLat);

  const spanX = normRight - normLeft;
  const spanY = normBottom - normTop;
  if (spanX <= 0 || spanY <= 0) return [];

  // 뷰포트 픽셀 밀도에 가장 근접한 Web Mercator 줌 레벨(8~16) 선택
  const idealZoom = Math.log2(viewportWidthPx / (256 * spanX));
  const z = Math.max(8, Math.min(16, Math.round(idealZoom)));
  const n = Math.pow(2, z);

  const minTx = Math.max(0, Math.floor(normLeft * n));
  const maxTx = Math.min(n - 1, Math.floor(normRight * n));
  const minTy = Math.max(0, Math.floor(normTop * n));
  const maxTy = Math.min(n - 1, Math.floor(normBottom * n));

  const tiles: Epsg3857TileBox[] = [];
  for (let x = minTx; x <= maxTx; x++) {
    for (let y = minTy; y <= maxTy; y++) {
      const tNormLeft = x / n;
      const tNormRight = (x + 1) / n;
      const tNormTop = y / n;
      const tNormBottom = (y + 1) / n;

      const leftPx = ((tNormLeft - normLeft) / spanX) * viewportWidthPx;
      const topPx = ((tNormTop - normTop) / spanY) * viewportHeightPx;
      const widthPx = ((tNormRight - tNormLeft) / spanX) * viewportWidthPx;
      const heightPx = ((tNormBottom - tNormTop) / spanY) * viewportHeightPx;

      tiles.push({
        key: `${z}/${x}/${y}`,
        z,
        x,
        y,
        leftPx,
        topPx,
        widthPx,
        heightPx,
      });
    }
  }
  return tiles;
}

export function tileXToLng(x: number, z: number): number {
  return (x / Math.pow(2, z)) * 360 - 180;
}

export function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * EPSG:3857 타일의 3꼭짓점(NW, NE, SW)을 카카오맵 EPSG:5181 컨테이너 픽셀로
 * 아핀 변환(스트레칭 + 회전 + 전단)하여 자오선 수렴각으로 인한 타일 계단/틈새를 제거
 */
export function computeTileAffineMatrix(
  nw: { x: number; y: number },
  ne: { x: number; y: number },
  sw: { x: number; y: number },
  tileSize: number = 256,
  bleedPx: number = 0.6
): string {
  const scale = (tileSize + bleedPx) / tileSize;
  const a = ((ne.x - nw.x) / tileSize) * scale;
  const b = ((ne.y - nw.y) / tileSize) * scale;
  const c = ((sw.x - nw.x) / tileSize) * scale;
  const d = ((sw.y - nw.y) / tileSize) * scale;
  return `matrix(${a.toFixed(6)}, ${b.toFixed(6)}, ${c.toFixed(6)}, ${d.toFixed(6)}, ${nw.x.toFixed(2)}, ${nw.y.toFixed(2)})`;
}

interface HaeRoadEncOverlayProps {
  mapRef: React.RefObject<any>;
  enabled: boolean;
  opacity?: number;
}

export const HaeRoadEncOverlay: React.FC<HaeRoadEncOverlayProps> = ({
  mapRef,
  enabled,
  opacity = 0.5,
}) => {
  const [tiles, setTiles] = React.useState<Epsg3857TileBox[]>([]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!enabled || !map || !window.kakao?.maps?.event) {
      setTiles([]);
      return;
    }

    const syncTiles = () => {
      try {
        const node = map.getNode?.();
        const proj = map.getProjection?.();
        if (!node) return;
        const rect = node.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        // digitalZoom transform이 부모에 적용되어 있어 offsetWidth/offsetHeight 기준으로 배치
        const w = node.offsetWidth || rect.width;
        const h = node.offsetHeight || rect.height;

        if (
          proj &&
          typeof proj.coordsFromContainerPoint === 'function' &&
          typeof proj.containerPointFromCoords === 'function' &&
          window.kakao?.maps?.Point &&
          window.kakao?.maps?.LatLng
        ) {
          // 사이드바 열림/닫힘 등으로 map.getBounds()와 실제 뷰포트 크기가 어긋나도
          // 컨테이너 픽셀(0,h)~(w,0) 기준 실제 투영 좌표로 0px 오차 동기화
          const sw = proj.coordsFromContainerPoint(new window.kakao.maps.Point(0, h));
          const ne = proj.coordsFromContainerPoint(new window.kakao.maps.Point(w, 0));
          const baseTiles = computeVisibleEpsg3857Tiles(
            sw.getLat(),
            sw.getLng(),
            ne.getLat(),
            ne.getLng(),
            w,
            h
          );
          const projectedTiles = baseTiles.map((t) => {
            const nwLat = tileYToLat(t.y, t.z);
            const nwLng = tileXToLng(t.x, t.z);
            const neLng = tileXToLng(t.x + 1, t.z);
            const swLat = tileYToLat(t.y + 1, t.z);
            const nwPt = proj.containerPointFromCoords(new window.kakao.maps.LatLng(nwLat, nwLng));
            const nePt = proj.containerPointFromCoords(new window.kakao.maps.LatLng(nwLat, neLng));
            const swPt = proj.containerPointFromCoords(new window.kakao.maps.LatLng(swLat, nwLng));
            return {
              ...t,
              leftPx: nwPt.x,
              topPx: nwPt.y,
              widthPx: Math.max(1, nePt.x - nwPt.x),
              heightPx: Math.max(1, swPt.y - nwPt.y),
              matrixCss: computeTileAffineMatrix(nwPt, nePt, swPt),
            };
          });
          setTiles(projectedTiles);
          return;
        }

        const bounds = map.getBounds?.();
        if (!bounds) return;
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        setTiles(
          computeVisibleEpsg3857Tiles(sw.getLat(), sw.getLng(), ne.getLat(), ne.getLng(), w, h)
        );
      } catch {
        // ignore transient map init states
      }
    };

    syncTiles();
    const l1 = window.kakao.maps.event.addListener(map, 'bounds_changed', syncTiles);
    const l2 = window.kakao.maps.event.addListener(map, 'zoom_changed', syncTiles);
    const l3 = window.kakao.maps.event.addListener(map, 'idle', syncTiles);

    let ro: ResizeObserver | null = null;
    const node = map.getNode?.();
    if (node && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => syncTiles());
      ro.observe(node);
    }

    return () => {
      if (l1) window.kakao.maps.event.removeListener(map, 'bounds_changed', syncTiles);
      if (l2) window.kakao.maps.event.removeListener(map, 'zoom_changed', syncTiles);
      if (l3) window.kakao.maps.event.removeListener(map, 'idle', syncTiles);
      if (ro) ro.disconnect();
    };
  }, [mapRef, enabled]);

  if (!enabled || tiles.length === 0) return null;

  return (
    <div
      className="absolute inset-0 pointer-events-none overflow-hidden z-[5]"
      style={{ opacity }}
      aria-hidden="true"
    >
      {tiles.map((t) => (
        <img
          key={t.key}
          src={`${getApiBaseUrl()}/api/haeroad-tile?z=${t.z}&x=${t.x}&y=${t.y}`}
          alt=""
          draggable={false}
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
          className="absolute max-w-none select-none"
          style={
            t.matrixCss
              ? {
                  left: 0,
                  top: 0,
                  width: '256px',
                  height: '256px',
                  transformOrigin: '0 0',
                  transform: t.matrixCss,
                }
              : {
                  left: `${t.leftPx}px`,
                  top: `${t.topPx}px`,
                  width: `${t.widthPx + 0.5}px`,
                  height: `${t.heightPx + 0.5}px`,
                }
          }
        />
      ))}
    </div>
  );
};
