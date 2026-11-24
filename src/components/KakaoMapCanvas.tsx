import React from 'react';
import {
  Map,
  MapMarker,
  CustomOverlayMap,
  Polyline,
  Circle,
} from 'react-kakao-maps-sdk';
import { Store } from 'lucide-react';
import { MaterialSpotMarker } from './MaterialSpotMarker';
import { HaeRoadEncOverlay } from './HaeRoadEncOverlay';
import { ProhibitedZoneOverlay } from './ProhibitedZoneOverlay';
import { ZoneDigitizer } from './ZoneDigitizer';
import { formatWindSpeed, formatCurrentVelocity } from '../utils/weatherApi';
import { getTackleShortLabel, calculateSinkingPhysics, calculateAerodynamicCastingDrift, solveLeadCastAimPoint } from '../utils/tackleCalibration';
import { findNearestKhoaStation } from '../utils/tideService';
import { resolveUnifiedWaterDepth } from '../utils/depthSinkEngine';
import { triggerHaptic } from '../utils/nativeBridge';
import { calculateDestinationPoint, calculateDistanceAndBearing, CASTING_BEARINGS, type SharedMapCanvasProps } from './mapCanvasTypes';

export const KakaoMapCanvas: React.FC<SharedMapCanvasProps> = ({
  center,
  level,
  digitalZoom,
  mapMode,
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
  isDraggingAdjustMarkerRef,
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
  weather,
  marine,
  tide,
  windUnit,
  currentUnit,
  landingPoint,
  landingKhoaDepth,
  myLocation,
  gpsAccuracy,
  expandedSweetId,
  setExpandedSweetId,
  setPendingDeleteSweetIdx,
  selectedNewRadius,
  pressStartPosRef,
  isCoarsePointer,
  skipAutoRecenterRef,
  onOpenDetail,
  prohibitedZones,
  currentUser,
  onZonesMutated,
  isDigitizingZones,
  digitizerPoints,
  setDigitizerPoints,
  onUndoDigitize,
  onResetDigitize,
  onCancelDigitize,
  onSuccessDigitize,
  isStrictAdmin,
  showHaeroadEnc,
  isMeasuringDistance,
  measureSegments,
  measureDraftStart,
  onMeasureMapClick,
  isMarkerClickRef,
  lastClientPosRef,
  longPressTimerRef,
  isLongPressTriggeredRef,
  activeTouchCountRef,
  lastMultiTouchAtRef,
  dragTrackerRef,
  handlePointerDown,
  handlePointerMove,
  handlePointerUp,
}) => {
  const mapRef = React.useRef<any>(null);

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
      if (!mapRef.current) return null;
      const map = mapRef.current;
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

  React.useEffect(() => {
    bridgeRef.current = {
      latLngToScreen: (lat: number, lng: number) => {
        if (!mapRef.current) return null;
        const map = mapRef.current;
        const proj = map.getProjection ? map.getProjection() : null;
        if (!proj || !(window as any).kakao?.maps?.LatLng) return null;
        const container = map.getNode ? map.getNode() : null;
        if (!container) return null;
        const rect = container.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const latLng = new (window as any).kakao.maps.LatLng(lat, lng);
        const containerPoint = proj.containerPointFromCoords(latLng);
        if (!containerPoint) return null;
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
        }
      },
    };
  }, [bridgeRef, digitalZoom, getCorrectLatLngFromClient, mapContainerRef]);

  return (
      <div
        className="relative isolate z-0 w-full h-full transition-transform duration-200 origin-center select-none"
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
        onWheel={(e) => { if (level === 1) onWheelDigitalZoom(e.deltaY); }}
      >
        <div className="w-full h-full kakao-dark-target">
        <Map
          onCreate={(map) => {
            mapRef.current = map;
          }}
          draggable={digitalZoom === 1.0}
          zoomable={digitalZoom === 1.0}
          center={center}
          level={level}
          mapTypeId={kakaoMapTypeId}
          style={{ width: '100%', height: '100%' }}
          onClick={(_target, mouseEvent) => {
            // 마커나 팝업 클릭 시 지도 클릭 핸들러가 발화되는 관통 현상 원천 차단
            if (isMarkerClickRef.current) {
              isMarkerClickRef.current = false;
              return;
            }
            // 디지털 줌 드래그 중 실수 클릭 차단
            if (dragTrackerRef.current.totalDist > 6) {
              dragTrackerRef.current.totalDist = 0;
              return;
            }

            const latLng = mouseEvent.latLng;
            let clickedLat = latLng.getLat();
            let clickedLng = latLng.getLng();

            // [요구사항 4] 디지털 줌 상태에서는 CSS scale 역산을 통해 실제 클릭/터치한 정확한 위경도 산출
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

            // 거리 측정 모드: 두 지점을 순서대로 클릭하여 다중 선분 생성
            if (isMeasuringDistance) {
              onMeasureMapClick(clickedLat, clickedLng);
              return;
            }

            // 금지구역 다각형 작도 모드: 클릭 좌표를 꼭짓점으로 추가하고 새 포인트 핀 방지
            if (isDigitizingZones) {
              setDigitizerPoints((prev) => (prev.length < 60 ? [...prev, { lat: clickedLat, lng: clickedLng }] : prev));
              return;
            }

            // [요구사항 2-1-6] 스윗 스팟 추가 모드: 지도를 누를 때마다 초안 위치 변경 ('추가' 버튼으로 최종 승인)
            if (sweetSpotConfigSpot && isAddingSweetSpot) {
              setDraftSweetPos({ lat: clickedLat, lng: clickedLng });
              return;
            }

            // 컨텍스트 메뉴 닫기
            if (contextMenuSpot) {
              setContextMenuSpot(null);
            }

            // 캐스팅/스윗스팟 설정 모드 중에는 새 포인트 등록 핀 방지
            if (castingConfigSpot || sweetSpotConfigSpot) {
              return;
            }

            // 지도 빈 공간 클릭 시 바로 모달을 열지 않고 '미니 확인 팝업'을 띄워 실수 터치 방지
            setPendingNewSpot({ lat: clickedLat, lng: clickedLng });
          }}
        onZoomChanged={(target) => {
          onLevelChange(target.getLevel());
        }}
        onCenterChanged={(target) => {
          const latLng = target.getCenter();
          onCenterChange({ lat: latLng.getLat(), lng: latLng.getLng() });
        }}
      >
        {/* 선택된 포인트의 캐스팅 비거리 동심원 눈금 링 및 유효 공략 부채꼴 섹터 (채비 캘리브레이션 거리 반영) */}
        {showCastingArrows && (selectedSpot || castingConfigSpot) && (() => {
          const targetSpot = castingConfigSpot || selectedSpot;
          if (!targetSpot) return null;

          let startDeg = targetSpot.casting_start_deg;
          let endDeg = targetSpot.casting_end_deg;

          // [요구사항 4-3] 캐스팅 방향 설정 모드 실시간 각도 반영
          if (castingConfigSpot) {
            if (!tempCastingEnabled) return null;
            startDeg = tempStartDeg;
            endDeg = tempEndDeg;
          } else {
            // 레거시 하위 호환 매핑
            if (startDeg === undefined || endDeg === undefined) {
              const dirs = targetSpot.casting_directions || [];
              if (dirs.length > 0 && !dirs.includes('ALL')) {
                const info = CASTING_BEARINGS[dirs[0]];
                if (info) {
                  startDeg = (info.deg - 30 + 360) % 360;
                  endDeg = (info.deg + 30) % 360;
                }
              }
            }
          }

          if (startDeg === undefined || endDeg === undefined) {
            return null;
          }

          const span = endDeg >= startDeg ? endDeg - startDeg : 360 - startDeg + endDeg;
          const centerBearing = (startDeg + span / 2) % 360;
          const radii = tackleConfig.radii;
          const maxRadius = radii[2];

          // 좌우 유효 경계선 (최대 비거리 지점까지 뻗어나가는 레이더 가이드 선)
          const leftEdge = calculateDestinationPoint(targetSpot.lat, targetSpot.lng, startDeg, maxRadius);
          const rightEdge = calculateDestinationPoint(targetSpot.lat, targetSpot.lng, endDeg, maxRadius);

          return (
            <React.Fragment key={`range-sector-${targetSpot.id}`}>
              {/* 시작각 경계선 */}
              <Polyline
                path={[
                  { lat: targetSpot.lat, lng: targetSpot.lng },
                  { lat: leftEdge[0], lng: leftEdge[1] },
                ]}
                strokeWeight={1.5}
                strokeColor="#10b981"
                strokeOpacity={0.65}
                strokeStyle="dash"
                zIndex={28}
              />

              {/* 종료각 경계선 */}
              <Polyline
                path={[
                  { lat: targetSpot.lat, lng: targetSpot.lng },
                  { lat: rightEdge[0], lng: rightEdge[1] },
                ]}
                strokeWeight={1.5}
                strokeColor="#06b6d4"
                strokeOpacity={0.65}
                strokeStyle="dash"
                zIndex={28}
              />

              {/* 거리(30m / 60m / 100m)별 부채꼴 호 및 거리 라벨 오버레이 */}
              {radii.map((r, rIdx) => {
                const step = Math.max(1, Math.min(3, Math.round(span / 25)));
                const arcPoints: { lat: number; lng: number }[] = [];
                for (let offset = 0; offset <= span; offset += step) {
                  const b = (startDeg! + offset) % 360;
                  const [pLat, pLng] = calculateDestinationPoint(targetSpot.lat, targetSpot.lng, b, r);
                  arcPoints.push({ lat: pLat, lng: pLng });
                }
                const [endLat, endLng] = calculateDestinationPoint(targetSpot.lat, targetSpot.lng, endDeg!, r);
                arcPoints.push({ lat: endLat, lng: endLng });

                // 호 중심 지점에 거리 m 표기 오버레이
                const [labelLat, labelLng] = calculateDestinationPoint(targetSpot.lat, targetSpot.lng, centerBearing, r);

                return (
                  <React.Fragment key={`arc-r-${targetSpot.id}-${r}`}>
                    <Polyline
                      path={arcPoints}
                      strokeWeight={rIdx === 0 ? 2 : 1.5}
                      strokeColor="#06b6d4"
                      strokeOpacity={rIdx === 0 ? 0.85 : rIdx === 1 ? 0.6 : 0.4}
                      strokeStyle="dash"
                      zIndex={30}
                    />
                    <CustomOverlayMap
                      position={{ lat: labelLat, lng: labelLng }}
                      yAnchor={0.5}
                      xAnchor={0.5}
                      zIndex={35}
                      clickable={false}
                    >
                      <div className="px-1.5 py-0.5 rounded-full bg-slate-950/90 text-cyan-300 border border-cyan-400/60 text-[9px] font-bold font-mono shadow-md backdrop-blur-xs select-none pointer-events-none kakao-invert-restore whitespace-nowrap">
                        {r}m
                      </div>
                    </CustomOverlayMap>
                  </React.Fragment>
                );
              })}
            </React.Fragment>
          );
        })()}

        {/* 선택된 포인트의 파란색 캐스팅 방향 화살표 + 실시간 바람·조류 상호작용 HUD (설정 모드 시 비거리/풍속/조류 HUD 제거) */}
        {showCastingArrows && selectedSpot && !castingConfigSpot && !sweetSpotConfigSpot && (() => {
          let startDeg = selectedSpot.casting_start_deg;
          let endDeg = selectedSpot.casting_end_deg;

          // 레거시 하위 호환 매핑
          if (startDeg === undefined || endDeg === undefined) {
            const dirs = selectedSpot.casting_directions || [];
            if (dirs.length > 0 && !dirs.includes('ALL')) {
              const info = CASTING_BEARINGS[dirs[0]];
              if (info) {
                startDeg = (info.deg - 30 + 360) % 360;
                endDeg = (info.deg + 30) % 360;
              }
            }
          }

          // [요구사항 2-4] 캐스팅 방향이 없으면(보이지 않으면) 예상 비거리 관련 표시 생략, 풍향·풍속·조류는 유지
          const hasCasting = startDeg !== undefined && endDeg !== undefined;

          if (startDeg === undefined || endDeg === undefined) {
            startDeg = 45;
            endDeg = 135;
          }

          const span = endDeg >= startDeg ? endDeg - startDeg : 360 - startDeg + endDeg;
          const bearing = (startDeg + span / 2) % 360; // 중심 방위각

          const baseDist = tackleConfig.calibratedDistanceMeters;
          const tipDist = Math.max(8, Math.round(baseDist));
          const tip = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, bearing, tipDist);
          // 캐스팅 레이더 정면(착수) 지점에 수심 + 선택 채비 안착 시간 배지 배치 (화살표·조류선 겹침 회피)
          const badgePos = calculateDestinationPoint(
            selectedSpot.lat,
            selectedSpot.lng,
            bearing,
            tipDist + 6
          );
          const badgeYAnchor = bearing > 110 && bearing < 250 ? -0.15 : 1.25;

          // 착수 지점 수심 통합 연산 (착수점 KHOA 150m 실측 수심 + 현 시각 조위 + 역기압)
          const curHourNow = new Date().getHours();
          const curTidePt =
            tide?.hourlyCurve?.find((c) => c.isCurrent || c.hour === curHourNow) ||
            tide?.hourlyCurve?.[0];
          const nearestSt = findNearestKhoaStation(selectedSpot.lat, selectedSpot.lng);
          const landingDepthInfo = resolveUnifiedWaterDepth({
            spotLat: selectedSpot.lat,
            spotLng: selectedSpot.lng,
            targetLat: tip[0],
            targetLng: tip[1],
            spotType: selectedSpot.spot_type,
            khoaDpwt: landingKhoaDepth?.dpwt ?? null,
            khoaDpwtIsAtTarget: true,
            datumZ0: nearestSt.station.datumZ0,
            tideHeightCm: curTidePt?.height,
            pressureHpa: weather?.pressureHpa,
            isPredictedTide: true,
          });
          const landingDepth = landingDepthInfo.realDepthM;

          // 방향성(Δθ) 반영 수중 침강 물리 및 조류 연동 바닥 안착 시간/흘림 계산
          const currentVel = marine?.currentVelocity ?? 0.3;
          const sinkPhysics = calculateSinkingPhysics(
            tackleConfig.weightGrams,
            landingDepth,
            currentVel,
            tackleConfig.baitConfig,
            {
              castBearingDeg: bearing,
              currentDirectionDeg: marine?.currentDirection,
              peLineSize: tackleConfig.peLineSize,
              honorFloatLayer: true,
            }
          );

          const leadAim = solveLeadCastAimPoint(
            bearing,
            tipDist,
            weather?.windSpeed ?? 0,
            weather?.windDirection ?? 0,
            currentVel,
            marine?.currentDirection ?? bearing,
            Math.max(1.0, landingDepth),
            tackleConfig
          );

          // 수중 침강 중 채비가 실제로 흘러가는 궤적 (착수점 -> 수중 조류 방향 흘림)
          const hasSubsurfaceDrift =
            sinkPhysics.driftDistanceM >= 1.5 && marine?.currentDirection != null;
          const driftPreviewDist = Math.min(35, sinkPhysics.driftDistanceM);
          const subsurfaceEnd = hasSubsurfaceDrift
            ? calculateDestinationPoint(tip[0], tip[1], marine!.currentDirection, driftPreviewDist)
            : null;

          const castingLines = (
            <React.Fragment key={`selected-casting-${selectedSpot.id}`}>
              <Polyline
                path={[
                  { lat: selectedSpot.lat, lng: selectedSpot.lng },
                  { lat: tip[0], lng: tip[1] },
                ]}
                endArrow={true}
                strokeWeight={4.5}
                strokeColor="#2563eb"
                strokeOpacity={0.95}
                zIndex={50}
              />
              {subsurfaceEnd && (
                <Polyline
                  path={[
                    { lat: tip[0], lng: tip[1] },
                    { lat: subsurfaceEnd[0], lng: subsurfaceEnd[1] },
                  ]}
                  endArrow={true}
                  strokeWeight={2.5}
                  strokeColor="#22d3ee"
                  strokeOpacity={0.85}
                  strokeStyle="shortdash"
                  zIndex={51}
                />
              )}
              <CustomOverlayMap
                position={{ lat: badgePos[0], lng: badgePos[1] }}
                yAnchor={badgeYAnchor}
                xAnchor={0.5}
                zIndex={58}
                clickable={false}
              >
                <div className="pointer-events-none kakao-invert-restore select-none max-w-[260px] sm:max-w-none">
                  <div className="px-2.5 py-1 rounded-xl bg-slate-950/95 text-cyan-300 border border-cyan-500/80 text-[9px] sm:text-[10px] font-mono font-bold shadow-lg flex flex-col items-center justify-center leading-tight gap-0.5 whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <span className="text-sky-200">{getTackleShortLabel(tackleConfig)}</span>
                      <span>
                        {landingDepthInfo.isExposed ? '간출(0m)' : `수심 ${landingDepth.toFixed(1)}m`}
                      </span>
                      {sinkPhysics.driftDistanceM > 0.3 && (
                        <span className="text-emerald-300">, 흘림 +{sinkPhysics.driftDistanceM}m</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-amber-300">안착 {sinkPhysics.fallTimeSec}초</span>
                      <span className="text-cyan-200">
                        하강 {Math.round(sinkPhysics.effSinkSpeedMps * 100)}cm/s
                      </span>
                      {sinkPhysics.canReachBottom === false && (
                        <span className="text-rose-400">· {sinkPhysics.recommendedMinWeightG}g+ 권장</span>
                      )}
                    </div>
                  </div>
                </div>
              </CustomOverlayMap>
            </React.Fragment>
          );

          // 2. 실시간 풍향·풍속 및 합사줄(PE) 길이/두께 + 미끼 형상 공기역학 편류(밀림) 오렌지 라인
          // weather.windDirection: 바람이 불어오는 방위 (From)
          // windVectorDeg: 바람이 불어가는 진행 방위 (To) = (windDirection + 180) % 360
          let windElements = null;
          if (weather) {
            const windVectorDeg = (weather.windDirection + 180) % 360;
            const rigWeight = tackleConfig.totalWeightGrams ?? tackleConfig.weightGrams;
            const wormLenInches = tackleConfig.baitConfig?.lengthInches ?? 2;
            const peLine = tackleConfig.peLineSize;

            // 공략각 시점, 중간, 종점 3개 포인트에 대한 정밀 편류(Drift) 물리 계산 (미끼 형상 공기항력 반영)
            const midDeg = (startDeg + span / 2) % 360;
            const driftStart = calculateAerodynamicCastingDrift(startDeg, baseDist, weather.windSpeed, weather.windDirection, rigWeight, peLine, wormLenInches, tackleConfig.baitConfig);
            const driftMid = calculateAerodynamicCastingDrift(midDeg, baseDist, weather.windSpeed, weather.windDirection, rigWeight, peLine, wormLenInches, tackleConfig.baitConfig);
            const driftEnd = calculateAerodynamicCastingDrift(endDeg, baseDist, weather.windSpeed, weather.windDirection, rigWeight, peLine, wormLenInches, tackleConfig.baitConfig);

            // 공략각 시점~종점 전체 구간에서 바람/합사줄에 의해 밀린 실제 착수 지점들을 이은 오렌지색 arc 폴리라인 생성
            const orangeArcPts: { lat: number; lng: number }[] = [];
            const targetArcPts: { lat: number; lng: number }[] = [];
            const arcStep = Math.max(1, Math.min(3, Math.round(span / 30)));
            for (let offset = 0; offset <= span; offset += arcStep) {
              const b = (startDeg + offset) % 360;
              const dRes = calculateAerodynamicCastingDrift(b, baseDist, weather.windSpeed, weather.windDirection, rigWeight, peLine, wormLenInches, tackleConfig.baitConfig);
              // 실제 밀린 착수 좌표
              const [pActualLat, pActualLng] = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, dRes.actualBearingDeg, dRes.actualDistanceM);
              orangeArcPts.push({ lat: pActualLat, lng: pActualLng });
              // 원래 목표했던 착수 좌표 (보조 기준선)
              const [pTargetLat, pTargetLng] = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, b, dRes.targetDistanceM);
              targetArcPts.push({ lat: pTargetLat, lng: pTargetLng });
            }
            // 종점 마무리 포인트
            const [pEndActualLat, pEndActualLng] = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, driftEnd.actualBearingDeg, driftEnd.actualDistanceM);
            orangeArcPts.push({ lat: pEndActualLat, lng: pEndActualLng });
            const [pEndTargetLat, pEndTargetLng] = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, endDeg, driftEnd.targetDistanceM);
            targetArcPts.push({ lat: pEndTargetLat, lng: pEndTargetLng });

            // 3개 포인트의 실제 밀린 착수 좌표 (오렌지 라인 위에 위치)
            const ptStartActual = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, driftStart.actualBearingDeg, driftStart.actualDistanceM);
            const ptMidActual = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, driftMid.actualBearingDeg, driftMid.actualDistanceM);
            const ptEndActual = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, driftEnd.actualBearingDeg, driftEnd.actualDistanceM);

            // 3개 포인트의 원래 목표 좌표
            const ptStartTarget = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, startDeg, driftStart.targetDistanceM);
            const ptMidTarget = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, midDeg, driftMid.targetDistanceM);
            const ptEndTarget = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, endDeg, driftEnd.targetDistanceM);

            // 바람 진행 벡터 화살표 (바람이 불어가는 방향으로 45m 뻗어감)
            const windTip = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, windVectorDeg, 45);
            const windBadgePos = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, windVectorDeg, 48);

            windElements = (
              <React.Fragment key={`wind-physics-${selectedSpot.id}`}>
                {/* 1. 바람 진행 벡터 화살표 ([요구사항 7] 바람 화살표 두께 축소 3.5 -> 2.2) */}
                <Polyline
                  path={[
                    { lat: selectedSpot.lat, lng: selectedSpot.lng },
                    { lat: windTip[0], lng: windTip[1] },
                  ]}
                  endArrow={true}
                  strokeWeight={2.2}
                  strokeColor="#38bdf8"
                  strokeOpacity={0.9}
                  zIndex={45}
                />
                <CustomOverlayMap
                  position={{ lat: windBadgePos[0], lng: windBadgePos[1] }}
                  yAnchor={0.5}
                  xAnchor={0.5}
                  zIndex={55}
                  clickable={false}
                >
                  <div className="px-2 py-0.5 rounded-full text-[9px] font-bold font-mono shadow-xl border pointer-events-none kakao-invert-restore select-none whitespace-nowrap flex items-center gap-1 bg-slate-950/95 text-cyan-300 border-cyan-400/80">
                    <span className="inline-block text-[10px]" style={{ transform: `rotate(${weather.windDirection}deg)` }}>↓</span>
                    <span>{formatWindSpeed(weather.windSpeed, windUnit)}</span>
                  </div>
                </CustomOverlayMap>

                {hasCasting && (<>
                {/* 2. 바람 없을 때의 원래 목표 호선 (은은한 점선 기준선) */}
                <Polyline
                  path={targetArcPts}
                  strokeWeight={1.5}
                  strokeColor="#94a3b8"
                  strokeOpacity={0.35}
                  strokeStyle="dashed"
                  zIndex={41}
                />

                {/* 3. 목표 지점 -> 실제 착수 지점 사이의 밀림 편류 가이드 선 (밀림 1m 이상 시 표시) */}
                {[
                  { target: ptStartTarget, actual: ptStartActual, drift: driftStart },
                  { target: ptMidTarget, actual: ptMidActual, drift: driftMid },
                  { target: ptEndTarget, actual: ptEndActual, drift: driftEnd },
                ].map((item, idx) =>
                  item.drift.driftDistanceM >= 1.0 ? (
                    <Polyline
                      key={`drift-offset-${idx}`}
                      path={[
                        { lat: item.target[0], lng: item.target[1] },
                        { lat: item.actual[0], lng: item.actual[1] },
                      ]}
                      strokeWeight={1.5}
                      strokeColor="#fbbf24"
                      strokeOpacity={0.7}
                      strokeStyle="dashed"
                      zIndex={43}
                    />
                  ) : null
                )}

                {/* 4. 풍향·풍속 및 합사/채비 공기역학으로 밀린 실제 착수 오렌지색 arc */}
                <Polyline
                  path={orangeArcPts}
                  strokeWeight={3.5}
                  strokeColor="#f97316"
                  strokeOpacity={0.95}
                  zIndex={42}
                />

                {/* 5. 시점 착수점 배지 (오렌지 라인 위에 정확히 표시) */}
                <CustomOverlayMap
                  position={{ lat: ptStartActual[0], lng: ptStartActual[1] }}
                  yAnchor={0.5}
                  xAnchor={0.5}
                  zIndex={48}
                  clickable={false}
                >
                  <div className="px-2.5 py-1 rounded-full bg-slate-950/95 text-orange-400 border border-orange-500 font-extrabold font-mono text-xs sm:text-sm shadow-xl pointer-events-none kakao-invert-restore select-none whitespace-nowrap flex items-center gap-1.5">
                    <span>{driftStart.actualDistanceM}m</span>
                    {driftStart.driftDistanceM >= 1.0 && (
                      <span className="text-[10.5px] text-amber-300 font-semibold">
                        ({driftStart.driftAngleDeg > 0 ? '우' : '좌'} {driftStart.driftDistanceM}m)
                      </span>
                    )}
                  </div>
                </CustomOverlayMap>

                {/* 6. 중간 착수점 배지 */}
                <CustomOverlayMap
                  position={{ lat: ptMidActual[0], lng: ptMidActual[1] }}
                  yAnchor={0.5}
                  xAnchor={0.5}
                  zIndex={48}
                  clickable={false}
                >
                  <div className="px-2.5 py-1 rounded-full bg-slate-950/95 text-orange-400 border border-orange-500 font-extrabold font-mono text-xs sm:text-sm shadow-xl pointer-events-none kakao-invert-restore select-none whitespace-nowrap flex items-center gap-1.5">
                    <span>{driftMid.actualDistanceM}m</span>
                    {driftMid.driftDistanceM >= 1.0 && (
                      <span className="text-[10.5px] text-amber-300 font-semibold">
                        ({driftMid.driftAngleDeg > 0 ? '우' : '좌'} {driftMid.driftDistanceM}m)
                      </span>
                    )}
                  </div>
                </CustomOverlayMap>

                {/* 7. 종점 착수점 배지 */}
                <CustomOverlayMap
                  position={{ lat: ptEndActual[0], lng: ptEndActual[1] }}
                  yAnchor={0.5}
                  xAnchor={0.5}
                  zIndex={48}
                  clickable={false}
                >
                  <div className="px-2.5 py-1 rounded-full bg-slate-950/95 text-orange-400 border border-orange-500 font-extrabold font-mono text-xs sm:text-sm shadow-xl pointer-events-none kakao-invert-restore select-none whitespace-nowrap flex items-center gap-1.5">
                    <span>{driftEnd.actualDistanceM}m</span>
                    {driftEnd.driftDistanceM >= 1.0 && (
                      <span className="text-[10.5px] text-amber-300 font-semibold">
                        ({driftEnd.driftAngleDeg > 0 ? '우' : '좌'} {driftEnd.driftDistanceM}m)
                      </span>
                    )}
                  </div>
                </CustomOverlayMap>
                </>)}
              </React.Fragment>
            );
          }

          // 3. 실시간 조류 흘림선 (Drift Path)
          // [요구사항 6] 조류 흘림은 바람 화살표 끝(windTip)에서 합성 벡터로 이어서 표시
          let currentElements = null;
          if (marine && (marine.currentVelocity ?? 0) > 0.05) {
            let driftStartPt: [number, number];
            if (weather) {
              const wDeg = (weather.windDirection + 180) % 360;
              driftStartPt = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, wDeg, 45);
            } else {
              driftStartPt = [selectedSpot.lat, selectedSpot.lng];
            }

            const driftDist = Math.max(18, Math.min(45, (marine.currentVelocity ?? 0.3) * 65));
            const driftEnd = calculateDestinationPoint(driftStartPt[0], driftStartPt[1], marine.currentDirection, driftDist);
            const driftMid = calculateDestinationPoint(driftStartPt[0], driftStartPt[1], marine.currentDirection, driftDist * 0.5);

            currentElements = (
              <React.Fragment key={`drift-path-${selectedSpot.id}`}>
                <Polyline
                  path={[
                    { lat: driftStartPt[0], lng: driftStartPt[1] },
                    { lat: driftEnd[0], lng: driftEnd[1] },
                  ]}
                  endArrow={true}
                  strokeWeight={2.2}
                  strokeColor="#06b6d4"
                  strokeOpacity={0.9}
                  strokeStyle="shortdash"
                  zIndex={46}
                />
                <CustomOverlayMap
                  position={{ lat: driftMid[0], lng: driftMid[1] }}
                  yAnchor={0.5}
                  xAnchor={0.5}
                  zIndex={56}
                  clickable={false}
                >
                  <div className="px-1.5 py-0.5 rounded-full bg-slate-950/95 text-cyan-300 border border-cyan-500/70 text-[9px] font-bold shadow-md pointer-events-none kakao-invert-restore select-none whitespace-nowrap flex items-center gap-1">
                    <span className="inline-block text-[10px] text-emerald-400" style={{ transform: `rotate(${marine.currentDirection}deg)` }}>↑</span>
                    <span className="font-mono">{formatCurrentVelocity(marine.currentVelocity, currentUnit)}</span>
                  </div>
                </CustomOverlayMap>
              </React.Fragment>
            );
          }

          return (
            <React.Fragment key={`selected-hud-${selectedSpot.id}`}>
              {hasCasting && castingLines}
              {windElements}
              {currentElements}
            </React.Fragment>
          );
        })()}

        {/* 🎯 스위트 스팟 (Sweet Spot) 오버레이 렌더링 (요구사항 4-4 및 5-7-4) */}
        {(() => {
          const isConfig = !!sweetSpotConfigSpot;
          const target = sweetSpotConfigSpot || selectedSpot;
          if (!target) return null;
          const isEnabled = isConfig ? tempUseSweetSpot : (target.use_sweet_spot ?? false);
          const spots = isConfig ? tempSweetSpots : (target.sweet_spots || []);
          if (!isEnabled || spots.length === 0) return null;

          return (
            <React.Fragment key={`sweet-spots-group-${target.id}-${isConfig ? 'cfg' : 'view'}`}>
              {spots.map((ss, idx) => {
                const [targetLat, targetLng] = calculateDestinationPoint(
                  target.lat,
                  target.lng,
                  ss.direction,
                  ss.distance
                );

                return (
                  <React.Fragment key={`sweet-spot-${target.id}-${ss.id || idx}`}>
                    {/* 스위트 스팟 반경 원 */}
                    <Circle
                      center={{ lat: targetLat, lng: targetLng }}
                      radius={ss.radius}
                      strokeWeight={2}
                      strokeColor="#f59e0b"
                      strokeOpacity={0.9}
                      strokeStyle="solid"
                      fillColor="#f59e0b"
                      fillOpacity={0.35}
                      zIndex={38}
                    />

                    {/* 포인트 -> 스위트스팟 연결 점선 */}
                    <Polyline
                      path={[
                        { lat: target.lat, lng: target.lng },
                        { lat: targetLat, lng: targetLng },
                      ]}
                      strokeWeight={1.5}
                      strokeColor="#f59e0b"
                      strokeOpacity={0.65}
                      strokeStyle="dash"
                      zIndex={37}
                    />

                    {/* 스위트 스팟 번호 & 거리 & 반경 배지 오버레이 (설정 모드 시 삭제 아이콘 포함) */}
                    <CustomOverlayMap
                      position={{ lat: targetLat, lng: targetLng }}
                      yAnchor={0.5}
                      xAnchor={0.5}
                      zIndex={40}
                      clickable={true}
                    >
                      {(() => {
                        const ssKey = ss.id || `idx-${idx}`;
                        const isExpanded = expandedSweetId === ssKey;
                        const memo = ss.memo || '';
                        const shortMemo = memo.length > 10 ? `${memo.slice(0, 10)}…` : memo;
                        return (
                          <div
                            className="flex flex-col items-center select-none kakao-invert-restore whitespace-nowrap animate-in fade-in zoom-in-75 duration-200 cursor-pointer"
                            onMouseEnter={() => setExpandedSweetId(ssKey)}
                            onMouseLeave={() => setExpandedSweetId((prev) => (prev === ssKey ? null : prev))}
                            onClick={(e) => {
                              e.stopPropagation();
                              isMarkerClickRef.current = true;
                              setExpandedSweetId((prev) => (prev === ssKey ? null : ssKey));
                            }}
                          >
                            <div className="px-1.5 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black shadow-lg border border-white/80 flex items-center gap-1.5">
                              <span>{ss.distance}m</span>
                              {shortMemo && !isExpanded && <span className="font-semibold">{shortMemo}</span>}
                              {isConfig && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    isMarkerClickRef.current = true;
                                    setPendingDeleteSweetIdx(idx);
                                  }}
                                  className="ml-0.5 px-1 py-0.2 rounded bg-rose-600 hover:bg-rose-700 text-white font-bold text-[9px] shadow active:scale-95 transition pointer-events-auto cursor-pointer"
                                  title="스윗 스팟 삭제"
                                >
                                  ✕ 삭제
                                </button>
                              )}
                            </div>
                            {isExpanded && memo && (
                              <div className="mt-0.5 px-2 py-1 rounded-lg bg-slate-950/95 text-amber-200 border border-amber-500/60 text-[10px] font-medium shadow-lg max-w-[200px] whitespace-normal break-words text-center">
                                {memo}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </CustomOverlayMap>
                  </React.Fragment>
                );
              })}
            </React.Fragment>
          );
        })()}

        {/* [요구사항 2-1-6] 추가 중인 스윗 스팟 초안 미리보기 (지도를 누를 때마다 위치 갱신) */}
        {sweetSpotConfigSpot && isAddingSweetSpot && draftSweetPos && (
          <React.Fragment key="sweet-spot-draft">
            <Circle
              center={draftSweetPos}
              radius={selectedNewRadius}
              strokeWeight={2.5}
              strokeColor="#fde047"
              strokeOpacity={1}
              strokeStyle="dash"
              fillColor="#fde047"
              fillOpacity={0.3}
              zIndex={39}
            />
            <Polyline
              path={[{ lat: sweetSpotConfigSpot.lat, lng: sweetSpotConfigSpot.lng }, draftSweetPos]}
              strokeWeight={1.5}
              strokeColor="#fde047"
              strokeOpacity={0.8}
              strokeStyle="dash"
              zIndex={37}
            />
            <CustomOverlayMap position={draftSweetPos} yAnchor={0.5} xAnchor={0.5} zIndex={41} clickable={false}>
              <div className="px-1.5 py-0.5 rounded-full bg-yellow-300 text-slate-950 text-[10px] font-black shadow-lg border border-white pointer-events-none kakao-invert-restore whitespace-nowrap">
                {calculateDistanceAndBearing(sweetSpotConfigSpot.lat, sweetSpotConfigSpot.lng, draftSweetPos.lat, draftSweetPos.lng).distance}m
              </div>
            </CustomOverlayMap>
          </React.Fragment>
        )}

        {/* 내 현재 GPS 위치 마커 & 수평 오차 반경 원 (Virtual Crosshair Accuracy Circle) */}
        {myLocation && (
          <React.Fragment key="my-location-group">
            {gpsAccuracy && gpsAccuracy > 0 && (
              <Circle
                center={myLocation}
                radius={gpsAccuracy}
                strokeWeight={1}
                strokeColor="#06b6d4"
                strokeOpacity={0.8}
                strokeStyle="dash"
                fillColor="#06b6d4"
                fillOpacity={0.12}
                zIndex={85}
              />
            )}
            <CustomOverlayMap
              position={{ lat: myLocation.lat, lng: myLocation.lng }}
              yAnchor={0.5}
              xAnchor={0.5}
              zIndex={90}
              clickable={true}
            >
              <div
                className="relative flex items-center justify-center kakao-invert-restore cursor-pointer"
                title={`현재 내 위치 (GPS 오차 반경 약 ±${Math.round(gpsAccuracy || 10)}m)`}
              >
                <div className="w-6 h-6 rounded-full bg-blue-500/30 animate-ping absolute" />
                <div className="w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow-lg" />
              </div>
            </CustomOverlayMap>
          </React.Fragment>
        )}

        {/* 지도 빈 공간 클릭 시: 새 포인트 등록 위치 표시 핑 마커 */}
        {pendingNewSpot && (
          <CustomOverlayMap
            position={pendingNewSpot}
            yAnchor={0.5}
            xAnchor={0.5}
            zIndex={290}
            clickable={false}
          >
            <div className="relative flex items-center justify-center pointer-events-none kakao-invert-restore">
              <div className="w-9 h-9 rounded-full bg-cyan-400/40 animate-ping absolute" />
              <div className="w-7 h-7 rounded-full bg-cyan-500 border-2 border-white shadow-2xl flex items-center justify-center text-sm">
                📍
              </div>
            </div>
          </CustomOverlayMap>
        )}

        {/* 등록된 포인트 커스텀 핀 오버레이 (요구사항: 아이콘 하단 미세조정/상세보기 아이콘 제거, 짧은클릭=상세보기, 더블/롱클릭=컨텍스트메뉴) */}
        {displayedSpots.map((spot) => {
          // 미세 조정 대상 포인트는 드래깅 전용 MapMarker로 별도 렌더링
          if (microAdjustSpot?.id === spot.id) return null;

          const isSelected = selectedSpot?.id === spot.id;
          const isFavorited = favoriteSpotIds.includes(spot.id);

          return (
            <React.Fragment key={`spot-group-${spot.id}`}>
              <CustomOverlayMap
                position={{ lat: spot.lat, lng: spot.lng }}
                xAnchor={0.5}
                yAnchor={0.5}
                zIndex={isSelected ? 100 : 20}
                clickable={true}
              >
                <div
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    isLongPressTriggeredRef.current = false;
                    // [요구사항 1-2] 핀치 줌(멀티터치) 중에는 롱프레스 메뉴 비활성화
                    if (activeTouchCountRef.current > 1 || Date.now() - lastMultiTouchAtRef.current < 600) {
                      return;
                    }
                    pressStartPosRef.current = { x: e.clientX, y: e.clientY };
                    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                    longPressTimerRef.current = setTimeout(() => {
                      longPressTimerRef.current = null;
                      if (activeTouchCountRef.current > 1 || Date.now() - lastMultiTouchAtRef.current < 600) return;
                      isLongPressTriggeredRef.current = true;
                      isMarkerClickRef.current = true;
                      onOpenContextMenu(spot);
                      triggerHaptic('medium');
                    }, 500);
                  }}
                  onPointerMove={(e) => {
                    const start = pressStartPosRef.current;
                    if (start && longPressTimerRef.current && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) {
                      clearTimeout(longPressTimerRef.current);
                      longPressTimerRef.current = null;
                    }
                  }}
                  onPointerUp={() => {
                    if (longPressTimerRef.current) {
                      clearTimeout(longPressTimerRef.current);
                      longPressTimerRef.current = null;
                    }
                  }}
                  onPointerCancel={() => {
                    if (longPressTimerRef.current) {
                      clearTimeout(longPressTimerRef.current);
                      longPressTimerRef.current = null;
                    }
                  }}
                  onPointerLeave={() => {
                    if (longPressTimerRef.current) {
                      clearTimeout(longPressTimerRef.current);
                      longPressTimerRef.current = null;
                    }
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    // [요구사항 1-2] 터치 기기(모바일)는 더블클릭 대신 롱프레스만 사용 → 핀치 줌 오작동 방지
                    if (isCoarsePointer) return;
                    isMarkerClickRef.current = true;
                    onOpenContextMenu(spot);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    isMarkerClickRef.current = true;
                    if (isLongPressTriggeredRef.current) {
                      isLongPressTriggeredRef.current = false;
                      return;
                    }
                    if (Date.now() - lastMultiTouchAtRef.current < 600) return;
                    setPendingNewSpot(null);
                    setContextMenuSpot(null);
                    // [요구사항 1-1] 짧게 클릭: 뷰 리셋/재정렬 없이 상세보기 표시
                    skipAutoRecenterRef.current = true;
                    if (onOpenDetail) {
                      onOpenDetail(spot);
                    } else {
                      onSelectSpot(spot);
                    }
                  }}
                  className="relative flex items-center justify-center cursor-pointer group kakao-invert-restore"
                  title={`${spot.name} (클릭: 선택/상세, 길게 누르거나 더블클릭: 메뉴)`}
                >
                  {/* [요구사항 4] 아이콘 정중앙이 캐스팅 반원의 중심 좌표(spot.lat, spot.lng)에 정확히 위치 */}
                  <MaterialSpotMarker
                    methods={spot.fishing_methods}
                    isSelected={isSelected}
                    isFavorited={isFavorited}
                  />

                  {/* 포인트 이름 텍스트 (아이콘 바로 아래에 매달림 - 하단 미세조정/상세보기 아이콘은 전면 제거) */}
                  <div className="absolute top-full mt-1.5 flex flex-col items-center pointer-events-auto">
                    <span className="px-2 py-0.5 rounded-lg bg-slate-950/95 border border-slate-700/80 text-[11px] sm:text-xs text-white font-bold whitespace-nowrap shadow-xl">
                      {spot.name}
                    </span>
                  </div>
                </div>
              </CustomOverlayMap>
            </React.Fragment>
          );
        })}



        {/* 공용 낚시점(편의시설) 마커 상시 렌더링 (포인트 마커와 구별되는 앰버 스토어 아이콘) */}
        {shops.map((shop) => {
          const isShopSelected = selectedShop?.id === shop.id;
          return (
            <CustomOverlayMap
              key={`shop-marker-${shop.id}`}
              position={{ lat: shop.lat, lng: shop.lng }}
              yAnchor={0.5}
              xAnchor={0.5}
              zIndex={isShopSelected ? 32 : 18}
              clickable={true}
            >
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  isMarkerClickRef.current = true;
                  setPendingNewSpot(null);
                  setContextMenuSpot(null);
                  skipAutoRecenterRef.current = true;
                  onSelectShop?.(shop);
                }}
                className="relative flex items-center justify-center cursor-pointer group kakao-invert-restore"
                title={`${shop.name} (낚시점 · 편의시설)`}
              >
                <div
                  className={`w-7 h-7 rounded-xl border-2 flex items-center justify-center shadow-lg transition-transform group-hover:scale-110 ${
                    isShopSelected
                      ? 'bg-amber-500 border-white text-slate-950 scale-110'
                      : 'bg-slate-950/95 border-amber-400 text-amber-300'
                  }`}
                >
                  <Store className="w-3.5 h-3.5" />
                </div>
                <div className="absolute top-full mt-1 flex flex-col items-center pointer-events-none">
                  <span className="px-1.5 py-0.5 rounded bg-slate-950/95 border border-amber-500/50 text-[10px] text-amber-200 font-semibold whitespace-nowrap shadow">
                    {shop.name}
                  </span>
                </div>
              </div>
            </CustomOverlayMap>
          );
        })}

        {/* [요구사항 2] 위성지도 기반 2D 평면 포인트 마커 드래깅 미세조정 */}
        {microAdjustSpot && adjustedPos && (() => {
          const distMeters = calculateDistanceAndBearing(microAdjustSpot.lat, microAdjustSpot.lng, adjustedPos.lat, adjustedPos.lng).distance;
          return (
          <React.Fragment key="micro-adjust-marker-group">
            {/* 기존 등록 위치 옅은 고스트 마커 */}
            <CustomOverlayMap
              position={{ lat: microAdjustSpot.lat, lng: microAdjustSpot.lng }}
              yAnchor={1}
              zIndex={40}
            >
              <div className="flex flex-col items-center opacity-60 pointer-events-none">
                <div className="w-7 h-7 rounded-full border-2 border-dashed border-rose-400 bg-rose-500/20 flex items-center justify-center text-[10px] text-rose-300 font-bold shadow">
                  기존
                </div>
                <div className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[6px] border-t-rose-400" />
                <span className="text-[10px] text-rose-300 font-mono bg-slate-900/90 px-1 rounded border border-rose-500/30">
                  이전 위치
                </span>
              </div>
            </CustomOverlayMap>

            {/* 기존 위치에서 새 위치로의 이동 궤적 점선 */}
            {distMeters > 0.1 && (
              <Polyline
                path={[
                  { lat: microAdjustSpot.lat, lng: microAdjustSpot.lng },
                  { lat: adjustedPos.lat, lng: adjustedPos.lng },
                ]}
                strokeWeight={3}
                strokeColor="#10b981"
                strokeOpacity={0.9}
                strokeStyle="shortdash"
                zIndex={45}
              />
            )}

            {/* 2차원 평면 드래그 가능한 마커 (사용자가 위성지도에서 마우스/터치로 직접 발판으로 드래깅) */}
            <MapMarker
              position={adjustedPos}
              draggable={digitalZoom === 1.0}
              onDragEnd={(marker) => {
                if (digitalZoom === 1.0) {
                  const pos = marker.getPosition();
                  setAdjustedPos({ lat: pos.getLat(), lng: pos.getLng() });
                }
              }}
              zIndex={150}
            />

            {/* [요구사항 4] 디지털 줌 상태에서도 1:1 오차 없이 드래깅 가능한 커스텀 오버레이 핸들러 */}
            <CustomOverlayMap
              position={adjustedPos}
              yAnchor={1.0}
              xAnchor={0.5}
              zIndex={155}
            >
              <div
                onMouseDown={(e) => {
                  e.stopPropagation();
                  isMarkerClickRef.current = true;
                  isDraggingAdjustMarkerRef.current = true;
                  lastClientPosRef.current = { x: e.clientX, y: e.clientY };
                }}
                onTouchStart={(e) => {
                  e.stopPropagation();
                  isMarkerClickRef.current = true;
                  isDraggingAdjustMarkerRef.current = true;
                  if (e.touches.length > 0) {
                    lastClientPosRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                  }
                }}
                className="w-10 h-10 -m-5 flex items-center justify-center cursor-grab active:cursor-grabbing select-none"
                title="발판 위치로 드래그"
              >
                <div className="w-5 h-5 rounded-full bg-emerald-400 border-2 border-white shadow-xl flex items-center justify-center text-[10px] animate-pulse">
                  🎯
                </div>
              </div>
            </CustomOverlayMap>

            {/* 마커 상단 드래그 가이드 툴팁 배지 */}
            <CustomOverlayMap
              position={adjustedPos}
              yAnchor={2.3}
              zIndex={160}
            >
              <div className="px-3 py-1 rounded-full bg-slate-950/95 border-2 border-emerald-400 text-emerald-300 font-bold text-xs shadow-2xl flex items-center gap-1.5 whitespace-nowrap animate-pulse pointer-events-none">
                <span>👆 핀을 드래그하여 정확한 발판으로 옮기세요</span>
              </div>
            </CustomOverlayMap>
          </React.Fragment>
          );
        })()}
        {/* 거리 측정 다중 선분 및 끝점 거리(m) 표기 */}
        {measureSegments.map((seg) => (
          <React.Fragment key={seg.id}>
            <Polyline
              path={[seg.start, seg.end]}
              strokeWeight={2.5}
              strokeColor="#38bdf8"
              strokeOpacity={0.95}
              strokeStyle="dash"
              zIndex={120}
            />
            <CustomOverlayMap position={seg.start} xAnchor={0.5} yAnchor={0.5} zIndex={121} clickable={false}>
              <div className="w-2.5 h-2.5 rounded-full bg-sky-600 border-2 border-white shadow pointer-events-none kakao-invert-restore" />
            </CustomOverlayMap>
            <CustomOverlayMap position={seg.end} xAnchor={0.5} yAnchor={0.5} zIndex={122} clickable={false}>
              <div className="flex items-center pointer-events-none kakao-invert-restore">
                <div className="w-2.5 h-2.5 rounded-full bg-cyan-500 border-2 border-white shadow shrink-0" />
                <div className="ml-1.5 px-2 py-0.5 rounded-full bg-slate-950/92 text-cyan-300 border border-sky-400 text-[11px] font-extrabold font-mono shadow-lg whitespace-nowrap">
                  {seg.distanceM.toLocaleString()}m
                </div>
              </div>
            </CustomOverlayMap>
          </React.Fragment>
        ))}

        {measureDraftStart && (
          <CustomOverlayMap position={measureDraftStart} xAnchor={0.5} yAnchor={0.5} zIndex={125} clickable={false}>
            <div className="flex flex-col items-center pointer-events-none kakao-invert-restore">
              <div className="mb-1 px-1.5 py-0.5 rounded-full bg-slate-950/90 text-amber-300 border border-amber-500 text-[10px] font-bold whitespace-nowrap shadow">
                시작점
              </div>
              <div className="w-3 h-3 rounded-full bg-amber-500 border-2 border-white shadow" />
            </div>
          </CustomOverlayMap>
        )}

        <ProhibitedZoneOverlay
          enabled={level <= 6}
          zones={prohibitedZones}
          currentUser={currentUser}
          onZonesMutated={onZonesMutated}
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
      </Map>
        </div>
        <HaeRoadEncOverlay mapRef={mapRef} enabled={isStrictAdmin && showHaeroadEnc} opacity={0.5} />
      </div>
  );
};
