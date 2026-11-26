/**
 * 국립해양조사원(KHOA) 공공데이터 OpenAPI 연동 모듈
 * 제공 서비스:
 * 1. surveyTideLevel: 조위관측소 실측·예측 조위
 * 2. surveyWind: 조위관측소 실측 풍향/풍속
 * 3. surveyWaterTemp: 조위관측소 실측 수온
 * 4. waterDepth: 자연과학용 150m 격자 수심 (평균해면하 dpwt)
 * 5. roms: ROMS 수치예측모델 유향/유속/수온
 */

import { isNativePlatform } from './nativeBridge';

export const KHOA_SERVICE_KEY =
  '7Q54Z6DQ%2B9wH23fR%2FAlrOSh4XgQ9xyA8I%2F69h1tmrlCwtFqMG8zdR01z0h8%2Bo%2Ft1Uvt%2BwoN947y1ts5Maeoy%2Bg%3D%3D';

/** 웹 환경에서는 상대 프록시(/api-khoa), 네이티브 APK(https://localhost)에서는 Vercel CDN 프록시 절대 URL 사용 */
function getKhoaApiBaseUrl(): string {
  if (isNativePlatform()) {
    return 'https://exfish.vercel.app/api-khoa';
  }
  if (
    typeof window !== 'undefined' &&
    window.location &&
    window.location.protocol &&
    window.location.protocol.startsWith('http')
  ) {
    return '/api-khoa';
  }
  return 'https://apis.data.go.kr';
}

export interface KhoaTideRecord {
  obsvtrNm: string;
  lat: number;
  lot: number;
  obsrvnDt: string; // YYYY-MM-DD HH:mm
  bscTdlvHgt?: number; // 예측 조위 (cm)
  tdlvHgt?: number; // 실측 조위 (cm)
}

export interface KhoaWindRecord {
  obsvtrNm: string;
  lat: number;
  lot: number;
  obsrvnDt: string; // YYYY-MM-DD HH:mm:ss
  wndrct: number; // 풍향 (0~360 deg)
  wspd: number; // 풍속 (m/s)
}

export interface KhoaWaterTempRecord {
  obsvtrNm: string;
  lat: number;
  lot: number;
  obsrvnDt: string; // YYYY-MM-DD HH:mm:ss
  wtem: number; // 실측 수온 (°C)
}

export interface KhoaDepthRecord {
  lat: number;
  lot: number;
  dpwt: number; // 수심 (m, 평균해면하 Mean Sea Level)
}

export interface KhoaRomsRecord {
  lat: number;
  lot: number;
  predcDt: string;
  crdir: number; // 유향 (deg)
  crsp: number; // 유속 (m/s)
  wtem: number; // 수온 (°C)
}

function getTodayString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** 1. 조위관측소 실측·예측 조위 조회 (1일 1440분 전체 시계열: numOfRows=300 x 5페이지 병렬 조회) */
export async function fetchKhoaTideLevel(
  obsCode: string,
  dateStr: string = getTodayString()
): Promise<KhoaTideRecord[]> {
  const cleanDate = dateStr.replace(/-/g, '');
  const baseUrl = getKhoaApiBaseUrl();

  const fetchPage = async (pageNo: number): Promise<KhoaTideRecord[]> => {
    const url = `${baseUrl}/1192136/surveyTideLevel/GetSurveyTideLevelApiService?serviceKey=${KHOA_SERVICE_KEY}&type=json&obsCode=${obsCode}&date=${cleanDate}&numOfRows=300&pageNo=${pageNo}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const items = json?.body?.items?.item;
      if (!Array.isArray(items) || items.length === 0) return [];

      return items.map((it: any) => ({
        obsvtrNm: it.obsvtrNm,
        lat: Number(it.lat),
        lot: Number(it.lot),
        obsrvnDt: it.obsrvnDt,
        bscTdlvHgt: it.bscTdlvHgt != null && !isNaN(Number(it.bscTdlvHgt)) ? Number(it.bscTdlvHgt) : undefined,
        tdlvHgt: it.tdlvHgt != null && !isNaN(Number(it.tdlvHgt)) ? Number(it.tdlvHgt) : undefined,
      }));
    } catch (e) {
      console.warn(`[KHOA API] fetchKhoaTideLevel page ${pageNo} failed (${obsCode}):`, e);
      return [];
    }
  };

  try {
    // 1440분 전수 취득을 위해 5개 페이지(300개씩)를 순차 호출 (공공데이터포털 503 동시성 거부 방지)
    const combined: KhoaTideRecord[] = [];
    for (let page = 1; page <= 5; page++) {
      const pageData = await fetchPage(page);
      if (pageData.length > 0) {
        combined.push(...pageData);
      }
      if (page < 5) {
        await new Promise((r) => setTimeout(r, 40));
      }
    }
    return combined;
  } catch (e) {
    console.warn(`[KHOA API] fetchKhoaTideLevel combined failed (${obsCode}):`, e);
    return [];
  }
}

/** 당일 1분 단위 KHOA 시계열(1440건)에서 목표 시각(HH:mm) 또는 현재 시각이 포함된 페이지 번호(numOfRows=300 기준 1~5) 산출 */
function getMinutePageNo(targetTimeStr?: string): number {
  let mins: number;
  if (targetTimeStr && /^\d{1,2}:\d{2}/.test(targetTimeStr)) {
    const [h, m] = targetTimeStr.split(':').map(Number);
    mins = (Number.isFinite(h) ? h : 12) * 60 + (Number.isFinite(m) ? m : 0);
  } else {
    const now = new Date();
    mins = now.getHours() * 60 + now.getMinutes();
  }
  return Math.min(5, Math.max(1, Math.ceil((mins + 5) / 300)));
}

function parseObsrvnMinutes(obsrvnDt: string): number | null {
  const m = /(\d{2}):(\d{2})/.exec(String(obsrvnDt || ''));
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function pickBestItemByTime<T extends { obsrvnDt?: string }>(
  items: T[],
  targetTimeStr?: string,
  isValid?: (it: T) => boolean
): T | null {
  const validItems = isValid ? items.filter(isValid) : items;
  if (validItems.length === 0) return null;
  if (!targetTimeStr || !/^\d{1,2}:\d{2}/.test(targetTimeStr)) {
    return validItems[validItems.length - 1];
  }
  const [th, tm] = targetTimeStr.split(':').map(Number);
  const targetMins = (Number.isFinite(th) ? th : 12) * 60 + (Number.isFinite(tm) ? tm : 0);
  let best = validItems[0];
  let bestDiff = Infinity;
  for (const it of validItems) {
    const om = parseObsrvnMinutes(it.obsrvnDt || '');
    if (om == null) continue;
    const diff = Math.abs(om - targetMins);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = it;
    }
  }
  return best;
}

/** 2. 조위관측소 실측 풍향/풍속 조회 (목표 시각 또는 당일 현재 시각 페이지 조회) */
export async function fetchKhoaWind(
  obsCode: string,
  dateStr: string = getTodayString(),
  targetTimeStr?: string
): Promise<KhoaWindRecord | null> {
  const cleanDate = dateStr.replace(/-/g, '');
  const baseUrl = getKhoaApiBaseUrl();
  const targetPage = getMinutePageNo(targetTimeStr);

  const tryFetchPage = async (pageNo: number): Promise<KhoaWindRecord | null> => {
    const url = `${baseUrl}/1192136/surveyWind/GetSurveyWindApiService?serviceKey=${KHOA_SERVICE_KEY}&type=json&obsCode=${obsCode}&date=${cleanDate}&numOfRows=300&pageNo=${pageNo}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const items = json?.body?.items?.item;
    if (!Array.isArray(items) || items.length === 0) return null;

    const it = pickBestItemByTime(
      items,
      targetTimeStr,
      (row: any) => row.wspd != null && row.wndrct != null && !isNaN(Number(row.wspd))
    );
    if (!it) return null;
    return {
      obsvtrNm: it.obsvtrNm,
      lat: Number(it.lat),
      lot: Number(it.lot),
      obsrvnDt: it.obsrvnDt,
      wndrct: Math.round(Number(it.wndrct)),
      wspd: Math.round(Number(it.wspd) * 10) / 10,
    };
  };

  try {
    const latest = await tryFetchPage(targetPage);
    if (latest) return latest;
    if (targetPage > 1) {
      return await tryFetchPage(targetPage - 1);
    }
    return null;
  } catch (e) {
    console.warn(`[KHOA API] fetchKhoaWind failed (${obsCode}):`, e);
    return null;
  }
}

/** 3. 조위관측소 실측 수온 조회 (목표 시각 또는 당일 현재 시각 페이지 조회) */
export async function fetchKhoaWaterTemp(
  obsCode: string,
  dateStr: string = getTodayString(),
  targetTimeStr?: string
): Promise<KhoaWaterTempRecord | null> {
  const cleanDate = dateStr.replace(/-/g, '');
  const baseUrl = getKhoaApiBaseUrl();
  const targetPage = getMinutePageNo(targetTimeStr);

  const tryFetchPage = async (pageNo: number): Promise<KhoaWaterTempRecord | null> => {
    const url = `${baseUrl}/1192136/surveyWaterTemp/GetSurveyWaterTempApiService?serviceKey=${KHOA_SERVICE_KEY}&type=json&obsCode=${obsCode}&date=${cleanDate}&numOfRows=300&pageNo=${pageNo}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const items = json?.body?.items?.item;
    if (!Array.isArray(items) || items.length === 0) return null;

    const it = pickBestItemByTime(
      items,
      targetTimeStr,
      (row: any) => row.wtem != null && !isNaN(Number(row.wtem))
    );
    if (!it) return null;
    return {
      obsvtrNm: it.obsvtrNm,
      lat: Number(it.lat),
      lot: Number(it.lot),
      obsrvnDt: it.obsrvnDt,
      wtem: Math.round(Number(it.wtem) * 10) / 10,
    };
  };

  try {
    const latest = await tryFetchPage(targetPage);
    if (latest) return latest;
    if (targetPage > 1) {
      return await tryFetchPage(targetPage - 1);
    }
    return null;
  } catch (e) {
    console.warn(`[KHOA API] fetchKhoaWaterTemp failed (${obsCode}):`, e);
    return null;
  }
}

/** 4. 자연과학용 150m 격자 수심 조회 (0.0015° 격자 스냅으로 CDN 캐시 히트율 극대화) */
export async function fetchKhoaWaterDepth(lat: number, lng: number): Promise<KhoaDepthRecord | null> {
  const snapLat = Math.round(lat / 0.0015) * 0.0015;
  const snapLng = Math.round(lng / 0.0015) * 0.0015;
  const ymin = (snapLat - 0.002).toFixed(4);
  const ymax = (snapLat + 0.002).toFixed(4);
  const xmin = (snapLng - 0.0025).toFixed(4);
  const xmax = (snapLng + 0.0025).toFixed(4);
  const baseUrl = getKhoaApiBaseUrl();

  const url = `${baseUrl}/1192136/waterDepth/GetWaterDepthApiService?serviceKey=${KHOA_SERVICE_KEY}&type=json&ymin=${ymin}&ymax=${ymax}&xmin=${xmin}&xmax=${xmax}&numOfRows=10`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const items = json?.body?.items?.item;
    if (!Array.isArray(items) || items.length === 0) return null;

    // 단일 최근접 셀만 취할 경우 방조제/석축 경계(dpwt <= 1.2m)가 선택되어 간출(0m)로 왜곡될 수 있음
    // 동일 150m~300m 격자 내 외해 유효 수심 셀(dpwt >= 2.5m)이 존재하면 경계 천해 셀을 제외하고 역거리 가중 보간(IDW) 적용
    const validItems = items
      .filter((it) => it.dpwt != null && Number.isFinite(Number(it.dpwt)))
      .map((it) => ({
        lat: Number(it.lat),
        lot: Number(it.lot),
        dpwt: Number(it.dpwt),
      }));

    if (validItems.length === 0) return null;

    const offshoreItems = validItems.filter((it) => it.dpwt >= 2.5);
    const pool = offshoreItems.length > 0 ? offshoreItems : validItems;

    let nearest = pool[0];
    let minD = Infinity;
    let weightSum = 0;
    let weightedDpwtSum = 0;

    for (const it of pool) {
      const dLat = it.lat - lat;
      const dLot = it.lot - lng;
      const distSq = Math.max(1e-10, dLat * dLat + dLot * dLot);
      const w = 1 / distSq;
      weightSum += w;
      weightedDpwtSum += w * it.dpwt;
      if (distSq < minD) {
        minD = distSq;
        nearest = it;
      }
    }

    const interpolatedDpwt =
      weightSum > 0 ? Math.round((weightedDpwtSum / weightSum) * 10) / 10 : Math.round(nearest.dpwt * 10) / 10;

    return {
      lat: nearest.lat,
      lot: nearest.lot,
      dpwt: interpolatedDpwt,
    };
  } catch (e) {
    console.warn(`[KHOA API] fetchKhoaWaterDepth failed (${lat}, ${lng}):`, e);
    return null;
  }
}

/** 5. ROMS 수치예측모델 유향/유속/수온 조회 (0.02° 격자 스냅으로 CDN 캐시 히트율 극대화) */
export async function fetchKhoaRoms(lat: number, lng: number): Promise<KhoaRomsRecord | null> {
  const snapLat = Math.round(lat * 50) / 50;
  const snapLng = Math.round(lng * 50) / 50;
  const ymin = (snapLat - 0.02).toFixed(4);
  const ymax = (snapLat + 0.02).toFixed(4);
  const xmin = (snapLng - 0.025).toFixed(4);
  const xmax = (snapLng + 0.025).toFixed(4);
  const baseUrl = getKhoaApiBaseUrl();

  const url = `${baseUrl}/1192136/roms/GetRomsApiService?serviceKey=${KHOA_SERVICE_KEY}&type=json&ymin=${ymin}&ymax=${ymax}&xmin=${xmin}&xmax=${xmax}&numOfRows=200`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const items = json?.body?.items?.item;
    if (!Array.isArray(items) || items.length === 0) return null;

    // 현재 시각(KST)과 가장 오차가 적은 예측치 탐색 (어제 00:00 items[0] 고정 버그 방지)
    const nowMs = Date.now();
    let bestItem: any = null;
    let minDiffMs = Infinity;

    for (const it of items) {
      if (it.crdir == null || it.crsp == null) continue;
      const tMs = new Date(it.predcDt.replace(' ', 'T') + '+09:00').getTime();
      const diff = Math.abs(nowMs - tMs);
      if (diff < minDiffMs) {
        minDiffMs = diff;
        bestItem = it;
      }
    }

    if (!bestItem) return null;

    return {
      lat: Number(bestItem.lat),
      lot: Number(bestItem.lot),
      predcDt: bestItem.predcDt,
      crdir: Math.round(Number(bestItem.crdir)),
      crsp: Math.round(Number(bestItem.crsp) * 100) / 100,
      wtem: bestItem.wtem != null ? Math.round(Number(bestItem.wtem) * 10) / 10 : 0,
    };
  } catch {
    return null;
  }
}
