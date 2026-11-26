// ExFish 초경량 오프라인 JSON 메타데이터 캐시 & 네트워크 감지 모듈
// 카카오맵 타일 이미지 캐싱 배제 (약관 준수), 오직 포인트·조위·기상 메타데이터만 로컬 안전 캐싱

import type { FishingSpot, FishingShop, TideDayInfo, WeatherData, MarineData } from '../types';

const STORAGE_KEY_OFFLINE_SPOTS = 'exfish_offline_spots';
const STORAGE_KEY_SPOTS_MASTER = 'exfish_spots_master';
export const STORAGE_KEY_SHOPS_MASTER = 'exfish_shops_master';

function sanitizeSpotForStorage(spot: FishingSpot): FishingSpot {
  return spot.photo_urls
    ? {
        ...spot,
        photo_urls: spot.photo_urls.filter((url) => typeof url === 'string' && !url.startsWith('data:')),
      }
    : spot;
}

/**
 * 전체 포인트 마스터 목록을 단일 JSON으로 일괄 저장 (30개 제한 없이 전체 보존, O(N) 1회 직렬화)
 */
export function saveAllCachedSpots(spots: FishingSpot[]): void {
  if (typeof window === 'undefined') return;
  try {
    const sanitized = spots.map(sanitizeSpotForStorage);
    localStorage.setItem(STORAGE_KEY_SPOTS_MASTER, JSON.stringify(sanitized));
  } catch (e) {
    console.warn('Offline spots master cache write failed:', e);
  }
}

export interface CachedSpotMeta {
  spot: FishingSpot;
  cachedAt: string;
  tide?: TideDayInfo;
  weather?: WeatherData;
  marine?: MarineData;
}

/**
 * 온라인일 때 조회된 포인트 및 해양/기상 메타데이터를 로컬 JSON 캐시에 백업
 */
export function cacheSpotMetadata(
  spot: FishingSpot,
  tide?: TideDayInfo | null,
  weather?: WeatherData | null,
  marine?: MarineData | null
): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_OFFLINE_SPOTS);
    const spotsMap: Record<string, CachedSpotMeta> = raw ? JSON.parse(raw) : {};

    // Base64 data URI 사진은 localStorage 5MB 쿼터를 고갈시키므로 오프라인 메타 캐시에서 제외
    const sanitizedSpot = sanitizeSpotForStorage(spot);

    spotsMap[spot.id] = {
      spot: sanitizedSpot,
      cachedAt: new Date().toISOString(),
      tide: tide || undefined,
      weather: weather || undefined,
      marine: marine || undefined,
    };

    // 최대 30개 포인트 메타데이터만 유지 (용량 1MB 미만 초경량 관리)
    const keys = Object.keys(spotsMap);
    if (keys.length > 30) {
      delete spotsMap[keys[0]];
    }

    localStorage.setItem(STORAGE_KEY_OFFLINE_SPOTS, JSON.stringify(spotsMap));
  } catch (e) {
    console.warn('Offline metadata cache write failed:', e);
  }
}

/**
 * 오프라인 상태에서 로컬 캐시된 포인트 메타데이터 복원
 */
export function getCachedSpotMetadata(spotId: string): CachedSpotMeta | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_OFFLINE_SPOTS);
    if (!raw) return null;
    const spotsMap: Record<string, CachedSpotMeta> = JSON.parse(raw);
    return spotsMap[spotId] || null;
  } catch {
    return null;
  }
}

/**
 * 전체 캐시된 포인트 목록 반환 (마스터 목록 우선, 구형 메타 캐시 폴백)
 */
export function getAllCachedSpots(): FishingSpot[] {
  try {
    const masterRaw = localStorage.getItem(STORAGE_KEY_SPOTS_MASTER);
    if (masterRaw) {
      const parsed = JSON.parse(masterRaw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
    const raw = localStorage.getItem(STORAGE_KEY_OFFLINE_SPOTS);
    if (!raw) return [];
    const spotsMap: Record<string, CachedSpotMeta> = JSON.parse(raw);
    return Object.values(spotsMap).map((item) => item.spot);
  } catch {
    return [];
  }
}

/** 공용 낚시점 마스터 목록 별도 저장 (exfish_offline_spots 30개 캐시와 완전 분리) */
export function saveAllCachedShops(shops: FishingShop[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_SHOPS_MASTER, JSON.stringify(shops));
  } catch (e) {
    console.warn('Offline shops master cache write failed:', e);
  }
}

export function getAllCachedShops(): FishingShop[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SHOPS_MASTER);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * 브라우저 온라인/오프라인 상태 훅 또는 리스너 등록
 */
export function subscribeNetworkStatus(onChange: (isOnline: boolean) => void): () => void {
  const handleOnline = () => onChange(true);
  const handleOffline = () => onChange(false);

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}
