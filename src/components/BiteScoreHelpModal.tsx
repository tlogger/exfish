import React from 'react';
import { X } from 'lucide-react';

interface BiteScoreHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BiteScoreHelpModal: React.FC<BiteScoreHelpModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto">
      <div className="bg-[#0F172A] border border-slate-700/60 rounded-[16px] w-full max-w-xl text-slate-100 shadow-2xl p-[12px] sm:p-4 my-6 max-h-[92vh] overflow-y-auto space-y-[8px]">
        {/* 모달 헤더 */}
        <div className="flex justify-between items-center pb-2.5 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-300 font-black text-sm">
              Ex
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white">
                입질 종합 지수
              </h2>
              <p className="text-[11px] text-slate-400">
                100점 만점 · 어종별 생태 채점 및 포인트 종합 산출 방식
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-[#1E293B] hover:bg-slate-700 text-slate-300 border border-slate-700/60 flex items-center justify-center transition"
          >
            <X size={16} />
          </button>
        </div>

        {/* 1단계: 각 어종별 입질 지수 산출 (100점 만점) */}
        <div className="p-[10px] bg-[#1E293B] border border-slate-700/60 rounded-[16px] space-y-2 text-xs">
          <div className="font-bold text-emerald-300">
            1단계 · 각 어종별 입질 지수 (100점 만점)
          </div>
          <p className="leading-relaxed text-slate-300">
            포인트의 각 어종마다 4대 해양·생태 요소를 실시간 채점하고 사리/정조 탁도 보정(-6~+3점)을 반영해 어종별 0~100점을 산출합니다.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <div className="p-2.5 bg-[#0F172A] border border-slate-700/50 rounded-xl space-y-1">
              <div className="flex items-center justify-between font-bold text-slate-100">
                <span>어종별 활성 수온</span>
                <span className="font-mono text-emerald-300">최대 30점</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-snug">
                어종 고유의 최적 활성 수온(저서 어종은 수심·계절별 저층 수온 보정 포함) 일치도를 정밀 채점합니다.
              </p>
            </div>

            <div className="p-2.5 bg-[#0F172A] border border-slate-700/50 rounded-xl space-y-1">
              <div className="flex items-center justify-between font-bold text-slate-100">
                <span>시간대 · 해창 골든타임</span>
                <span className="font-mono text-emerald-300">최대 25점</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-snug">
                일출/일몰 해창 피딩과 어종별 주행성·야행성(수심 15m 미만 비활성 시간대 제한 포함)을 반영합니다.
              </p>
            </div>

            <div className="p-2.5 bg-[#0F172A] border border-slate-700/50 rounded-xl space-y-1">
              <div className="flex items-center justify-between font-bold text-slate-100">
                <span>조류 유속 · 물때 위상</span>
                <span className="font-mono text-emerald-300">최대 25점</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-snug">
                어종이 선호하는 유속(강조류/중류/완류)과 들물·날물·물돌이 위상 일치도를 채점합니다.
              </p>
            </div>

            <div className="p-2.5 bg-[#0F172A] border border-slate-700/50 rounded-xl space-y-1">
              <div className="flex items-center justify-between font-bold text-slate-100">
                <span>지형 · 제철 적합도</span>
                <span className="font-mono text-emerald-300">최대 20점</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-snug">
                포인트 지형(갯바위·방파제·해변·선착장)과 어종 서식 바닥·제철 시즌 일치도를 반영합니다.
              </p>
            </div>
          </div>
        </div>

        {/* 2단계: 입질 종합 지수 산출 (출현·대상 어종 통합 + 물리 환경 감점) */}
        <div className="p-[10px] bg-[#1E293B] border border-slate-700/60 rounded-[16px] space-y-2 text-xs">
          <div className="font-bold text-emerald-300">
            2단계 · 입질 종합 지수 산출 (출현·대상 어종 통합)
          </div>
          <div className="space-y-1.5 text-[11px] text-slate-300 leading-relaxed">
            <p>
              • <strong className="text-slate-100">대상 어종 합산</strong>: 포인트 출현·대상 어종(관심어종 설정 시 교집합 우선)의 개별 점수를 종합합니다. 1~2종은 전체 평균을 사용하며, 3종 이상일 때는 야간/주간 휴면 어종(30점 미만)이 호황 어종 점수를 왜곡하지 않도록 <strong className="text-emerald-300">활성 어종 상위 최대 3종의 평균</strong>으로 기본 점수를 산출합니다.
            </p>
            <p>
              • <strong className="text-slate-100">물리 출조 환경 감점</strong>: 기본 점수에서 실제 낚시 운용을 방해하는 <strong className="text-amber-300">파고 채비 쓸림(-2~-14점), 맞바람/강풍(-3~-14점), 급류 과속(-3~-12점)</strong>을 차감해 최종 종합 지수를 확정합니다.
            </p>
            <div className="p-2 rounded-xl bg-[#0F172A] border border-slate-700/50 text-slate-200 font-mono text-[11px]">
              예) 우럭 90점 · 광어 80점 → 기본 평균 <strong className="text-emerald-300">85점</strong> (바람·파고 양호 시 최종 <strong className="text-emerald-300">85점</strong>, 맞바람 6m/s 시 -8점 → <strong className="text-amber-300">77점</strong>)
            </div>
          </div>
        </div>

        {/* 종합 점수 구간별 판정 가이드 */}
        <div className="p-[10px] bg-[#1E293B] border border-slate-700/60 rounded-[16px] space-y-2 text-xs">
          <span className="font-bold text-slate-100">
            점수 구간별 출조 가이드
          </span>
          <div className="space-y-1.5 text-[11px]">
            <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-[#0F172A] border border-emerald-500/40 text-emerald-300">
              <span className="font-bold shrink-0">85점 이상 · 특급 찬스</span>
              <span className="text-slate-300 text-right">수온·물때·바람·피딩 최적 구간</span>
            </div>
            <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-[#0F172A] border border-emerald-500/25 text-emerald-300">
              <span className="font-bold shrink-0">70 ~ 84점 · 호조황 기대</span>
              <span className="text-slate-300 text-right">들물/날물 본류대 집중 공략 추천</span>
            </div>
            <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-[#0F172A] border border-slate-700/60 text-slate-200">
              <span className="font-bold shrink-0">50 ~ 69점 · 무난한 여건</span>
              <span className="text-slate-400 text-right">중들물·해창 타이밍 중심 공략</span>
            </div>
            <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-[#0F172A] border border-amber-500/40 text-amber-300">
              <span className="font-bold shrink-0">50점 미만 · 주의/비활성</span>
              <span className="text-slate-300 text-right">강풍·너울·비활성 시간대 주의</span>
            </div>
          </div>
        </div>

        {/* 닫기 버튼 */}
        <div className="flex justify-end pt-1">
          <button
            onClick={onClose}
            className="w-full sm:w-auto px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition"
          >
            확인 및 닫기
          </button>
        </div>
      </div>
    </div>
  );
};
