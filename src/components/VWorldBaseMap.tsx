import React from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getApiBaseUrl } from '../utils/apiBase';
import { kakaoLevelToLeafletZoom, leafletZoomToKakaoLevel } from '../utils/mapCoordSync';
import { calculateDestinationPoint, type BaseMapProps } from './mapCanvasTypes';

/**
 * VWorld 베이스 맵 어댑터 (순수 타일·패닝·줌·축척·ENC만 담당)
 * 모든 포인트·캐스팅아크·스윗스팟·HUD·측정선 오버레이는 상단 UnifiedMapOverlay가 단일 렌더링합니다.
 */
export const VWorldBaseMap: React.FC<BaseMapProps> = ({
  center,
  level,
  digitalZoom,
  mapMode,
  isDarkMode,
  isStrictAdmin,
  showHaeroadEnc,
  onCenterChange,
  onLevelChange,
  onMapClick,
  bridgeRef,
  mapContainerRef,
  isMarkerClickRef,
  dragTrackerRef,
}) => {
  const leafletDivRef = React.useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = React.useRef<L.Map | null>(null);
  const baseLayerGroupRef = React.useRef<L.LayerGroup | null>(null);
  const encLayerRef = React.useRef<L.TileLayer | null>(null);
  const isSyncingRef = React.useRef(false);
  const viewportListenersRef = React.useRef<Set<() => void>>(new Set());

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

  // Leaflet 맵 초기화 (1회)
  React.useEffect(() => {
    if (!leafletDivRef.current || mapInstanceRef.current) return;

    const map = L.map(leafletDivRef.current, {
      center: [center.lat, center.lng],
      zoom: kakaoLevelToLeafletZoom(level),
      minZoom: 6,
      maxZoom: 19,
      zoomControl: false,
      attributionControl: false,
    });

    // VWorld 축척 바 (좌하단, 미터법 전용)
    L.control.scale({ metric: true, imperial: false, position: 'bottomleft', maxWidth: 120 }).addTo(map);

    baseLayerGroupRef.current = L.layerGroup().addTo(map);
    mapInstanceRef.current = map;

    map.on('move zoom viewreset resize', notifyViewport);

    map.on('moveend', () => {
      notifyViewport();
      if (isSyncingRef.current) return;
      const c = map.getCenter();
      callbacksRef.current.onCenterChange({ lat: c.lat, lng: c.lng });
    });

    map.on('zoomend', () => {
      notifyViewport();
      if (isSyncingRef.current) return;
      const nextLevel = leafletZoomToKakaoLevel(map.getZoom());
      callbacksRef.current.onLevelChange(nextLevel);
    });

    map.on('click', (ev: L.LeafletMouseEvent) => {
      if (isMarkerClickRef.current) {
        isMarkerClickRef.current = false;
        return;
      }
      if (dragTrackerRef.current.totalDist > 6) {
        dragTrackerRef.current.totalDist = 0;
        return;
      }
      callbacksRef.current.onMapClick(ev.latlng.lat, ev.latlng.lng);
    });

    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          map.invalidateSize({ animate: false });
          notifyViewport();
        })
      : null;
    if (ro && leafletDivRef.current) ro.observe(leafletDivRef.current);

    // 초기 마운트 직후 오버레이 첫 투영 트리거
    requestAnimationFrame(notifyViewport);

    return () => {
      ro?.disconnect();
      map.remove();
      mapInstanceRef.current = null;
      baseLayerGroupRef.current = null;
      encLayerRef.current = null;
    };
  }, [dragTrackerRef, isMarkerClickRef, notifyViewport]);

  // 공통 투영 브릿지 등록
  React.useEffect(() => {
    const project = (lat: number, lng: number) => {
      const map = mapInstanceRef.current;
      if (!map) return null;
      const pt = map.latLngToContainerPoint([lat, lng]);
      return { x: pt.x, y: pt.y };
    };

    bridgeRef.current = {
      project,
      latLngToScreen: (lat: number, lng: number) => {
        const map = mapInstanceRef.current;
        const container = leafletDivRef.current;
        if (!map || !container) return null;
        const pt = map.latLngToContainerPoint([lat, lng]);
        const rect = container.getBoundingClientRect();
        const rootRect = mapContainerRef.current ? mapContainerRef.current.getBoundingClientRect() : rect;
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
        const container = leafletDivRef.current;
        if (!map || !container) return null;
        const rect = container.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;

        if (digitalZoom <= 1.0) {
          const ll = map.containerPointToLatLng([clientX - rect.left, clientY - rect.top]);
          return { lat: ll.lat, lng: ll.lng };
        }

        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const unscaledW = rect.width / digitalZoom;
        const unscaledH = rect.height / digitalZoom;
        const unscaledX = unscaledW / 2 + (clientX - cx) / digitalZoom;
        const unscaledY = unscaledH / 2 + (clientY - cy) / digitalZoom;
        const ll = map.containerPointToLatLng([unscaledX, unscaledY]);
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
        const map = mapInstanceRef.current;
        if (!map) return null;
        const sz = map.getSize();
        return { width: sz.x, height: sz.y };
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
    const targetZoom = kakaoLevelToLeafletZoom(level);
    const dist = Math.hypot(cur.lat - center.lat, cur.lng - center.lng);
    const zoomDiff = Math.abs(map.getZoom() - targetZoom);
    if (dist > 1e-6 || zoomDiff > 0) {
      isSyncingRef.current = true;
      map.setView([center.lat, center.lng], targetZoom, { animate: false });
      isSyncingRef.current = false;
      notifyViewport();
    }
  }, [center.lat, center.lng, level, notifyViewport]);

  // 디지털 줌 상태 시 Leaflet 네이티브 드래그/휠 줌 비활성화
  React.useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (digitalZoom > 1.0) {
      map.dragging.disable();
      map.scrollWheelZoom.disable();
      map.doubleClickZoom.disable();
    } else {
      map.dragging.enable();
      map.scrollWheelZoom.enable();
      map.doubleClickZoom.enable();
    }
  }, [digitalZoom]);

  // VWorld 타일 레이어 전환 (Base / Satellite+Hybrid / midnight)
  React.useEffect(() => {
    const group = baseLayerGroupRef.current;
    if (!group) return;
    group.clearLayers();
    const apiBase = getApiBaseUrl();

    const addVWorldLayer = (layerName: 'Base' | 'Satellite' | 'Hybrid' | 'midnight', maxNativeZoom: number) => {
      const ext = layerName === 'Satellite' ? 'jpeg' : 'png';
      const tl = L.tileLayer(
        `${apiBase}/api/vworld-tile?layer=${layerName}&z={z}&x={x}&y={y}`,
        {
          maxZoom: 19,
          maxNativeZoom,
        }
      );
      tl.on('tileerror', (ev: any) => {
        const img = ev?.tile as HTMLImageElement | undefined;
        const coords = ev?.coords as { z: number; x: number; y: number } | undefined;
        if (!img || !coords || img.dataset.vworldFallbackTried === '1') return;
        img.dataset.vworldFallbackTried = '1';
        img.src = `https://xdworld.vworld.kr/2d/${layerName}/service/${coords.z}/${coords.x}/${coords.y}.${ext}`;
      });
      tl.addTo(group);
    };

    if (mapMode === 'HYBRID') {
      addVWorldLayer('Satellite', 19);
      addVWorldLayer('Hybrid', 19);
    } else if (mapMode === 'DARK') {
      addVWorldLayer('midnight', 18);
    } else {
      addVWorldLayer('Base', 19);
    }
  }, [mapMode]);

  // 해로드 ENC 네이티브 EPSG:3857 타일 오버레이
  React.useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (encLayerRef.current) {
      map.removeLayer(encLayerRef.current);
      encLayerRef.current = null;
    }
    if (isStrictAdmin && showHaeroadEnc) {
      const apiBase = getApiBaseUrl();
      encLayerRef.current = L.tileLayer(`${apiBase}/api/haeroad-tile?z={z}&x={x}&y={y}`, {
        opacity: 0.5,
        maxNativeZoom: 16,
        maxZoom: 19,
        zIndex: 5,
      }).addTo(map);
    }
  }, [isStrictAdmin, showHaeroadEnc]);

  return (
    <div className={`w-full h-full ${isDarkMode ? 'bg-slate-950' : 'bg-slate-900'}`}>
      {/* Leaflet 컨테이너의 className은 반드시 정적으로 유지해야 isDarkMode 전환 시 .leaflet-container가 보존됨 */}
      <div ref={leafletDivRef} className="w-full h-full" />
    </div>
  );
};
