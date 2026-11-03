import {
  fetchKhoaRoms,
  fetchKhoaTideLevel,
  fetchKhoaWaterDepth,
  fetchKhoaWaterTemp,
  fetchKhoaWind,
  KhoaDepthRecord,
  KhoaRomsRecord,
  KhoaTideRecord,
  KhoaWaterTempRecord,
  KhoaWindRecord,
} from './khoaApi';
import { getOrFetchKhoaData } from './khoaDbCache';

/** 150m 공간 격자 인덱스 키 생성 (약 0.0015도 간격 정규화) */
export function get150mGridKey(lat: number, lng: number): string {
  const gLat = Math.round(lat / 0.0015);
  const gLng = Math.round(lng / 0.0015);
  return `${gLat}_${gLng}`;
}

/** 1. 자연과학용 150m 격자 수심 중앙 DB 캐시 취득 (지형 데이터 특성상 365일 영구 캐싱) */
export async function getCachedKhoaDepth(lat: number, lng: number): Promise<KhoaDepthRecord | null> {
  const gridKey = get150mGridKey(lat, lng);
  const cacheKey = `DEPTH:${gridKey}`;
  const ttlMs = 365 * 24 * 60 * 60 * 1000; // 365일 (사실상 영구 보존)

  return getOrFetchKhoaData<KhoaDepthRecord>(
    cacheKey,
    'DEPTH',
    gridKey,
    ttlMs,
    () => fetchKhoaWaterDepth(lat, lng)
  );
}

/** 2. 조위관측소 실측 풍향/풍속 중앙 DB 캐시 취득 (15분 슬롯 유효) */
export async function getCachedKhoaWind(obsCode: string): Promise<KhoaWindRecord | null> {
  const slot = Math.floor(Date.now() / (15 * 60 * 1000));
  const cacheKey = `WIND_V2:${obsCode}:${slot}`;
  const ttlMs = 15 * 60 * 1000; // 15분

  return getOrFetchKhoaData<KhoaWindRecord>(
    cacheKey,
    'WIND',
    obsCode,
    ttlMs,
    () => fetchKhoaWind(obsCode)
  );
}

/** 3. 조위관측소 실측 수온 중앙 DB 캐시 취득 (30분 슬롯 유효) */
export async function getCachedKhoaWaterTemp(obsCode: string): Promise<KhoaWaterTempRecord | null> {
  const slot = Math.floor(Date.now() / (30 * 60 * 1000));
  const cacheKey = `TEMP_V2:${obsCode}:${slot}`;
  const ttlMs = 30 * 60 * 1000; // 30분

  return getOrFetchKhoaData<KhoaWaterTempRecord>(
    cacheKey,
    'WATER_TEMP',
    obsCode,
    ttlMs,
    () => fetchKhoaWaterTemp(obsCode)
  );
}

/** 4. 1일 실측·예측 조위 1440분 전체 시계열 중앙 DB 캐시 취득 (당일 24시간 유효) */
export async function getCachedKhoaTideSeries(
  obsCode: string,
  dateStr: string
): Promise<KhoaTideRecord[]> {
  const cleanDate = dateStr.replace(/-/g, '');
  const cacheKey = `TIDE:${obsCode}:${cleanDate}`;
  const ttlMs = 24 * 60 * 60 * 1000; // 24시간 (당일 기준)

  const result = await getOrFetchKhoaData<KhoaTideRecord[]>(
    cacheKey,
    'TIDE',
    obsCode,
    ttlMs,
    () => fetchKhoaTideLevel(obsCode, dateStr)
  );

  return result || [];
}

/** 5. ROMS 수치예측모델 유향/유속/수온 중앙 DB 캐시 취득 (3시간 유효) */
export async function getCachedKhoaRoms(lat: number, lng: number): Promise<KhoaRomsRecord | null> {
  const rLat = (Math.round(lat * 50) / 50).toFixed(2);
  const rLng = (Math.round(lng * 50) / 50).toFixed(2);
  const now = new Date();
  const dateHourKey = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${Math.floor(now.getHours() / 3) * 3}`;
  const cacheKey = `ROMS:${rLat}_${rLng}:${dateHourKey}`;
  const ttlMs = 3 * 60 * 60 * 1000; // 3시간

  return getOrFetchKhoaData<KhoaRomsRecord>(
    cacheKey,
    'ROMS',
    `${rLat}_${rLng}`,
    ttlMs,
    () => fetchKhoaRoms(lat, lng)
  );
}
