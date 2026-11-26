import type { MapMode } from '../components/mapCanvasTypes';
import type { MapSecondaryLang } from '../types';

export const OPENFREEMAP_STYLES = {
  liberty: 'https://tiles.openfreemap.org/styles/liberty',
  dark: 'https://tiles.openfreemap.org/styles/dark',
} as const;

export const ESRI_WORLD_IMAGERY_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

export const CARTO_DARK_TILES =
  'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png';

export const OPENSEAMAP_SEAMARK_TILES =
  'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png';

export const GEBCO_WMS_TILES =
  'https://wms.gebco.net/mapserv?service=WMS&request=GetMap&layers=GEBCO_LATEST&styles=&format=image%2Fpng&transparent=true&version=1.1.1&srs=EPSG%3A3857&width=256&height=256&bbox={bbox-epsg-3857}';

const styleJsonCache = new Map<string, Promise<any>>();

/**
 * MapLibre symbol 레이어의 text-field를
 * "현지어(name)\n보조어(name:ko 또는 name:en)" 2줄 병기 표현식으로 생성합니다.
 */
export function buildBilingualTextField(secondaryLang: MapSecondaryLang): unknown[] {
  const localName = ['coalesce', ['get', 'name'], ['get', 'name:latin'], ''];
  const subName =
    secondaryLang === 'ko'
      ? ['coalesce', ['get', 'name:ko'], ['get', 'name:en'], ['get', 'name:latin'], '']
      : ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ''];

  return [
    'case',
    [
      'all',
      ['!=', subName, ''],
      ['!=', localName, ''],
      ['!=', localName, subName],
    ],
    [
      'format',
      localName,
      { 'font-scale': 1.0 },
      '\n',
      {},
      subName,
      { 'font-scale': 0.82 },
    ],
    ['coalesce', ['get', 'name'], subName, ''],
  ];
}

function isNameTextField(textField: unknown): boolean {
  if (typeof textField === 'string') {
    return textField.includes('name');
  }
  if (Array.isArray(textField)) {
    return JSON.stringify(textField).includes('name');
  }
  return false;
}

const SATELLITE_HIDDEN_LAYER_PATTERNS = [
  'water',
  'land',
  'earth',
  'park',
  'building',
  'natural',
  'aeroway',
  'ice',
  'glacier',
  'sand',
  'wood',
  'grass',
  'farmland',
  'residential',
  'industrial',
  'commercial',
];

function shouldHideForSatellite(layer: any): boolean {
  if (!layer || layer.type === 'symbol') return false;
  if (layer.type === 'background') return true;
  if (layer.type === 'fill' || layer.type === 'fill-extrusion') return true;
  const id = String(layer.id || '').toLowerCase();
  const sourceLayer = String(layer['source-layer'] || '').toLowerCase();
  return SATELLITE_HIDDEN_LAYER_PATTERNS.some(
    (pat) => id.includes(pat) || sourceLayer.includes(pat)
  );
}

/**
 * OpenFreeMap 스타일 JSON을 불변 복제하여 이중 언어 POI 및 위성/주간/야간 모드에 맞게 패치합니다.
 */
export function patchStyleForBilingual(
  styleJson: any,
  secondaryLang: MapSecondaryLang,
  options?: { transparentBaseForSatellite?: boolean }
): any {
  const cloned = JSON.parse(JSON.stringify(styleJson));
  const transparentBaseForSatellite = Boolean(options?.transparentBaseForSatellite);
  const bilingualExpr = buildBilingualTextField(secondaryLang);

  const rawLayers: any[] = Array.isArray(cloned.layers) ? cloned.layers : [];
  const nextLayers: any[] = [];

  if (transparentBaseForSatellite) {
    cloned.sources = cloned.sources || {};
    cloned.sources['esri-satellite'] = {
      type: 'raster',
      tiles: [ESRI_WORLD_IMAGERY_TILES],
      tileSize: 256,
      maxzoom: 17,
      attribution: 'Tiles &copy; Esri',
    };
    nextLayers.push({
      id: 'esri-satellite-base',
      type: 'raster',
      source: 'esri-satellite',
      paint: {
        'raster-opacity': 1,
      },
    });
  }

  for (const layer of rawLayers) {
    if (transparentBaseForSatellite && layer.type === 'background') {
      continue;
    }
    if (transparentBaseForSatellite && shouldHideForSatellite(layer)) {
      layer.layout = { ...(layer.layout || {}), visibility: 'none' };
      nextLayers.push(layer);
      continue;
    }

    if (layer.type === 'symbol' && layer.layout && isNameTextField(layer.layout['text-field'])) {
      layer.layout = {
        ...layer.layout,
        'text-field': bilingualExpr,
      };
      if (transparentBaseForSatellite) {
        layer.paint = {
          ...(layer.paint || {}),
          'text-color': '#f8fafc',
          'text-halo-color': 'rgba(15, 23, 42, 0.92)',
          'text-halo-width': 1.5,
        };
      }
    }

    nextLayers.push(layer);
  }

  cloned.layers = nextLayers;
  return cloned;
}

/**
 * 네트워크 장애 또는 Brave Shields/광고차단기(ERR_BLOCKED_BY_CLIENT)로
 * OpenFreeMap 벡터 소스가 차단될 때 안전한 래스터 폴백 스타일 생성
 */
export function buildOsmRasterFallbackStyle(mapMode: MapMode): any {
  const isHybrid = mapMode === 'HYBRID';
  const isDark = mapMode === 'DARK';
  const tileUrl = isHybrid
    ? ESRI_WORLD_IMAGERY_TILES
    : isDark
    ? CARTO_DARK_TILES
    : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

  return {
    version: 8,
    sources: {
      'osm-raster-fallback': {
        type: 'raster',
        tiles: [tileUrl],
        tileSize: 256,
        maxzoom: isHybrid ? 17 : 19,
      },
    },
    layers: [
      {
        id: 'osm-raster-fallback-layer',
        type: 'raster',
        source: 'osm-raster-fallback',
      },
    ],
  };
}

let vectorSourceReachablePromise: Promise<boolean> | null = null;

function checkVectorSourceReachable(tileJsonUrl: string): Promise<boolean> {
  if (!vectorSourceReachablePromise) {
    vectorSourceReachablePromise = fetch(tileJsonUrl, {
      signal: AbortSignal.timeout(5000),
    })
      .then((res) => res.ok)
      .catch(() => false);
  }
  return vectorSourceReachablePromise;
}

async function fetchBaseStyleJson(styleKey: 'liberty' | 'dark'): Promise<any> {
  const url = OPENFREEMAP_STYLES[styleKey];
  if (!styleJsonCache.has(url)) {
    const p = fetch(url, { signal: AbortSignal.timeout(8000) })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP_${res.status}`);
        return res.json();
      })
      .catch((err) => {
        styleJsonCache.delete(url);
        throw err;
      });
    styleJsonCache.set(url, p);
  }
  return styleJsonCache.get(url)!;
}

export async function fetchAndBuildOsmStyle(
  mapMode: MapMode,
  secondaryLang: MapSecondaryLang
): Promise<any> {
  const styleKey: 'liberty' | 'dark' = mapMode === 'DARK' ? 'dark' : 'liberty';
  try {
    const baseJson = await fetchBaseStyleJson(styleKey);
    const tileJsonUrl = baseJson?.sources?.openmaptiles?.url;
    if (typeof tileJsonUrl === 'string' && tileJsonUrl.startsWith('http')) {
      const ok = await checkVectorSourceReachable(tileJsonUrl);
      if (!ok) {
        console.warn(
          '[OsmBaseMap] Vector TileJSON blocked/unreachable, using raster fallback:',
          tileJsonUrl
        );
        return buildOsmRasterFallbackStyle(mapMode);
      }
    }
    return patchStyleForBilingual(baseJson, secondaryLang, {
      transparentBaseForSatellite: mapMode === 'HYBRID',
    });
  } catch (err) {
    console.warn('OpenFreeMap style load failed, falling back to raster tiles:', err);
    return buildOsmRasterFallbackStyle(mapMode);
  }
}
