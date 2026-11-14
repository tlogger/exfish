import React from 'react';
import { X, ShieldAlert, Award, Compass, Utensils, Waves, Moon, Sun, Sunrise } from 'lucide-react';
import { SPECIES_ENCYCLOPEDIA, SpeciesEcology } from '../utils/speciesDatabase';

interface SpeciesQuickModalProps {
  speciesName: string | null;
  onClose: () => void;
}

function getCurrentMonth(): number {
  return new Date().getMonth() + 1;
}

export const SpeciesQuickModal: React.FC<SpeciesQuickModalProps> = ({ speciesName, onClose }) => {
  if (!speciesName) return null;

  // 매칭 검색 (정확한 매칭 or 부분 포함)
  const ecology: SpeciesEcology | undefined =
    SPECIES_ENCYCLOPEDIA[speciesName] ||
    Object.values(SPECIES_ENCYCLOPEDIA).find(
      (sp) => sp.name.includes(speciesName) || speciesName.includes(sp.name)
    );

  if (!ecology) return null;

  const currentMonth = getCurrentMonth();
  const isTastiestSeason = ecology.tastiestMonths?.includes(currentMonth);
  const isPeakSeason = ecology.peakMonths.includes(currentMonth);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700/80 rounded-t-2xl sm:rounded-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col shadow-2xl animate-in slide-in-from-bottom duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 모달 헤더 */}
        <div className="p-4 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-cyan-950 border border-cyan-500/40 flex items-center justify-center text-lg shadow-inner">
              🐟
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-white text-base tracking-tight">{ecology.name}</h3>
                {ecology.scientificName && (
                  <span className="text-[11px] text-slate-400 font-mono italic hidden xs:inline">
                    {ecology.scientificName}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 font-medium">
                  {ecology.categoryName}
                </span>
                {isTastiestSeason && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/80 border border-amber-500/40 text-amber-300 font-bold flex items-center gap-0.5">
                    <Utensils size={10} />
                    <span>지금 제철 꿀맛</span>
                  </span>
                )}
                {isPeakSeason && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 font-bold flex items-center gap-0.5">
                    <Award size={10} />
                    <span>출조 시즌</span>
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>

        {/* 법정 금지체장 / 금어기 경보 배너 (해당 규정 있을 시 최우선 노출) */}
        {(ecology.minLengthCm != null || ecology.minWeightG != null || ecology.prohibitedPeriod) && (
          <div className="bg-amber-950/40 border-b border-amber-500/30 px-4 py-2.5 flex items-start gap-2 text-xs">
            <ShieldAlert size={16} className="text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5 leading-tight">
              <div className="font-bold text-amber-200">
                {ecology.minLengthCm != null && `방생 기준: 전장 ${ecology.minLengthCm}cm 이하 방류 필수`}
                {ecology.minWeightG != null && `방생 기준: 체중 ${ecology.minWeightG}g 이하 포획 금지`}
                {ecology.prohibitedPeriod && ` · 금어기: ${ecology.prohibitedPeriod}`}
              </div>
              <p className="text-[11px] text-amber-300/80">
                {ecology.prohibitedNote || '수산자원관리법 시행령 준수 (위반 시 과태료 최대 80만 원)'}
              </p>
            </div>
          </div>
        )}

        {/* 5대 실전 핵심 생태 요약 (3초 훑어보기) */}
        <div className="p-4 overflow-y-auto space-y-2.5 text-xs">
          {/* 1. 수층 및 서식 지형 */}
          <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-start gap-2.5">
            <div className="w-6 h-6 rounded-lg bg-blue-950 text-blue-400 flex items-center justify-center shrink-0 mt-0.5">
              <Waves size={14} />
            </div>
            <div className="flex-1">
              <span className="text-slate-400 font-medium text-[11px]">활동 수층 & 서식 지형</span>
              <p className="text-white font-bold mt-0.5">
                {ecology.waterLayerName || ecology.bottomName}
              </p>
            </div>
          </div>

          {/* 2. 활동 시간대 및 피딩 */}
          <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-start gap-2.5">
            <div className="w-6 h-6 rounded-lg bg-indigo-950 text-indigo-400 flex items-center justify-center shrink-0 mt-0.5">
              {ecology.activityPeriod === 'NOCTURNAL' ? (
                <Moon size={14} />
              ) : ecology.activityPeriod === 'DIURNAL' ? (
                <Sun size={14} />
              ) : (
                <Sunrise size={14} />
              )}
            </div>
            <div className="flex-1">
              <span className="text-slate-400 font-medium text-[11px]">활동 시간대 & 입질 패턴</span>
              <p className="text-white font-bold mt-0.5">{ecology.activityName}</p>
            </div>
          </div>

          {/* 3. 활성 수온 및 적정 물때 */}
          <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-start gap-2.5">
            <div className="w-6 h-6 rounded-lg bg-emerald-950 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
              <Compass size={14} />
            </div>
            <div className="flex-1">
              <span className="text-slate-400 font-medium text-[11px]">활성 수온 & 선호 조류</span>
              <p className="text-white font-bold mt-0.5">
                최적 {ecology.tempRange.optMin}~{ecology.tempRange.optMax}°C (생존 {ecology.tempRange.min}~{ecology.tempRange.max}°C) · {ecology.currentPrefName}
              </p>
            </div>
          </div>

          {/* 4. 추천 채비 & 미끼 */}
          {ecology.recommendedBait && (
            <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-start gap-2.5">
              <div className="w-6 h-6 rounded-lg bg-cyan-950 text-cyan-400 flex items-center justify-center shrink-0 mt-0.5 font-bold text-xs">
                🎣
              </div>
              <div className="flex-1">
                <span className="text-slate-400 font-medium text-[11px]">추천 채비 & 미끼 요약</span>
                <p className="text-cyan-200 font-medium mt-0.5 leading-relaxed">
                  {ecology.recommendedBait}
                </p>
              </div>
            </div>
          )}

          {/* 5. 가장 맛있는 제철 미식 설명 */}
          {ecology.tastiestDesc && (
            <div className="p-2.5 rounded-xl bg-amber-950/30 border border-amber-500/20 flex items-start gap-2.5">
              <div className="w-6 h-6 rounded-lg bg-amber-950 text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                <Utensils size={14} />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-amber-300 font-medium text-[11px]">제철 맛 & 요리 팁</span>
                  {ecology.tastiestMonths && (
                    <span className="text-[10px] text-amber-400 font-bold">
                      {ecology.tastiestMonths.join(', ')}월 제철
                    </span>
                  )}
                </div>
                <p className="text-slate-200 mt-0.5 leading-relaxed">
                  {ecology.tastiestDesc}
                </p>
              </div>
            </div>
          )}

          {/* 대표 서식 권역 */}
          {ecology.regionNames && (
            <div className="pt-1 text-[11px] text-slate-400 flex items-center gap-1.5">
              <span className="font-semibold text-slate-300 shrink-0">📍 주요 산지:</span>
              <span className="truncate">{ecology.regionNames}</span>
            </div>
          )}
        </div>

        {/* 하단 닫기 버튼 */}
        <div className="p-3 bg-slate-950/80 border-t border-slate-800 shrink-0">
          <button
            onClick={onClose}
            className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl transition text-xs"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
};
