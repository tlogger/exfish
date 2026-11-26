import React from 'react';
import {
  Map as MapLibreMap,
  ScaleControl,
  setWorkerUrl,
  type MapMouseEvent,
} from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(maplibreWorkerUrl);
import { getApiBaseUrl } from '../utils/apiBase';
import { globalZoomToLevel, levelToGlobalZoom } from '../utils/mapCoordSync';
import {
  fetchAndBuildOsmStyle,
  GEBCO_WMS_TILES,
  OPENSEAMAP_SEAMARK_TILES,
} from '../utils/osmBilingualStyle';
import { calculateDestinationPoint, type BaseMapProps } from './mapCanvasTypes';

/**
 * OSM + OpenFreeMap 이중언어 벡터 + Esri 위성 + OpenSeaMap 해양표지 + GEBCO 해저지형 베이스 맵 어댑터
 * 모든 낚시 포인트·캐스팅아크·스윗스팟·HUD·측정선 오버레이는 상단 UnifiedMapOverlay가 단일 렌더링합니다.
 */
export const OsmBaseMap: React.FC<BaseMapProps> = ({
  center,
  level,
  digitalZoom,
  mapMode,
  isDarkMode,
  isStrictAdmin,
  showHaeroadEnc,
  secondaryLang = 'ko',
  showOpenSeaMap = true,
  showBathymetry = false,
  onCenterChange,
  onLevelChange,
  onMapClick,
  bridgeRef,
  mapContainerRef,
  isMarkerClickRef,
  dragTrackerRef,
}) => {
  const containerDivRef = React.useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = React.useRef<MapLibreMap | null>(null);
  const isSyncingRef = React.useRef(false);
  const viewportListenersRef = React.useRef<Set<() => void>>(new Set());

  const marineOptionsRef = React.useRef({
    showOpenSeaMap,
    showBathymetry,
    isStrictAdmin,
    showHaeroadEnc,
  });
  marineOptionsRef.current = {
    showOpenSeaMap,
    showBathymetry,
    isStrictAdmin,
    showHaeroadEnc,
  };

  const notifyViewport = React.useCallback(() => {
    viewportListenersRef.current.forEach((fn) => fn());
  }, []);

  const callbacksRef = React.useRef({
    onCenterChange,
    onLevelChange,
    onMapClick,
  });
  callbacksRef.current = {
    onCenterChange,
    onLevelChange,
    onMapClick,
  };

  const syncMarineOverlays = React.useCallback((map: MapLibreMap) => {
    if (!map.isStyleLoaded()) return;
    const opts = marineOptionsRef.current;

    const removeLayerAndSource = (layerId: string, sourceId: string) => {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };

    // 1) GEBCO 글로벌 해저지형 WMS (가장 아래쪽 오버레이)
    if (opts.showBathymetry) {
      if (!map.getSource('gebco-bathymetry')) {
        map.addSource('gebco-bathymetry', {
          type: 'raster',
          tiles: [GEBCO_WMS_TILES],
          tileSize: 256,
          maxzoom: 14,
        });
      }
      if (!map.getLayer('gebco-bathymetry-layer')) {
        const firstSymbolId = map
          .getStyle()
          ?.layers?.find((l: { type?: string; id?: string }) => l.type === 'symbol')?.id;
        map.addLayer(
          {
            id: 'gebco-bathymetry-layer',
            type: 'raster',
            source: 'gebco-bathymetry',
            paint: { 'raster-opacity': 0.45 },
          },
          firstSymbolId
        );
      }
    } else {
      removeLayerAndSource('gebco-bathymetry-layer', 'gebco-bathymetry');
    }

    // 2) 국내 해역 해로드 ENC (관리자 전용)
    if (opts.isStrictAdmin && opts.showHaeroadEnc) {
      const apiBase = getApiBaseUrl();
      if (!map.getSource('haeroad-enc')) {
        map.addSource('haeroad-enc', {
          type: 'raster',
          tiles: [`${apiBase}/api/haeroad-tile?z={z}&x={x}&y={y}`],
          tileSize: 256,
          maxzoom: 16,
        });
      }
      if (!map.getLayer('haeroad-enc-layer')) {
        map.addLayer({
          id: 'haeroad-enc-layer',
          type: 'raster',
          source: 'haeroad-enc',
          paint: { 'raster-opacity': 0.5 },
        });
      }
    } else {
      removeLayerAndSource('haeroad-enc-layer', 'haeroad-enc');
    }

    // 3) OpenSeaMap 글로벌 해양표지 (등대·항로·부표·암초·마리나)
    if (opts.showOpenSeaMap) {
      if (!map.getSource('openseamap-seamark')) {
        map.addSource('openseamap-seamark', {
          type: 'raster',
          tiles: [OPENSEAMAP_SEAMARK_TILES],
          tileSize: 256,
          maxzoom: 18,
        });
      }
      if (!map.getLayer('openseamap-seamark-layer')) {
        map.addLayer({
          id: 'openseamap-seamark-layer',
          type: 'raster',
          source: 'openseamap-seamark',
          paint: { 'raster-opacity': 0.92 },
        });
      }
    } else {
      removeLayerAndSource('openseamap-seamark-layer', 'openseamap-seamark');
    }
  }, []);

  // MapLibre 인스턴스 초기화 (1회)
  React.useEffect(() => {
    const el = containerDivRef.current;
    if (!el || mapInstanceRef.current) return;

    let disposed = false;

    const map = new MapLibreMap({
      container: el,
      style: {
        version: 8,
        sources: {},
        layers: [],
      },
      center: [center.lng, center.lat],
      zoom: levelToGlobalZoom(level),
      minZoom: 2,
      maxZoom: 19,
      attributionControl: false,
      pitchWithRotate: false,
      dragRotate: false,
    });

    map.addControl(
      new ScaleControl({ maxWidth: 120, unit: 'metric' }),
      'bottom-left'
    );

    mapInstanceRef.current = map;

    map.on('move', notifyViewport);
    map.on('zoom', notifyViewport);
    map.on('resize', notifyViewport);
    map.on('style.load', () => {
      syncMarineOverlays(map);
      notifyViewport();
    });
    map.on('error', (e) => {
      if (e?.error) {
        console.warn('[OsmBaseMap] MapLibre error:', e.error);
      }
    });

    map.on('moveend', () => {
      notifyViewport();
      if (isSyncingRef.current) return;
      const c = map.getCenter();
      callbacksRef.current.onCenterChange({ lat: c.lat, lng: c.lng });
    });

    map.on('zoomend', () => {
      notifyViewport();
      if (isSyncingRef.current) return;
      callbacksRef.current.onLevelChange(globalZoomToLevel(map.getZoom()));
    });

    map.on('click', (ev: MapMouseEvent) => {
      if (isMarkerClickRef.current) {
        isMarkerClickRef.current = false;
        return;
      }
      if (dragTrackerRef.current.totalDist > 6) {
        dragTrackerRef.current.totalDist = 0;
        return;
      }
      callbacksRef.current.onMapClick(ev.lngLat.lat, ev.lngLat.lng);
    });

    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            map.resize();
            notifyViewport();
          })
        : null;
    ro?.observe(el);

    fetchAndBuildOsmStyle(mapMode, secondaryLang).then((style) => {
      if (!disposed && mapInstanceRef.current === map) {
        map.setStyle(style);
      }
    });

    requestAnimationFrame(notifyViewport);

    return () => {
      disposed = true;
      ro?.disconnect();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [dragTrackerRef, isMarkerClickRef, notifyViewport, syncMarineOverlays]);

  // 공통 투영 브릿지 등록
  React.useEffect(() => {
    const project = (lat: number, lng: number) => {
      const map = mapInstanceRef.current;
      if (!map) return null;
      const pt = map.project([lng, lat]);
      return { x: pt.x, y: pt.y };
    };

    bridgeRef.current = {
      project,
      latLngToScreen: (lat: number, lng: number) => {
        const map = mapInstanceRef.current;
        const container = containerDivRef.current;
        if (!map || !container) return null;
        const pt = map.project([lng, lat]);
        const rect = container.getBoundingClientRect();
        const rootRect = mapContainerRef.current
          ? mapContainerRef.current.getBoundingClientRect()
          : rect;
        if (!rect.width || !rect.height) return null;

        if (digitalZoom <= 1.0) {
          return {
            x: rect.left - rootRect.left + pt.x,
            y: rect.top - rootRect.top + pt.y,
          };
        }

        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const unscaledW = rect.width / digitalZoom;
        const unscaledH = rect.height / digitalZoom;
        const screenX = cx + (pt.x - unscaledW / 2) * digitalZoom;
        const screenY = cy + (pt.y - unscaledH / 2) * digitalZoom;
        return {
          x: screenX - rootRect.left,
          y: screenY - rootRect.top,
        };
      },
      screenToLatLng: (clientX: number, clientY: number) => {
        const map = mapInstanceRef.current;
        const container = containerDivRef.current;
        if (!map || !container) return null;
        const rect = container.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;

        if (digitalZoom <= 1.0) {
          const ll = map.unproject([clientX - rect.left, clientY - rect.top]);
          return { lat: ll.lat, lng: ll.lng };
        }

        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const unscaledW = rect.width / digitalZoom;
        const unscaledH = rect.height / digitalZoom;
        const unscaledX = unscaledW / 2 + (clientX - cx) / digitalZoom;
        const unscaledY = unscaledH / 2 + (clientY - cy) / digitalZoom;
        const ll = map.unproject([unscaledX, unscaledY]);
        return { lat: ll.lat, lng: ll.lng };
      },
      metersToPixels: (lat: number, lng: number, meters: number) => {
        const p0 = project(lat, lng);
        if (!p0) return 0;
        const [dLat, dLng] = calculateDestinationPoint(lat, lng, 90, meters);
        const p1 = project(dLat, dLng);
        if (!p1) return 0;
        return Math.hypot(p1.x - p0.x, p1.y - p0.y);
      },
      getContainerSize: () => {
        const el = containerDivRef.current;
        if (!el) return null;
        return { width: el.offsetWidth, height: el.offsetHeight };
      },
      panByPixels: (dx: number, dy: number) => {
        const map = mapInstanceRef.current;
        if (!map) return;
        map.panBy([-dx / digitalZoom, -dy / digitalZoom], { animate: false });
      },
      subscribeViewport: (listener: () => void) => {
        viewportListenersRef.current.add(listener);
        return () => {
          viewportListenersRef.current.delete(listener);
        };
      },
    };
    notifyViewport();
  }, [bridgeRef, digitalZoom, mapContainerRef, notifyViewport]);

  // center / level 외부 변경 동기화
  React.useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const cur = map.getCenter();
    const targetZoom = levelToGlobalZoom(level);
    const dist = Math.hypot(cur.lat - center.lat, cur.lng - center.lng);
    const zoomDiff = Math.abs(map.getZoom() - targetZoom);
    if (dist > 1e-6 || zoomDiff > 0.05) {
      isSyncingRef.current = true;
      map.jumpTo({ center: [center.lng, center.lat], zoom: targetZoom });
      isSyncingRef.current = false;
      notifyViewport();
    }
  }, [center.lat, center.lng, level, notifyViewport]);

  // 디지털 줌 상태 시 MapLibre 드래그/휠 줌 비활성화
  React.useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (digitalZoom > 1.0) {
      map.dragPan.disable();
      map.scrollZoom.disable();
      map.doubleClickZoom.disable();
    } else {
      map.dragPan.enable();
      map.scrollZoom.enable();
      map.doubleClickZoom.enable();
    }
  }, [digitalZoom]);

  // mapMode / secondaryLang 변경 시 스타일 재적용
  const prevStyleKeyRef = React.useRef(`${mapMode}:${secondaryLang}`);
  React.useEffect(() => {
    const nextKey = `${mapMode}:${secondaryLang}`;
    if (prevStyleKeyRef.current === nextKey) return;
    prevStyleKeyRef.current = nextKey;

    const map = mapInstanceRef.current;
    if (!map) return;
    let cancelled = false;
    fetchAndBuildOsmStyle(mapMode, secondaryLang).then((style) => {
      if (!cancelled && mapInstanceRef.current === map) {
        map.setStyle(style);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [mapMode, secondaryLang]);

  // 해양 오버레이 토글 즉시 반영
  React.useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    syncMarineOverlays(map);
  }, [showOpenSeaMap, showBathymetry, isStrictAdmin, showHaeroadEnc, syncMarineOverlays]);

  return (
    <div className={`relative w-full h-full ${isDarkMode ? 'bg-slate-950' : 'bg-slate-900'}`}>
      <div ref={containerDivRef} className="w-full h-full" />
      <div className="pointer-events-none absolute bottom-1 right-2 z-20 rounded bg-slate-950/70 px-1.5 py-0.5 text-[9px] text-slate-300/85 backdrop-blur-sm">
        © OSM · OpenFreeMap
        {showOpenSeaMap ? ' · OpenSeaMap' : ''}
        {mapMode === 'HYBRID' ? ' · Esri' : ''}
        {showBathymetry ? ' · GEBCO' : ''}
      </div>
    </div>
  );
};

export default OsmBaseMap;
