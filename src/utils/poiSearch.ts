import type { MapProvider, MapSecondaryLang } from '../types';
import { getApiBaseUrl } from './apiBase';
import { hasGoogleMapsApiKey, loadGoogleMapsApi } from './googleMapsLoader';

export interface PoiSearchResult {
  place_id: number | string;
  display_name: string;
  lat: number;
  lng: number;
  type: string;
  address_name?: string;
  road_address_name?: string;
  place_name?: string;
  category_name?: string;
  source?: 'kakao' | 'google' | 'osm';
}

export interface PoiSearchOptions {
  provider?: MapProvider;
  center?: { lat: number; lng: number };
  secondaryLang?: MapSecondaryLang;
}

declare global {
  interface Window {
    kakao?: any;
  }
}

/**
 * 카카오 지도 SDK services 라이브러리가 로드될 때까지 대기 (최대 3초)
 */
function waitForKakaoServices(timeoutMs = 3000): Promise<boolean> {
  if (typeof window !== 'undefined' && window.kakao?.maps?.services?.Places) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve(false);
      return;
    }

    const startTime = Date.now();
    const interval = setInterval(() => {
      if (window.kakao?.maps?.services?.Places) {
        clearInterval(interval);
        resolve(true);
      } else if (Date.now() - startTime >= timeoutMs) {
        clearInterval(interval);
        resolve(false);
      }
    }, 100);
  });
}

/**
 * 카카오 지도 SDK 기반 국내 지명, 항구, 방파제, 건물 및 도로명/지번 주소 검색
 */
export async function searchKakaoPoi(cleanQuery: string): Promise<PoiSearchResult[]> {
  const isReady = await waitForKakaoServices();
  if (!isReady || !window.kakao?.maps?.services) {
    return [];
  }

  const { kakao } = window;
  const services = kakao.maps.services;

  const placeResults = await new Promise<PoiSearchResult[]>((resolve) => {
    try {
      const ps = new services.Places();
      ps.keywordSearch(
        cleanQuery,
        (data: any[], status: any) => {
          if (status === services.Status.OK && Array.isArray(data)) {
            const mapped: PoiSearchResult[] = data.map((item) => {
              const subLabel = item.road_address_name || item.address_name || '';
              const fullLabel = subLabel ? `${item.place_name} (${subLabel})` : item.place_name;
              const category =
                item.category_group_name ||
                (item.category_name ? item.category_name.split('>').pop()?.trim() : '') ||
                '장소';

              return {
                place_id: item.id || `kakao-place-${item.x}-${item.y}`,
                display_name: fullLabel,
                lat: parseFloat(item.y),
                lng: parseFloat(item.x),
                type: category,
                address_name: item.address_name,
                road_address_name: item.road_address_name,
                place_name: item.place_name,
                category_name: item.category_name,
                source: 'kakao',
              };
            });
            resolve(mapped);
          } else {
            resolve([]);
          }
        },
        { size: 10 }
      );
    } catch (err) {
      console.warn('Kakao Places keywordSearch error:', err);
      resolve([]);
    }
  });

  if (placeResults.length >= 5) {
    return placeResults;
  }

  const addressResults = await new Promise<PoiSearchResult[]>((resolve) => {
    try {
      if (!services.Geocoder) {
        resolve([]);
        return;
      }
      const geocoder = new services.Geocoder();
      geocoder.addressSearch(cleanQuery, (data: any[], status: any) => {
        if (status === services.Status.OK && Array.isArray(data)) {
          const mapped: PoiSearchResult[] = data.map((item, idx) => {
            const addrName = item.address_name || cleanQuery;
            return {
              place_id: `kakao-addr-${idx}-${item.x}-${item.y}`,
              display_name: `${addrName} (주소)`,
              lat: parseFloat(item.y),
              lng: parseFloat(item.x),
              type: item.address_type === 'ROAD_ADDR' ? '도로명' : '지번주소',
              address_name: item.address_name,
              place_name: addrName,
              source: 'kakao',
            };
          });
          resolve(mapped);
        } else {
          resolve([]);
        }
      });
    } catch (err) {
      console.warn('Kakao Geocoder addressSearch error:', err);
      resolve([]);
    }
  });

  const combined: PoiSearchResult[] = [...placeResults];
  const existingCoords = new Set(
    placeResults.map((r) => `${r.lat.toFixed(5)},${r.lng.toFixed(5)}`)
  );

  for (const addr of addressResults) {
    const key = `${addr.lat.toFixed(5)},${addr.lng.toFixed(5)}`;
    if (!existingCoords.has(key)) {
      combined.push(addr);
      existingCoords.add(key);
    }
  }

  return combined;
}

/**
 * OSM 글로벌 지명/항구 검색 (/api/osm-search 프록시 우선, 로컬 dev 미지원 시 Photon 직접 폴백)
 */
export async function searchOsmPoi(
  cleanQuery: string,
  options?: PoiSearchOptions
): Promise<PoiSearchResult[]> {
  const lang = options?.secondaryLang === 'en' ? 'en' : 'ko';
  const params = new URLSearchParams({ q: cleanQuery, lang });
  if (
    options?.center &&
    Number.isFinite(options.center.lat) &&
    Number.isFinite(options.center.lng)
  ) {
    params.set('lat', String(options.center.lat));
    params.set('lon', String(options.center.lng));
  }

  const apiBase = getApiBaseUrl();
  try {
    const res = await fetch(`${apiBase}/api/osm-search?${params.toString()}`, {
      signal: AbortSignal.timeout(7000),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.results)) {
        return data.results.map((r: PoiSearchResult) => ({ ...r, source: 'osm' as const }));
      }
    }
  } catch (err) {
    console.warn('/api/osm-search failed, falling back to direct Photon:', err);
  }

  // 로컬 Vite dev 등 서버리스 프록시가 없을 때 Photon 직접 호출 폴백
  try {
    const photonParams = new URLSearchParams({ q: cleanQuery, limit: '10' });
    if (
      options?.center &&
      Number.isFinite(options.center.lat) &&
      Number.isFinite(options.center.lng)
    ) {
      photonParams.set('lat', String(options.center.lat));
      photonParams.set('lon', String(options.center.lng));
    }
    const res = await fetch(`https://photon.komoot.io/api/?${photonParams.toString()}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const features: any[] = Array.isArray(data?.features) ? data.features : [];
    return features
      .map((f, idx): PoiSearchResult | null => {
        const coords = f?.geometry?.coordinates;
        const props = f?.properties || {};
        if (!Array.isArray(coords) || coords.length < 2) return null;
        const lng = Number(coords[0]);
        const lat = Number(coords[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const name = String(props.name || props.city || props.country || '').trim();
        const sub = [props.city, props.state, props.country]
          .filter((v, i, arr) => Boolean(v) && v !== name && arr.indexOf(v) === i)
          .join(', ');
        return {
          place_id: `osm-direct-${props.osm_id || idx}`,
          display_name: sub && name ? `${name} (${sub})` : name || sub,
          lat,
          lng,
          type: String(props.osm_value || props.osm_key || '장소'),
          address_name: sub || undefined,
          place_name: name || sub,
          source: 'osm',
        };
      })
      .filter((x): x is PoiSearchResult => x !== null);
  } catch {
    return [];
  }
}

/**
 * Google Places API (New) Basic Field Masking 검색 (실패/키 미설정 시 OSM 폴백)
 */
export async function searchGooglePoi(
  cleanQuery: string,
  options?: PoiSearchOptions
): Promise<PoiSearchResult[]> {
  if (!hasGoogleMapsApiKey()) {
    return searchOsmPoi(cleanQuery, options);
  }

  const lang = options?.secondaryLang === 'en' ? 'en' : 'ko';
  try {
    const gMaps = await loadGoogleMapsApi(lang);
    const PlaceCtor = gMaps?.places?.Place;
    if (!PlaceCtor || typeof PlaceCtor.searchByText !== 'function') {
      return searchOsmPoi(cleanQuery, options);
    }

    const request: any = {
      textQuery: cleanQuery,
      fields: ['id', 'displayName', 'formattedAddress', 'location', 'primaryTypeDisplayName'],
      language: lang,
      maxResultCount: 10,
    };

    if (
      options?.center &&
      Number.isFinite(options.center.lat) &&
      Number.isFinite(options.center.lng)
    ) {
      request.locationBias = {
        center: { lat: options.center.lat, lng: options.center.lng },
        radius: 50000,
      };
    }

    const { places } = await PlaceCtor.searchByText(request);
    if (!Array.isArray(places) || places.length === 0) {
      return searchOsmPoi(cleanQuery, options);
    }

    const mapped: PoiSearchResult[] = [];
    for (const p of places) {
      const loc = p.location;
      const lat = typeof loc?.lat === 'function' ? loc.lat() : Number(loc?.lat);
      const lng = typeof loc?.lng === 'function' ? loc.lng() : Number(loc?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const name = String(p.displayName || '').trim();
      const addr = String(p.formattedAddress || '').trim();
      const display = addr && name ? `${name} (${addr})` : name || addr;

      mapped.push({
        place_id: p.id || `google-${lat.toFixed(5)}-${lng.toFixed(5)}`,
        display_name: display,
        lat,
        lng,
        type: String(p.primaryTypeDisplayName || 'Google 장소'),
        address_name: addr || undefined,
        place_name: name || display,
        source: 'google',
      });
    }

    return mapped.length > 0 ? mapped : searchOsmPoi(cleanQuery, options);
  } catch (err) {
    console.warn('Google Places search failed, falling back to OSM:', err);
    return searchOsmPoi(cleanQuery, options);
  }
}

/**
 * 지도 프로바이더별 통합 지명/POI 검색
 * - vworld / kakao: Kakao Places+Geocoder 우선 → 결과 0건 시 글로벌 OSM 폴백
 * - google: Google Places(New) Basic Field Masking 우선 → 실패/미설정 시 OSM 폴백
 * - osm: /api/osm-search (Photon + Nominatim)
 */
export async function searchPoi(
  query: string,
  options?: PoiSearchOptions
): Promise<PoiSearchResult[]> {
  if (!query || query.trim().length < 2) return [];
  const cleanQuery = query.trim();
  const provider = options?.provider ?? 'vworld';

  if (provider === 'osm') {
    return searchOsmPoi(cleanQuery, options);
  }

  if (provider === 'google') {
    return searchGooglePoi(cleanQuery, options);
  }

  const kakaoResults = await searchKakaoPoi(cleanQuery);
  if (kakaoResults.length > 0) {
    return kakaoResults;
  }

  // 국내 검색 결과 0건 시 해외 지명 자동 폴백
  return searchOsmPoi(cleanQuery, options);
}
