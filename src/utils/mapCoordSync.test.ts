import { describe, it, expect } from 'vitest';
import {
  computeApproxViewportBounds,
  kakaoLevelToLeafletZoom,
  leafletZoomToKakaoLevel,
  normalizeWgs84Center,
} from './mapCoordSync';

describe('mapCoordSync (Kakao EPSG:5181 <-> VWorld EPSG:3857)', () => {
  it('maps Kakao level 1..14 to Leaflet zoom 19..6 consistently', () => {
    expect(kakaoLevelToLeafletZoom(1)).toBe(19);
    expect(kakaoLevelToLeafletZoom(2)).toBe(18);
    expect(kakaoLevelToLeafletZoom(6)).toBe(14);
    expect(kakaoLevelToLeafletZoom(12)).toBe(8);
    expect(kakaoLevelToLeafletZoom(14)).toBe(6);

    for (let lvl = 1; lvl <= 14; lvl++) {
      const z = kakaoLevelToLeafletZoom(lvl);
      expect(leafletZoomToKakaoLevel(z)).toBe(lvl);
    }
  });

  it('preserves WGS84 center coordinates across provider switches', () => {
    const spotCenter = { lat: 35.8684123, lng: 126.5065589 };
    const normalized = normalizeWgs84Center(spotCenter);
    expect(normalized.lat).toBeCloseTo(35.8684123, 6);
    expect(normalized.lng).toBeCloseTo(126.5065589, 6);
  });

  it('computes symmetric viewport bounds that expand on zoom out', () => {
    const center = { lat: 35.8684, lng: 126.5066 };
    const b1 = computeApproxViewportBounds(center, 1);
    const b6 = computeApproxViewportBounds(center, 6);
    expect(b6.maxLat - b6.minLat).toBeGreaterThan(b1.maxLat - b1.minLat);
    expect(b1.minLat).toBeLessThan(center.lat);
    expect(b1.maxLat).toBeGreaterThan(center.lat);
  });
});
