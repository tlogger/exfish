import React from 'react';
import { Map } from 'react-kakao-maps-sdk';
import { HaeRoadEncOverlay } from './HaeRoadEncOverlay';
import { calculateDestinationPoint, type BaseMapProps } from './mapCanvasTypes';

/**
 * 카카오맵 베이스 맵 어댑터 (순수 타일·패닝·줌·ENC만 담당)
 * 모든 포인트·캐스팅아크·스윗스팟·HUD·측정선 오버레이는 상단 UnifiedMapOverlay가 단일 렌더링하며,
 * 야간 모드 필터(.kakao-dark-target)는 타일 레이어에만 국한되어 오버레이 색상이 왜곡되지 않습니다.
 */
export const KakaoBaseMap: React.FC<BaseMapProps> = ({
  center,
  level,
  digitalZoom,
  mapMode,
  isStrictAdmin,
  showHaeroadEnc,
  onCenterChange,
  onLevelChange,
  onMapClick,
  bridgeRef,
  mapContainerRef,
  isMarkerClickRef,
  lastClientPosRef,
  dragTrackerRef,
}) => {
  const mapRef = React.useRef<any>(null);
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const viewportListenersRef = React.useRef<Set<() => void>>(new Set());
  const kakaoListenersCleanupRef = React.useRef<(() => void) | null>(null);

  const notifyViewport = React.useCallback(() => {
    viewportListenersRef.current.forEach((fn) => fn());
  }, []);

  const kakaoMapTypeId = React.useMemo(() => {
    if (typeof window !== 'undefined' && (window as any).kakao?.maps?.MapTypeId) {
      return mapMode === 'HYBRID'
        ? (window as any).kakao.maps.MapTypeId.HYBRID
        : (window as any).kakao.maps.MapTypeId.ROADMAP;
    }
    return undefined;
  }, [mapMode]);

  const getCorrectLatLngFromClient = React.useCallback(
    (clientX: number, clientY: number): { lat: number; lng: number } | null => {
      const map = mapRef.current;
      if (!map) return null;
      const proj = map.getProjection ? map.getProjection() : null;
      if (!proj || !(window as any).kakao?.maps?.Point) return null;
      const container = map.getNode ? map.getNode() : null;
      if (!container) return null;
      const rect = container.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;

      if (digitalZoom <= 1.0) {
        const point = new (window as any).kakao.maps.Point(clientX - rect.left, clientY - rect.top);
        const coords = proj.coordsFromContainerPoint(point);
        return coords ? { lat: coords.getLat(), lng: coords.getLng() } : null;
      }

      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const unscaledW = rect.width / digitalZoom;
      const unscaledH = rect.height / digitalZoom;
      const unscaledX = unscaledW / 2 + (clientX - cx) / digitalZoom;
      const unscaledY = unscaledH / 2 + (clientY - cy) / digitalZoom;
      const point = new (window as any).kakao.maps.Point(unscaledX, unscaledY);
      const coords = proj.coordsFromContainerPoint(point);
      return coords ? { lat: coords.getLat(), lng: coords.getLng() } : null;
    },
    [digitalZoom]
  );

  // ResizeObserver로 컨테이너 크기 변경 시 오버레이 재투영
  React.useEffect(() => {
    const el = wrapperRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      mapRef.current?.relayout?.();
      notifyViewport();
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      kakaoListenersCleanupRef.current?.();
      kakaoListenersCleanupRef.current = null;
    };
  }, [notifyViewport]);

  // 공통 투영 브릿지 등록
  React.useEffect(() => {
    const project = (lat: number, lng: number) => {
      const map = mapRef.current;
      if (!map) return null;
      const proj = map.getProjection ? map.getProjection() : null;
      if (!proj || !(window as any).kakao?.maps?.LatLng) return null;
      const pt = proj.containerPointFromCoords(new (window as any).kakao.maps.LatLng(lat, lng));
      return pt ? { x: pt.x, y: pt.y } : null;
    };

    bridgeRef.current = {
      project,
      latLngToScreen: (lat: number, lng: number) => {
        const map = mapRef.current;
        if (!map) return null;
        const containerPoint = project(lat, lng);
        if (!containerPoint) return null;
        const container = map.getNode ? map.getNode() : null;
        if (!container) return null;
        const rect = container.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const rootRect = mapContainerRef.current ? mapContainerRef.current.getBoundingClientRect() : rect;
        if (digitalZoom <= 1.0) {
          return {
            x: rect.left - rootRect.left + containerPoint.x,
            y: rect.top - rootRect.top + containerPoint.y,
          };
        }
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const unscaledW = rect.width / digitalZoom;
        const unscaledH = rect.height / digitalZoom;
        const screenX = cx + (containerPoint.x - unscaledW / 2) * digitalZoom;
        const screenY = cy + (containerPoint.y - unscaledH / 2) * digitalZoom;
        return { x: screenX - rootRect.left, y: screenY - rootRect.top };
      },
      screenToLatLng: getCorrectLatLngFromClient,
      metersToPixels: (lat: number, lng: number, meters: number) => {
        const p0 = project(lat, lng);
        if (!p0) return 0;
        const [dLat, dLng] = calculateDestinationPoint(lat, lng, 90, meters);
        const p1 = project(dLat, dLng);
        if (!p1) return 0;
        return Math.hypot(p1.x - p0.x, p1.y - p0.y);
      },
      getContainerSize: () => {
        const el = wrapperRef.current;
        if (!el) return null;
        return { width: el.offsetWidth, height: el.offsetHeight };
      },
      panByPixels: (dx: number, dy: number) => {
        const map = mapRef.current;
        const proj = map?.getProjection ? map.getProjection() : null;
        if (proj && (window as any).kakao?.maps?.Point) {
          const curCenter = map.getCenter();
          const curPoint = proj.pointFromCoords(curCenter);
          const newPoint = new (window as any).kakao.maps.Point(
            curPoint.x - dx / digitalZoom,
            curPoint.y - dy / digitalZoom
          );
          map.setCenter(proj.coordsFromPoint(newPoint));
          notifyViewport();
        }
      },
      subscribeViewport: (listener: () => void) => {
        viewportListenersRef.current.add(listener);
        return () => {
          viewportListenersRef.current.delete(listener);
        };
      },
    };
    notifyViewport();
  }, [bridgeRef, digitalZoom, getCorrectLatLngFromClient, mapContainerRef, notifyViewport]);

  // center / level 변경 시 오버레이 재투영 보장
  React.useEffect(() => {
    const id = requestAnimationFrame(notifyViewport);
    return () => cancelAnimationFrame(id);
  }, [center.lat, center.lng, level, notifyViewport]);

  const handleMapCreate = React.useCallback(
    (map: any) => {
      mapRef.current = map;
      kakaoListenersCleanupRef.current?.();
      const kEvent = (window as any).kakao?.maps?.event;
      if (kEvent) {
        const events = ['center_changed', 'zoom_changed', 'bounds_changed', 'drag', 'idle'];
        events.forEach((ev) => kEvent.addListener(map, ev, notifyViewport));
        kakaoListenersCleanupRef.current = () => {
          events.forEach((ev) => kEvent.removeListener(map, ev, notifyViewport));
        };
      }
      requestAnimationFrame(notifyViewport);
    },
    [notifyViewport]
  );

  return (
    <div ref={wrapperRef} className="relative w-full h-full">
      <div className="w-full h-full kakao-dark-target">
        <Map
          onCreate={handleMapCreate}
          draggable={digitalZoom === 1.0}
          zoomable={digitalZoom === 1.0}
          center={center}
          level={level}
          mapTypeId={kakaoMapTypeId}
          style={{ width: '100%', height: '100%' }}
          onClick={(_target, mouseEvent) => {
            if (isMarkerClickRef.current) {
              isMarkerClickRef.current = false;
              return;
            }
            if (dragTrackerRef.current.totalDist > 6) {
              dragTrackerRef.current.totalDist = 0;
              return;
            }
            const latLng = mouseEvent.latLng;
            let clickedLat = latLng.getLat();
            let clickedLng = latLng.getLng();

            if (digitalZoom > 1.0) {
              const domEv = (mouseEvent as any).domEvent;
              const clickX = domEv?.clientX ?? lastClientPosRef.current.x;
              const clickY = domEv?.clientY ?? lastClientPosRef.current.y;
              if (clickX > 0) {
                const corrected = getCorrectLatLngFromClient(clickX, clickY);
                if (corrected) {
                  clickedLat = corrected.lat;
                  clickedLng = corrected.lng;
                }
              }
            }
            onMapClick(clickedLat, clickedLng);
          }}
          onZoomChanged={(target) => {
            notifyViewport();
            onLevelChange(target.getLevel());
          }}
          onCenterChanged={(target) => {
            notifyViewport();
            const latLng = target.getCenter();
            onCenterChange({ lat: latLng.getLat(), lng: latLng.getLng() });
          }}
        />
      </div>
      <HaeRoadEncOverlay mapRef={mapRef} enabled={isStrictAdmin && showHaeroadEnc} opacity={0.5} />
    </div>
  );
};
