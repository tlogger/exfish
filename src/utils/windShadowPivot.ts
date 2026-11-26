// 풍향 시프트 기반 '등바람 대피 포인트' 자동 추천 (Wind-Shadow Pivot)
// 로컬 캐시된 포인트 중 반경 20km 이내 + 현재/예보 풍향 대비 등바람(사잇각 >= 120°) 상위 3곳을 <5ms 로컬 기하 연산으로 추출
import type { FishingSpot, RelativeWindClass } from '../types';
import { classifyRelativeWind, resolveCastCenterDeg } from './spotComparison';

export interface WindShadowCandidate {
  spot: FishingSpot;
  distanceKm: number;
  castCenterDeg: number;
  relativeWindAngleDeg: number;
  windClass: RelativeWindClass;
}

export interface WindShadowResult {
  tailwindSpots: WindShadowCandidate[];
  crosswindFallback: WindShadowCandidate[];
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function findWindShadowSpots(
  originSpot: Pick<FishingSpot, 'id' | 'lat' | 'lng'>,
  allCachedSpots: FishingSpot[],
  windDirectionFromDeg: number,
  maxRadiusKm: number = 20,
  topN: number = 3
): WindShadowResult {
  const tailwinds: WindShadowCandidate[] = [];
  const crosswinds: WindShadowCandidate[] = [];

  for (const spot of allCachedSpots) {
    if (spot.id === originSpot.id || spot.is_deleted) continue;

    const distanceKm = haversineKm(originSpot.lat, originSpot.lng, spot.lat, spot.lng);
    if (distanceKm > maxRadiusKm) continue;

    const castCenterDeg = resolveCastCenterDeg(spot);
    if (castCenterDeg == null) continue;

    const { angleDiff, windClass } = classifyRelativeWind(castCenterDeg, windDirectionFromDeg);
    if (angleDiff == null) continue;

    const candidate: WindShadowCandidate = {
      spot,
      distanceKm: Math.round(distanceKm * 10) / 10,
      castCenterDeg,
      relativeWindAngleDeg: angleDiff,
      windClass,
    };

    if (windClass === 'TAILWIND') {
      tailwinds.push(candidate);
    } else if (windClass === 'CROSSWIND') {
      crosswinds.push(candidate);
    }
  }

  // 등바람은 사잇각이 180°에 가까울수록(완전 등바람) 우선, 동률이면 가까운 거리 우선
  tailwinds.sort((a, b) => (b.relativeWindAngleDeg - a.relativeWindAngleDeg) || (a.distanceKm - b.distanceKm));
  crosswinds.sort((a, b) => (b.relativeWindAngleDeg - a.relativeWindAngleDeg) || (a.distanceKm - b.distanceKm));

  return {
    tailwindSpots: tailwinds.slice(0, topN),
    crosswindFallback: crosswinds.slice(0, topN),
  };
}
