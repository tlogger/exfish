/**
 * 국립해양조사원(KHOA) 공공데이터 OpenAPI 연동 모듈
 * 제공 서비스:
 * 1. surveyTideLevel: 조위관측소 실측·예측 조위
 * 2. surveyWind: 조위관측소 실측 풍향/풍속
 * 3. surveyWaterTemp: 조위관측소 실측 수온
 * 4. waterDepth: 자연과학용 150m 격자 수심 (평균해면하 dpwt)
 * 5. roms: ROMS 수치예측모델 유향/유속/수온
 */

export const KHOA_SERVICE_KEY =
  '7Q54Z6DQ%2B9wH23fR%2FAlrOSh4XgQ9xyA8I%2F69h1tmrlCwtFqMG8zdR01z0h8%2Bo%2Ft1Uvt%2BwoN947y1ts5Maeoy%2Bg%3D%3D';

/** 웹 환경(로컬 개발)에서는 Vite 프록시(/api-khoa)를 통해 CORS를 우회하고, 네이티브/프로덕션에서는 직접 호출 */
function getKhoaApiBaseUrl(): string {
  if (
    typeof window !== 'undefined' &&
    window.location &&
    window.location.protocol &&
    window.location.protocol.startsWith('http') &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
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

/** 당일 1분 단위 KHOA 시계열(1440건)에서 현재 시각이 포함된 최신 페이지 번호(numOfRows=300 기준 1~5) 산출 */
function getCurrentMinutePageNo(): number {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  return Math.min(5, Math.max(1, Math.ceil((mins + 5) / 300)));
}

/** 2. 조위관측소 실측 풍향/풍속 조회 (당일 현재 시각에 해당하는 최신 페이지 조회) */
export async function fetchKhoaWind(
  obsCode: string,
  dateStr: string = getTodayString()
): Promise<KhoaWindRecord | null> {
  const cleanDate = dateStr.replace(/-/g, '');
  const baseUrl = getKhoaApiBaseUrl();
  const targetPage = getCurrentMinutePageNo();

  const tryFetchPage = async (pageNo: number): Promise<KhoaWindRecord | null> => {
    const url = `${baseUrl}/1192136/surveyWind/GetSurveyWindApiService?serviceKey=${KHOA_SERVICE_KEY}&type=json&obsCode=${obsCode}&date=${cleanDate}&numOfRows=300&pageNo=${pageNo}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const items = json?.body?.items?.item;
    if (!Array.isArray(items) || items.length === 0) return null;

    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.wspd != null && it.wndrct != null && !isNaN(Number(it.wspd))) {
        return {
          obsvtrNm: it.obsvtrNm,
          lat: Number(it.lat),
          lot: Number(it.lot),
          obsrvnDt: it.obsrvnDt,
          wndrct: Math.round(Number(it.wndrct)),
          wspd: Math.round(Number(it.wspd) * 10) / 10,
        };
      }
    }
    return null;
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

/** 3. 조위관측소 실측 수온 조회 (당일 현재 시각에 해당하는 최신 페이지 조회) */
export async function fetchKhoaWaterTemp(
  obsCode: string,
  dateStr: string = getTodayString()
): Promise<KhoaWaterTempRecord | null> {
  const cleanDate = dateStr.replace(/-/g, '');
  const baseUrl = getKhoaApiBaseUrl();
  const targetPage = getCurrentMinutePageNo();

  const tryFetchPage = async (pageNo: number): Promise<KhoaWaterTempRecord | null> => {
    const url = `${baseUrl}/1192136/surveyWaterTemp/GetSurveyWaterTempApiService?serviceKey=${KHOA_SERVICE_KEY}&type=json&obsCode=${obsCode}&date=${cleanDate}&numOfRows=300&pageNo=${pageNo}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const items = json?.body?.items?.item;
    if (!Array.isArray(items) || items.length === 0) return null;

    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.wtem != null && !isNaN(Number(it.wtem))) {
        return {
          obsvtrNm: it.obsvtrNm,
          lat: Number(it.lat),
          lot: Number(it.lot),
          obsrvnDt: it.obsrvnDt,
          wtem: Math.round(Number(it.wtem) * 10) / 10,
        };
      }
    }
    return null;
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

/** 4. 자연과학용 150m 격자 수심 조회 (주어진 lat, lng 반경 300m 바운딩 박스) */
export async function fetchKhoaWaterDepth(lat: number, lng: number): Promise<KhoaDepthRecord | null> {
  // 약 300m Bounding Box (0.003도)
  const ymin = (lat - 0.002).toFixed(4);
  const ymax = (lat + 0.002).toFixed(4);
  const xmin = (lng - 0.0025).toFixed(4);
  const xmax = (lng + 0.0025).toFixed(4);
  const baseUrl = getKhoaApiBaseUrl();

  const url = `${baseUrl}/1192136/waterDepth/GetWaterDepthApiService?serviceKey=${KHOA_SERVICE_KEY}&type=json&ymin=${ymin}&ymax=${ymax}&xmin=${xmin}&xmax=${xmax}&numOfRows=10`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const items = json?.body?.items?.item;
    if (!Array.isArray(items) || items.length === 0) return null;

    // 포인트 좌표와 가장 유클리드 거리가 가까운 격자점 선택
    let nearest: KhoaDepthRecord | null = null;
    let minD = Infinity;

    for (const it of items) {
      if (it.dpwt == null) continue;
      const dLat = Number(it.lat) - lat;
      const dLot = Number(it.lot) - lng;
      const d = dLat * dLat + dLot * dLot;
      if (d < minD) {
        minD = d;
        nearest = {
          lat: Number(it.lat),
          lot: Number(it.lot),
          dpwt: Math.round(Number(it.dpwt) * 10) / 10,
        };
      }
    }
    return nearest;
  } catch (e) {
    console.warn(`[KHOA API] fetchKhoaWaterDepth failed (${lat}, ${lng}):`, e);
    return null;
  }
}

/** 5. ROMS 수치예측모델 유향/유속/수온 조회 (현재 시각에 가장 근접한 예측치 매칭) */
export async function fetchKhoaRoms(lat: number, lng: number): Promise<KhoaRomsRecord | null> {
  const ymin = (lat - 0.02).toFixed(4);
  const ymax = (lat + 0.02).toFixed(4);
  const xmin = (lng - 0.025).toFixed(4);
  const xmax = (lng + 0.025).toFixed(4);
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
  } catch (e) {
    return null;
  }
}
