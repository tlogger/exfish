import React from 'react';
import { AlertTriangle, Flag, ShieldAlert, Store, Trash2, X } from 'lucide-react';
import { MaterialSpotMarker } from './MaterialSpotMarker';
import { ZoneDigitizer } from './ZoneDigitizer';
import type { MapProvider } from '../types';
import type { ProhibitedZoneFeature } from '../types/prohibitedZone';
import { DEFAULT_CAUTION_RADIUS_M } from '../utils/zoneSpatial';
import { isStrictPaedrosAdmin } from '../services/oauthService';
import { adminDeleteProhibitedZone, flagProhibitedZone } from '../utils/zoneCache';
import { formatWindSpeed, formatCurrentVelocity } from '../utils/weatherApi';
import {
  getTackleShortLabel,
  calculateSinkingPhysics,
  calculateAerodynamicCastingDrift,
} from '../utils/tackleCalibration';
import { findNearestKhoaStation } from '../utils/tideService';
import { resolveUnifiedWaterDepth } from '../utils/depthSinkEngine';
import { triggerHaptic } from '../utils/nativeBridge';
import {
  calculateDestinationPoint,
  calculateDistanceAndBearing,
  CASTING_BEARINGS,
  type SharedMapCanvasProps,
} from './mapCanvasTypes';

const SCOPE_LABELS: Record<string, string> = {
  all_year: '연중 제한',
  seasonal: '계절/기간 제한',
  night_only: '야간 통제',
};

export interface UnifiedMapOverlayProps extends SharedMapCanvasProps {
  mapProvider: MapProvider;
}

/**
 * VWorld / 카카오맵 공통 단일 통합 오버레이 엔진 (SVG 벡터 + DOM 인터랙티브 레이어)
 * 베이스 맵의 MapProjectionBridge(project/metersToPixels/subscribeViewport)만 참조하므로
 * 두 지도 엔진에서 포인트 아이콘, 캐스팅 아크/풍속/조류 HUD, 스윗 스팟, 금지구역, 거리 측정이 100% 동일하게 렌더링됩니다.
 */
export const UnifiedMapOverlay: React.FC<UnifiedMapOverlayProps> = ({
  mapProvider,
  center,
  level,
  digitalZoom,
  bridgeRef,
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
  showCastingArrows,
  tackleConfig,
  weather,
  marine,
  tide,
  windUnit,
  currentUnit,
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
  onUndoDigitize,
  onResetDigitize,
  onCancelDigitize,
  onSuccessDigitize,
  isMeasuringDistance,
  measureSegments,
  measureDraftStart,
  isMarkerClickRef,
  lastClientPosRef,
  longPressTimerRef,
  isLongPressTriggeredRef,
  activeTouchCountRef,
  lastMultiTouchAtRef,
}) => {
  // 60fps requestAnimationFrame 병합으로 뷰포트 변경 시 부드럽게 재투영
  const [, setViewportTick] = React.useState(0);
  const rafIdRef = React.useRef<number | null>(null);

  // 금지구역 클릭 상세 카드 상태
  const [selectedZone, setSelectedZone] = React.useState<ProhibitedZoneFeature | null>(null);
  const [zoneBusy, setZoneBusy] = React.useState(false);
  const [zoneFeedbackMsg, setZoneFeedbackMsg] = React.useState<string | null>(null);
  const isAdmin = isStrictPaedrosAdmin(currentUser);

  const scheduleReproject = React.useCallback(() => {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      setViewportTick((t) => (t + 1) % 1000000);
    });
  }, []);

  React.useEffect(() => {
    let unsub: (() => void) | null = null;
    let retryTimer: number | null = null;

    const attach = () => {
      if (bridgeRef.current) {
        unsub = bridgeRef.current.subscribeViewport(scheduleReproject);
        scheduleReproject();
      } else {
        retryTimer = window.setTimeout(attach, 50);
      }
    };
    attach();

    return () => {
      unsub?.();
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [bridgeRef, mapProvider, scheduleReproject]);

  // center/level/digitalZoom 변경 시 즉시 재투영 예약
  React.useEffect(() => {
    scheduleReproject();
  }, [center.lat, center.lng, level, digitalZoom, scheduleReproject]);

  const bridge = bridgeRef.current;
  const project = (lat: number, lng: number) => (bridge ? bridge.project(lat, lng) : null);
  const metersToPx = (lat: number, lng: number, meters: number) =>
    bridge ? bridge.metersToPixels(lat, lng, meters) : 0;
  const containerSize = bridge ? bridge.getContainerSize() : null;

  const isInViewport = (pt: { x: number; y: number } | null, margin = 140) => {
    if (!pt) return false;
    if (!containerSize || containerSize.width <= 0 || containerSize.height <= 0) return true;
    return (
      pt.x >= -margin &&
      pt.x <= containerSize.width + margin &&
      pt.y >= -margin &&
      pt.y <= containerSize.height + margin
    );
  };

  const toPointsAttr = (pts: Array<{ x: number; y: number } | null>): string => {
    const valid = pts.filter((p): p is { x: number; y: number } => p !== null);
    return valid.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  };

  // 디지털 줌 역스케일링 스타일 (지도는 확대되고 뱃지/아이콘은 선명한 원본 크기 유지)
  const counterScaleStyle: React.CSSProperties | undefined =
    digitalZoom > 1.0
      ? { transform: `scale(${(1 / digitalZoom).toFixed(4)})`, transformOrigin: 'center center' }
      : undefined;

  const handleZoneFlag = async () => {
    if (!selectedZone || !currentUser) return;
    setZoneBusy(true);
    setZoneFeedbackMsg(null);
    const res = await flagProhibitedZone({
      user: currentUser,
      zoneId: selectedZone.properties.zone_id,
      reason: '사용자 오탐/허위 신고',
    });
    setZoneBusy(false);
    if (!res.ok) {
      setZoneFeedbackMsg(res.error || '신고 처리 실패');
      return;
    }
    if (res.flagged) {
      setSelectedZone(null);
      onZonesMutated();
    } else {
      setZoneFeedbackMsg('신고가 접수되었습니다 (3명 이상 신고 시 자동 숨김 처리됩니다).');
    }
  };

  const handleZoneAdminDelete = async () => {
    if (!selectedZone || !isAdmin) return;
    const isUser =
      selectedZone.properties.tier === 'community_reported' ||
      selectedZone.properties.zone_id.startsWith('usr_');
    setZoneBusy(true);
    setZoneFeedbackMsg(null);
    const res = await adminDeleteProhibitedZone({
      zoneId: selectedZone.properties.zone_id,
      targetType: isUser ? 'user' : 'public',
      reason: '관리자 지도 클릭 삭제',
    });
    setZoneBusy(false);
    if (!res.ok) {
      setZoneFeedbackMsg(res.error || '삭제 실패');
      return;
    }
    setSelectedZone(null);
    onZonesMutated();
  };

  // =========================================================================
  // 1. 캐스팅 부채꼴 / 호 / 거리 라벨 계산
  // =========================================================================
  const castingSectorData = (() => {
    if (!showCastingArrows || (!selectedSpot && !castingConfigSpot)) return null;
    const targetSpot = castingConfigSpot || selectedSpot;
    if (!targetSpot) return null;

    let startDeg = targetSpot.casting_start_deg;
    let endDeg = targetSpot.casting_end_deg;
    if (castingConfigSpot) {
      if (!tempCastingEnabled) return null;
      startDeg = tempStartDeg;
      endDeg = tempEndDeg;
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
    if (startDeg === undefined || endDeg === undefined) return null;

    const origin = project(targetSpot.lat, targetSpot.lng);
    if (!origin) return null;

    const rawSpan = (endDeg - startDeg + 360) % 360;
    const span = rawSpan === 0 ? 360 : rawSpan;
    const centerBearing = (startDeg + span / 2) % 360;
    const radii = tackleConfig.radii;
    const maxRadius = radii[2];
    const step = Math.max(1, Math.min(3, Math.round(span / 25)));

    const leftEdgeLL = calculateDestinationPoint(targetSpot.lat, targetSpot.lng, startDeg, maxRadius);
    const rightEdgeLL = calculateDestinationPoint(targetSpot.lat, targetSpot.lng, endDeg, maxRadius);
    const leftEdge = project(leftEdgeLL[0], leftEdgeLL[1]);
    const rightEdge = project(rightEdgeLL[0], rightEdgeLL[1]);

    // 반투명 부채꼴 섹터 폴리곤
    const wedgePts: Array<{ x: number; y: number } | null> = [origin];
    for (let offset = 0; offset <= span; offset += step) {
      const b = (startDeg + offset) % 360;
      const [pLat, pLng] = calculateDestinationPoint(targetSpot.lat, targetSpot.lng, b, maxRadius);
      wedgePts.push(project(pLat, pLng));
    }
    wedgePts.push(rightEdge);

    // 거리별 호 및 라벨 위치
    const arcs = radii.map((r, rIdx) => {
      const arcPts: Array<{ x: number; y: number } | null> = [];
      for (let offset = 0; offset <= span; offset += step) {
        const b = (startDeg! + offset) % 360;
        const [pLat, pLng] = calculateDestinationPoint(targetSpot.lat, targetSpot.lng, b, r);
        arcPts.push(project(pLat, pLng));
      }
      const [eLat, eLng] = calculateDestinationPoint(targetSpot.lat, targetSpot.lng, endDeg!, r);
      arcPts.push(project(eLat, eLng));

      const [lLat, lLng] = calculateDestinationPoint(targetSpot.lat, targetSpot.lng, centerBearing, r);
      return {
        r,
        rIdx,
        pointsAttr: toPointsAttr(arcPts),
        labelPt: project(lLat, lLng),
      };
    });

    return {
      spotId: targetSpot.id,
      origin,
      leftEdge,
      rightEdge,
      wedgeAttr: toPointsAttr(wedgePts),
      arcs,
    };
  })();

  // =========================================================================
  // 2. 선택 포인트 캐스팅 화살표 + 착수 수심 HUD + 바람/편류 + 조류 벡터 계산
  // =========================================================================
  const tacticalHudData = (() => {
    if (!showCastingArrows || !selectedSpot || castingConfigSpot || sweetSpotConfigSpot) return null;

    let startDeg = selectedSpot.casting_start_deg;
    let endDeg = selectedSpot.casting_end_deg;
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
    const hasCasting = startDeg !== undefined && endDeg !== undefined;
    if (startDeg === undefined || endDeg === undefined) {
      startDeg = 45;
      endDeg = 135;
    }

    const origin = project(selectedSpot.lat, selectedSpot.lng);
    if (!origin) return null;

    const span = endDeg >= startDeg ? endDeg - startDeg : 360 - startDeg + endDeg;
    const bearing = (startDeg + span / 2) % 360;
    const baseDist = tackleConfig.calibratedDistanceMeters;
    const tipDist = Math.max(8, Math.round(baseDist));
    const tipLL = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, bearing, tipDist);
    const tipPt = project(tipLL[0], tipLL[1]);
    const badgeLL = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, bearing, tipDist + 6);
    const badgePt = project(badgeLL[0], badgeLL[1]);

    const curHourNow = new Date().getHours();
    const curTidePt =
      tide?.hourlyCurve?.find((c) => c.isCurrent || c.hour === curHourNow) || tide?.hourlyCurve?.[0];
    const nearestSt = findNearestKhoaStation(selectedSpot.lat, selectedSpot.lng);
    const landingDepthInfo = resolveUnifiedWaterDepth({
      spotLat: selectedSpot.lat,
      spotLng: selectedSpot.lng,
      targetLat: tipLL[0],
      targetLng: tipLL[1],
      spotType: selectedSpot.spot_type,
      khoaDpwt: landingKhoaDepth?.dpwt ?? null,
      khoaDpwtIsAtTarget: true,
      datumZ0: nearestSt.station.datumZ0,
      tideHeightCm: curTidePt?.height,
      pressureHpa: weather?.pressureHpa,
      isPredictedTide: true,
    });
    const landingDepth = landingDepthInfo.realDepthM;
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

    const hasSubsurfaceDrift = sinkPhysics.driftDistanceM >= 1.5 && marine?.currentDirection != null;
    const driftPreviewDist = Math.min(35, sinkPhysics.driftDistanceM);
    const subsurfaceEndLL = hasSubsurfaceDrift
      ? calculateDestinationPoint(tipLL[0], tipLL[1], marine!.currentDirection, driftPreviewDist)
      : null;
    const subsurfaceEndPt = subsurfaceEndLL ? project(subsurfaceEndLL[0], subsurfaceEndLL[1]) : null;

    // 바람 진행 벡터 및 공기역학 편류
    let windData: {
      windTipPt: { x: number; y: number } | null;
      windBadgePt: { x: number; y: number } | null;
      windDirection: number;
      windSpeed: number;
      targetArcAttr: string;
      orangeArcAttr: string;
      driftOffsets: Array<{ from: { x: number; y: number } | null; to: { x: number; y: number } | null }>;
      driftBadges: Array<{
        pt: { x: number; y: number } | null;
        actualDistanceM: number;
        driftDistanceM: number;
        driftAngleDeg: number;
      }>;
    } | null = null;

    if (weather) {
      const windVectorDeg = (weather.windDirection + 180) % 360;
      const rigWeight = tackleConfig.totalWeightGrams ?? tackleConfig.weightGrams;
      const wormLenInches = tackleConfig.baitConfig?.lengthInches ?? 2;
      const peLine = tackleConfig.peLineSize;

      const windTipLL = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, windVectorDeg, 45);
      const windBadgeLL = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, windVectorDeg, 48);

      const orangeArcPts: Array<{ x: number; y: number } | null> = [];
      const targetArcPts: Array<{ x: number; y: number } | null> = [];
      const driftOffsets: Array<{ from: { x: number; y: number } | null; to: { x: number; y: number } | null }> = [];
      const driftBadges: Array<{
        pt: { x: number; y: number } | null;
        actualDistanceM: number;
        driftDistanceM: number;
        driftAngleDeg: number;
      }> = [];

      if (hasCasting) {
        const midDeg = (startDeg + span / 2) % 360;
        const driftStart = calculateAerodynamicCastingDrift(
          startDeg, baseDist, weather.windSpeed, weather.windDirection, rigWeight, peLine, wormLenInches, tackleConfig.baitConfig
        );
        const driftMid = calculateAerodynamicCastingDrift(
          midDeg, baseDist, weather.windSpeed, weather.windDirection, rigWeight, peLine, wormLenInches, tackleConfig.baitConfig
        );
        const driftEnd = calculateAerodynamicCastingDrift(
          endDeg, baseDist, weather.windSpeed, weather.windDirection, rigWeight, peLine, wormLenInches, tackleConfig.baitConfig
        );

        const arcStep = Math.max(1, Math.min(3, Math.round(span / 30)));
        for (let offset = 0; offset <= span; offset += arcStep) {
          const b = (startDeg + offset) % 360;
          const dRes = calculateAerodynamicCastingDrift(
            b, baseDist, weather.windSpeed, weather.windDirection, rigWeight, peLine, wormLenInches, tackleConfig.baitConfig
          );
          const [pALat, pALng] = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, dRes.actualBearingDeg, dRes.actualDistanceM);
          orangeArcPts.push(project(pALat, pALng));
          const [pTLat, pTLng] = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, b, dRes.targetDistanceM);
          targetArcPts.push(project(pTLat, pTLng));
        }
        const [eALat, eALng] = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, driftEnd.actualBearingDeg, driftEnd.actualDistanceM);
        orangeArcPts.push(project(eALat, eALng));
        const [eTLat, eTLng] = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, endDeg, driftEnd.targetDistanceM);
        targetArcPts.push(project(eTLat, eTLng));

        const samples = [
          { deg: startDeg, drift: driftStart },
          { deg: midDeg, drift: driftMid },
          { deg: endDeg, drift: driftEnd },
        ];
        samples.forEach(({ deg, drift }) => {
          const tLL = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, deg, drift.targetDistanceM);
          const aLL = calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, drift.actualBearingDeg, drift.actualDistanceM);
          const aPt = project(aLL[0], aLL[1]);
          if (drift.driftDistanceM >= 1.0) {
            driftOffsets.push({ from: project(tLL[0], tLL[1]), to: aPt });
          }
          driftBadges.push({
            pt: aPt,
            actualDistanceM: drift.actualDistanceM,
            driftDistanceM: drift.driftDistanceM,
            driftAngleDeg: drift.driftAngleDeg,
          });
        });
      }

      windData = {
        windTipPt: project(windTipLL[0], windTipLL[1]),
        windBadgePt: project(windBadgeLL[0], windBadgeLL[1]),
        windDirection: weather.windDirection,
        windSpeed: weather.windSpeed,
        targetArcAttr: toPointsAttr(targetArcPts),
        orangeArcAttr: toPointsAttr(orangeArcPts),
        driftOffsets,
        driftBadges,
      };
    }

    // 실시간 조류 흘림선
    let currentData: {
      startPt: { x: number; y: number } | null;
      endPt: { x: number; y: number } | null;
      midPt: { x: number; y: number } | null;
      direction: number;
      velocity: number;
    } | null = null;

    if (marine && (marine.currentVelocity ?? 0) > 0.05) {
      const driftStartLL: [number, number] = weather
        ? calculateDestinationPoint(selectedSpot.lat, selectedSpot.lng, (weather.windDirection + 180) % 360, 45)
        : [selectedSpot.lat, selectedSpot.lng];
      const driftDist = Math.max(18, Math.min(45, (marine.currentVelocity ?? 0.3) * 65));
      const driftEndLL = calculateDestinationPoint(driftStartLL[0], driftStartLL[1], marine.currentDirection, driftDist);
      const driftMidLL = calculateDestinationPoint(driftStartLL[0], driftStartLL[1], marine.currentDirection, driftDist * 0.5);
      currentData = {
        startPt: project(driftStartLL[0], driftStartLL[1]),
        endPt: project(driftEndLL[0], driftEndLL[1]),
        midPt: project(driftMidLL[0], driftMidLL[1]),
        direction: marine.currentDirection,
        velocity: marine.currentVelocity,
      };
    }

    return {
      hasCasting,
      bearing,
      origin,
      tipPt,
      badgePt,
      subsurfaceEndPt,
      landingDepthInfo,
      landingDepth,
      sinkPhysics,
      windData,
      currentData,
    };
  })();

  // =========================================================================
  // 3. 스윗 스팟 데이터 계산
  // =========================================================================
  const sweetSpotData = (() => {
    const isConfig = !!sweetSpotConfigSpot;
    const target = sweetSpotConfigSpot || selectedSpot;
    if (!target) return null;
    const isEnabled = isConfig ? tempUseSweetSpot : (target.use_sweet_spot ?? false);
    const list = isConfig ? tempSweetSpots : target.sweet_spots || [];
    const originPt = project(target.lat, target.lng);
    const items = isEnabled
      ? list.map((ss, idx) => {
          const [sLat, sLng] = calculateDestinationPoint(target.lat, target.lng, ss.direction, ss.distance);
          return {
            ss,
            idx,
            pt: project(sLat, sLng),
            radiusPx: metersToPx(sLat, sLng, ss.radius),
          };
        })
      : [];

    const draft =
      isConfig && isAddingSweetSpot && draftSweetPos
        ? {
            pt: project(draftSweetPos.lat, draftSweetPos.lng),
            radiusPx: metersToPx(draftSweetPos.lat, draftSweetPos.lng, selectedNewRadius),
            distM: calculateDistanceAndBearing(target.lat, target.lng, draftSweetPos.lat, draftSweetPos.lng).distance,
          }
        : null;

    return { target, isConfig, originPt, items, draft };
  })();

  const myLocPt = myLocation ? project(myLocation.lat, myLocation.lng) : null;
  const myLocAccPx =
    myLocation && gpsAccuracy && gpsAccuracy > 0
      ? metersToPx(myLocation.lat, myLocation.lng, gpsAccuracy)
      : 0;
  const pendingSpotPt = pendingNewSpot ? project(pendingNewSpot.lat, pendingNewSpot.lng) : null;
  const microOrigPt = microAdjustSpot ? project(microAdjustSpot.lat, microAdjustSpot.lng) : null;
  const microAdjPt = microAdjustSpot && adjustedPos ? project(adjustedPos.lat, adjustedPos.lng) : null;

  return (
    <>
      <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden">
        {/* ==================== SVG 벡터 레이어 ==================== */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
          <defs>
            <marker id="exfish-arrow-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#2563eb" />
            </marker>
            <marker id="exfish-arrow-cyan" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#22d3ee" />
            </marker>
            <marker id="exfish-arrow-sky" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" />
            </marker>
            <marker id="exfish-arrow-teal" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#06b6d4" />
            </marker>
          </defs>

          {/* 1. 금지구역 폴리곤 / 반경 원 */}
          {level <= 6 &&
            prohibitedZones.map((feat) => {
              const { zone_id, tier, radius_m } = feat.properties;
              if (feat.geometry.type === 'Point') {
                const [lng, lat] = feat.geometry.coordinates;
                const pt = project(lat, lng);
                const rPx = metersToPx(lat, lng, radius_m ?? DEFAULT_CAUTION_RADIUS_M);
                if (!pt || rPx <= 0) return null;
                return (
                  <circle
                    key={`pz-pt-${zone_id}`}
                    cx={pt.x}
                    cy={pt.y}
                    r={rPx}
                    stroke="#f59e0b"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    strokeOpacity={0.9}
                    fill="#f59e0b"
                    fillOpacity={0.14}
                    className={isMeasuringDistance ? 'pointer-events-none' : 'pointer-events-auto cursor-pointer'}
                    onClick={(e) => {
                      e.stopPropagation();
                      isMarkerClickRef.current = true;
                      setZoneFeedbackMsg(null);
                      setSelectedZone(feat);
                    }}
                  />
                );
              }
              const isCommunity = tier === 'community_reported';
              const polys =
                feat.geometry.type === 'MultiPolygon'
                  ? feat.geometry.coordinates
                  : [feat.geometry.coordinates];
              return polys.map((polyCoords, pIdx) => {
                const outerRing = polyCoords[0] || [];
                const ptsAttr = toPointsAttr(outerRing.map(([lng, lat]) => project(lat, lng)));
                if (!ptsAttr) return null;
                return (
                  <polygon
                    key={`pz-poly-${zone_id}-${pIdx}`}
                    points={ptsAttr}
                    stroke={isCommunity ? '#f97316' : '#ef4444'}
                    strokeWidth={2}
                    strokeDasharray={isCommunity ? '5 4' : undefined}
                    strokeOpacity={0.9}
                    fill={isCommunity ? '#fb923c' : '#ef4444'}
                    fillOpacity={isCommunity ? 0.2 : 0.24}
                    className={isMeasuringDistance ? 'pointer-events-none' : 'pointer-events-auto cursor-pointer'}
                    onClick={(e) => {
                      e.stopPropagation();
                      isMarkerClickRef.current = true;
                      setZoneFeedbackMsg(null);
                      setSelectedZone(feat);
                    }}
                  />
                );
              });
            })}

          {/* 2. 금지구역 작도 미리보기 */}
          {isDigitizingZones && digitizerPoints.length > 0 && (() => {
            const pts = digitizerPoints.map((p) => project(p.lat, p.lng));
            const attr = toPointsAttr(pts);
            return (
              <g>
                {pts.length >= 3 ? (
                  <polygon points={attr} stroke="#fb923c" strokeWidth={2} fill="#fb923c" fillOpacity={0.25} />
                ) : (
                  <polyline points={attr} stroke="#fb923c" strokeWidth={2} fill="none" />
                )}
                {pts.map(
                  (pt, i) =>
                    pt && (
                      <circle key={`dig-${i}`} cx={pt.x} cy={pt.y} r={4} stroke="#ffffff" strokeWidth={1.5} fill="#f97316" />
                    )
                )}
              </g>
            );
          })()}

          {/* 3. 캐스팅 부채꼴 섹터 + 경계선 + 3단 거리 호 */}
          {castingSectorData && (
            <g>
              {castingSectorData.wedgeAttr && (
                <polygon points={castingSectorData.wedgeAttr} fill="#06b6d4" fillOpacity={0.08} stroke="none" />
              )}
              {castingSectorData.leftEdge && (
                <line
                  x1={castingSectorData.origin.x}
                  y1={castingSectorData.origin.y}
                  x2={castingSectorData.leftEdge.x}
                  y2={castingSectorData.leftEdge.y}
                  stroke="#10b981"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  strokeOpacity={0.7}
                />
              )}
              {castingSectorData.rightEdge && (
                <line
                  x1={castingSectorData.origin.x}
                  y1={castingSectorData.origin.y}
                  x2={castingSectorData.rightEdge.x}
                  y2={castingSectorData.rightEdge.y}
                  stroke="#06b6d4"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  strokeOpacity={0.7}
                />
              )}
              {castingSectorData.arcs.map((arc) => (
                <polyline
                  key={`arc-${castingSectorData.spotId}-${arc.r}`}
                  points={arc.pointsAttr}
                  fill="none"
                  stroke="#06b6d4"
                  strokeWidth={arc.rIdx === 0 ? 2 : 1.5}
                  strokeOpacity={arc.rIdx === 0 ? 0.85 : arc.rIdx === 1 ? 0.6 : 0.4}
                  strokeDasharray="5 4"
                />
              ))}
            </g>
          )}

          {/* 4. 선택 포인트 캐스팅 화살표 + 바람/편류 + 조류 벡터 */}
          {tacticalHudData && (
            <g>
              {/* 바람 진행 벡터 화살표 */}
              {tacticalHudData.windData?.windTipPt && (
                <line
                  x1={tacticalHudData.origin.x}
                  y1={tacticalHudData.origin.y}
                  x2={tacticalHudData.windData.windTipPt.x}
                  y2={tacticalHudData.windData.windTipPt.y}
                  stroke="#38bdf8"
                  strokeWidth={2.2}
                  strokeOpacity={0.9}
                  markerEnd="url(#exfish-arrow-sky)"
                />
              )}
              {/* 공기역학 편류 기준 호선 & 오프셋 & 오렌지 실제 착수 호선 */}
              {tacticalHudData.hasCasting && tacticalHudData.windData && (
                <>
                  {tacticalHudData.windData.targetArcAttr && (
                    <polyline
                      points={tacticalHudData.windData.targetArcAttr}
                      fill="none"
                      stroke="#94a3b8"
                      strokeWidth={1.5}
                      strokeOpacity={0.35}
                      strokeDasharray="5 4"
                    />
                  )}
                  {tacticalHudData.windData.driftOffsets.map((d, idx) =>
                    d.from && d.to ? (
                      <line
                        key={`doff-${idx}`}
                        x1={d.from.x}
                        y1={d.from.y}
                        x2={d.to.x}
                        y2={d.to.y}
                        stroke="#fbbf24"
                        strokeWidth={1.5}
                        strokeOpacity={0.7}
                        strokeDasharray="4 4"
                      />
                    ) : null
                  )}
                  {tacticalHudData.windData.orangeArcAttr && (
                    <polyline
                      points={tacticalHudData.windData.orangeArcAttr}
                      fill="none"
                      stroke="#f97316"
                      strokeWidth={3.5}
                      strokeOpacity={0.95}
                    />
                  )}
                </>
              )}
              {/* 조류 흘림선 */}
              {tacticalHudData.currentData?.startPt && tacticalHudData.currentData?.endPt && (
                <line
                  x1={tacticalHudData.currentData.startPt.x}
                  y1={tacticalHudData.currentData.startPt.y}
                  x2={tacticalHudData.currentData.endPt.x}
                  y2={tacticalHudData.currentData.endPt.y}
                  stroke="#06b6d4"
                  strokeWidth={2.2}
                  strokeOpacity={0.9}
                  strokeDasharray="5 3"
                  markerEnd="url(#exfish-arrow-teal)"
                />
              )}
              {/* 캐스팅 중심 파란 화살표 + 수중 침강 흘림 화살표 */}
              {tacticalHudData.hasCasting && tacticalHudData.tipPt && (
                <>
                  <line
                    x1={tacticalHudData.origin.x}
                    y1={tacticalHudData.origin.y}
                    x2={tacticalHudData.tipPt.x}
                    y2={tacticalHudData.tipPt.y}
                    stroke="#2563eb"
                    strokeWidth={4}
                    strokeOpacity={0.95}
                    markerEnd="url(#exfish-arrow-blue)"
                  />
                  {tacticalHudData.subsurfaceEndPt && (
                    <line
                      x1={tacticalHudData.tipPt.x}
                      y1={tacticalHudData.tipPt.y}
                      x2={tacticalHudData.subsurfaceEndPt.x}
                      y2={tacticalHudData.subsurfaceEndPt.y}
                      stroke="#22d3ee"
                      strokeWidth={2.5}
                      strokeOpacity={0.85}
                      strokeDasharray="4 3"
                      markerEnd="url(#exfish-arrow-cyan)"
                    />
                  )}
                </>
              )}
            </g>
          )}

          {/* 5. 스윗 스팟 반경 원 & 연결 점선 + 추가 초안 */}
          {sweetSpotData && (
            <g>
              {sweetSpotData.items.map(({ ss, idx, pt, radiusPx }) =>
                pt ? (
                  <g key={`ss-svg-${ss.id || idx}`}>
                    {sweetSpotData.originPt && (
                      <line
                        x1={sweetSpotData.originPt.x}
                        y1={sweetSpotData.originPt.y}
                        x2={pt.x}
                        y2={pt.y}
                        stroke="#f59e0b"
                        strokeWidth={1.5}
                        strokeOpacity={0.65}
                        strokeDasharray="4 4"
                      />
                    )}
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={Math.max(4, radiusPx)}
                      stroke="#f59e0b"
                      strokeWidth={2}
                      strokeOpacity={0.9}
                      fill="#f59e0b"
                      fillOpacity={0.32}
                    />
                  </g>
                ) : null
              )}
              {sweetSpotData.draft?.pt && (
                <g>
                  {sweetSpotData.originPt && (
                    <line
                      x1={sweetSpotData.originPt.x}
                      y1={sweetSpotData.originPt.y}
                      x2={sweetSpotData.draft.pt.x}
                      y2={sweetSpotData.draft.pt.y}
                      stroke="#fde047"
                      strokeWidth={1.5}
                      strokeOpacity={0.85}
                      strokeDasharray="4 4"
                    />
                  )}
                  <circle
                    cx={sweetSpotData.draft.pt.x}
                    cy={sweetSpotData.draft.pt.y}
                    r={Math.max(5, sweetSpotData.draft.radiusPx)}
                    stroke="#fde047"
                    strokeWidth={2.5}
                    strokeDasharray="4 4"
                    fill="#fde047"
                    fillOpacity={0.28}
                  />
                </g>
              )}
            </g>
          )}

          {/* 6. GPS 오차 반경 원 */}
          {myLocPt && myLocAccPx > 2 && (
            <circle
              cx={myLocPt.x}
              cy={myLocPt.y}
              r={myLocAccPx}
              stroke="#06b6d4"
              strokeWidth={1}
              strokeDasharray="4 4"
              strokeOpacity={0.8}
              fill="#06b6d4"
              fillOpacity={0.12}
            />
          )}

          {/* 7. 미세조정 이동 궤적 점선 */}
          {microOrigPt && microAdjPt && (
            <line
              x1={microOrigPt.x}
              y1={microOrigPt.y}
              x2={microAdjPt.x}
              y2={microAdjPt.y}
              stroke="#10b981"
              strokeWidth={3}
              strokeOpacity={0.9}
              strokeDasharray="5 4"
            />
          )}

          {/* 8. 거리 측정 다중 선분 및 시작/끝점 원 */}
          {measureSegments.map((seg) => {
            const p1 = project(seg.start.lat, seg.start.lng);
            const p2 = project(seg.end.lat, seg.end.lng);
            if (!p1 || !p2) return null;
            return (
              <g key={`ms-svg-${seg.id}`}>
                <line
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke="#38bdf8"
                  strokeWidth={2.5}
                  strokeDasharray="6 4"
                  strokeOpacity={0.95}
                />
                <circle cx={p1.x} cy={p1.y} r={4.5} stroke="#ffffff" strokeWidth={2} fill="#0284c7" />
                <circle cx={p2.x} cy={p2.y} r={4.5} stroke="#ffffff" strokeWidth={2} fill="#06b6d4" />
              </g>
            );
          })}
          {measureDraftStart && (() => {
            const p = project(measureDraftStart.lat, measureDraftStart.lng);
            return p ? (
              <circle cx={p.x} cy={p.y} r={5.5} stroke="#ffffff" strokeWidth={2} fill="#f59e0b" />
            ) : null;
          })()}
        </svg>

        {/* ==================== DOM 인터랙티브 레이어 ==================== */}
        <div className="absolute inset-0 pointer-events-none">
          {/* 1. 금지구역 Point 경고 아이콘 */}
          {level <= 6 &&
            prohibitedZones.map((feat) => {
              if (feat.geometry.type !== 'Point') return null;
              const [lng, lat] = feat.geometry.coordinates;
              const pt = project(lat, lng);
              if (!isInViewport(pt)) return null;
              return (
                <div
                  key={`pz-icon-${feat.properties.zone_id}`}
                  style={{ position: 'absolute', left: pt!.x, top: pt!.y, transform: 'translate(-50%, -50%)' }}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      isMarkerClickRef.current = true;
                      setZoneFeedbackMsg(null);
                      setSelectedZone(feat);
                    }}
                    style={counterScaleStyle}
                    className={`flex h-6 w-6 items-center justify-center rounded-full border border-amber-300 bg-amber-500/90 text-white shadow-md ${
                      isMeasuringDistance ? 'pointer-events-none' : 'pointer-events-auto cursor-pointer'
                    }`}
                    title={feat.properties.zone_name}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}

          {/* 2. 캐스팅 거리 라벨 (30m / 60m / 100m) */}
          {castingSectorData?.arcs.map((arc) =>
            arc.labelPt ? (
              <div
                key={`arc-lbl-${castingSectorData.spotId}-${arc.r}`}
                style={{
                  position: 'absolute',
                  left: arc.labelPt.x,
                  top: arc.labelPt.y,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <div
                  style={counterScaleStyle}
                  className="px-1.5 py-0.5 rounded-full bg-slate-950/90 text-cyan-300 border border-cyan-400/60 text-[9px] font-bold font-mono shadow-md select-none whitespace-nowrap"
                >
                  {arc.r}m
                </div>
              </div>
            ) : null
          )}

          {/* 3. 선택 포인트 착수 수심·안착 HUD + 바람/편류 + 조류 라벨 */}
          {tacticalHudData && (
            <>
              {tacticalHudData.hasCasting && tacticalHudData.badgePt && (
                <div
                  style={{
                    position: 'absolute',
                    left: tacticalHudData.badgePt.x,
                    top: tacticalHudData.badgePt.y,
                    transform:
                      tacticalHudData.bearing > 110 && tacticalHudData.bearing < 250
                        ? 'translate(-50%, 10%)'
                        : 'translate(-50%, -115%)',
                    zIndex: 35,
                  }}
                >
                  <div style={counterScaleStyle} className="select-none max-w-[260px] sm:max-w-none">
                    <div className="px-2.5 py-1 rounded-xl bg-slate-950/95 text-cyan-300 border border-cyan-500/80 text-[9px] sm:text-[10px] font-mono font-bold shadow-lg flex flex-col items-center justify-center leading-tight gap-0.5 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <span className="text-sky-200">{getTackleShortLabel(tackleConfig)}</span>
                        <span>
                          {tacticalHudData.landingDepthInfo.isExposed
                            ? '간출(0m)'
                            : `수심 ${tacticalHudData.landingDepth.toFixed(1)}m`}
                        </span>
                        {tacticalHudData.sinkPhysics.driftDistanceM > 0.3 && (
                          <span className="text-emerald-300">
                            , 흘림 +{tacticalHudData.sinkPhysics.driftDistanceM}m
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-amber-300">안착 {tacticalHudData.sinkPhysics.fallTimeSec}초</span>
                        <span className="text-cyan-200">
                          하강 {Math.round(tacticalHudData.sinkPhysics.effSinkSpeedMps * 100)}cm/s
                        </span>
                        {tacticalHudData.sinkPhysics.canReachBottom === false && (
                          <span className="text-rose-400">
                            · {tacticalHudData.sinkPhysics.recommendedMinWeightG}g+ 권장
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {tacticalHudData.windData?.windBadgePt && (
                <div
                  style={{
                    position: 'absolute',
                    left: tacticalHudData.windData.windBadgePt.x,
                    top: tacticalHudData.windData.windBadgePt.y,
                    transform: 'translate(-50%, -50%)',
                    zIndex: 34,
                  }}
                >
                  <div
                    style={counterScaleStyle}
                    className="px-2 py-0.5 rounded-full text-[9px] font-bold font-mono shadow-xl border select-none whitespace-nowrap flex items-center gap-1 bg-slate-950/95 text-cyan-300 border-cyan-400/80"
                  >
                    <span
                      className="inline-block text-[10px]"
                      style={{ transform: `rotate(${tacticalHudData.windData.windDirection}deg)` }}
                    >
                      ↓
                    </span>
                    <span>{formatWindSpeed(tacticalHudData.windData.windSpeed, windUnit)}</span>
                  </div>
                </div>
              )}

              {tacticalHudData.hasCasting &&
                tacticalHudData.windData?.driftBadges.map((db, idx) =>
                  db.pt ? (
                    <div
                      key={`dbadge-${idx}`}
                      style={{
                        position: 'absolute',
                        left: db.pt.x,
                        top: db.pt.y,
                        transform: 'translate(-50%, -50%)',
                        zIndex: 33,
                      }}
                    >
                      <div
                        style={counterScaleStyle}
                        className="px-2 py-0.5 rounded-full bg-slate-950/95 text-orange-400 border border-orange-500 font-extrabold font-mono text-[11px] sm:text-xs shadow-xl select-none whitespace-nowrap flex items-center gap-1"
                      >
                        <span>{db.actualDistanceM}m</span>
                        {db.driftDistanceM >= 1.0 && (
                          <span className="text-[10px] text-amber-300 font-semibold">
                            ({db.driftAngleDeg > 0 ? '우' : '좌'} {db.driftDistanceM}m)
                          </span>
                        )}
                      </div>
                    </div>
                  ) : null
                )}

              {tacticalHudData.currentData?.midPt && (
                <div
                  style={{
                    position: 'absolute',
                    left: tacticalHudData.currentData.midPt.x,
                    top: tacticalHudData.currentData.midPt.y,
                    transform: 'translate(-50%, -50%)',
                    zIndex: 34,
                  }}
                >
                  <div
                    style={counterScaleStyle}
                    className="px-1.5 py-0.5 rounded-full bg-slate-950/95 text-cyan-300 border border-cyan-500/70 text-[9px] font-bold shadow-md select-none whitespace-nowrap flex items-center gap-1"
                  >
                    <span
                      className="inline-block text-[10px] text-emerald-400"
                      style={{ transform: `rotate(${tacticalHudData.currentData.direction}deg)` }}
                    >
                      ↑
                    </span>
                    <span className="font-mono">
                      {formatCurrentVelocity(tacticalHudData.currentData.velocity, currentUnit)}
                    </span>
                  </div>
                </div>
              )}
            </>
          )}

          {/* 4. 스윗 스팟 앰버 뱃지 & 초안 거리 뱃지 */}
          {sweetSpotData?.items.map(({ ss, idx, pt }) => {
            if (!pt) return null;
            const ssKey = ss.id || `idx-${idx}`;
            const isExpanded = expandedSweetId === ssKey;
            const memo = ss.memo || '';
            const shortMemo = memo.length > 10 ? `${memo.slice(0, 10)}…` : memo;
            return (
              <div
                key={`ss-dom-${ssKey}`}
                style={{
                  position: 'absolute',
                  left: pt.x,
                  top: pt.y,
                  transform: 'translate(-50%, -50%)',
                  zIndex: 36,
                }}
              >
                <div
                  style={counterScaleStyle}
                  className={`flex flex-col items-center select-none whitespace-nowrap ${
                    isMeasuringDistance ? 'pointer-events-none' : 'pointer-events-auto cursor-pointer'
                  }`}
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
                    {sweetSpotData.isConfig && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          isMarkerClickRef.current = true;
                          setPendingDeleteSweetIdx(idx);
                        }}
                        className="ml-0.5 px-1 py-0.2 rounded bg-rose-600 hover:bg-rose-700 text-white font-bold text-[9px] shadow active:scale-95 transition cursor-pointer"
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
              </div>
            );
          })}
          {sweetSpotData?.draft?.pt && (
            <div
              style={{
                position: 'absolute',
                left: sweetSpotData.draft.pt.x,
                top: sweetSpotData.draft.pt.y,
                transform: 'translate(-50%, -50%)',
                zIndex: 37,
              }}
            >
              <div
                style={counterScaleStyle}
                className="px-1.5 py-0.5 rounded-full bg-yellow-300 text-slate-950 text-[10px] font-black shadow-lg border border-white whitespace-nowrap"
              >
                {sweetSpotData.draft.distM}m
              </div>
            </div>
          )}

          {/* 5. 내 현재 GPS 위치 펄스 마커 */}
          {myLocPt && (
            <div
              style={{
                position: 'absolute',
                left: myLocPt.x,
                top: myLocPt.y,
                transform: 'translate(-50%, -50%)',
                zIndex: 42,
              }}
            >
              <div
                style={counterScaleStyle}
                className="relative flex items-center justify-center"
                title={`현재 내 위치 (GPS 오차 반경 약 ±${Math.round(gpsAccuracy || 10)}m)`}
              >
                <div className="w-6 h-6 rounded-full bg-blue-500/30 animate-ping absolute" />
                <div className="w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow-lg" />
              </div>
            </div>
          )}

          {/* 6. 새 포인트 등록 위치 핑 마커 */}
          {pendingSpotPt && (
            <div
              style={{
                position: 'absolute',
                left: pendingSpotPt.x,
                top: pendingSpotPt.y,
                transform: 'translate(-50%, -50%)',
                zIndex: 48,
              }}
            >
              <div style={counterScaleStyle} className="relative flex items-center justify-center">
                <div className="w-9 h-9 rounded-full bg-cyan-400/40 animate-ping absolute" />
                <div className="w-7 h-7 rounded-full bg-cyan-500 border-2 border-white shadow-2xl flex items-center justify-center text-sm">
                  📍
                </div>
              </div>
            </div>
          )}

          {/* 7. 등록된 포인트 커스텀 핀 (MaterialSpotMarker - VWorld·카카오맵 100% 동일) */}
          {displayedSpots.map((spot) => {
            if (microAdjustSpot?.id === spot.id) return null;
            const pt = project(spot.lat, spot.lng);
            const isSelected = selectedSpot?.id === spot.id;
            if (!isSelected && !isInViewport(pt)) return null;
            if (!pt) return null;
            const isFavorited = favoriteSpotIds.includes(spot.id);

            return (
              <div
                key={`spot-unified-${spot.id}`}
                style={{
                  position: 'absolute',
                  left: pt.x,
                  top: pt.y,
                  transform: 'translate(-50%, -50%)',
                  zIndex: isSelected ? 45 : 25,
                }}
              >
                <div
                  style={counterScaleStyle}
                  onPointerDown={(e) => {
                    if (isMeasuringDistance) return;
                    e.stopPropagation();
                    isLongPressTriggeredRef.current = false;
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
                    if (isMeasuringDistance || isCoarsePointer) return;
                    e.stopPropagation();
                    isMarkerClickRef.current = true;
                    onOpenContextMenu(spot);
                  }}
                  onContextMenu={(e) => {
                    if (isMeasuringDistance) return;
                    e.preventDefault();
                    e.stopPropagation();
                    isMarkerClickRef.current = true;
                    onOpenContextMenu(spot);
                  }}
                  onClick={(e) => {
                    if (isMeasuringDistance) return;
                    e.stopPropagation();
                    isMarkerClickRef.current = true;
                    if (isLongPressTriggeredRef.current) {
                      isLongPressTriggeredRef.current = false;
                      return;
                    }
                    if (Date.now() - lastMultiTouchAtRef.current < 600) return;
                    setPendingNewSpot(null);
                    setContextMenuSpot(null);
                    skipAutoRecenterRef.current = true;
                    if (onOpenDetail) {
                      onOpenDetail(spot);
                    } else {
                      onSelectSpot(spot);
                    }
                  }}
                  className={`relative flex items-center justify-center group select-none ${
                    isMeasuringDistance ? 'pointer-events-none' : 'pointer-events-auto cursor-pointer'
                  }`}
                  title={`${spot.name} (클릭: 선택/상세, 길게 누르거나 더블클릭: 메뉴)`}
                >
                  <MaterialSpotMarker
                    methods={spot.fishing_methods}
                    isSelected={isSelected}
                    isFavorited={isFavorited}
                  />
                  <div className="absolute top-full mt-1.5 flex flex-col items-center">
                    <span className="px-2 py-0.5 rounded-lg bg-slate-950/95 border border-slate-700/80 text-[11px] sm:text-xs text-white font-bold whitespace-nowrap shadow-xl">
                      {spot.name}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}

          {/* 8. 공용 낚시점 마커 */}
          {shops.map((shop) => {
            const pt = project(shop.lat, shop.lng);
            const isShopSelected = selectedShop?.id === shop.id;
            if (!isShopSelected && !isInViewport(pt)) return null;
            if (!pt) return null;
            return (
              <div
                key={`shop-unified-${shop.id}`}
                style={{
                  position: 'absolute',
                  left: pt.x,
                  top: pt.y,
                  transform: 'translate(-50%, -50%)',
                  zIndex: isShopSelected ? 32 : 22,
                }}
              >
                <div
                  style={counterScaleStyle}
                  onClick={(e) => {
                    if (isMeasuringDistance) return;
                    e.stopPropagation();
                    isMarkerClickRef.current = true;
                    setPendingNewSpot(null);
                    setContextMenuSpot(null);
                    skipAutoRecenterRef.current = true;
                    onSelectShop?.(shop);
                  }}
                  className={`relative flex items-center justify-center group select-none ${
                    isMeasuringDistance ? 'pointer-events-none' : 'pointer-events-auto cursor-pointer'
                  }`}
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
              </div>
            );
          })}

          {/* 9. 미세조정 기존 고스트 마커 + 통합 포인터 드래그 타깃 핀 */}
          {microAdjustSpot && adjustedPos && (
            <>
              {microOrigPt && (
                <div
                  style={{
                    position: 'absolute',
                    left: microOrigPt.x,
                    top: microOrigPt.y,
                    transform: 'translate(-50%, -100%)',
                    zIndex: 40,
                  }}
                >
                  <div style={counterScaleStyle} className="flex flex-col items-center opacity-65">
                    <div className="w-7 h-7 rounded-full border-2 border-dashed border-rose-400 bg-rose-500/20 flex items-center justify-center text-[10px] text-rose-300 font-bold shadow">
                      기존
                    </div>
                    <div className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[6px] border-t-rose-400" />
                    <span className="text-[10px] text-rose-300 font-mono bg-slate-900/90 px-1 rounded border border-rose-500/30 whitespace-nowrap">
                      이전 위치
                    </span>
                  </div>
                </div>
              )}
              {microAdjPt && (
                <>
                  <div
                    style={{
                      position: 'absolute',
                      left: microAdjPt.x,
                      top: microAdjPt.y,
                      transform: 'translate(-50%, -50%)',
                      zIndex: 50,
                    }}
                  >
                    <div
                      style={counterScaleStyle}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        isMarkerClickRef.current = true;
                        isDraggingAdjustMarkerRef.current = true;
                        lastClientPosRef.current = { x: e.clientX, y: e.clientY };
                      }}
                      className="w-11 h-11 flex items-center justify-center cursor-grab active:cursor-grabbing select-none pointer-events-auto"
                      title="발판 위치로 드래그"
                    >
                      <div className="w-6 h-6 rounded-full bg-emerald-400 border-2 border-white shadow-xl flex items-center justify-center text-xs animate-pulse">
                        🎯
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      position: 'absolute',
                      left: microAdjPt.x,
                      top: microAdjPt.y - 30,
                      transform: 'translate(-50%, -100%)',
                      zIndex: 51,
                    }}
                  >
                    <div
                      style={counterScaleStyle}
                      className="px-3 py-1 rounded-full bg-slate-950/95 border-2 border-emerald-400 text-emerald-300 font-bold text-xs shadow-2xl flex items-center gap-1.5 whitespace-nowrap animate-pulse"
                    >
                      <span>👆 핀을 드래그하여 정확한 발판으로 옮기세요</span>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* 10. 거리 측정 끝점 거리(m) 뱃지 및 시작점 뱃지 */}
          {measureSegments.map((seg) => {
            const p2 = project(seg.end.lat, seg.end.lng);
            if (!p2) return null;
            return (
              <div
                key={`ms-lbl-${seg.id}`}
                style={{
                  position: 'absolute',
                  left: p2.x + 10,
                  top: p2.y,
                  transform: 'translate(0, -50%)',
                  zIndex: 47,
                }}
              >
                <div
                  style={counterScaleStyle}
                  className="px-2 py-0.5 rounded-full bg-slate-950/92 text-cyan-300 border border-sky-400 text-[11px] font-extrabold font-mono shadow-lg whitespace-nowrap"
                >
                  {seg.distanceM.toLocaleString()}m
                </div>
              </div>
            );
          })}
          {measureDraftStart && (() => {
            const p = project(measureDraftStart.lat, measureDraftStart.lng);
            return p ? (
              <div
                style={{
                  position: 'absolute',
                  left: p.x,
                  top: p.y - 12,
                  transform: 'translate(-50%, -100%)',
                  zIndex: 47,
                }}
              >
                <div
                  style={counterScaleStyle}
                  className="px-1.5 py-0.5 rounded-full bg-slate-950/90 text-amber-300 border border-amber-500 text-[10px] font-bold whitespace-nowrap shadow"
                >
                  시작점
                </div>
              </div>
            ) : null;
          })()}
        </div>
      </div>

      {/* 금지구역 클릭 상세 모달 카드 (VWorld·카카오맵 공통) */}
      {selectedZone && (
        <div
          className="fixed inset-x-0 bottom-20 z-[65] mx-auto w-[calc(100%-24px)] max-w-md rounded-2xl border border-slate-700 bg-slate-900/95 p-4 text-slate-100 shadow-2xl backdrop-blur-md pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldAlert
                className={`h-5 w-5 shrink-0 ${
                  selectedZone.properties.tier === 'confirmed_polygon'
                    ? 'text-red-400'
                    : selectedZone.properties.tier === 'community_reported'
                    ? 'text-orange-400'
                    : 'text-amber-400'
                }`}
              />
              <div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      selectedZone.properties.tier === 'confirmed_polygon'
                        ? 'bg-red-500/20 text-red-300'
                        : selectedZone.properties.tier === 'community_reported'
                        ? 'bg-orange-500/20 text-orange-300'
                        : 'bg-amber-500/20 text-amber-300'
                    }`}
                  >
                    {selectedZone.properties.tier === 'confirmed_polygon'
                      ? '공공 고시'
                      : selectedZone.properties.tier === 'community_reported'
                      ? '사용자 제보 · 공식 고시 미확인'
                      : '인근 통제고시 주의'}
                  </span>
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                    {SCOPE_LABELS[selectedZone.properties.restriction_scope] || '연중 제한'}
                  </span>
                </div>
                <h4 className="mt-1 text-sm font-bold text-white">{selectedZone.properties.zone_name}</h4>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedZone(null)}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <p className="mt-2 text-xs leading-relaxed text-slate-300">{selectedZone.properties.reason}</p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
            <span>출처: {selectedZone.properties.source_agency}</span>
            {selectedZone.properties.notice_number && (
              <span>고시/도호: {selectedZone.properties.notice_number}</span>
            )}
          </div>
          <p className="mt-2 text-[10px] text-slate-500">
            * 참고용 안내이며 실제 낚시 가능 여부는 현장 표지판 및 지자체 고시가 우선합니다.
          </p>

          {zoneFeedbackMsg && (
            <div className="mt-2 rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs text-amber-300">
              {zoneFeedbackMsg}
            </div>
          )}

          <div className="mt-3 flex items-center justify-end gap-2">
            {selectedZone.properties.tier === 'community_reported' && currentUser && (
              <button
                type="button"
                disabled={zoneBusy}
                onClick={handleZoneFlag}
                className="flex items-center gap-1 rounded-lg border border-orange-500/40 bg-orange-500/10 px-2.5 py-1.5 text-xs font-medium text-orange-300 hover:bg-orange-500/20 disabled:opacity-50"
              >
                <Flag className="h-3.5 w-3.5" />
                허위/오탐 신고
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                disabled={zoneBusy}
                onClick={handleZoneAdminDelete}
                className="flex items-center gap-1 rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                금지구역 삭제(비노출)
              </button>
            )}
          </div>
        </div>
      )}

      {/* 금지구역 작도 컨트롤 */}
      <ZoneDigitizer
        active={isDigitizingZones}
        points={digitizerPoints}
        currentUser={currentUser}
        onUndo={onUndoDigitize}
        onReset={onResetDigitize}
        onCancel={onCancelDigitize}
        onSuccess={onSuccessDigitize}
      />
    </>
  );
};
