import { calculateTideDay } from './tideEngine';
import { fetchWeatherData, fetchMarineData, fetchHistoricalWeatherAndMarine } from './weatherApi';
import { fetchKhoaWaterTemp, fetchKhoaWind } from './khoaApi';
import { findNearestKhoaStation } from './tideService';

export const MAX_PAST_SYNC_DAYS = 90;

export interface CatchSyncResult {
  catch_mul: string;
  tide_state: string;
  water_temp: number;
  wind_speed: number;
  wind_direction?: number;
  current_velocity?: number;
  current_direction?: number;
  wave_height?: number;
  wave_period?: number;
  temp?: number;
  source?: 'TODAY_HOURLY' | 'PAST_HISTORICAL' | 'FALLBACK';
}

export function getMinAllowedCatchDateStr(now: Date = new Date()): string {
  const minDate = new Date(now.getTime() - MAX_PAST_SYNC_DAYS * 24 * 60 * 60 * 1000);
  const y = minDate.getFullYear();
  const m = String(minDate.getMonth() + 1).padStart(2, '0');
  const d = String(minDate.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isWithinAllowedCatchWindow(dateStr: string, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1, d, 12, 0, 0);
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  const diffDays = (todayMid.getTime() - target.getTime()) / (24 * 60 * 60 * 1000);
  return diffDays >= -1 && diffDays <= MAX_PAST_SYNC_DAYS;
}

/**
 * 출조 날짜(최근 90일 이내), 시각, 위경도 좌표를 기반으로 당시 실제 환경(물때, 조위, 수온, 바람, 파고, 조류)을 복원
 */
export async function syncCatchEnvironment(
  dateStr: string, // YYYY-MM-DD
  timeStr: string, // HH:mm
  lat: number,
  lng: number
): Promise<CatchSyncResult> {
  if (!isWithinAllowedCatchWindow(dateStr)) {
    throw new Error(`최근 ${MAX_PAST_SYNC_DAYS}일 이내 출조 기록만 환경 자동 복원을 지원합니다.`);
  }

  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  const targetDate = new Date(year, month - 1, day, Number.isFinite(hour) ? hour : 12, Number.isFinite(minute) ? minute : 0);

  // 1. 해당 날짜 및 좌표의 물때 및 조석 계산
  const tideInfo = calculateTideDay(lat, lng, targetDate);
  const targetHour = targetDate.getHours();
  const matchedCurve = tideInfo.hourlyCurve.find((c) => c.hour === targetHour) || tideInfo.hourlyCurve[0];

  const tide_state = matchedCurve
    ? `${matchedCurve.stateText} (조위 ${matchedCurve.height}cm)`
    : '조석 정보 연동';

  // 천문 조석 기울기 기반 조류 폴백 (ROMS는 예측 전용)
  const slopeFallbackVel = matchedCurve?.normalizedSlope != null
    ? Math.round(Math.max(0.05, Math.abs(matchedCurve.normalizedSlope) * 0.8) * 100) / 100
    : 0.3;

  let water_temp = 17.5;
  let wind_speed = 3.0;
  let wind_direction: number | undefined = 315;
  let current_velocity: number | undefined = slopeFallbackVel;
  let current_direction: number | undefined = 180;
  let wave_height: number | undefined = 0.6;
  let wave_period: number | undefined = 5.0;
  let temp: number | undefined = 18.0;
  let source: CatchSyncResult['source'] = 'FALLBACK';

  const now = new Date();
  const isToday = now.toDateString() === targetDate.toDateString();

  try {
    if (isToday) {
      const [wData, mData] = await Promise.all([
        fetchWeatherData(lat, lng),
        fetchMarineData(lat, lng),
      ]);
      if (wData.hourly.temp[targetHour] != null) temp = wData.hourly.temp[targetHour];
      if (wData.hourly.windSpeed[targetHour] != null) wind_speed = wData.hourly.windSpeed[targetHour];
      if (wData.hourly.windDirection[targetHour] != null) wind_direction = wData.hourly.windDirection[targetHour];
      if (mData.hourly?.seaSurfaceTemp[targetHour] != null) water_temp = mData.hourly.seaSurfaceTemp[targetHour];
      else water_temp = mData.seaSurfaceTemp;
      if (mData.hourly?.waveHeight[targetHour] != null) wave_height = mData.hourly.waveHeight[targetHour];
      else wave_height = mData.waveHeight;
      if (mData.hourly?.wavePeriod?.[targetHour] != null) wave_period = mData.hourly.wavePeriod[targetHour];
      else wave_period = mData.wavePeriod;
      if (mData.hourly?.currentVelocity[targetHour] != null) current_velocity = mData.hourly.currentVelocity[targetHour];
      else current_velocity = mData.currentVelocity;
      if (mData.hourly?.currentDirection[targetHour] != null) current_direction = mData.hourly.currentDirection[targetHour];
      else current_direction = mData.currentDirection;
      source = 'TODAY_HOURLY';
    } else {
      // 최근 90일 이내 과거 출조: Open-Meteo 과거 시간별 + KHOA 시각별 실측 병렬 복원
      const nearest = findNearestKhoaStation(lat, lng);
      const [hist, khoaTemp, khoaWind] = await Promise.all([
        fetchHistoricalWeatherAndMarine(lat, lng, dateStr, targetHour),
        fetchKhoaWaterTemp(nearest.station.code, dateStr, timeStr).catch(() => null),
        fetchKhoaWind(nearest.station.code, dateStr, timeStr).catch(() => null),
      ]);

      if (hist.temp != null) temp = hist.temp;
      if (hist.windSpeed != null) wind_speed = hist.windSpeed;
      if (hist.windDirection != null) wind_direction = hist.windDirection;
      if (hist.waterTemp != null) water_temp = hist.waterTemp;
      if (hist.waveHeight != null) wave_height = hist.waveHeight;
      if (hist.wavePeriod != null) wave_period = hist.wavePeriod;
      if (hist.currentVelocity != null) current_velocity = hist.currentVelocity;
      if (hist.currentDirection != null) current_direction = hist.currentDirection;

      // KHOA 과거 실측 관측값 우선 반영
      if (khoaTemp && typeof khoaTemp.wtem === 'number' && !Number.isNaN(khoaTemp.wtem)) {
        water_temp = khoaTemp.wtem;
      }
      if (khoaWind && typeof khoaWind.wspd === 'number' && !Number.isNaN(khoaWind.wspd)) {
        wind_speed = khoaWind.wspd;
        wind_direction = khoaWind.wndrct;
      }
      source = 'PAST_HISTORICAL';
    }
  } catch (e) {
    console.warn('syncCatchEnvironment error:', e);
  }

  return {
    catch_mul: tideInfo.mulText,
    tide_state,
    water_temp,
    wind_speed,
    wind_direction,
    current_velocity,
    current_direction,
    wave_height,
    wave_period,
    temp,
    source,
  };
}
