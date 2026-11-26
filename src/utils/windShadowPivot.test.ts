import { describe, it, expect } from 'vitest';
import { findWindShadowSpots } from './windShadowPivot';
import type { FishingSpot } from '../types';

function makeSpot(id: string, lat: number, lng: number, start?: number, end?: number, dirs?: string[]): FishingSpot {
  return {
    id,
    user_id: 'u1',
    author_name: 'a',
    is_public: true,
    name: id,
    spot_type: 'ROCK',
    lat,
    lng,
    directions: '',
    photo_urls: [],
    fishing_methods: ['LURE'],
    target_species: ['우럭'],
    casting_start_deg: start,
    casting_end_deg: end,
    casting_directions: dirs,
    created_at: '2026-11-01T00:00:00Z',
  };
}

describe('windShadowPivot', () => {
  it('finds top tailwind spots within 20km and supports legacy casting_directions fallback', () => {
    const origin = makeSpot('origin', 37.25, 126.49, 315, 45); // 북쪽 캐스팅, 북풍(0°) 맞바람 상황
    const spots = [
      origin,
      makeSpot('tail-near', 37.28, 126.50, 135, 225), // 남쪽(180°) 캐스팅 -> 등바람 180° (~3.4km)
      makeSpot('tail-legacy', 37.26, 126.52, undefined, undefined, ['남동', '남']), // ~158° 등바람
      makeSpot('head-near', 37.26, 126.49, 330, 30), // 북쪽(0°) -> 맞바람 제외
      makeSpot('too-far', 37.60, 126.50, 135, 225), // ~39km > 20km 제외
      makeSpot('no-arc', 37.25, 126.50), // 아크 미설정 제외
    ];

    const res = findWindShadowSpots(origin, spots, 0, 20, 3);
    expect(res.tailwindSpots.map((c) => c.spot.id)).toEqual(['tail-near', 'tail-legacy']);
  });
});
