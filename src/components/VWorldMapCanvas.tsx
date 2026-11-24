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
  expandedSweetId,
  setExpandedSweetId,
  setPendingDeleteSweetIdx,
  selectedNewRadius,
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
  isMeasuringDistance,
  measureSegments,
  measureDraftStart,
  onMeasureMapClick,
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
    onMeasureMapClick,
    setExpandedSweetId,
    setPendingDeleteSweetIdx,
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
    onMeasureMapClick,
    setExpandedSweetId,
    setPendingDeleteSweetIdx,
  };

  const stateRef = React.useRef({
    isMeasuringDistance,
    isDigitizingZones,
    isAddingSweetSpot,
    sweetSpotConfigSpot,
    castingConfigSpot,
    contextMenuSpot,
    digitalZoom,
  });
  stateRef.current = {
    isMeasuringDistance,
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

    // VWorld 축척 바 (좌하단, 미터법 전용)
    L.control.scale({ metric: true, imperial: false, position: 'bottomleft', maxWidth: 120 }).addTo(map);

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

      if (st.isMeasuringDistance) {
        callbacksRef.current.onMeasureMapClick(lat, lng);
        return;
      }
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
        const rawSpan = (endDeg - startDeg + 360) % 360;
        const span = rawSpan === 0 ? 360 : rawSpan;
        const centerBearing = (startDeg + span / 2) % 360;
        const step = Math.max(1, Math.min(3, Math.round(span / 25)));

        // 반투명 부채꼴 섹터 채우기
        const sectorPolygonPoints: [number, number][] = [[targetSpot.lat, targetSpot.lng]];
        for (let offset = 0; offset <= span; offset += step) {
          const b = (startDeg + offset) % 360;
          sectorPolygonPoints.push(calculateDestinationPoint(targetSpot.lat, targetSpot.lng, b, maxRadius));
        }
        sectorPolygonPoints.push(calculateDestinationPoint(targetSpot.lat, targetSpot.lng, endDeg, maxRadius));
        L.polygon(sectorPolygonPoints, {
          stroke: false,
          fillColor: '#06b6d4',
          fillOpacity: 0.09,
          interactive: false,
        }).addTo(group);

        // 좌우 유효 경계선
        const leftEdge = calculateDestinationPoint(targetSpot.lat, targetSpot.lng, startDeg, maxRadius);
        const rightEdge = calculateDestinationPoint(targetSpot.lat, targetSpot.lng, endDeg, maxRadius);
        L.polyline([[targetSpot.lat, targetSpot.lng], leftEdge], {
          color: '#10b981',
          weight: 1.5,
          dashArray: '4 4',
          opacity: 0.75,
          interactive: false,
        }).addTo(group);
        L.polyline([[targetSpot.lat, targetSpot.lng], rightEdge], {
          color: '#06b6d4',
          weight: 1.5,
          dashArray: '4 4',
          opacity: 0.75,
          interactive: false,
        }).addTo(group);

        // 거리(radii)별 부채꼴 호(Arc) 및 거리 라벨
        radii.forEach((r, rIdx) => {
          const arcPoints: [number, number][] = [];
          for (let offset = 0; offset <= span; offset += step) {
            const b = (startDeg! + offset) % 360;
            arcPoints.push(calculateDestinationPoint(targetSpot.lat, targetSpot.lng, b, r));
          }
          arcPoints.push(calculateDestinationPoint(targetSpot.lat, targetSpot.lng, endDeg!, r));

          L.polyline(arcPoints, {
            color: '#06b6d4',
            weight: rIdx === 0 ? 2 : 1.5,
            opacity: rIdx === 0 ? 0.85 : rIdx === 1 ? 0.65 : 0.45,
            dashArray: '5 4',
            interactive: false,
          }).addTo(group);

          const [labelLat, labelLng] = calculateDestinationPoint(
            targetSpot.lat,
            targetSpot.lng,
            centerBearing,
            r
          );
          const distIcon = L.divIcon({
            html: `<div style="transform:translate(-50%,-50%);padding:1px 6px;border-radius:9999px;background:rgba(2,6,23,0.9);color:#67e8f9;border:1px solid rgba(34,211,238,0.6);font-size:10px;font-weight:700;font-family:ui-monospace,monospace;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.45);pointer-events:none;">${r}m</div>`,
            className: '',
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          });
          L.marker([labelLat, labelLng], { icon: distIcon, interactive: false }).addTo(group);
        });
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
    const isSweetConfig = !!sweetSpotConfigSpot;
    const ssSpot = sweetSpotConfigSpot || selectedSpot;
    if (ssSpot) {
      const enabled = isSweetConfig ? tempUseSweetSpot : (ssSpot.use_sweet_spot ?? false);
      const list = isSweetConfig ? tempSweetSpots : ssSpot.sweet_spots || [];
      if (enabled) {
        list.forEach((ss, idx) => {
          const [sLat, sLng] = calculateDestinationPoint(ssSpot.lat, ssSpot.lng, ss.direction, ss.distance);

          // 포인트 -> 스윗스팟 연결 점선
          L.polyline(
            [
              [ssSpot.lat, ssSpot.lng],
              [sLat, sLng],
            ],
            {
              color: '#f59e0b',
              weight: 1.5,
              dashArray: '4 4',
              opacity: 0.7,
              interactive: false,
            }
          ).addTo(group);

          // 스윗 스팟 반경 원
          L.circle([sLat, sLng], {
            radius: ss.radius,
            color: '#f59e0b',
            fillColor: '#f59e0b',
            fillOpacity: 0.32,
            weight: 2,
            opacity: 0.9,
            interactive: false,
          }).addTo(group);

          // 스윗 스팟 거리/메모 배지 (설정 모드 시 삭제 버튼 포함)
          const ssKey = ss.id || `idx-${idx}`;
          const isExpanded = expandedSweetId === ssKey;
          const rawMemo = (ss.memo || '').replace(/[<>&"']/g, (ch) =>
            ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[ch] || ch)
          );
          const shortMemo = rawMemo.length > 10 ? `${rawMemo.slice(0, 10)}…` : rawMemo;
          const deleteBtnHtml = isSweetConfig
            ? `<span data-ss-delete="${idx}" style="margin-left:3px;padding:0 4px;border-radius:4px;background:#e11d48;color:#fff;font-weight:700;font-size:9px;cursor:pointer;">✕ 삭제</span>`
            : '';
          const memoBoxHtml =
            isExpanded && rawMemo
              ? `<div style="margin-top:2px;padding:3px 7px;border-radius:8px;background:rgba(2,6,23,0.95);color:#fde68a;border:1px solid rgba(245,158,11,0.6);font-size:10px;max-width:180px;white-space:normal;word-break:break-word;text-align:center;">${rawMemo}</div>`
              : '';
          const ssIcon = L.divIcon({
            html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%);cursor:pointer;white-space:nowrap;">
              <div style="padding:2px 7px;border-radius:9999px;background:#f59e0b;color:#020617;font-size:10px;font-weight:900;border:1px solid rgba(255,255,255,0.85);box-shadow:0 3px 10px rgba(0,0,0,0.45);display:flex;align-items:center;gap:4px;">
                <span>${ss.distance}m</span>
                ${shortMemo && !isExpanded ? `<span style="font-weight:600;">${shortMemo}</span>` : ''}
                ${deleteBtnHtml}
              </div>
              ${memoBoxHtml}
            </div>`,
            className: '',
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          });
          const ssMarker = L.marker([sLat, sLng], { icon: ssIcon }).addTo(group);
          ssMarker.on('click', (ev) => {
            L.DomEvent.stopPropagation(ev);
            isMarkerClickRef.current = true;
            const targetEl = (ev.originalEvent?.target as HTMLElement | null)?.closest?.('[data-ss-delete]');
            if (targetEl && isSweetConfig) {
              callbacksRef.current.setPendingDeleteSweetIdx(idx);
              return;
            }
            callbacksRef.current.setExpandedSweetId((prev) => (prev === ssKey ? null : ssKey));
          });
        });
      }
      if (draftSweetPos && sweetSpotConfigSpot && isAddingSweetSpot) {
        L.circle([draftSweetPos.lat, draftSweetPos.lng], {
          radius: selectedNewRadius,
          color: '#22d3ee',
          fillColor: '#06b6d4',
          fillOpacity: 0.25,
          weight: 2,
          dashArray: '4 4',
          interactive: false,
        }).addTo(group);
        L.circleMarker([draftSweetPos.lat, draftSweetPos.lng], {
          radius: 6,
          color: '#ffffff',
          fillColor: '#06b6d4',
          fillOpacity: 1,
          weight: 2,
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

    // 거리 측정 다중 선분 및 끝점 거리(m) 표기
    if (measureSegments.length > 0) {
      measureSegments.forEach((seg) => {
        L.polyline(
          [
            [seg.start.lat, seg.start.lng],
            [seg.end.lat, seg.end.lng],
          ],
          {
            color: '#38bdf8',
            weight: 2.5,
            dashArray: '6 4',
            opacity: 0.95,
            interactive: false,
          }
        ).addTo(group);
        L.circleMarker([seg.start.lat, seg.start.lng], {
          radius: 4.5,
          color: '#ffffff',
          fillColor: '#0284c7',
          fillOpacity: 1,
          weight: 2,
          interactive: false,
        }).addTo(group);
        L.circleMarker([seg.end.lat, seg.end.lng], {
          radius: 4.5,
          color: '#ffffff',
          fillColor: '#06b6d4',
          fillOpacity: 1,
          weight: 2,
          interactive: false,
        }).addTo(group);

        const distLabelIcon = L.divIcon({
          html: `<div style="transform:translate(8px,-50%);padding:2px 7px;border-radius:9999px;background:rgba(2,6,23,0.92);color:#67e8f9;border:1.5px solid #38bdf8;font-size:11px;font-weight:800;font-family:ui-monospace,monospace;white-space:nowrap;box-shadow:0 3px 10px rgba(0,0,0,0.55);pointer-events:none;">${seg.distanceM.toLocaleString()}m</div>`,
          className: '',
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        });
        L.marker([seg.end.lat, seg.end.lng], { icon: distLabelIcon, interactive: false }).addTo(group);
      });
    }

    if (measureDraftStart) {
      L.circleMarker([measureDraftStart.lat, measureDraftStart.lng], {
        radius: 6,
        color: '#ffffff',
        fillColor: '#f59e0b',
        fillOpacity: 1,
        weight: 2,
        interactive: false,
      }).addTo(group);
      const startIcon = L.divIcon({
        html: `<div style="transform:translate(-50%,-150%);padding:1px 6px;border-radius:9999px;background:rgba(2,6,23,0.9);color:#fcd34d;border:1px solid #f59e0b;font-size:10px;font-weight:700;white-space:nowrap;pointer-events:none;">시작점</div>`,
        className: '',
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });
      L.marker([measureDraftStart.lat, measureDraftStart.lng], { icon: startIcon, interactive: false }).addTo(group);
    }
  }, [
    castingConfigSpot,
    digitizerPoints,
    draftSweetPos,
    expandedSweetId,
    isAddingSweetSpot,
    isDigitizingZones,
    isMarkerClickRef,
    landingPoint,
    measureDraftStart,
    measureSegments,
    selectedNewRadius,
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
      className={`relative isolate z-0 w-full h-full transition-transform duration-200 origin-center select-none ${
        isDarkMode ? 'bg-slate-950' : 'bg-slate-900'
      }`}
      style={{
        transform: digitalZoom > 1.0 ? `scale(${digitalZoom})` : 'none',
        transformOrigin: 'center center',
        touchAction: digitalZoom > 1.0 ? 'none' : 'auto',
        cursor: isMeasuringDistance
          ? 'crosshair'
          : digitalZoom > 1.0
          ? dragTrackerRef.current.isDragging
            ? 'grabbing'
            : 'grab'
          : 'default',
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
      {/* Leaflet 컨테이너의 className은 반드시 정적으로 유지해야 isDarkMode 전환 시 .leaflet-container 클래스가 소실되지 않음 */}
      <div
        ref={leafletDivRef}
        className="w-full h-full"
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
