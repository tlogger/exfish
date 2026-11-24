import type {
  FishingSpot,
  FishingShop,
  SweetSpot,
  WeatherData,
  MarineData,
  CurrentUnit,
  WindUnit,
  TideDayInfo,
} from '../types';
import type { ProhibitedZoneFeature } from '../types/prohibitedZone';
import type { AuthUser } from './LoginModal';
import type { TackleRigConfig } from '../utils/tackleCalibration';
import type { CastingLandingPoint } from '../utils/castingLanding';

export type MapMode = 'ROADMAP' | 'HYBRID' | 'DARK';

export interface MapCanvasBridge {
  latLngToScreen: (lat: number, lng: number) => { x: number; y: number } | null;
  screenToLatLng: (clientX: number, clientY: number) => { lat: number; lng: number } | null;
  panByPixels: (dx: number, dy: number) => void;
}

export const CASTING_BEARINGS: Record<string, { deg: number; label: string }> = {
  N: { deg: 0, label: '북(N)' },
  NE: { deg: 45, label: '북동(NE)' },
  E: { deg: 90, label: '동(E)' },
  SE: { deg: 135, label: '남동(SE)' },
  S: { deg: 180, label: '남(S)' },
  SW: { deg: 225, label: '남서(SW)' },
  W: { deg: 270, label: '서(W)' },
  NW: { deg: 315, label: '북서(NW)' },
};

export function calculateDestinationPoint(
  lat: number,
  lng: number,
  bearingDeg: number,
  distanceMeters: number
): [number, number] {
  const R = 6378137;
  const d = distanceMeters;
  const bearing = (bearingDeg * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;

  const endLatRad = Math.asin(
    Math.sin(latRad) * Math.cos(d / R) +
      Math.cos(latRad) * Math.sin(d / R) * Math.cos(bearing)
  );
  const endLngRad =
    lngRad +
    Math.atan2(
      Math.sin(bearing) * Math.sin(d / R) * Math.cos(latRad),
      Math.cos(d / R) - Math.sin(latRad) * Math.sin(endLatRad)
    );

  return [(endLatRad * 180) / Math.PI, (endLngRad * 180) / Math.PI];
}

export function calculateDistanceAndBearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): { distance: number; bearing: number } {
  const R = 6378137;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const rLat1 = (lat1 * Math.PI) / 180;
  const rLat2 = (lat2 * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = Math.round(R * c);
  const y = Math.sin(dLng) * Math.cos(rLat2);
  const x =
    Math.cos(rLat1) * Math.sin(rLat2) -
    Math.sin(rLat1) * Math.cos(rLat2) * Math.cos(dLng);
  let bearing = Math.round((Math.atan2(y, x) * 180) / Math.PI);
  if (bearing < 0) bearing += 360;
  return { distance, bearing: bearing % 360 };
}

export interface SharedMapCanvasProps {
  center: { lat: number; lng: number };
  level: number;
  digitalZoom: number;
  mapMode: MapMode;
  isDarkMode: boolean;
  isSunMode: boolean;
  onCenterChange: (center: { lat: number; lng: number }) => void;
  onLevelChange: (level: number) => void;
  onWheelDigitalZoom: (deltaY: number) => void;
  bridgeRef: React.MutableRefObject<MapCanvasBridge | null>;
  mapContainerRef: React.RefObject<HTMLDivElement | null>;

  displayedSpots: FishingSpot[];
  selectedSpot: FishingSpot | null;
  favoriteSpotIds: string[];
  shops: FishingShop[];
  selectedShop: FishingShop | null;
  onSelectSpot: (spot: FishingSpot) => void;
  onSelectShop?: (shop: FishingShop) => void;

  pendingNewSpot: { lat: number; lng: number } | null;
  setPendingNewSpot: (pos: { lat: number; lng: number } | null) => void;
  contextMenuSpot: FishingSpot | null;
  setContextMenuSpot: (spot: FishingSpot | null) => void;
  onOpenContextMenu: (spot: FishingSpot) => void;

  microAdjustSpot: FishingSpot | null;
  adjustedPos: { lat: number; lng: number } | null;
  setAdjustedPos: (pos: { lat: number; lng: number } | null) => void;
  isDraggingAdjustMarkerRef: React.MutableRefObject<boolean>;

  castingConfigSpot: FishingSpot | null;
  tempCastingEnabled: boolean;
  tempStartDeg: number;
  tempEndDeg: number;
  sweetSpotConfigSpot: FishingSpot | null;
  tempUseSweetSpot: boolean;
  tempSweetSpots: SweetSpot[];
  isAddingSweetSpot: boolean;
  draftSweetPos: { lat: number; lng: number } | null;
  setDraftSweetPos: (pos: { lat: number; lng: number } | null) => void;

  showCastingArrows: boolean;
  tackleConfig: TackleRigConfig;
  weather: WeatherData | null;
  marine: MarineData | null;
  tide: TideDayInfo | null;
  windUnit: WindUnit;
  currentUnit: CurrentUnit;
  landingPoint: CastingLandingPoint | null;
  landingKhoaDepth: { dpwt?: number } | null;

  myLocation: { lat: number; lng: number } | null;
  gpsAccuracy: number | null;
  expandedSweetId: string | null;
  setExpandedSweetId: React.Dispatch<React.SetStateAction<string | null>>;
  setPendingDeleteSweetIdx: React.Dispatch<React.SetStateAction<number | null>>;
  selectedNewRadius: number;
  pressStartPosRef: React.MutableRefObject<{ x: number; y: number } | null>;
  isCoarsePointer: boolean;
  skipAutoRecenterRef: React.MutableRefObject<boolean>;
  onOpenDetail?: (spot: FishingSpot) => void;
  prohibitedZones: ProhibitedZoneFeature[];
  currentUser: AuthUser | null;
  onZonesMutated: () => void;

  isDigitizingZones: boolean;
  digitizerPoints: Array<{ lat: number; lng: number }>;
  setDigitizerPoints: React.Dispatch<React.SetStateAction<Array<{ lat: number; lng: number }>>>;
  onUndoDigitize: () => void;
  onResetDigitize: () => void;
  onCancelDigitize: () => void;
  onSuccessDigitize: () => void;

  isStrictAdmin: boolean;
  showHaeroadEnc: boolean;

  isMarkerClickRef: React.MutableRefObject<boolean>;
  lastClientPosRef: React.MutableRefObject<{ x: number; y: number }>;
  longPressTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  isLongPressTriggeredRef: React.MutableRefObject<boolean>;
  activeTouchCountRef: React.MutableRefObject<number>;
  lastMultiTouchAtRef: React.MutableRefObject<number>;
  dragTrackerRef: React.MutableRefObject<{
    isDragging: boolean;
    lastX: number;
    lastY: number;
    totalDist: number;
  }>;
  handlePointerDown: (clientX: number, clientY: number) => void;
  handlePointerMove: (clientX: number, clientY: number) => void;
  handlePointerUp: () => void;
}
