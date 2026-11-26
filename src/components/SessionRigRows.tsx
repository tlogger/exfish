import React, { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { CatchLog } from '../types';
import { loadTacklePresetStore, type TacklePreset } from '../utils/tacklePresets';
import { buildRigContrastInsight } from '../utils/rigContrastEngine';
import type { TackleRigConfig } from '../utils/tackleCalibration';

export interface SessionRigRow {
  rowId: string;
  presetId?: string;
  lureBait: string;
  rigSnapshot?: TackleRigConfig;
  isHit: boolean;
  fishCount: number;
  fishSizeCm?: number;
}

interface SessionRigRowsProps {
  rows: SessionRigRow[];
  onChange: (rows: SessionRigRow[]) => void;
  envPreview: Pick<CatchLog, 'water_temp' | 'wind_speed' | 'current_velocity' | 'catch_mul' | 'tide_state'>;
}

export const SessionRigRows: React.FC<SessionRigRowsProps> = ({ rows, onChange, envPreview }) => {
  const presets = useMemo(() => loadTacklePresetStore().presets, []);

  const addPresetRow = (preset?: TacklePreset) => {
    const nextRow: SessionRigRow = {
      rowId: `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      presetId: preset?.id,
      lureBait: preset?.name || '',
      rigSnapshot: preset?.rig,
      isHit: false,
      fishCount: 0,
    };
    onChange([...rows, nextRow]);
  };

  const updateRow = (rowId: string, patch: Partial<SessionRigRow>) => {
    onChange(rows.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));
  };

  const removeRow = (rowId: string) => {
    onChange(rows.filter((r) => r.rowId !== rowId));
  };

  const insight = useMemo(() => {
    if (rows.length === 0) return null;
    const pseudoLogs: CatchLog[] = rows.map((r) => ({
      id: r.rowId,
      spot_id: '',
      user_id: '',
      user_name: '',
      catch_date: '',
      catch_time: '',
      fish_species: '',
      fish_count: r.isHit ? Math.max(1, r.fishCount) : 0,
      is_hitless: !r.isHit,
      catch_method: r.rigSnapshot?.rodType === 'SURF' ? 'SURF' : 'LURE',
      lure_bait: r.lureBait,
      tackle_snapshot: r.rigSnapshot as any,
      catch_mul: envPreview.catch_mul,
      tide_state: envPreview.tide_state,
      water_temp: envPreview.water_temp,
      wind_speed: envPreview.wind_speed,
      current_velocity: envPreview.current_velocity,
      created_at: '',
    }));
    const result = buildRigContrastInsight(pseudoLogs);
    return result.mode !== 'NONE' ? result : null;
  }, [envPreview, rows]);

  return (
    <div className="rounded-xl border border-slate-700/80 bg-slate-900/70 p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-bold text-cyan-300">같은 환경 다채비(히트/꽝) 동시 비교 기록</div>
          <div className="text-[10px] text-slate-400">내 채비 프리셋을 탭해 같은 출조에서 시도한 채비별 성패를 묶어 남깁니다.</div>
        </div>
        <button
          type="button"
          onClick={() => addPresetRow()}
          className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200 border border-slate-700 flex items-center gap-1"
        >
          <Plus className="w-3 h-3" />직접 추가
        </button>
      </div>

      {presets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => addPresetRow(p)}
              className="px-2 py-1 rounded-full bg-cyan-500/10 hover:bg-cyan-500/20 text-[10px] text-cyan-200 border border-cyan-500/30"
            >
              + {p.name}
            </button>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.rowId} className="flex flex-wrap items-center gap-1.5 bg-slate-950/70 border border-slate-800 rounded-lg p-2 text-xs">
              <input
                type="text"
                value={r.lureBait}
                onChange={(e) => updateRow(r.rowId, { lureBait: e.target.value })}
                placeholder="채비명 (예: 5g 지그헤드+4인치 웜)"
                className="flex-1 min-w-[140px] bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100"
              />
              <button
                type="button"
                onClick={() => updateRow(r.rowId, { isHit: !r.isHit, fishCount: !r.isHit ? Math.max(1, r.fishCount) : 0 })}
                className={`px-2.5 py-1 rounded font-bold text-[11px] border ${
                  r.isHit
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                    : 'bg-rose-500/20 text-rose-300 border-rose-500/50'
                }`}
              >
                {r.isHit ? '히트' : '꽝'}
              </button>
              {r.isHit && (
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={r.fishCount}
                  onChange={(e) => updateRow(r.rowId, { fishCount: Math.max(1, Number(e.target.value) || 1) })}
                  className="w-14 bg-slate-800 border border-slate-700 rounded px-1.5 py-1 text-xs text-center text-slate-100"
                  title="마릿수"
                />
              )}
              <button
                type="button"
                onClick={() => removeRow(r.rowId)}
                className="p-1 text-slate-500 hover:text-rose-400"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {insight && (
        <div className="rounded-lg bg-indigo-950/50 border border-indigo-500/30 px-2.5 py-2 text-[11px] text-indigo-200">
          <strong>물리 대조 프리뷰:</strong> {insight.summary}
        </div>
      )}
    </div>
  );
};
