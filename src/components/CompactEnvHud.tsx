import React, { useMemo, useState } from 'react';
import { Wind, Waves, Compass, ShieldAlert, ArrowRightLeft } from 'lucide-react';
import type { FishingSpot, MarineData, WeatherData } from '../types';
import {
  classifyRelativeWind,
  getRelativeWindLabel,
  resolveCastCenterDeg,
} from '../utils/spotComparison';
import { findWindShadowSpots } from '../utils/windShadowPivot';
import { getWindDirectionKor } from '../utils/weatherApi';

interface CompactEnvHudProps {
  spot: FishingSpot;
  weather: WeatherData | null;
  marine: MarineData | null;
}

/**
 * 기상과 물때 첫 카드: 풍향(화살표), 조류 각도(화살표), 파고·너울(0.6m, 3sec)
 */
export const CompactEnvHud: React.FC<CompactEnvHudProps> = ({
  spot,
  weather,
  marine,
}) => {
  const windSpeed = weather?.windSpeed ?? 0;
  const windDir = weather?.windDirection ?? 0;
  const castCenter = useMemo(() => resolveCastCenterDeg(spot), [spot]);
  const { windClass } = useMemo(() => classifyRelativeWind(castCenter, windDir), [castCenter, windDir]);

  const windBadgeStyle =
    windClass === 'TAILWIND'
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
      : windClass === 'HEADWIND' || windClass === 'CROSSWIND'
        ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
        : 'bg-slate-800 text-slate-300 border-slate-700';

  return (
    <div className="rounded-[16px] border border-slate-700/60 bg-[#1E293B] p-[10px]">
      <div className="grid grid-cols-3 gap-1.5 text-xs">
        {/* 바람: 풍향 화살표 + 풍속 */}
        <div className="rounded-xl bg-[#0F172A] px-2 py-1.5 border border-slate-700/50">
          <div className="flex items-center justify-between text-[10px] text-slate-400 leading-tight">
            <span className="flex items-center gap-1">
              <Wind className="w-3 h-3 text-slate-400" />
              바람
            </span>
            <span className={`px-1 py-0 rounded border text-[9px] font-semibold leading-tight ${windBadgeStyle}`}>
              {getRelativeWindLabel(windClass)}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-1">
            <span className="font-bold text-slate-100 text-xs leading-tight tabular-nums">
              {weather ? `${windSpeed.toFixed(1)}m/s` : '-'}
            </span>
            {weather ? (
              <span
                className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#1E293B] text-emerald-300 font-bold text-xs leading-none shrink-0"
                style={{ transform: `rotate(${windDir}deg)` }}
                title={`풍향 ${getWindDirectionKor(windDir)} (${Math.round(windDir)}°)`}
                aria-label={`풍향 ${getWindDirectionKor(windDir)}`}
              >
                ↓
              </span>
            ) : (
              <span className="text-[10px] text-slate-500">-</span>
            )}
          </div>
        </div>

        {/* 조류: 조류 각도 화살표 + 유속 */}
        <div className="rounded-xl bg-[#0F172A] px-2 py-1.5 border border-slate-700/50">
          <div className="flex items-center gap-1 text-[10px] text-slate-400 leading-tight">
            <Compass className="w-3 h-3 text-slate-400" />
            조류
          </div>
          <div className="mt-1 flex items-center justify-between gap-1">
            <span className="font-bold text-slate-100 text-xs leading-tight tabular-nums">
              {marine ? `${marine.currentVelocity.toFixed(2)}m/s` : '-'}
            </span>
            {marine ? (
              <span
                className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#1E293B] text-emerald-300 font-bold text-xs leading-none shrink-0"
                style={{ transform: `rotate(${marine.currentDirection}deg)` }}
                title={`조류 방향 ${Math.round(marine.currentDirection)}°`}
                aria-label={`조류 방향 ${Math.round(marine.currentDirection)}도`}
              >
                ↑
              </span>
            ) : (
              <span className="text-[10px] text-slate-500">-</span>
            )}
          </div>
        </div>

        {/* 파고·너울: 0.6m, 3sec 형태 */}
        <div className="rounded-xl bg-[#0F172A] px-2 py-1.5 border border-slate-700/50">
          <div className="flex items-center gap-1 text-[10px] text-slate-400 leading-tight">
            <Waves className="w-3 h-3 text-slate-400" />
            파고·너울
          </div>
          <div className="mt-1 flex items-baseline gap-1 truncate">
            <span className="font-bold text-slate-100 text-xs leading-tight tabular-nums truncate">
              {marine ? `${marine.waveHeight.toFixed(1)}m, ${Math.round(marine.wavePeriod)}sec` : '-'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

interface SpotCompareAndWindCardProps {
  spot: FishingSpot;
  allSpots: FishingSpot[];
  weather: WeatherData | null;
  onSelectSpot?: (spot: FishingSpot) => void;
  onOpenCompare?: (spotIds: string[]) => void;
}

/**
 * 물때 표시 카드 아래 배치: 포인트 비교 + 바람 피하기 액션 카드
 */
export const SpotCompareAndWindCard: React.FC<SpotCompareAndWindCardProps> = ({
  spot,
  allSpots,
  weather,
  onSelectSpot,
  onOpenCompare,
}) => {
  const [showPivotList, setShowPivotList] = useState(false);

  const windSpeed = weather?.windSpeed ?? 0;
  const windDir = weather?.windDirection ?? 0;
  const castCenter = useMemo(() => resolveCastCenterDeg(spot), [spot]);
  const { windClass } = useMemo(() => classifyRelativeWind(castCenter, windDir), [castCenter, windDir]);

  const pivotResult = useMemo(() => {
    if (!showPivotList) return null;
    return findWindShadowSpots(spot, allSpots, windDir, 20, 3);
  }, [allSpots, showPivotList, spot, windDir]);

  const needsWindPivot = windClass === 'HEADWIND' || windSpeed >= 6.0;

  return (
    <div className="rounded-[16px] border border-slate-700/60 bg-[#1E293B] p-[10px] space-y-2">
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={() => onOpenCompare?.([spot.id])}
          disabled={!onOpenCompare}
          className="py-2 px-3 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 disabled:opacity-40 text-xs text-emerald-300 border border-emerald-500/40 flex items-center justify-center gap-1.5 font-bold transition cursor-pointer"
        >
          <ArrowRightLeft className="w-3.5 h-3.5" />
          <span>포인트 비교</span>
        </button>

        <button
          type="button"
          onClick={() => setShowPivotList((v) => !v)}
          className={`py-2 px-3 rounded-xl text-xs border flex items-center justify-center gap-1.5 font-bold transition cursor-pointer ${
            needsWindPivot || showPivotList
              ? 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border-amber-500/40'
              : 'bg-[#0F172A] hover:bg-slate-800 text-slate-200 border-slate-700/60'
          }`}
        >
          <ShieldAlert className="w-3.5 h-3.5" />
          <span>바람 피하기</span>
        </button>
      </div>

      {/* 바람 피하기 포인트 결과 드롭다운 */}
      {showPivotList && pivotResult && (
        <div className="rounded-xl bg-[#0F172A] border border-amber-500/35 p-2.5 space-y-1.5 text-xs">
          <div className="font-semibold text-amber-300 flex items-center justify-between">
            <span>반경 20km 바람 피하기 ({getWindDirectionKor(windDir)} 기준)</span>
            <button
              type="button"
              onClick={() => setShowPivotList(false)}
              className="text-[10px] text-slate-400 hover:text-slate-200"
            >
              닫기
            </button>
          </div>
          {pivotResult.tailwindSpots.length > 0 ? (
            <div className="space-y-1">
              {pivotResult.tailwindSpots.map((c) => (
                <button
                  key={c.spot.id}
                  type="button"
                  onClick={() => onSelectSpot?.(c.spot)}
                  className="w-full text-left px-2 py-1.5 rounded-lg bg-[#1E293B] hover:bg-slate-700/80 flex items-center justify-between"
                >
                  <span className="font-medium text-slate-100 truncate">{c.spot.name}</span>
                  <span className="shrink-0 text-[10px] text-emerald-300 ml-2">
                    등바람 {c.relativeWindAngleDeg}° · {c.distanceKm}km
                  </span>
                </button>
              ))}
            </div>
          ) : pivotResult.crosswindFallback.length > 0 ? (
            <div className="space-y-1">
              <div className="text-[10px] text-amber-300 font-semibold">후보 리스트</div>
              {pivotResult.crosswindFallback.map((c) => (
                <button
                  key={c.spot.id}
                  type="button"
                  onClick={() => onSelectSpot?.(c.spot)}
                  className="w-full text-left px-2 py-1.5 rounded-lg bg-[#1E293B] hover:bg-slate-700/80 flex items-center justify-between"
                >
                  <span className="text-slate-200 truncate">{c.spot.name}</span>
                  <span className="text-[10px] text-amber-300 ml-2">
                    옆바람 {c.relativeWindAngleDeg}° · {c.distanceKm}km
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-slate-400">후보 리스트 없음</div>
          )}
        </div>
      )}
    </div>
  );
};
