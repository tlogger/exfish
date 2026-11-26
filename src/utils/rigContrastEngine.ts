// 같은 출조 세션 내 A/B 채비 물리 대조 복기(Rig Contrast Insight) + 전원 꽝 물리 피드백 엔진
import type { CatchLog, RigContrastInsight } from '../types';
import { calculateSinkingPhysics, type TackleRigConfig } from './tackleCalibration';

function formatRigShort(log: CatchLog): string {
  const snap = log.tackle_snapshot as Partial<TackleRigConfig> | null | undefined;
  if (snap?.weightGrams) {
    return `${log.lure_bait || `${snap.weightGrams}g`} (${snap.weightGrams}g)`;
  }
  return log.lure_bait || log.catch_method;
}

/**
 * 동일 출조 세션의 채비별 결과(히트/꽝)를 침강 속도·바닥 안착·조류 흘림 물리 모델로 대조해
 * 1줄 결정론적 복기 인사이트를 생성합니다.
 * - 히트 + 꽝 공존 세션: 두 채비의 바닥 안착 시간과 흘림 거리 차이 대조
 * - 전원 꽝 세션: 바닥 안착 한계 / 권장 최소 무게 물리 진단
 */
export function buildRigContrastInsight(
  sessionLogs: CatchLog[],
  depthMeters: number = 6.0
): RigContrastInsight {
  if (!sessionLogs || sessionLogs.length === 0) {
    return { mode: 'NONE', summary: '' };
  }

  const hits = sessionLogs.filter((l) => (l.fish_count ?? 0) > 0 && !l.is_hitless);
  const skunks = sessionLogs.filter((l) => (l.fish_count ?? 0) === 0 || l.is_hitless);

  const refLog = sessionLogs[0];
  const currentVel = Math.max(0, refLog.current_velocity ?? 0.3);
  const safeDepth = Math.max(1.5, depthMeters || 6.0);

  // 1. 히트 + 꽝 공존: A/B 채비 물리 대조
  if (hits.length > 0 && skunks.length > 0) {
    const hitLog = hits[0];
    const skunkLog = skunks[0];
    const hitRig = hitLog.tackle_snapshot as TackleRigConfig | null | undefined;
    const skunkRig = skunkLog.tackle_snapshot as TackleRigConfig | null | undefined;

    if (hitRig && skunkRig && hitRig.weightGrams && skunkRig.weightGrams) {
      const hitPhys = calculateSinkingPhysics(hitRig.weightGrams, safeDepth, currentVel, hitRig.baitConfig, { peLineSize: hitRig.peLineSize });
      const skunkPhys = calculateSinkingPhysics(skunkRig.weightGrams, safeDepth, currentVel, skunkRig.baitConfig, { peLineSize: skunkRig.peLineSize });

      const hitFall = hitPhys.fallTimeSec != null ? `${Math.round(hitPhys.fallTimeSec)}초` : '바닥 불가';
      const skunkFall = skunkPhys.fallTimeSec != null ? `${Math.round(skunkPhys.fallTimeSec)}초` : '바닥 불가';
      const hitDrift = hitPhys.driftDistanceM != null ? `${hitPhys.driftDistanceM.toFixed(1)}m` : '-';
      const skunkDrift = skunkPhys.driftDistanceM != null ? `${skunkPhys.driftDistanceM.toFixed(1)}m` : '-';

      let takeaway = '채비 액션·볼륨 차이가 입질 유무에 작용';
      if (hitPhys.canReachBottom && !skunkPhys.canReachBottom) {
        takeaway = '바닥 안착 성공 여부가 결정적';
      } else if (hitPhys.fallTimeSec != null && skunkPhys.fallTimeSec != null) {
        if (hitPhys.fallTimeSec > skunkPhys.fallTimeSec + 1.5) {
          takeaway = '느린 폴링(체공 시간 확보)이 유효';
        } else if (hitPhys.fallTimeSec + 1.5 < skunkPhys.fallTimeSec) {
          takeaway = '빠른 바닥 공략(흘림 억제)이 유효';
        }
      }

      return {
        mode: 'AB_CONTRAST',
        hitLabel: formatRigShort(hitLog),
        skunkLabel: formatRigShort(skunkLog),
        summary: `유속 ${currentVel.toFixed(2)}m/s·수심 ${safeDepth.toFixed(1)}m에서 ${formatRigShort(hitLog)}(안착 ${hitFall}·흘림 ${hitDrift}) 히트 vs ${formatRigShort(skunkLog)}(안착 ${skunkFall}·흘림 ${skunkDrift}) 꽝 → ${takeaway}`,
      };
    }

    return {
      mode: 'AB_CONTRAST',
      hitLabel: formatRigShort(hitLog),
      skunkLabel: formatRigShort(skunkLog),
      summary: `동일 환경(수온 ${refLog.water_temp}°C·유속 ${currentVel.toFixed(2)}m/s)에서 ${formatRigShort(hitLog)} 히트 vs ${formatRigShort(skunkLog)} 꽝`,
    };
  }

  // 2. 전원 꽝 세션: 바닥 안착 한계 / 권장 최소 무게 물리 진단
  if (hits.length === 0 && skunks.length > 0) {
    const skunkLog = skunks[0];
    const skunkRig = skunkLog.tackle_snapshot as TackleRigConfig | null | undefined;
    if (skunkRig && skunkRig.weightGrams) {
      const phys = calculateSinkingPhysics(skunkRig.weightGrams, safeDepth, currentVel, skunkRig.baitConfig, { peLineSize: skunkRig.peLineSize });
      if (!phys.canReachBottom) {
        return {
          mode: 'ALL_SKUNK_PHYSICS',
          skunkLabel: formatRigShort(skunkLog),
          summary: `유속 ${currentVel.toFixed(2)}m/s에서 ${skunkRig.weightGrams}g은 바닥 안착 불가 — 다음 출조 시 최소 ${phys.recommendedMinWeightG ?? Math.ceil(skunkRig.weightGrams * 1.5)}g 이상 증량 권장`,
        };
      }
      return {
        mode: 'ALL_SKUNK_PHYSICS',
        skunkLabel: formatRigShort(skunkLog),
        summary: `유속 ${currentVel.toFixed(2)}m/s·수심 ${safeDepth.toFixed(1)}m 기준 ${skunkRig.weightGrams}g 안착 ${Math.round(phys.fallTimeSec ?? 0)}초(흘림 ${(phys.driftDistanceM ?? 0).toFixed(1)}m) — 수온(${refLog.water_temp}°C) 및 물때(${refLog.catch_mul}) 변수 복기 완료`,
      };
    }
  }

  return { mode: 'NONE', summary: '' };
}
