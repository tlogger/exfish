import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./khoaCache', () => ({
  getCachedKhoaWind: vi.fn().mockResolvedValue({ wspd: 3.4, wndrct: 180 }),
  getCachedKhoaWaterTemp: vi.fn().mockResolvedValue({ wtem: 16.2 }),
  getCachedKhoaRoms: vi.fn().mockResolvedValue(null),
}));

vi.mock('./nativeBridge', () => ({
  isNativePlatform: vi.fn().mockReturnValue(false),
}));

import {
  fetchWeatherData,
  fetchMarineData,
  getOpenMeteoEndpointUrl,
  resetOpenMeteoClientState,
} from './weatherApi';
import { isNativePlatform } from './nativeBridge';

describe('weatherApi Open-Meteo 방어 및 CDN 프록시 라우팅', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetOpenMeteoClientState();
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllGlobals();
  });

  it('실패 시 2분 메모리 네거티브 캐시가 동작해 동일 좌표 재요청을 차단한다', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const first = await fetchWeatherData(34.889, 128.475);
    const second = await fetchWeatherData(34.889, 128.475);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.isObserved).toBe(true);
    expect(first.windSpeed).toBe(3.4);
    expect(second.windSpeed).toBe(3.4);
  });

  it('연속 3회 실패 시 forecast 서킷 브레이커가 열려 4번째 좌표부터 fetch를 건너뛰며 marine은 격리된다', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('marine')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              current: {
                wave_height: 0.4,
                wave_direction: 180,
                wave_period: 5,
                ocean_current_velocity: 1.8,
                ocean_current_direction: 90,
                sea_surface_temperature: 17.0,
              },
              hourly: {
                time: ['2026-11-15T00:00'],
                wave_height: [0.4],
                sea_surface_temperature: [17.0],
                ocean_current_velocity: [1.8],
                ocean_current_direction: [90],
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        );
      }
      return Promise.reject(new TypeError('Failed to fetch'));
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await fetchWeatherData(34.10, 128.10);
    await fetchWeatherData(34.20, 128.20);
    await fetchWeatherData(34.30, 128.30);
    // 4번째 다른 좌표는 서킷 오픈으로 즉시 폴백
    await fetchWeatherData(34.40, 128.40);

    const forecastCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('forecast'));
    expect(forecastCalls).toHaveLength(3);

    // marine 엔드포인트는 서킷이 독립적이므로 정상 호출됨
    const marine = await fetchMarineData(34.40, 128.40);
    expect(marine.waveHeight).toBe(0.4);
    expect(marine.currentVelocity).toBe(0.5); // 1.8 km/h / 3.6 = 0.5 m/s
  });

  it('동시에 10개 좌표를 요청해도 Open-Meteo 동시 요청 수는 최대 4개로 제한된다', async () => {
    let currentActive = 0;
    let maxActive = 0;

    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      expect(init?.signal).toBeDefined();
      expect(url).toContain('latitude=');
      currentActive++;
      if (currentActive > maxActive) maxActive = currentActive;
      await new Promise((r) => setTimeout(r, 15));
      currentActive--;
      return new Response(
        JSON.stringify({
          current: {
            temperature_2m: 15,
            relative_humidity_2m: 60,
            apparent_temperature: 14,
            weather_code: 0,
            wind_speed_10m: 2.5,
            wind_direction_10m: 270,
            wind_gusts_10m: 4.0,
            surface_pressure: 1015,
          },
          hourly: {
            time: ['2026-11-15T00:00'],
            temperature_2m: [15],
            precipitation_probability: [0],
            weather_code: [0],
            wind_speed_10m: [2.5],
            wind_direction_10m: [270],
            wind_gusts_10m: [4.0],
            surface_pressure: [1015],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await Promise.all(
      Array.from({ length: 10 }, (_, idx) => fetchWeatherData(34.0 + idx * 0.1, 128.0 + idx * 0.1))
    );

    expect(fetchMock).toHaveBeenCalledTimes(10);
    expect(maxActive).toBeLessThanOrEqual(4);
  });

  it('웹·네이티브·비브라우저 환경별로 올바른 Open-Meteo 프록시 URL을 선택한다', () => {
    // 비브라우저(Node/Vitest)
    expect(getOpenMeteoEndpointUrl('forecast')).toBe('https://api.open-meteo.com/v1/forecast');
    expect(getOpenMeteoEndpointUrl('marine')).toBe('https://marine-api.open-meteo.com/v1/marine');

    // 브라우저 HTTP 환경
    vi.stubGlobal('window', { location: { protocol: 'https:' } });
    expect(getOpenMeteoEndpointUrl('forecast')).toBe('/api-openmeteo/forecast');
    expect(getOpenMeteoEndpointUrl('marine')).toBe('/api-openmeteo/marine');

    // 네이티브 APK 환경
    vi.mocked(isNativePlatform).mockReturnValue(true);
    expect(getOpenMeteoEndpointUrl('forecast')).toBe('https://exfish.vercel.app/api-openmeteo/forecast');
    expect(getOpenMeteoEndpointUrl('marine')).toBe('https://exfish.vercel.app/api-openmeteo/marine');
  });
});
