import React from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getApiBaseUrl } from '../utils/apiBase';
import { kakaoLevelToLeafletZoom, leafletZoomToKakaoLevel } from '../utils/mapCoordSync';
import { ZoneDigitizer } from './ZoneDigitizer';
import { calculateDestinationPoint, CASTING_BEARINGS, type SharedMapCanvasProps } from './mapCanvasTypes';

export const VWorldMapCanvas: React.FC<SharedMapCanvasProps> = ({
  center,
  level,
  digitalZoom,
  mapMode,
  isDarkMode,
  onCenterChange,
  onLevelChange,
  onWheelDigitalZoom,
  bridgeRef,
  mapContainerRef,
  displayedSpots,
  selectedSpot,
  favoriteSpotIds,
  shops,
  selectedShop,
  onSelectSpot,
  onSelectShop,
  pendingNewSpot,
  setPendingNewSpot,
  contextMenuSpot,
  setContextMenuSpot,
  onOpenContextMenu,
  microAdjustSpot,
  adjustedPos,
  setAdjustedPos,
  castingConfigSpot,
  tempCastingEnabled,
  tempStartDeg,
  tempEndDeg,
  sweetSpotConfigSpot,
  tempUseSweetSpot,
  tempSweetSpots,
  isAddingSweetSpot,
  draftSweetPos,
  setDraftSweetPos,
  showCastingArrows,
  tackleConfig,
  landingPoint,
  myLocation,
  prohibitedZones,
  isDigitizingZones,
  digitizerPoints,
  setDigitizerPoints,
  onUndoDigitize,
  onResetDigitize,
  onCancelDigitize,
  onSuccessDigitize,
  currentUser,
  isStrictAdmin,
  showHaeroadEnc,
  isMarkerClickRef,
  longPressTimerRef,
  isLongPressTriggeredRef,
  activeTouchCountRef,
  lastMultiTouchAtRef,
  dragTrackerRef,
  handlePointerDown,
  handlePointerMove,
  handlePointerUp,
}) => {
  const leafletDivRef = React.useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = React.useRef<L.Map | null>(null);
  const baseLayerGroupRef = React.useRef<L.LayerGroup | null>(null);
  const encLayerRef = React.useRef<L.TileLayer | null>(null);
  const zonesLayerRef = React.useRef<L.LayerGroup | null>(null);
  const overlayLayerRef = React.useRef<L.LayerGroup | null>(null);
  const markersLayerRef = React.useRef<L.LayerGroup | null>(null);
  const isSyncingRef = React.useRef(false);

  // 최신 콜백 ref 유지
  const callbacksRef = React.useRef({
    onCenterChange,
    onLevelChange,
    setPendingNewSpot,
    setContextMenuSpot,
    setDraftSweetPos,
    setDigitizerPoints,
    onSelectSpot,
    onSelectShop,
    onOpenContextMenu,
    setAdjustedPos,
  });
  callbacksRef.current = {
    onCenterChange,
    onLevelChange,
    setPendingNewSpot,
    setContextMenuSpot,
    setDraftSweetPos,
    setDigitizerPoints,
    onSelectSpot,
    onSelectShop,
    onOpenContextMenu,
    setAdjustedPos,
  };

  const stateRef = React.useRef({
    isDigitizingZones,
    isAddingSweetSpot,
    sweetSpotConfigSpot,
    castingConfigSpot,
    contextMenuSpot,
    digitalZoom,
  });
  stateRef.current = {
    isDigitizingZones,
    isAddingSweetSpot,
    sweetSpotConfigSpot,
    castingConfigSpot,
    contextMenuSpot,
    digitalZoom,
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

    baseLayerGroupRef.current = L.layerGroup().addTo(map);
    zonesLayerRef.current = L.layerGroup().addTo(map);
    overlayLayerRef.current = L.layerGroup().addTo(map);
    markersLayerRef.current = L.layerGroup().addTo(map);
    mapInstanceRef.current = map;

    map.on('moveend', () => {
      if (isSyncingRef.current) return;
      const c = map.getCenter();
      callbacksRef.current.onCenterChange({ lat: c.lat, lng: c.lng });
    });

    map.on('zoomend', () => {
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
      const { lat, lng } = ev.latlng;
      const st = stateRef.current;

      if (st.isDigitizingZones) {
        callbacksRef.current.setDigitizerPoints((prev) =>
          prev.length < 60 ? [...prev, { lat, lng }] : prev
        );
        return;
      }
      if (st.sweetSpotConfigSpot && st.isAddingSweetSpot) {
        callbacksRef.current.setDraftSweetPos({ lat, lng });
        return;
      }
      if (st.contextMenuSpot) {
        callbacksRef.current.setContextMenuSpot(null);
      }
      if (st.castingConfigSpot || st.sweetSpotConfigSpot) {
        return;
      }
      callbacksRef.current.setPendingNewSpot({ lat, lng });
    });

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      baseLayerGroupRef.current = null;
      encLayerRef.current = null;
      zonesLayerRef.current = null;
      overlayLayerRef.current = null;
      markersLayerRef.current = null;
    };
  }, []);

  // Bridge 등록 (좌표 변환 & 디지털 줌 팬)
  React.useEffect(() => {
    bridgeRef.current = {
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
      panByPixels: (dx: number, dy: number) => {
        const map = mapInstanceRef.current;
        if (!map) return;
        map.panBy([-dx / digitalZoom, -dy / digitalZoom], { animate: false });
      },
    };
  }, [bridgeRef, digitalZoom, mapContainerRef]);

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
    }
  }, [center.lat, center.lng, level]);

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
  // Vercel CDN 프록시(/api/vworld-tile)를 우선 사용하고, 프록시 장애(502 등) 시 브라우저 직접 xdworld 타일로 자동 폴백
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

  // 금지구역 폴리곤 렌더링
  React.useEffect(() => {
    const group = zonesLayerRef.current;
    if (!group) return;
    group.clearLayers();
    if (level > 6) return;

    for (const z of prohibitedZones) {
      const tier = z.properties.tier;
      const color =
        tier === 'confirmed_polygon'
          ? '#ef4444'
          : tier === 'community_reported'
          ? '#f97316'
          : '#f59e0b';
      if (z.geometry.type === 'Point') {
        const [lng, lat] = z.geometry.coordinates;
        const c = L.circle([lat, lng], {
          radius: z.properties.radius_m || 100,
          color,
          weight: 2,
          fillColor: color,
          fillOpacity: 0.25,
        }).addTo(group);
        c.bindPopup(`<div style="font-size:12px;"><strong>${z.properties.zone_name}</strong><br/>${z.properties.reason}</div>`);
        continue;
      }

      const polys =
        z.geometry.type === 'MultiPolygon' ? z.geometry.coordinates : [z.geometry.coordinates];
      for (const polyCoords of polys) {
        const rings = polyCoords.map((ring) =>
          ring.map(([lng, lat]) => [lat, lng] as [number, number])
        );
        const poly = L.polygon(rings, {
          color,
          weight: 2,
          fillColor: color,
          fillOpacity: 0.25,
        }).addTo(group);
        poly.bindPopup(
          `<div style="font-size:12px;"><strong>${z.properties.zone_name}</strong><br/>${z.properties.reason}</div>`
        );
      }
    }
  }, [level, prohibitedZones]);

  // 캐스팅 부채꼴, 동심원, 스윗스팟, 작도 폴리곤 렌더링
  React.useEffect(() => {
    const group = overlayLayerRef.current;
    if (!group) return;
    group.clearLayers();

    const targetSpot = castingConfigSpot || selectedSpot;
    if (showCastingArrows && targetSpot) {
      let startDeg = targetSpot.casting_start_deg;
      let endDeg = targetSpot.casting_end_deg;
      if (castingConfigSpot) {
        if (!tempCastingEnabled) {
          startDeg = undefined;
          endDeg = undefined;
        } else {
          startDeg = tempStartDeg;
          endDeg = tempEndDeg;
        }
      } else if (startDeg === undefined || endDeg === undefined) {
        const dirs = targetSpot.casting_directions || [];
        if (dirs.length > 0 && !dirs.includes('ALL')) {
          const info = CASTING_BEARINGS[dirs[0]];
          if (info) {
            startDeg = (info.deg - 30 + 360) % 360;
            endDeg = (info.deg + 30) % 360;
          }
        }
      }

      if (startDeg !== undefined && endDeg !== undefined) {
        const radii = tackleConfig.radii;
        const maxRadius = radii[2];
        const leftEdge = calculateDestinationPoint(targetSpot.lat, targetSpot.lng, startDeg, maxRadius);
        const rightEdge = calculateDestinationPoint(targetSpot.lat, targetSpot.lng, endDeg, maxRadius);
        L.polyline([[targetSpot.lat, targetSpot.lng], leftEdge], {
          color: '#10b981',
          weight: 1.5,
          dashArray: '4 4',
          opacity: 0.7,
        }).addTo(group);
        L.polyline([[targetSpot.lat, targetSpot.lng], rightEdge], {
          color: '#06b6d4',
          weight: 1.5,
          dashArray: '4 4',
          opacity: 0.7,
        }).addTo(group);
        for (const r of radii) {
          L.circle([targetSpot.lat, targetSpot.lng], {
            radius: r,
            color: '#22d3ee',
            weight: 1,
            opacity: 0.35,
            fillOpacity: 0.03,
          }).addTo(group);
        }
      }

      if (landingPoint && !castingConfigSpot && !sweetSpotConfigSpot && selectedSpot) {
        L.circleMarker([landingPoint.lat, landingPoint.lng], {
          radius: 6,
          color: '#f59e0b',
          fillColor: '#fbbf24',
          fillOpacity: 0.9,
          weight: 2,
        })
          .bindTooltip(`착수 ${landingPoint.distanceM}m`, { direction: 'top' })
          .addTo(group);
      }
    }

    // 스윗 스팟
    const ssSpot = sweetSpotConfigSpot || selectedSpot;
    if (ssSpot) {
      const enabled = sweetSpotConfigSpot ? tempUseSweetSpot : ssSpot.use_sweet_spot !== false;
      const list = sweetSpotConfigSpot ? tempSweetSpots : ssSpot.sweet_spots || [];
      if (enabled) {
        for (const ss of list) {
          const [sLat, sLng] = calculateDestinationPoint(ssSpot.lat, ssSpot.lng, ss.direction, ss.distance);
          L.circle([sLat, sLng], {
            radius: ss.radius,
            color: '#f59e0b',
            fillColor: '#f59e0b',
            fillOpacity: 0.18,
            weight: 1.5,
          }).addTo(group);
        }
      }
      if (draftSweetPos && sweetSpotConfigSpot) {
        L.circleMarker([draftSweetPos.lat, draftSweetPos.lng], {
          radius: 7,
          color: '#22d3ee',
          fillColor: '#06b6d4',
          fillOpacity: 0.9,
        }).addTo(group);
      }
    }

    // 금지구역 작도 미리보기
    if (isDigitizingZones && digitizerPoints.length > 0) {
      const latlngs = digitizerPoints.map((p) => [p.lat, p.lng] as [number, number]);
      if (latlngs.length >= 3) {
        L.polygon(latlngs, { color: '#fb923c', fillColor: '#fb923c', fillOpacity: 0.25, weight: 2 }).addTo(group);
      } else {
        L.polyline(latlngs, { color: '#fb923c', weight: 2 }).addTo(group);
      }
      latlngs.forEach((pt) => {
        L.circleMarker(pt, { radius: 4, color: '#fff', fillColor: '#f97316', fillOpacity: 1, weight: 1.5 }).addTo(group);
      });
    }
  }, [
    castingConfigSpot,
    digitizerPoints,
    draftSweetPos,
    isDigitizingZones,
    landingPoint,
    selectedSpot,
    showCastingArrows,
    sweetSpotConfigSpot,
    tackleConfig,
    tempCastingEnabled,
    tempEndDeg,
    tempStartDeg,
    tempSweetSpots,
    tempUseSweetSpot,
  ]);

  // 포인트 마커, 낚시점 마커, 내 위치, 미세조정 마커 렌더링
  React.useEffect(() => {
    const group = markersLayerRef.current;
    if (!group) return;
    group.clearLayers();

    for (const spot of displayedSpots) {
      const isSelected = selectedSpot?.id === spot.id;
      const isFav = favoriteSpotIds.includes(spot.id);
      const isMicroTarget = microAdjustSpot?.id === spot.id;
      if (isMicroTarget) continue;

      const badgeColor = isSelected ? '#06b6d4' : isFav ? '#f59e0b' : '#0f172a';
      const borderColor = isSelected ? '#67e8f9' : isFav ? '#fcd34d' : '#38bdf8';
      const html = `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);cursor:pointer;">
        <div style="background:${badgeColor};color:#fff;border:2px solid ${borderColor};border-radius:9999px;padding:2px 7px;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.45);">
          ${isFav ? '★ ' : ''}${spot.name}
        </div>
        <div style="width:8px;height:8px;border-radius:9999px;background:${borderColor};border:2px solid #020617;margin-top:1px;"></div>
      </div>`;

      const icon = L.divIcon({
        html,
        className: '',
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });

      const marker = L.marker([spot.lat, spot.lng], { icon }).addTo(group);
      marker.on('click', (ev) => {
        L.DomEvent.stopPropagation(ev);
        isMarkerClickRef.current = true;
        if (isLongPressTriggeredRef.current) {
          isLongPressTriggeredRef.current = false;
          return;
        }
        callbacksRef.current.onSelectSpot(spot);
      });
      marker.on('dblclick', (ev) => {
        L.DomEvent.stopPropagation(ev);
        isMarkerClickRef.current = true;
        callbacksRef.current.onOpenContextMenu(spot);
      });
      marker.on('contextmenu', (ev) => {
        L.DomEvent.stopPropagation(ev);
        isMarkerClickRef.current = true;
        callbacksRef.current.onOpenContextMenu(spot);
      });
    }

    for (const shop of shops) {
      const isSel = selectedShop?.id === shop.id;
      const html = `<div style="transform:translate(-50%,-100%);background:${isSel ? '#d97706' : '#1e293b'};color:#fde68a;border:1.5px solid #f59e0b;border-radius:8px;padding:2px 6px;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.4);">🏪 ${shop.name}</div>`;
      const icon = L.divIcon({ html, className: '', iconSize: [0, 0], iconAnchor: [0, 0] });
      const m = L.marker([shop.lat, shop.lng], { icon }).addTo(group);
      m.on('click', (ev) => {
        L.DomEvent.stopPropagation(ev);
        isMarkerClickRef.current = true;
        callbacksRef.current.onSelectShop?.(shop);
      });
    }

    if (myLocation) {
      L.circleMarker([myLocation.lat, myLocation.lng], {
        radius: 7,
        color: '#ffffff',
        fillColor: '#0ea5e9',
        fillOpacity: 1,
        weight: 2.5,
      }).addTo(group);
    }

    if (pendingNewSpot) {
      const icon = L.divIcon({
        html: `<div style="transform:translate(-50%,-100%);font-size:20px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.6));">📍</div>`,
        className: '',
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });
      L.marker([pendingNewSpot.lat, pendingNewSpot.lng], { icon }).addTo(group);
    }

    if (microAdjustSpot && adjustedPos) {
      const icon = L.divIcon({
        html: `<div style="transform:translate(-50%,-100%);background:#10b981;color:#fff;border:2px solid #fff;border-radius:9999px;padding:3px 9px;font-size:11px;font-weight:800;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.5);">🎯 ${microAdjustSpot.name} (드래그)</div>`,
        className: '',
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });
      const adj = L.marker([adjustedPos.lat, adjustedPos.lng], { icon, draggable: true }).addTo(group);
      adj.on('dragend', () => {
        const ll = adj.getLatLng();
        callbacksRef.current.setAdjustedPos({ lat: ll.lat, lng: ll.lng });
      });
    }
  }, [
    adjustedPos,
    displayedSpots,
    favoriteSpotIds,
    isLongPressTriggeredRef,
    isMarkerClickRef,
    microAdjustSpot,
    pendingNewSpot,
    selectedShop,
    selectedSpot,
    shops,
    myLocation,
  ]);

  return (
    <div
      className="relative isolate z-0 w-full h-full transition-transform duration-200 origin-center select-none"
      style={{
        transform: digitalZoom > 1.0 ? `scale(${digitalZoom})` : 'none',
        transformOrigin: 'center center',
        touchAction: digitalZoom > 1.0 ? 'none' : 'auto',
        cursor: digitalZoom > 1.0 ? (dragTrackerRef.current.isDragging ? 'grabbing' : 'grab') : 'default',
      }}
      onDragStart={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        if (digitalZoom > 1.0) {
          try {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          } catch {}
        }
        handlePointerDown(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        handlePointerMove(e.clientX, e.clientY);
      }}
      onPointerUp={(e) => {
        try {
          if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
          }
        } catch {}
        handlePointerUp();
      }}
      onPointerCancel={(e) => {
        try {
          if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
          }
        } catch {}
        handlePointerUp();
      }}
      onTouchStart={(e) => {
        activeTouchCountRef.current = e.touches.length;
        if (e.touches.length > 1) {
          lastMultiTouchAtRef.current = Date.now();
          if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
          }
        }
        if (e.touches.length === 1) {
          handlePointerDown(e.touches[0].clientX, e.touches[0].clientY);
        }
      }}
      onTouchMove={(e) => {
        activeTouchCountRef.current = e.touches.length;
        if (e.touches.length > 1) {
          lastMultiTouchAtRef.current = Date.now();
          if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
          }
        }
        if (e.touches.length === 1) {
          handlePointerMove(e.touches[0].clientX, e.touches[0].clientY);
        }
      }}
      onTouchEnd={(e) => {
        activeTouchCountRef.current = e.touches.length;
        if (e.touches.length > 0) {
          lastMultiTouchAtRef.current = Date.now();
        }
        handlePointerUp();
      }}
      onTouchCancel={() => {
        activeTouchCountRef.current = 0;
        lastMultiTouchAtRef.current = Date.now();
        handlePointerUp();
      }}
      onWheel={(e) => {
        if (level === 1) {
          onWheelDigitalZoom(e.deltaY);
        }
      }}
    >
      <div
        ref={leafletDivRef}
        className={`w-full h-full ${isDarkMode ? 'bg-slate-950' : 'bg-slate-900'}`}
      />
      <ZoneDigitizer
        active={isDigitizingZones}
        points={digitizerPoints}
        currentUser={currentUser}
        onUndo={onUndoDigitize}
        onReset={onResetDigitize}
        onCancel={onCancelDigitize}
        onSuccess={onSuccessDigitize}
      />
    </div>
  );
};
