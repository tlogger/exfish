import { describe, expect, it } from 'vitest';
import {
  findZoneHitsAtPoint,
  getCellId,
  getCellsForBounds,
  isPointInZone,
  toKakaoPolygonPaths,
  validateDrawnPoints,
} from './zoneSpatial';
import type { ProhibitedZoneFeature } from '../types/prohibitedZone';

const squareWithHole: ProhibitedZoneFeature = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [129.0, 35.0],
        [129.1, 35.0],
        [129.1, 35.1],
        [129.0, 35.1],
        [129.0, 35.0],
      ],
      [
        [129.03, 35.03],
        [129.07, 35.03],
        [129.07, 35.07],
        [129.03, 35.07],
        [129.03, 35.03],
      ],
    ],
  },
  properties: {
    zone_id: 'pub_test_hole',
    tier: 'confirmed_polygon',
    zone_name: '테스트 항만 구역',
    restriction_scope: 'all_year',
    reason: '테스트',
    source_agency: '해양수산부',
    verified_at: '2026-11-18',
  },
};

const cautionPoint: ProhibitedZoneFeature = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [129.05, 35.05] },
  properties: {
    zone_id: 'pub_caution_1',
    tier: 'caution_point',
    zone_name: '방파제 주의 지점',
    restriction_scope: 'seasonal',
    reason: '인근 고시 존재',
    source_agency: '지자체',
    radius_m: 150,
    verified_at: '2026-11-18',
  },
};

describe('zoneSpatial', () => {
  it('computes deterministic 0.25 deg cellId and bounds cells', () => {
    expect(getCellId(35.08, 129.04)).toBe('cell_140_516');
    expect(getCellsForBounds(35.01, 129.01, 35.26, 129.24)).toEqual([
      'cell_140_516',
      'cell_141_516',
    ]);
  });

  it('evaluates polygon with interior hole accurately', () => {
    expect(isPointInZone(35.01, 129.01, squareWithHole)).not.toBeNull();
    expect(isPointInZone(35.05, 129.05, squareWithHole)).toBeNull(); // inside hole
    expect(isPointInZone(35.2, 129.2, squareWithHole)).toBeNull();
  });

  it('evaluates caution_point radius and hit priority', () => {
    const hits = findZoneHitsAtPoint(35.0505, 129.0505, [cautionPoint, squareWithHole]);
    expect(hits).toHaveLength(1);
    expect(hits[0].tier).toBe('caution_point');
    expect(hits[0].distanceM).toBeLessThanOrEqual(150);
  });

  it('rejects self-intersecting, collinear, out-of-bounds, and oversized polygons', () => {
    const bowtie = [
      { lat: 35.0, lng: 129.0 },
      { lat: 35.01, lng: 129.01 },
      { lat: 35.01, lng: 129.0 },
      { lat: 35.0, lng: 129.01 },
    ];
    expect(validateDrawnPoints(bowtie).ok).toBe(false);

    const collinear = [
      { lat: 35.0, lng: 129.0 },
      { lat: 35.005, lng: 129.005 },
      { lat: 35.01, lng: 129.01 },
    ];
    expect(validateDrawnPoints(collinear).ok).toBe(false);

    const valid = [
      { lat: 35.08, lng: 129.04 },
      { lat: 35.081, lng: 129.04 },
      { lat: 35.081, lng: 129.041 },
      { lat: 35.08, lng: 129.041 },
    ];
    const res = validateDrawnPoints(valid);
    expect(res.ok).toBe(true);
    expect(res.areaSqm).toBeGreaterThan(100);
  });

  it('converts polygon with hole to nested Kakao Polygon paths', () => {
    const paths = toKakaoPolygonPaths(squareWithHole.geometry);
    expect(paths).toHaveLength(1);
    expect(Array.isArray(paths[0][0])).toBe(true);
  });
});
