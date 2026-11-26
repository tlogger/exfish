import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeCastingLandingPoint } from './castingLanding';
import { resolveUnifiedWaterDepth } from './depthSinkEngine';
import { fetchKhoaWaterDepth } from './khoaApi';
import {
  resetTackleConfigState,
  saveTackleConfig,
  syncTackleWithUserCookie,
  getSavedTackleConfig,
  getTackleShortLabel,
} from './tackleCalibration';

describe('착수 지점 수심 계산 및 로그인 채비 쿠키 보존', () => {
  beforeEach(() => {
    resetTackleConfigState();
    vi.restoreAllMocks();
  });

  it('캐스팅 부채꼴 정중앙 방위각과 비거리로 착수 지점을 계산한다', () => {
    const landing = computeCastingLandingPoint(
      {
        lat: 35.0,
        lng: 129.0,
        casting_start_deg: 60,
        casting_end_deg: 120,
        casting_directions: ['E'],
      },
      50
    );

    expect(landing.hasCasting).toBe(true);
    expect(landing.bearingDeg).toBe(90);
    expect(landing.distanceM).toBe(50);
    expect(landing.lng).toBeGreaterThan(129.0);
    expect(Math.abs(landing.lat - 35.0)).toBeLessThan(0.0001);
  });

  it('360도 경계를 걸치는 캐스팅 부채꼴(330°~30°)의 정중앙은 북쪽(0°)이다', () => {
    const landing = computeCastingLandingPoint(
      {
        lat: 35.0,
        lng: 129.0,
        casting_start_deg: 330,
        casting_end_deg: 30,
        casting_directions: ['N'],
      },
      40
    );

    expect(landing.hasCasting).toBe(true);
    expect(landing.bearingDeg).toBe(0);
    expect(landing.lat).toBeGreaterThan(35.0);
  });

  it('전방위(ALL) 또는 방향 정보 없음일 때는 hasCasting=false 및 연안 좌표를 반환한다', () => {
    const landing = computeCastingLandingPoint(
      {
        lat: 35.0,
        lng: 129.0,
        casting_directions: ['ALL'],
      },
      60
    );

    expect(landing.hasCasting).toBe(false);
    expect(landing.distanceM).toBe(0);
    expect(landing.lat).toBe(35.0);
    expect(landing.lng).toBe(129.0);
  });

  it('khoaDpwtIsAtTarget=true이면 착수점 KHOA 수심에 원거리 경사 보너스를 중복 가산하지 않는다', () => {
    const landing = computeCastingLandingPoint(
      { lat: 35.0, lng: 129.0, casting_start_deg: 80, casting_end_deg: 100, casting_directions: ['E'] },
      100
    );

    const res = resolveUnifiedWaterDepth({
      spotLat: 35.0,
      spotLng: 129.0,
      targetLat: landing.lat,
      targetLng: landing.lng,
      spotType: 'ROCK',
      khoaDpwt: 12.0,
      khoaDpwtIsAtTarget: true,
      datumZ0: 2.0,
      tideHeightCm: 200, // 평균해면과 동일 -> 조위 보정 0m
      pressureHpa: 1013.25,
      isPredictedTide: true,
    });

    expect(res.realDepthM).toBeCloseTo(12.0, 1);
  });

  it('로그인 사용자별 쿠키에 채비를 보존하고 계정 전환 시 타 계정의 localStorage를 덮어쓴다', () => {
    let cookieJar = '';
    vi.stubGlobal('document', {
      get cookie() {
        return cookieJar;
      },
      set cookie(val: string) {
        const [pair] = val.split(';');
        const [k] = pair.split('=');
        const existing = cookieJar
          .split('; ')
          .filter(Boolean)
          .filter((item) => !item.startsWith(`${k}=`));
        existing.push(pair);
        cookieJar = existing.join('; ');
      },
    });

    // User A 로그인 후 에기 20g + 봉돌 7.5g 저장
    syncTackleWithUserCookie('userA@example.com');
    saveTackleConfig({ baitType: 'LURE', lureSubMode: 'JUKKUMI', egiWeightGrams: 20, sinkerWeightGrams: 7.5 });
    expect(getTackleShortLabel(getSavedTackleConfig())).toBe('에기 20g+봉돌7.5g');

    // User B 로그인 후 지그헤드 7g 저장
    syncTackleWithUserCookie('userB@example.com');
    saveTackleConfig({ baitType: 'LURE', lureSubMode: 'JIG', weightGrams: 7 });
    expect(getTackleShortLabel(getSavedTackleConfig())).toBe('지그헤드 7g');

    // 다시 User A로 전환 시 User A의 쿠키 채비가 복원되어야 함
    const restoredA = syncTackleWithUserCookie('userA@example.com');
    expect(getTackleShortLabel(restoredA)).toBe('에기 20g+봉돌7.5g');

    vi.unstubAllGlobals();
  });

  it('KHOA 150m 격자 수심 조회 시 연안 경계 저수심 셀(0.58m)을 제외하고 외해 셀 IDW 보간으로 실제 수심을 산출한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          body: {
            items: {
              item: [
                { lat: 35.8725, lot: 126.5069, dpwt: 0.58 },
                { lat: 35.8739, lot: 126.5069, dpwt: 7.41 },
                { lat: 35.8712, lot: 126.5053, dpwt: 12.84 },
                { lat: 35.8725, lot: 126.5052, dpwt: 13.27 },
                { lat: 35.8739, lot: 126.5052, dpwt: 13.37 },
              ],
            },
          },
        }),
      })
    );

    const depthRes = await fetchKhoaWaterDepth(35.872145, 126.506811);
    expect(depthRes).not.toBeNull();
    expect(depthRes!.dpwt).toBeGreaterThan(7.0);

    vi.unstubAllGlobals();
  });
});
