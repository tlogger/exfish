import React from 'react';
import { FishingSpot } from '../types';
import { KhoaDepthRecord } from './khoaApi';
import { get150mGridKey, getCachedKhoaDepth } from './khoaCache';

export interface CastingLandingPoint {
  hasCasting: boolean;
  bearingDeg: number | undefined;
  distanceM: number;
  lat: number;
  lng: number;
}

const COMPASS_DEG_MAP: Record<string, number> = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
};

/** 위경도, 방위각(deg), 거리(m)로부터 착수 지점 위경도 계산 */
export function calculateLandingDestination(
  lat: number,
  lng: number,
  bearingDeg: number,
  distanceM: number
): [number, number] {
  const R = 6371000;
  const brng = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lng * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distanceM / R) +
      Math.cos(lat1) * Math.sin(distanceM / R) * Math.cos(brng)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(distanceM / R) * Math.cos(lat1),
      Math.cos(distanceM / R) - Math.sin(lat1) * Math.sin(lat2)
    );

  return [(lat2 * 180) / Math.PI, (lon2 * 180) / Math.PI];
}

/**
 * 포인트의 캐스팅 가능 부채꼴 정중앙 방위각 + 현재 선택 채비의 예상 비거리를 이용해
 * 실제 채비 착수 지점(landingLat, landingLng)을 산출합니다.
 */
export function computeCastingLandingPoint(
  spot: Pick<FishingSpot, 'lat' | 'lng' | 'casting_start_deg' | 'casting_end_deg' | 'casting_directions'>,
  calibratedDistanceMeters: number
): CastingLandingPoint {
  let startDeg = spot.casting_start_deg;
  let endDeg = spot.casting_end_deg;

  if (startDeg === undefined || endDeg === undefined) {
    const firstDir = spot.casting_directions?.find((d) => d !== 'ALL');
    if (firstDir && COMPASS_DEG_MAP[firstDir] !== undefined) {
      const center = COMPASS_DEG_MAP[firstDir];
      startDeg = (center - 30 + 360) % 360;
      endDeg = (center + 30) % 360;
    }
  }

  if (startDeg === undefined || endDeg === undefined) {
    return {
      hasCasting: false,
      bearingDeg: undefined,
      distanceM: 0,
      lat: spot.lat,
      lng: spot.lng,
    };
  }

  const span = endDeg >= startDeg ? endDeg - startDeg : 360 - startDeg + endDeg;
  const bearingDeg = (startDeg + span / 2) % 360;
  const distanceM = Math.max(8, Math.round(calibratedDistanceMeters));
  const [lat, lng] = calculateLandingDestination(spot.lat, spot.lng, bearingDeg, distanceM);

  return {
    hasCasting: true,
    bearingDeg,
    distanceM,
    lat,
    lng,
  };
}

/**
 * 착수 지점(landingLat, landingLng) 기준 KHOA 150m 격자 수심을 조회합니다.
 * - 포인트 변경 시 즉시 조회
 * - 비거리 슬라이더 변경 시 250ms 디바운스
 * - 동일 150m 격자 키 내에서는 중복 재조회 차단
 */
export function useLandingKhoaDepth(
  spot: FishingSpot | null | undefined,
  calibratedDistanceMeters: number
): { landingPoint: CastingLandingPoint | null; khoaDepthRecord: KhoaDepthRecord | null } {
  const landingPoint = React.useMemo(() => {
    if (!spot) return null;
    return computeCastingLandingPoint(spot, calibratedDistanceMeters);
  }, [
    spot?.id,
    spot?.lat,
    spot?.lng,
    spot?.casting_start_deg,
    spot?.casting_end_deg,
    spot?.casting_directions,
    calibratedDistanceMeters,
  ]);

  const gridKey = landingPoint ? get150mGridKey(landingPoint.lat, landingPoint.lng) : null;
  const [khoaDepthRecord, setKhoaDepthRecord] = React.useState<KhoaDepthRecord | null>(null);
  const lastSpotIdRef = React.useRef<string | null>(null);
  const lastFetchedGridKeyRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!spot || !landingPoint || !gridKey) {
      setKhoaDepthRecord(null);
      lastSpotIdRef.current = null;
      lastFetchedGridKeyRef.current = null;
      return;
    }

    const isSpotChanged = lastSpotIdRef.current !== spot.id;
    if (!isSpotChanged && lastFetchedGridKeyRef.current === gridKey) {
      return;
    }

    let cancelled = false;
    const runFetch = () => {
      lastSpotIdRef.current = spot.id;
      lastFetchedGridKeyRef.current = gridKey;
      getCachedKhoaDepth(landingPoint.lat, landingPoint.lng)
        .then((rec) => {
          if (!cancelled) setKhoaDepthRecord(rec);
        })
        .catch(() => {});
    };

    if (isSpotChanged) {
      runFetch();
      return () => {
        cancelled = true;
      };
    }

    const timer = setTimeout(runFetch, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [spot?.id, gridKey, landingPoint?.lat, landingPoint?.lng]);

  return { landingPoint, khoaDepthRecord };
}
