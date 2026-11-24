import React, { useMemo, useState } from 'react';
import { Wind, Waves, Thermometer, Droplets, Compass, ShieldAlert, ArrowRightLeft } from 'lucide-react';
import type { FishingSpot, MarineData, WeatherData } from '../types';
import {
  calculateAerodynamicCastingDrift,
  calculateSinkingPhysics,
  type TackleRigConfig,
} from '../utils/tackleCalibration';
import {
  classifyRelativeWind,
  getRelativeWindLabel,
  resolveCastCenterDeg,
} from '../utils/spotComparison';
import { findWindShadowSpots } from '../utils/windShadowPivot';
import {
  loadTacklePresetStore,
  selectTacklePreset,
  type TacklePreset,
} from '../utils/tacklePresets';
import { calculateSwellRisk, getWindDirectionKor } from '../utils/weatherApi';

interface CompactEnvHudProps {
  spot: FishingSpot;
  allSpots: FishingSpot[];
  weather: WeatherData | null;
  marine: MarineData | null;
  depthMeters?: number | null;
  activeRig: TackleRigConfig;
  onRigChanged?: (rig: TackleRigConfig) => void;
  onSelectSpot?: (spot: FishingSpot) => void;
  onOpenCompare?: (spotIds: string[]) => void;
}

export const CompactEnvHud: React.FC<CompactEnvHudProps> = ({
  spot,
  allSpots,
  weather,
  marine,
  depthMeters,
  activeRig,
  onRigChanged,
  onSelectSpot,
  onOpenCompare,
}) => {
  const [presetStore, setPresetStore] = useState(() => loadTacklePresetStore());
  const [showPivotList, setShowPivotList] = useState(false);

  const windSpeed = weather?.windSpeed ?? 0;
  const windDir = weather?.windDirection ?? 0;
  const castCenter = useMemo(() => resolveCastCenterDeg(spot), [spot]);
  const { windClass } = useMemo(() => classifyRelativeWind(castCenter, windDir), [castCenter, windDir]);

  const swell = useMemo(
    () => calculateSwellRisk(marine?.waveHeight ?? 0.5, marine?.wavePeriod ?? 5),
    [marine?.waveHeight, marine?.wavePeriod]
  );

  const castability = useMemo(() => {
    let deltaM: number | null = null;
    if (castCenter != null) {
      const drift = calculateAerodynamicCastingDrift(
        castCenter,
        activeRig.calibratedDistanceMeters,
        windSpeed,
        windDir,
        activeRig.weightGrams,
        activeRig.peLineSize,
        activeRig.baitConfig.lengthInches,
        activeRig.baitConfig
      );
      deltaM = Math.round(drift.actualDistanceM - activeRig.calibratedDistanceMeters);
    }

    const validDepth = depthMeters != null && depthMeters > 0 ? depthMeters : null;
    const sink = validDepth != null
      ? calculateSinkingPhysics(activeRig.weightGrams, validDepth, marine?.currentVelocity ?? 0.25, activeRig.baitConfig, {
          castBearingDeg: castCenter ?? undefined,
          currentDirectionDeg: marine?.currentDirection,
          peLineSize: activeRig.peLineSize,
        })
      : null;

    return { deltaM, sink, validDepth };
  }, [activeRig, castCenter, depthMeters, marine?.currentDirection, marine?.currentVelocity, windDir, windSpeed]);

  const pivotResult = useMemo(() => {
    if (!showPivotList) return null;
    return findWindShadowSpots(spot, allSpots, windDir, 20, 3);
  }, [allSpots, showPivotList, spot, windDir]);

  const handleSelectPreset = (preset: TacklePreset) => {
    const nextRig = selectTacklePreset(preset.id);
    setPresetStore(loadTacklePresetStore());
    if (nextRig && onRigChanged) onRigChanged(nextRig);
  };

  const windBadgeStyle =
    windClass === 'TAILWIND'
      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
      : windClass === 'HEADWIND'
        ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
        : windClass === 'CROSSWIND'
          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
          : 'bg-slate-700/60 text-slate-300 border-slate-600';

  const needsWindPivot = windClass === 'HEADWIND' || windSpeed >= 6.0;

  return (
    <div className="rounded-xl border border-slate-700/80 bg-slate-900/90 p-2 space-y-1.5 shadow-sm">
      {/* 1x3 단일 시야 3대 실시간 환경 그리드 (바람, 조류, 파고·너울 - 상단 헤더와 중복 제거) */}
      <div className="grid grid-cols-3 gap-1.5 text-xs">
        <div className="rounded-lg bg-slate-800/80 px-2 py-1.5 border border-slate-700/60">
          <div className="flex items-center justify-between text-[10px] text-slate-400 leading-tight">
            <span className="flex items-center gap-1"><Wind className="w-3 h-3 text-sky-400" />바람</span>
            <span className={`px-1 py-0 rounded border text-[9px] font-semibold leading-tight ${windBadgeStyle}`}>
              {getRelativeWindLabel(windClass)}
            </span>
          </div>
          <div className="mt-0.5 flex items-baseline justify-between gap-1">
            <span className="font-bold text-slate-100 text-xs leading-tight">
              {weather ? `${windSpeed.toFixed(1)}m/s` : '-'}
            </span>
            <span className="text-[10px] text-slate-400 truncate leading-tight">
              {weather ? getWindDirectionKor(windDir) : '로딩중'}
            </span>
          </div>
        </div>

        <div className="rounded-lg bg-slate-800/80 px-2 py-1.5 border border-slate-700/60">
          <div className="flex items-center gap-1 text-[10px] text-slate-400 leading-tight">
            <Compass className="w-3 h-3 text-cyan-400" />조류
          </div>
          <div className="mt-0.5 flex items-baseline justify-between gap-1">
            <span className="font-bold text-slate-100 text-xs leading-tight">
              {marine ? `${marine.currentVelocity.toFixed(2)}m/s` : '-'}
            </span>
            <span className="text-[10px] text-slate-400 truncate leading-tight">
              {marine ? `${Math.round(marine.currentDirection)}°` : '로딩중'}
            </span>
          </div>
        </div>

        <div className="rounded-lg bg-slate-800/80 px-2 py-1.5 border border-slate-700/60">
          <div className="flex items-center gap-1 text-[10px] text-slate-400 leading-tight">
            <Waves className="w-3 h-3 text-indigo-400" />파고·너울
          </div>
          <div className="mt-0.5 flex items-baseline justify-between gap-1">
            <span className="font-bold text-slate-100 text-xs leading-tight">
              {marine ? `${marine.waveHeight.toFixed(1)}m` : '-'}
            </span>
            <span className="text-[10px] text-slate-400 truncate leading-tight">
              {marine ? `${marine.wavePeriod}s·E${swell.energyScore}` : '-'}
            </span>
          </div>
        </div>
      </div>

      {/* 1탭 개인 채비 프리셋 전환 & 내 채비 공략 가능성 1줄 요약 */}
      <div className="rounded-lg bg-slate-950/70 border border-slate-800 px-2.5 py-2 space-y-1.5">
        {presetStore.presets.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {presetStore.presets.map((p) => {
              const isActive = p.id === presetStore.activePresetId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelectPreset(p)}
                  className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium border transition ${
                    isActive
                      ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/60'
                      : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-slate-200'
                  }`}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-300">
          <span>
            내 채비({activeRig.weightGrams}g):{' '}
            <strong className={castability.deltaM != null && castability.deltaM < -5 ? 'text-rose-300' : 'text-emerald-300'}>
              {castability.deltaM != null ? `비거리 ${castability.deltaM >= 0 ? '+' : ''}${castability.deltaM}m` : '아크 미설정'}
            </strong>
            {' · '}
            {castability.sink ? (
              castability.sink.canReachBottom ? (
                <span className="text-cyan-300">바닥 안착 약 {Math.round(castability.sink.fallTimeSec ?? 0)}초</span>
              ) : (
                <span className="text-rose-300 font-semibold">
                  바닥 불가 (최소 {castability.sink.recommendedMinWeightG ?? Math.ceil(activeRig.weightGrams * 1.5)}g↑)
                </span>
              )
            ) : (
              <span className="text-slate-400">수심 정보 없음</span>
            )}
          </span>

          <div className="flex items-center gap-1.5">
            {onOpenCompare && (
              <button
                type="button"
                onClick={() => onOpenCompare([spot.id])}
                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-cyan-300 border border-slate-700 flex items-center gap-1"
              >
                <ArrowRightLeft className="w-3 h-3" />비교담기
              </button>
            )}
            {needsWindPivot && (
              <button
                type="button"
                onClick={() => setShowPivotList((v) => !v)}
                className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-[10px] text-amber-200 border border-amber-500/40 flex items-center gap-1 font-semibold"
              >
                <ShieldAlert className="w-3 h-3" />등바람 대피
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 등바람 대피 포인트 결과 드롭다운 */}
      {showPivotList && pivotResult && (
        <div className="rounded-lg bg-slate-950/90 border border-amber-500/30 p-2.5 space-y-1.5 text-xs">
          <div className="font-semibold text-amber-300 flex items-center justify-between">
            <span>반경 20km 등바람 대피 포인트 ({getWindDirectionKor(windDir)} 기준)</span>
            <button type="button" onClick={() => setShowPivotList(false)} className="text-[10px] text-slate-400 hover:text-slate-200">닫기</button>
          </div>
          {pivotResult.tailwindSpots.length > 0 ? (
            <div className="space-y-1">
              {pivotResult.tailwindSpots.map((c) => (
                <button
                  key={c.spot.id}
                  type="button"
                  onClick={() => onSelectSpot?.(c.spot)}
                  className="w-full text-left px-2 py-1.5 rounded bg-slate-800/80 hover:bg-slate-700/80 flex items-center justify-between"
                >
                  <span className="font-medium text-slate-100 truncate">{c.spot.name}</span>
                  <span className="shrink-0 text-[10px] text-emerald-300 ml-2">
                    등바람 {c.relativeWindAngleDeg}° · {c.distanceKm}km
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-1 text-[11px] text-slate-400">
              <div>반경 20km 내 캐스팅 방향이 등록된 등바람 포인트가 없습니다.</div>
              {pivotResult.crosswindFallback.length > 0 && (
                <div className="pt-1 space-y-1">
                  <div className="text-[10px] text-amber-300">옆바람 완화 후보:</div>
                  {pivotResult.crosswindFallback.map((c) => (
                    <button
                      key={c.spot.id}
                      type="button"
                      onClick={() => onSelectSpot?.(c.spot)}
                      className="w-full text-left px-2 py-1 rounded bg-slate-800/60 hover:bg-slate-700/60 flex items-center justify-between"
                    >
                      <span className="text-slate-200 truncate">{c.spot.name}</span>
                      <span className="text-[10px] text-amber-300 ml-2">옆바람 {c.relativeWindAngleDeg}° · {c.distanceKm}km</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
