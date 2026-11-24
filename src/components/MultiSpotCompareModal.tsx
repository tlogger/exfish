import React, { useEffect, useMemo, useState } from 'react';
import { X, Plus, Trash2, Clock, Wind, Waves, Fish, Scale } from 'lucide-react';
import type { CompareSortPreset, FishingSpot, MarineData, WeatherData } from '../types';
import { fetchMarineData, fetchWeatherData, getWindDirectionKor } from '../utils/weatherApi';
import {
  computeSpotComparisonMetric,
  getRelativeWindLabel,
  sortComparisonMetrics,
} from '../utils/spotComparison';
import { getSavedTackleConfig, type TackleRigConfig } from '../utils/tackleCalibration';
import { loadTacklePresetStore, selectTacklePreset } from '../utils/tacklePresets';

interface MultiSpotCompareModalProps {
  isOpen: boolean;
  onClose: () => void;
  allSpots: FishingSpot[];
  selectedSpotIds: string[];
  onChangeSpotIds: (ids: string[]) => void;
  onSelectSpot?: (spot: FishingSpot) => void;
}

const TIME_OFFSETS = [0, 3, 6, 12, 24, 48];

const SORT_TABS: Array<{ id: CompareSortPreset; label: string; icon: React.ReactNode }> = [
  { id: 'BALANCED', label: '균형', icon: <Scale className="w-3.5 h-3.5" /> },
  { id: 'WIND_AVOID', label: '바람', icon: <Wind className="w-3.5 h-3.5" /> },
  { id: 'SWELL_SAFE', label: '안전', icon: <Waves className="w-3.5 h-3.5" /> },
  { id: 'BITE_ACTIVE', label: '활성', icon: <Fish className="w-3.5 h-3.5" /> },
];

export const MultiSpotCompareModal: React.FC<MultiSpotCompareModalProps> = ({
  isOpen,
  onClose,
  allSpots,
  selectedSpotIds,
  onChangeSpotIds,
  onSelectSpot,
}) => {
  const [offsetHours, setOffsetHours] = useState<number>(6);
  const [sortPreset, setSortPreset] = useState<CompareSortPreset>('BALANCED');
  const [activeRig] = useState<TackleRigConfig>(() => getSavedTackleConfig());
  const [envMap, setEnvMap] = useState<Record<string, { weather?: WeatherData; marine?: MarineData; error?: string }>>({});
  const [loading, setLoading] = useState(false);
  const [spotSearch, setSpotSearch] = useState('');

  const candidateSpots = useMemo(
    () => selectedSpotIds.map((id) => allSpots.find((s) => s.id === id)).filter((s): s is FishingSpot => Boolean(s)),
    [allSpots, selectedSpotIds]
  );

  const availableToAdd = useMemo(() => {
    const q = spotSearch.trim().toLowerCase();
    return allSpots
      .filter((s) => !selectedSpotIds.includes(s.id))
      .filter((s) => !q || s.name.toLowerCase().includes(q) || s.target_species.some((sp) => sp.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [allSpots, selectedSpotIds, spotSearch]);

  // 후보 포인트 진입 시 1회 병렬 로드 (Promise.allSettled — 이후 시점 변경은 0-API)
  useEffect(() => {
    if (!isOpen || candidateSpots.length === 0) return;
    const missing = candidateSpots.filter((s) => !envMap[s.id]?.weather || !envMap[s.id]?.marine);
    if (missing.length === 0) return;

    let cancelled = false;
    setLoading(true);
    Promise.allSettled(
      missing.map(async (spot) => {
        const [weather, marine] = await Promise.all([
          fetchWeatherData(spot.lat, spot.lng),
          fetchMarineData(spot.lat, spot.lng),
        ]);
        return { id: spot.id, weather, marine };
      })
    ).then((results) => {
      if (cancelled) return;
      setEnvMap((prev) => {
        const next = { ...prev };
        results.forEach((r, idx) => {
          const spotId = missing[idx].id;
          if (r.status === 'fulfilled') {
            next[spotId] = { weather: r.value.weather, marine: r.value.marine };
          } else {
            next[spotId] = { error: '기상 데이터 조회 실패' };
          }
        });
        return next;
      });
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [candidateSpots, envMap, isOpen]);

  const sortedMetrics = useMemo(() => {
    const raw = candidateSpots.map((spot) => {
      const env = envMap[spot.id];
      if (!env?.weather || !env?.marine) {
        return {
          spot,
          offsetHours,
          targetTimeLabel: `+${offsetHours}h`,
          windSpeedMs: 0,
          windDirectionDeg: 0,
          castCenterDeg: null,
          relativeWindAngleDeg: null,
          relativeWindClass: 'NO_ARC' as const,
          waveHeightM: 0,
          wavePeriodS: 0,
          swellEnergy: 0,
          currentVelocityMs: 0,
          currentDirectionDeg: 0,
          waterTempC: 0,
          airTempC: 0,
          weatherText: env?.error || '로딩중',
          biteScore: 0,
          castDistanceDeltaM: null,
          actualCastDistanceM: null,
          depthM: null,
          canReachBottom: null,
          fallTimeSec: null,
          recommendedMinWeightG: null,
          error: env?.error || 'LOADING',
        };
      }
      return computeSpotComparisonMetric({
        spot,
        weather: env.weather,
        marine: env.marine,
        offsetHours,
        rig: activeRig,
        depthMeters: null,
      });
    });
    return sortComparisonMetrics(raw, sortPreset);
  }, [activeRig, candidateSpots, envMap, offsetHours, sortPreset]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="w-full max-w-4xl max-h-[90vh] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* 헤더 */}
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-100">출조 포인트 여건 비교</h2>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 컨트롤 바: 시점 스크러버 + 1탭 정렬 + 개인 채비 프리셋 */}
        <div className="px-4 py-2.5 bg-slate-950/60 border-b border-slate-800 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              {TIME_OFFSETS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setOffsetHours(h)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition ${
                    offsetHours === h
                      ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400'
                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  {h === 0 ? '지금' : `+${h}h`}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1">
              {SORT_TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSortPreset(t.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border flex items-center gap-1 ${
                    sortPreset === t.id
                      ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/70'
                      : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-slate-200'
                  }`}
                >
                  {t.icon}{t.label}
                </button>
              ))}
            </div>
          </div>

          {selectedSpotIds.length < 5 && (
            <div className="flex items-center justify-end gap-1.5 flex-wrap">
              <Plus className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                type="text"
                value={spotSearch}
                onChange={(e) => setSpotSearch(e.target.value)}
                placeholder="포인트·어종 검색"
                className="w-28 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-500 px-2 py-1 focus:outline-none focus:border-cyan-400"
              />
              <select
                defaultValue=""
                onChange={(e) => {
                  const id = e.target.value;
                  if (id && !selectedSpotIds.includes(id)) {
                    onChangeSpotIds([...selectedSpotIds, id].slice(0, 5));
                    setSpotSearch('');
                  }
                  e.target.value = '';
                }}
                className="max-w-[220px] bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-200 px-2 py-1"
              >
                <option value="">후보지 추가</option>
                {availableToAdd.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* 비교 테이블 */}
        <div className="flex-1 overflow-auto p-4">
          {candidateSpots.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400">
              상단에서 비교할 후보 포인트(2~5곳)를 추가해 주세요.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {sortedMetrics.map((m, idx) => (
                <div
                  key={m.spot.id}
                  className="rounded-xl border border-slate-700/80 bg-slate-800/60 p-3 flex flex-col justify-between gap-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="px-1.5 py-0.5 rounded bg-slate-700 text-[10px] font-bold text-cyan-300">#{idx + 1}</span>
                        <button
                          type="button"
                          onClick={() => { onSelectSpot?.(m.spot); onClose(); }}
                          className="text-sm font-bold text-slate-100 hover:text-cyan-300 text-left"
                        >
                          {m.spot.name}
                        </button>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{m.targetTimeLabel} 기준</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onChangeSpotIds(selectedSpotIds.filter((id) => id !== m.spot.id))}
                      className="p-1 text-slate-500 hover:text-rose-400"
                      title="비교에서 제외"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {m.error ? (
                    <div className="py-6 text-center text-xs text-slate-400">
                      {loading ? '예보 불러오는 중...' : m.error}
                    </div>
                  ) : (
                    <div className="space-y-2 text-xs">
                      <div className="flex items-center justify-between bg-slate-900/70 rounded-lg px-2.5 py-1.5">
                        <span className="text-slate-400">상대 풍향</span>
                        <span className={`font-bold ${
                          m.relativeWindClass === 'TAILWIND' ? 'text-emerald-300' :
                          m.relativeWindClass === 'HEADWIND' ? 'text-rose-300' : 'text-amber-300'
                        }`}>
                          {getRelativeWindLabel(m.relativeWindClass)} · {m.windSpeedMs}m/s ({getWindDirectionKor(m.windDirectionDeg)})
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                        <div className="bg-slate-900/50 rounded px-2 py-1">
                          <span className="text-slate-400">파고/너울: </span>
                          <strong className="text-slate-100">{m.waveHeightM}m / {m.wavePeriodS}s</strong>
                        </div>
                        <div className="bg-slate-900/50 rounded px-2 py-1">
                          <span className="text-slate-400">조류: </span>
                          <strong className="text-slate-100">{m.currentVelocityMs}m/s</strong>
                        </div>
                        <div className="bg-slate-900/50 rounded px-2 py-1">
                          <span className="text-slate-400">수온/기온: </span>
                          <strong className="text-teal-300">{m.waterTempC}° / {m.airTempC}°</strong>
                        </div>
                        <div className="bg-slate-900/50 rounded px-2 py-1">
                          <span className="text-slate-400">날씨: </span>
                          <strong className="text-slate-100">{m.weatherText}</strong>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
