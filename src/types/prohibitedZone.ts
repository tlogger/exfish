export type ZoneTier = 'confirmed_polygon' | 'community_reported' | 'caution_point';

export type RestrictionScope = 'all_year' | 'seasonal' | 'night_only';

export interface ZoneProperties {
  zone_id: string;
  raw_id?: string;
  tier: ZoneTier;
  zone_name: string;
  restriction_scope: RestrictionScope;
  effective_period?: string | null;
  notice_number?: string | null;
  reason: string;
  source_agency: string;
  source_url?: string | null;
  radius_m?: number;
  verified_at: string;
}

export type ZoneGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }
  | { type: 'Point'; coordinates: [number, number] };

export interface ProhibitedZoneFeature {
  type: 'Feature';
  geometry: ZoneGeometry;
  properties: ZoneProperties;
}

export interface ZoneManifest {
  version: string;
  cellSizeDeg: number;
  staticWatermark: string;
  availableCells: string[];
  generatedAt: string;
  featureCount?: number;
}

export interface ZonesDeltaResponse {
  activeZones: ProhibitedZoneFeature[];
  suppressedZoneIds: string[];
  generatedAt: string;
}

export interface ZoneHitResult {
  feature: ProhibitedZoneFeature;
  tier: ZoneTier;
  distanceM?: number;
}

export interface PendingZoneMutation {
  id: string;
  kind: 'add' | 'delete';
  committedAt: string;
  feature?: ProhibitedZoneFeature;
  zoneId?: string;
}
