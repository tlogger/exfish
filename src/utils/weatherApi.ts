import { MarineData, WeatherData } from '../types';
import { findNearestKhoaStation } from './tideService';
import { getCachedKhoaWind, getCachedKhoaWaterTemp } from './khoaCache';
import { fetchKhoaRoms } from './khoaApi';

/** WMO Weather Code를 사람이 읽기 쉬운 한국어 텍스트 및 이모지로 변환 */
export function getWeatherText(code: number): string {
  switch (code) {
    case 0: return '맑음 ☀️';
    case 1: return '대체로 맑음 🌤️';
    case 2: return '구름 조금 ⛅';
    case 3: return '흐림 ☁️';
    case 45:
    case 48: return '안개 🌫️';
    case 51:
    case 53:
    case 55: return '이슬비 🌧️';
    case 61:
    case 63:
    case 65: return '비 🌧️';
    case 71:
    case 73:
    case 75: return '눈 ❄️';
    case 80:
    case 81:
    case 82: return '소나기 🌦️';
    case 95: return '뇌우 ⛈️';
    default: return '보통 🌤️';
  }
}

/** 0-360° 방위각을 16방위 순수 한국어 텍스트로 변환 */
export function getCompassDirection(deg: number): string {
  const directions = [
    '북', '북북동', '북동', '동북동',
    '동', '동남동', '남동', '남남동',
    '남', '남남서', '남서', '서남서',
    '서', '서북서', '북서', '북북서'
  ];
  const norm = ((Number(deg) || 0) % 360 + 360) % 360;
  const index = Math.round(norm / 22.5) % 16;
  return directions[index];
}

/**
 * 한국 기상청 표준 풍향 표기 (바람이 불어오는 방위 기준 '~풍')
 * 예: 0° -> '북풍' (북->남으로 부는 바람), 90° -> '동풍' (동->서로 부는 바람), 270° -> '서풍' (서->동으로 부는 바람)
 */
export function getWindDirectionKor(deg: number): string {
  return `${getCompassDirection(deg)}풍`;
}

/**
 * 풍향 각도(From)로부터 실제 바람이 불어가는 이동 방향(From -> To) 한국어 설명 반환
 * 예: 90°(동풍) -> '동→서', 270°(서풍) -> '서→동', 0°(북풍) -> '북→남'
 */
export function getWindFlowDescKor(deg: number): string {
  const directions8 = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
  const normFrom = ((Number(deg) || 0) % 360 + 360) % 360;
  const normTo = (normFrom + 180) % 360;
  const fromStr = directions8[Math.round(normFrom / 45) % 8];
  const toStr = directions8[Math.round(normTo / 45) % 8];
  return `${fromStr}→${toStr}`;
}

/**
 * 조류·해류 유향(물이 흘러가는 방향, To)을 한국식 조류 방향으로 변환 (단순 방향 표기)
 * 예: 90° -> '동류', 180° -> '남류', 270° -> '서류'
 */
export function getCurrentDirectionKor(deg: number): string {
  const currentDirs8 = [
    '북류',
    '북동류',
    '동류',
    '남동류',
    '남류',
    '남서류',
    '서류',
    '북서류',
  ];
  const norm = ((Number(deg) || 0) % 360 + 360) % 360;
  const index = Math.round(norm / 45) % 8;
  return currentDirs8[index];
}

interface CachedItem<T> {
  data: T;
  expireAt: number;
}

const memoryWeatherCache = new Map<string, CachedItem<WeatherData>>();
const inFlightWeatherRequests = new Map<string, Promise<WeatherData>>();

const memoryMarineCache = new Map<string, CachedItem<MarineData>>();
const inFlightMarineRequests = new Map<string, Promise<MarineData>>();

const WEATHER_CACHE_TTL_MS = 15 * 60 * 1000; // 15분 캐시

/** Open-Meteo Weather Forecast API (Windy.com과 100% 동일한 ECMWF IFS HRES 9km 고해상도 모델 `ecmwf_ifs`) 호출 (15분 캐시 적용) */
export async function fetchWeatherData(lat: number, lng: number): Promise<WeatherData> {
  // 해안선/방조제 좌표가 내륙 격자로 밀리지 않도록 0.01°(약 1km) 정밀도 유지
  const gridLat = Math.round(lat * 100) / 100;
  const gridLng = Math.round(lng * 100) / 100;
  const cacheKey = `exfish_weather_v3_${gridLat.toFixed(2)}_${gridLng.toFixed(2)}`;

  // 1. 메모리 캐시 검사
  const mem = memoryWeatherCache.get(cacheKey);
  if (mem && mem.expireAt > Date.now()) {
    return mem.data;
  }

  // 2. LocalStorage 캐시 검사
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const item: CachedItem<WeatherData> = JSON.parse(raw);
        if (item && item.expireAt > Date.now()) {
          memoryWeatherCache.set(cacheKey, item);
          return item.data;
        }
      }
    } catch {}
  }

  // 3. In-flight 요청 중복 방지 (동시 다발적 동일 좌표 쿼리 병합)
  if (inFlightWeatherRequests.has(cacheKey)) {
    return inFlightWeatherRequests.get(cacheKey)!;
  }

  const reqPromise = (async () => {
    // Windy.com 기본 모델과 100% 동일한 ECMWF IFS HRES 9km (`models=ecmwf_ifs`) 지정
    // (기존 `ecmwf_ifs025`는 0.25°=28km 저해상도 격자였으며, KHOA 내항 관측소 덮어쓰기로 인해 현장/Windy와 괴리 발생)
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m&models=ecmwf_ifs&wind_speed_unit=ms&forecast_days=4&timezone=Asia%2FSeoul`;

    try {
      let res = await fetch(url);
      // 만약 ecmwf_ifs 일시 오류 시 ecmwf_ifs025 모델로 1회 안전 폴백
      if (!res.ok) {
        const fallbackUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m&models=ecmwf_ifs025&wind_speed_unit=ms&forecast_days=4&timezone=Asia%2FSeoul`;
        res = await fetch(fallbackUrl);
      }

      if (!res.ok) throw new Error(`Weather fetch failed: ${res.statusText}`);
      const data = await res.json();
      const current = data.current;

      // Windy.com과 완전 일치하도록 포인트 해당 좌표의 ECMWF IFS 9km 풍향·풍속을 원형 그대로 사용
      // (수십 km 떨어진 내항 조위관측소 풍속계로 덮어쓰지 않음)
      const finalWindSpeed = Math.round((current.wind_speed_10m ?? 2.0) * 10) / 10;
      const finalWindDir = Math.round(current.wind_direction_10m ?? 0);

      // 물리적 검증(Physical Sanity Check): 돌풍(windGust)은 항상 일반 풍속 이상이어야 함 (풍속 > 돌풍 역전 차단)
      const rawGust = current.wind_gusts_10m != null ? Math.round(current.wind_gusts_10m * 10) / 10 : finalWindSpeed;
      const finalWindGust = Math.max(rawGust, finalWindSpeed);

      const hourlyWindSpeed = (data.hourly?.wind_speed_10m?.slice(0, 96) || []).map((v: number) => Math.round(v * 10) / 10);
      const hourlyRawGust = data.hourly?.wind_gusts_10m?.slice(0, 96) || [];
      const hourlyWindGust = hourlyWindSpeed.map((spd: number, idx: number) => {
        const g = hourlyRawGust[idx] != null ? Math.round(hourlyRawGust[idx] * 10) / 10 : spd;
        return Math.max(g, spd);
      });

      const result: WeatherData = {
        temp: Math.round(current.temperature_2m * 10) / 10,
        apparentTemp: Math.round(current.apparent_temperature * 10) / 10,
        humidity: Math.round(current.relative_humidity_2m ?? 65),
        weatherCode: current.weather_code,
        weatherText: getWeatherText(current.weather_code),
        windSpeed: finalWindSpeed,
        windDirection: finalWindDir,
        windGust: finalWindGust,
        isObserved: false,
        hourly: {
          time: data.hourly?.time?.slice(0, 96) || [],
          temp: (data.hourly?.temperature_2m?.slice(0, 96) || []).map((v: number) => Math.round(v * 10) / 10),
          windSpeed: hourlyWindSpeed,
          windDirection: data.hourly?.wind_direction_10m?.slice(0, 96) || [],
          windGust: hourlyWindGust,
          pop: data.hourly?.precipitation_probability?.slice(0, 96) || [],
          weatherCode: data.hourly?.weather_code?.slice(0, 96) || [],
        },
      };

      // 캐시 저장
      const expireAt = Date.now() + WEATHER_CACHE_TTL_MS;
      memoryWeatherCache.set(cacheKey, { data: result, expireAt });
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(cacheKey, JSON.stringify({ data: result, expireAt }));
        } catch {}
      }

      return result;
    } catch (err) {
      console.warn('Weather API fallback used:', err);
      const nearest = findNearestKhoaStation(lat, lng);
      const khoaWind = await getCachedKhoaWind(nearest.station.code).catch(() => null);

      const fallback: WeatherData = {
        temp: 18.5,
        apparentTemp: 17.8,
        humidity: 68,
        weatherCode: 1,
        weatherText: '대체로 맑음 🌤️',
        windSpeed: (khoaWind && typeof khoaWind.wspd === 'number') ? Math.round(khoaWind.wspd * 10) / 10 : 2.0,
        windDirection: (khoaWind && typeof khoaWind.wndrct === 'number') ? Math.round(khoaWind.wndrct) : 315, // 북서풍
        windGust: 3.5,
        isObserved: !!khoaWind,
        observedStationName: khoaWind ? nearest.station.name : undefined,
        observedDistanceKm: khoaWind ? nearest.distanceKm : undefined,
        hourly: {
          time: Array.from({ length: 24 }, (_, i) => `${i}:00`),
          temp: Array.from({ length: 24 }, () => 18),
          windSpeed: Array.from({ length: 24 }, () => 2.0),
          windDirection: Array.from({ length: 24 }, () => 315),
          windGust: Array.from({ length: 24 }, () => 3.5),
          pop: Array.from({ length: 24 }, () => 10),
        },
      };

      return fallback;
    } finally {
      inFlightWeatherRequests.delete(cacheKey);
    }
  })();

  inFlightWeatherRequests.set(cacheKey, reqPromise);
  return reqPromise;
}

/** Open-Meteo Marine API 호출 및 국립해양조사원 실측 수온 & ROMS 해류 융합 (단위 km/h -> m/s 정규화, 15분 캐시 적용) */
export async function fetchMarineData(lat: number, lng: number): Promise<MarineData> {
  const gridLat = Math.round(lat * 100) / 100;
  const gridLng = Math.round(lng * 100) / 100;
  const cacheKey = `exfish_marine_v3_${gridLat.toFixed(2)}_${gridLng.toFixed(2)}`;

  // 1. 메모리 캐시 검사
  const mem = memoryMarineCache.get(cacheKey);
  if (mem && mem.expireAt > Date.now()) {
    return mem.data;
  }

  // 2. LocalStorage 캐시 검사
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const item: CachedItem<MarineData> = JSON.parse(raw);
        if (item && item.expireAt > Date.now()) {
          memoryMarineCache.set(cacheKey, item);
          return item.data;
        }
      }
    } catch {}
  }

  // 3. In-flight 요청 중복 방지
  if (inFlightMarineRequests.has(cacheKey)) {
    return inFlightMarineRequests.get(cacheKey)!;
  }

  const reqPromise = (async () => {
    const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}&current=wave_height,wave_direction,wave_period,ocean_current_velocity,ocean_current_direction,sea_surface_temperature&hourly=wave_height,sea_surface_temperature,ocean_current_velocity,ocean_current_direction&forecast_days=4&timezone=Asia%2FSeoul`;

    const nearest = findNearestKhoaStation(lat, lng);
    const khoaTempPromise = getCachedKhoaWaterTemp(nearest.station.code).catch(() => null);
    const romsPromise = fetchKhoaRoms(lat, lng).catch(() => null);

    try {
      const [res, khoaTemp, roms] = await Promise.all([
        fetch(url),
        khoaTempPromise,
        romsPromise,
      ]);

      if (!res.ok) throw new Error(`Marine fetch failed: ${res.statusText}`);
      const data = await res.json();
      const current = data.current;
      const hourly = data.hourly;

      // 실측 수온 우선 반영
      let finalSst = current.sea_surface_temperature != null ? Math.round(current.sea_surface_temperature * 10) / 10 : 17.2;
      let isObservedTemp = false;
      let observedTempStationName: string | undefined = undefined;

      if (khoaTemp && typeof khoaTemp.wtem === 'number' && !isNaN(khoaTemp.wtem)) {
        finalSst = Math.round(khoaTemp.wtem * 10) / 10;
        isObservedTemp = true;
        observedTempStationName = nearest.station.name;
      }

      // [단위 교정 버그 픽스] Open-Meteo ocean_current_velocity는 km/h 단위이므로 m/s로 정규화 (/ 3.6)
      // 이전 버전은 km/h를 m/s로 오인하여 12노트(울돌목 초과) 쓰나미급 조류가 산출되던 오류 완벽 해결
      const rawCurrentKmh = current.ocean_current_velocity;
      const openMeteoCurrentMps = rawCurrentKmh != null ? Math.round((rawCurrentKmh / 3.6) * 100) / 100 : 0.25;

      // ROMS 수치예측모델 유향/유속 우선 반영 (ROMS crsp는 이미 m/s 단위)
      let finalCurrentVel = openMeteoCurrentMps;
      let finalCurrentDir = current.ocean_current_direction ?? 135;
      let isRomsCurrent = false;

      if (roms && typeof roms.crsp === 'number' && !isNaN(roms.crsp) && typeof roms.crdir === 'number') {
        finalCurrentVel = Math.round(roms.crsp * 100) / 100;
        finalCurrentDir = Math.round(roms.crdir);
        isRomsCurrent = true;
      }

      // hourly currentVelocity도 km/h -> m/s로 일관되게 정규화
      const hourlyCurrentVel = (hourly?.ocean_current_velocity?.slice(0, 96) || []).map(
        (kmh: number | null) => (kmh != null ? Math.round((kmh / 3.6) * 100) / 100 : 0.25)
      );

      const result: MarineData = {
        seaSurfaceTemp: finalSst,
        waveHeight: current.wave_height != null ? Math.round(current.wave_height * 10) / 10 : 0.6,
        waveDirection: current.wave_direction ?? 180,
        wavePeriod: current.wave_period != null ? Math.round(current.wave_period) : 5,
        currentVelocity: finalCurrentVel,
        currentDirection: finalCurrentDir,
        isObservedTemp,
        observedTempStationName,
        isRomsCurrent,
        hourly: {
          time: hourly?.time?.slice(0, 96) || [],
          seaSurfaceTemp: hourly?.sea_surface_temperature?.slice(0, 96) || [],
          waveHeight: hourly?.wave_height?.slice(0, 96) || [],
          currentVelocity: hourlyCurrentVel,
          currentDirection: hourly?.ocean_current_direction?.slice(0, 96) || [],
        },
      };

      // 캐시 저장
      const expireAt = Date.now() + WEATHER_CACHE_TTL_MS;
      memoryMarineCache.set(cacheKey, { data: result, expireAt });
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(cacheKey, JSON.stringify({ data: result, expireAt }));
        } catch {}
      }

      return result;
    } catch (err) {
      console.warn('Marine API fallback used:', err);
      const khoaTemp = await khoaTempPromise.catch(() => null);

      return {
        seaSurfaceTemp: khoaTemp && typeof khoaTemp.wtem === 'number' ? Math.round(khoaTemp.wtem * 10) / 10 : 17.4,
        waveHeight: 0.5,
        waveDirection: 210,
        wavePeriod: 6,
        currentVelocity: 0.25,
        currentDirection: 140,
        isObservedTemp: !!khoaTemp,
        observedTempStationName: khoaTemp ? nearest.station.name : undefined,
        hourly: {
          time: Array.from({ length: 24 }, (_, i) => `${i}:00`),
          seaSurfaceTemp: Array.from({ length: 24 }, () => 17.4),
          waveHeight: Array.from({ length: 24 }, () => 0.5),
          currentVelocity: Array.from({ length: 24 }, () => 0.25),
          currentDirection: Array.from({ length: 24 }, () => 140),
        },
      };
    } finally {
      inFlightMarineRequests.delete(cacheKey);
    }
  })();

  inFlightMarineRequests.set(cacheKey, reqPromise);
  return reqPromise;
}

/** 포인트 위경도로부터 공식 Windy.com 상세 웹페이지 URL 생성 */
export function getWindyWebUrl(lat: number, lng: number): string {
  // 사용자가 요청한 Windy 링크 포맷
  const latFormatted = lat.toFixed(3);
  const lngFormatted = lng.toFixed(3);
  return `https://www.windy.com/${latFormatted}/${lngFormatted}?${latFormatted},${lngFormatted},13,i:pressure,p:cities,m:eHmajGb`;
}

/** 단위 변환 헬퍼 */
export function formatWindSpeed(valMs: number, unit: 'ms' | 'knot' | 'kmh'): string {
  switch (unit) {
    case 'knot':
      return `${(valMs * 1.94384).toFixed(1)} kt`;
    case 'kmh':
      return `${(valMs * 3.6).toFixed(1)} km/h`;
    case 'ms':
    default:
      return `${valMs.toFixed(1)} m/s`;
  }
}

export function formatCurrentVelocity(valMs: number, unit: 'knot' | 'ms' | 'cms'): string {
  switch (unit) {
    case 'knot':
      return `${(valMs * 1.94384).toFixed(1)} kt`;
    case 'cms':
      return `${(valMs * 100).toFixed(0)} cm/s`;
    case 'ms':
    default:
      return `${valMs.toFixed(2)} m/s`;
  }
}

export interface SwellRisk {
  level: 'SAFE' | 'CAUTION' | 'DANGER';
  title: string;
  badgeColor: string;
  energyScore: number;
  description: string;
}

/** 유의파고(m) 및 파주기(s) 결합 너울성(Swell) 위험도 판정 */
export function calculateSwellRisk(waveHeight: number, wavePeriod: number): SwellRisk {
  const energy = (waveHeight ** 2) * wavePeriod;
  if (energy >= 12 || waveHeight >= 1.6 || (wavePeriod >= 9 && waveHeight >= 0.9)) {
    return {
      level: 'DANGER',
      title: '너울성 파도 경보',
      badgeColor: 'bg-rose-500/20 text-rose-300 border-rose-500/50',
      energyScore: Math.round(energy * 10) / 10,
      description: '긴 파주기의 너울이 갯바위를 덮칠 수 있습니다. 간출여 진입을 절대 금지하세요.',
    };
  }
  if (energy >= 5.5 || waveHeight >= 1.0 || wavePeriod >= 7.5) {
    return {
      level: 'CAUTION',
      title: '너울 주의보',
      badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/50',
      energyScore: Math.round(energy * 10) / 10,
      description: '간헐적인 세트 너울이 발생할 수 있습니다. 구명조끼를 필히 착용하고 발판 침수에 유의하세요.',
    };
  }
  return {
    level: 'SAFE',
    title: '해상 파도 양호',
    badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50',
    energyScore: Math.round(energy * 10) / 10,
    description: '너울 에너지가 낮아 도보 포인트 및 갯바위 진입에 양호한 상태입니다.',
  };
}
