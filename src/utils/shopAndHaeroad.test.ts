import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isAllowedKoreaTile } from '../../api/haeroad-tile';
import { computeVisibleEpsg3857Tiles, computeTileAffineMatrix } from '../components/HaeRoadEncOverlay';
import { isStrictPaedrosAdmin } from '../services/oauthService';
import { fetchCloudShopsDelta } from './cloudDb';
import {
  STORAGE_KEY_SHOPS_MASTER,
  saveAllCachedShops,
  getAllCachedShops,
  saveAllCachedSpots,
  getAllCachedSpots,
} from './offlineStorage';
import type { FishingShop, FishingSpot } from '../types';

describe('HaeRoad ENC tile validation & EPSG:3857 sync', () => {
  it('allows valid Korea coastal tiles within zoom 8~16', () => {
    // Busan / South Sea around z=14 (129.075, 35.179) -> x~14065, y~6492
    expect(isAllowedKoreaTile(14, 14065, 6492)).toBe(true);
    // Jeju around z=10 (126.5, 33.4) -> x~871, y~410
    expect(isAllowedKoreaTile(10, 871, 410)).toBe(true);
  });

  it('rejects out-of-range zooms, non-integers, and tiles outside Korea bbox', () => {
    expect(isAllowedKoreaTile(7, 100, 50)).toBe(false);
    expect(isAllowedKoreaTile(17, 112520, 51936)).toBe(false);
    expect(isAllowedKoreaTile(14.5, 14065, 6492)).toBe(false);
    // Outside Korea bbox (e.g. Europe x=8192, y=5400 at z=14)
    expect(isAllowedKoreaTile(14, 8192, 5400)).toBe(false);
  });

  it('computes visible EPSG:3857 tiles matching viewport dimensions', () => {
    const tiles = computeVisibleEpsg3857Tiles(35.05, 129.0, 35.15, 129.15, 1200, 800);
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) {
      expect(tile.z).toBeGreaterThanOrEqual(8);
      expect(tile.z).toBeLessThanOrEqual(16);
      expect(tile.widthPx).toBeGreaterThan(0);
      expect(tile.heightPx).toBeGreaterThan(0);
    }
    expect(computeVisibleEpsg3857Tiles(35.15, 129.0, 35.05, 129.15, 1200, 800)).toEqual([]);
    expect(computeVisibleEpsg3857Tiles(35.05, 129.0, 35.15, 129.15, 0, 800)).toEqual([]);
  });

  it('computes 2D CSS affine matrix for rotated/sheared EPSG:5181 tile corners', () => {
    const css = computeTileAffineMatrix(
      { x: 100, y: 200 },
      { x: 356, y: 196 }, // NE shifted up 4px (East Sea convergence)
      { x: 104, y: 456 }, // SW shifted right 4px
      256,
      0
    );
    expect(css).toBe('matrix(1.000000, -0.015625, 0.015625, 1.000000, 100.00, 200.00)');
  });
});

describe('Strict paedros@gmail.com admin check', () => {
  it('returns true only for paedros@gmail.com (case/whitespace-insensitive)', () => {
    expect(isStrictPaedrosAdmin({ email: 'paedros@gmail.com' })).toBe(true);
    expect(isStrictPaedrosAdmin({ email: '  PAEDROS@GMAIL.COM ' })).toBe(true);
    expect(isStrictPaedrosAdmin({ email: 'other@gmail.com' })).toBe(false);
    expect(isStrictPaedrosAdmin({ email: null })).toBe(false);
    expect(isStrictPaedrosAdmin(null)).toBe(false);
  });
});

describe('fetchCloudShopsDelta graceful missing-table fallback', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns empty full-sync result when fishing_shops table does not exist (42P01)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ code: '42P01', message: 'relation "public.fishing_shops" does not exist' }),
    } as any);

    const res = await fetchCloudShopsDelta(null);
    expect(res).toEqual({
      rows: [],
      deletedIds: [],
      maxUpdatedAt: null,
      isFullSync: true,
    });
  });
});

describe('offlineStorage shop cache isolation', () => {
  const store = new Map<string, string>();
  const mockLocalStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  };

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('window', { localStorage: mockLocalStorage });
    vi.stubGlobal('localStorage', mockLocalStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores shops in STORAGE_KEY_SHOPS_MASTER without polluting spots cache', () => {
    const sampleSpot: FishingSpot = {
      id: 'spot-1',
      user_id: 'user-1',
      author_name: '테스터',
      is_public: true,
      name: '테스트 포인트',
      spot_type: 'BREAKWATER',
      lat: 35.1,
      lng: 129.1,
      directions: '주차 후 도보 3분',
      photo_urls: [],
      fishing_methods: ['FLOAT'],
      target_species: ['감성돔'],
      description: '설명',
      created_at: '2026-11-15T00:00:00Z',
    };
    const sampleShop: FishingShop = {
      id: 'shop-1',
      user_id: 'admin-1',
      author_name: '관리자',
      is_public: true,
      name: '테스트 낚시점',
      lat: 35.12,
      lng: 129.12,
      has_restroom: true,
      has_store: true,
      created_at: '2026-11-15T00:00:00Z',
      updated_at: '2026-11-15T00:00:00Z',
    };

    saveAllCachedSpots([sampleSpot]);
    saveAllCachedShops([sampleShop]);

    expect(store.has(STORAGE_KEY_SHOPS_MASTER)).toBe(true);
    expect(getAllCachedShops()).toHaveLength(1);
    expect(getAllCachedShops()[0].id).toBe('shop-1');
    expect(getAllCachedSpots()).toHaveLength(1);
    expect(getAllCachedSpots()[0].id).toBe('spot-1');
  });
});
