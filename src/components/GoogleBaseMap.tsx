import React from 'react';
import { getApiBaseUrl } from '../utils/apiBase';
import { hasGoogleMapsApiKey, loadGoogleMapsApi, resetGoogleMapsLoader } from '../utils/googleMapsLoader';
import { globalZoomToLevel, levelToGlobalZoom } from '../utils/mapCoordSync';
import { OPENSEAMAP_SEAMARK_TILES } from '../utils/osmBilingualStyle';
import { calculateDestinationPoint, type BaseMapProps } from './mapCanvasTypes';

/**
 * Google Maps JavaScript API 베이스 맵 어댑터
 * - ROADMAP / HYBRID / DARK(colorScheme: 'DARK') 지원
 * - OverlayView.getProjection()을 통한 정밀 MapCanvasBridge 구현
 * - OpenSeaMap / 해로드 ENC 선택적 중첩 지원
 */
export const GoogleBaseMap: React.FC<BaseMapProps> = ({
  center,
  level,
  digitalZoom,
  mapMode,
  isDarkMode,
  isStrictAdmin,
  showHaeroadEnc,
  secondaryLang = 'ko',
  showOpenSeaMap = false,
  onFallbackProvider,
  onCenterChange,
  onLevelChange,
  onMapClick,
  bridgeRef,
  mapContainerRef,
  isMarkerClickRef,
  dragTrackerRef,
}) => {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<any>(null);
  const googleMapsRef = React.useRef<any>(null);
  const overlayViewRef = React.useRef<any>(null);
  const isSyncingRef = React.useRef(false);
  const viewportListenersRef = React.useRef<Set<() => void>>(new Set());
  const [loadError, setLoadError] = React.useState<string | null>(() =>
    hasGoogleMapsApiKey() ? null : 'MISSING_KEY'
  );
  const [isReady, setIsReady] = React.useState(false);
  const [retryNonce, setRetryNonce] = React.useState(0);

  const centerRef = React.useRef(center);
  centerRef.current = center;
  const levelRef = React.useRef(level);
  levelRef.current = level;
  const mapModeRef = React.useRef(mapMode);
  mapModeRef.current = mapMode;

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

  const notifyViewport = React.useCallback(() => {
    viewportListenersRef.current.forEach((fn) => fn());
  }, []);

  // Google Maps colorScheme은 Map 생성 시점에만 적용되므로 DARK <-> LIGHT 전환 시 재초기화
  const colorSchemeKey = mapMode === 'DARK' ? 'DARK' : 'LIGHT';

  React.useEffect(() => {
    if (!hasGoogleMapsApiKey()) {
      setLoadError('MISSING_KEY');
      return;
    }

    let disposed = false;
    let listeners: any[] = [];
    let ro: ResizeObserver | null = null;
    setLoadError(null);
    setIsReady(false);

    loadGoogleMapsApi(secondaryLang)
      .then((gMaps) => {
        if (disposed || !hostRef.current) return;
        googleMapsRef.current = gMaps;

        const map = new gMaps.Map(hostRef.current, {
          center: { lat: centerRef.current.lat, lng: centerRef.current.lng },
          zoom: levelToGlobalZoom(levelRef.current),
          minZoom: 2,
          maxZoom: 20,
          disableDefaultUI: true,
          scaleControl: true,
          clickableIcons: false,
          gestureHandling: 'greedy',
          mapTypeId: mapModeRef.current === 'HYBRID' ? 'hybrid' : 'roadmap',
          colorScheme: colorSchemeKey,
        });

        class BridgeOverlay extends gMaps.OverlayView {
          onAdd() {}
          draw() {
            notifyViewport();
          }
          onRemove() {}
        }

        const overlay = new BridgeOverlay();
        overlay.setMap(map);

        mapRef.current = map;
        overlayViewRef.current = overlay;

        const addListener = (eventName: string, fn: (...args: any[]) => void) => {
          listeners.push(gMaps.event.addListener(map, eventName, fn));
        };

        addListener('bounds_changed', notifyViewport);
        addListener('center_changed', notifyViewport);
        addListener('zoom_changed', () => {
          notifyViewport();
          if (isSyncingRef.current) return;
          const z = map.getZoom();
          if (typeof z === 'number') {
            callbacksRef.current.onLevelChange(globalZoomToLevel(z));
          }
        });
        addListener('drag', notifyViewport);
        addListener('idle', () => {
          notifyViewport();
          if (isSyncingRef.current) return;
          const c = map.getCenter();
          if (c) {
            callbacksRef.current.onCenterChange({ lat: c.lat(), lng: c.lng() });
          }
        });
        addListener('click', (ev: any) => {
          if (isMarkerClickRef.current) {
            isMarkerClickRef.current = false;
            return;
          }
          if (dragTrackerRef.current.totalDist > 6) {
            dragTrackerRef.current.totalDist = 0;
            return;
          }
          const ll = ev?.latLng;
          if (ll) {
            callbacksRef.current.onMapClick(ll.lat(), ll.lng());
          }
        });

        ro =
          typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(() => {
                gMaps.event.trigger(map, 'resize');
                notifyViewport();
              })
            : null;
        ro?.observe(hostRef.current);

        setIsReady(true);
        requestAnimationFrame(notifyViewport);
      })
      .catch((err: any) => {
        if (!disposed) {
          setLoadError(String(err?.message || 'Google Maps 로드 실패'));
        }
      });

    return () => {
      disposed = true;
      ro?.disconnect();
      listeners.forEach((l) => l?.remove?.());
      listeners = [];
      if (overlayViewRef.current) {
        overlayViewRef.current.setMap(null);
        overlayViewRef.current = null;
      }
      mapRef.current = null;
    };
  }, [colorSchemeKey, dragTrackerRef, isMarkerClickRef, notifyViewport, retryNonce, secondaryLang]);

  // 공통 투영 브릿지 등록
  React.useEffect(() => {
    const project = (lat: number, lng: number) => {
      const gMaps = googleMapsRef.current;
      const overlay = overlayViewRef.current;
      if (!gMaps || !overlay) return null;
      const proj = overlay.getProjection?.();
      if (!proj) return null;
      const pt = proj.fromLatLngToContainerPixel(new gMaps.LatLng(lat, lng));
      return pt ? { x: pt.x, y: pt.y } : null;
    };

    bridgeRef.current = {
      project,
      latLngToScreen: (lat: number, lng: number) => {
        const container = hostRef.current;
        if (!container) return null;
        const pt = project(lat, lng);
        if (!pt) return null;
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
        const gMaps = googleMapsRef.current;
        const overlay = overlayViewRef.current;
        const container = hostRef.current;
        if (!gMaps || !overlay || !container) return null;
        const proj = overlay.getProjection?.();
        if (!proj) return null;
        const rect = container.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;

        if (digitalZoom <= 1.0) {
          const ll = proj.fromContainerPixelToLatLng(
            new gMaps.Point(clientX - rect.left, clientY - rect.top)
          );
          return ll ? { lat: ll.lat(), lng: ll.lng() } : null;
        }

        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const unscaledW = rect.width / digitalZoom;
        const unscaledH = rect.height / digitalZoom;
        const unscaledX = unscaledW / 2 + (clientX - cx) / digitalZoom;
        const unscaledY = unscaledH / 2 + (clientY - cy) / digitalZoom;
        const ll = proj.fromContainerPixelToLatLng(new gMaps.Point(unscaledX, unscaledY));
        return ll ? { lat: ll.lat(), lng: ll.lng() } : null;
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
        const el = hostRef.current;
        if (!el) return null;
        return { width: el.offsetWidth, height: el.offsetHeight };
      },
      panByPixels: (dx: number, dy: number) => {
        const map = mapRef.current;
        if (!map) return;
        map.panBy(-dx / digitalZoom, -dy / digitalZoom);
      },
      subscribeViewport: (listener: () => void) => {
        viewportListenersRef.current.add(listener);
        return () => {
          viewportListenersRef.current.delete(listener);
        };
      },
    };
    notifyViewport();
  }, [bridgeRef, digitalZoom, isReady, mapContainerRef, notifyViewport]);

  // center / level 외부 변경 동기화
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const cur = map.getCenter?.();
    const targetZoom = levelToGlobalZoom(level);
    const dist = cur ? Math.hypot(cur.lat() - center.lat, cur.lng() - center.lng) : 1;
    const zoomDiff = Math.abs((map.getZoom?.() ?? targetZoom) - targetZoom);
    if (dist > 1e-6 || zoomDiff > 0) {
      isSyncingRef.current = true;
      map.setCenter({ lat: center.lat, lng: center.lng });
      map.setZoom(targetZoom);
      isSyncingRef.current = false;
      notifyViewport();
    }
  }, [center.lat, center.lng, level, notifyViewport]);

  // mapTypeId 동기화 (ROADMAP / HYBRID)
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setMapTypeId(mapMode === 'HYBRID' ? 'hybrid' : 'roadmap');
  }, [mapMode]);

  // 디지털 줌 상태 시 Google Maps 제스처 비활성화
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setOptions({
      gestureHandling: digitalZoom > 1.0 ? 'none' : 'greedy',
      scrollwheel: digitalZoom <= 1.0,
      disableDoubleClickZoom: digitalZoom > 1.0,
    });
  }, [digitalZoom]);

  // OpenSeaMap / 해로드 ENC 오버레이 타일 중첩
  React.useEffect(() => {
    const map = mapRef.current;
    const gMaps = googleMapsRef.current;
    if (!map || !gMaps) return;

    map.overlayMapTypes.clear();

    if (isStrictAdmin && showHaeroadEnc) {
      const apiBase = getApiBaseUrl();
      const haeroadLayer = new gMaps.ImageMapType({
        getTileUrl: (coord: { x: number; y: number }, zoom: number) =>
          zoom >= 8 && zoom <= 16
            ? `${apiBase}/api/haeroad-tile?z=${zoom}&x=${coord.x}&y=${coord.y}`
            : '',
        tileSize: new gMaps.Size(256, 256),
        opacity: 0.5,
        maxZoom: 16,
        minZoom: 8,
        name: 'HaeRoadENC',
      });
      map.overlayMapTypes.push(haeroadLayer);
    }

    if (showOpenSeaMap) {
      const seamarkLayer = new gMaps.ImageMapType({
        getTileUrl: (coord: { x: number; y: number }, zoom: number) =>
          OPENSEAMAP_SEAMARK_TILES.replace('{z}', String(zoom))
            .replace('{x}', String(coord.x))
            .replace('{y}', String(coord.y)),
        tileSize: new gMaps.Size(256, 256),
        opacity: 0.92,
        maxZoom: 18,
        minZoom: 2,
        name: 'OpenSeaMap',
      });
      map.overlayMapTypes.push(seamarkLayer);
    }
  }, [isReady, showOpenSeaMap, isStrictAdmin, showHaeroadEnc]);

  if (loadError) {
    const isMissingKey = loadError === 'MISSING_KEY';
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#0F172A] p-6 text-center text-slate-200">
        <div className="max-w-sm space-y-3 rounded-[16px] border border-slate-700/60 bg-[#1E293B] p-4 shadow-2xl">
          <div className="text-sm font-bold text-amber-300">
            {isMissingKey ? 'Google Maps API 키 미설정' : 'Google Maps 로드 지연 / 실패'}
          </div>
          <p className="text-xs leading-relaxed text-slate-300">
            {isMissingKey
              ? 'Google Maps를 사용하려면 환경변수 VITE_GOOGLE_MAPS_API_KEY가 필요합니다. 키 없이도 무료 OSM 해양도 지도로 해외 포인트를 바로 이용할 수 있습니다.'
              : loadError}
          </p>
          <div className="grid grid-cols-2 gap-2 pt-1">
            {!isMissingKey && (
              <button
                type="button"
                onClick={() => {
                  resetGoogleMapsLoader();
                  setLoadError(null);
                  setRetryNonce((n) => n + 1);
                }}
                className="rounded-xl bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-400"
              >
                다시 시도 (대기)
              </button>
            )}
            {onFallbackProvider && (
              <button
                type="button"
                onClick={() => onFallbackProvider('osm')}
                className={`${isMissingKey ? 'col-span-2 bg-emerald-500 text-slate-950 hover:bg-emerald-400' : 'bg-[#0F172A] text-slate-200 border border-slate-700/60 hover:bg-slate-800'} rounded-xl px-3 py-2 text-xs font-bold transition`}
              >
                OSM 지도로 전환
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-[#0F172A]">
      <div ref={hostRef} className="h-full w-full" />
      {!isReady && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#0F172A]/80 text-xs font-medium text-emerald-300">
          Google Maps 불러오는 중...
        </div>
      )}
    </div>
  );
};

export default GoogleBaseMap;
