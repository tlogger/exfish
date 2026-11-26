import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { searchPoi } from './poiSearch';

describe('poiSearch multi-provider routing & fallback', () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as any).window;

  beforeEach(() => {
    vi.restoreAllMocks();
    (globalThis as any).window = {};
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = originalWindow;
    }
  });

  it('returns empty array for short queries (< 2 chars)', async () => {
    expect(await searchPoi('a', { provider: 'osm' })).toEqual([]);
    expect(await searchPoi(' ', { provider: 'vworld' })).toEqual([]);
  });

  it('routes osm provider to /api/osm-search and normalizes results', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            place_id: 'osm-1',
            display_name: 'Naha Port (Okinawa, Japan)',
            lat: 26.212,
            lng: 127.671,
            type: 'harbour',
            source: 'osm',
          },
        ],
      }),
    });
    globalThis.fetch = fetchMock as any;

    const results = await searchPoi('Naha Port', {
      provider: 'osm',
      center: { lat: 26.2, lng: 127.6 },
      secondaryLang: 'ko',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/osm-search?');
    expect(String(fetchMock.mock.calls[0][0])).toContain('q=Naha+Port');
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('osm');
    expect(results[0].lat).toBeCloseTo(26.212, 3);
  });

  it('falls back to OSM search when Google API key is not configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            place_id: 'osm-2',
            display_name: 'Apra Harbor (Guam)',
            lat: 13.455,
            lng: 144.651,
            type: 'harbour',
            source: 'osm',
          },
        ],
      }),
    });
    globalThis.fetch = fetchMock as any;

    const results = await searchPoi('Apra Harbor', {
      provider: 'google',
      secondaryLang: 'en',
    });

    expect(results).toHaveLength(1);
    expect(results[0].display_name).toContain('Apra Harbor');
    expect(results[0].source).toBe('osm');
  });

  it('uses Kakao Places when available, and falls back to OSM when Kakao returns 0 results', async () => {
    (globalThis as any).window.kakao = {
      maps: {
        services: {
          Status: { OK: 'OK' },
          Places: class {
            keywordSearch(_q: string, cb: (data: any[], status: string) => void) {
              cb([], 'ZERO_RESULT');
            }
          },
          Geocoder: class {
            addressSearch(_q: string, cb: (data: any[], status: string) => void) {
              cb([], 'ZERO_RESULT');
            }
          },
        },
      },
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            place_id: 'osm-fallback',
            display_name: 'Okinawa (Japan)',
            lat: 26.2124,
            lng: 127.6809,
            type: 'island',
            source: 'osm',
          },
        ],
      }),
    });
    globalThis.fetch = fetchMock as any;

    const fallbackResults = await searchPoi('Okinawa', { provider: 'vworld' });
    expect(fallbackResults).toHaveLength(1);
    expect(fallbackResults[0].source).toBe('osm');
  });
});
