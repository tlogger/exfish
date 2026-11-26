import React from 'react';
import { MapMarker, Polygon, Polyline } from 'react-kakao-maps-sdk';
import { Check, RotateCcw, Undo2, X } from 'lucide-react';
import type { RestrictionScope } from '../types/prohibitedZone';
import { validateDrawnPoints } from '../utils/zoneSpatial';
import { createUserProhibitedZone } from '../utils/zoneCache';
import type { AuthUser } from './LoginModal';

interface ZoneDigitizerProps {
  active: boolean;
  points: Array<{ lat: number; lng: number }>;
  currentUser: AuthUser | null;
  onUndo: () => void;
  onReset: () => void;
  onCancel: () => void;
  onSuccess: () => void;
}

export const ZoneDigitizer: React.FC<ZoneDigitizerProps> = ({
  active,
  points,
  currentUser,
  onUndo,
  onReset,
  onCancel,
  onSuccess,
}) => {
  const [closedPreview, setClosedPreview] = React.useState(false);
  const [showConfirmModal, setShowConfirmModal] = React.useState(false);
  const [zoneName, setZoneName] = React.useState('');
  const [restrictionScope, setRestrictionScope] = React.useState<RestrictionScope>('all_year');
  const [sourceNote, setSourceNote] = React.useState('');
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!active) {
      setClosedPreview(false);
      setShowConfirmModal(false);
      setErrorMsg(null);
      setZoneName('');
      setSourceNote('');
    }
  }, [active]);

  if (!active) return null;

  const handleConfirmShape = () => {
    const check = validateDrawnPoints(points);
    if (!check.ok) {
      setErrorMsg(check.error || '유효하지 않은 다각형입니다.');
      return;
    }
    setErrorMsg(null);
    setClosedPreview(true);
    setShowConfirmModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    const check = validateDrawnPoints(points);
    if (!check.ok || !check.closedRing) {
      setErrorMsg(check.error || '유효하지 않은 다각형입니다.');
      return;
    }
    if (zoneName.trim().length < 2) {
      setErrorMsg('구역 이름을 2자 이상 입력해 주세요.');
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    const res = await createUserProhibitedZone({
      user: currentUser,
      zoneName: zoneName.trim(),
      restrictionScope,
      sourceNote: sourceNote.trim(),
      closedRing: check.closedRing,
    });
    setSubmitting(false);
    if (!res.ok) {
      setErrorMsg(res.error || '등록에 실패했습니다.');
      return;
    }
    onSuccess();
  };

  return (
    <>
      {points.map((pt, idx) => (
        <MapMarker
          key={`dz_pt_${idx}`}
          position={pt}
          image={{
            src: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="6" fill="%23f97316" stroke="white" stroke-width="2"/></svg>',
            size: { width: 16, height: 16 },
          }}
        />
      ))}

      {!closedPreview && points.length >= 2 && (
        <Polyline path={points} strokeWeight={3} strokeColor="#f97316" strokeOpacity={0.95} strokeStyle="solid" />
      )}

      {closedPreview && points.length >= 3 && (
        <Polygon
          path={points}
          strokeWeight={3}
          strokeColor="#f97316"
          strokeOpacity={0.95}
          fillColor="#fb923c"
          fillOpacity={0.28}
        />
      )}

      <div
        className="fixed inset-x-0 bottom-5 z-[60] mx-auto flex w-[calc(100%-24px)] max-w-md flex-col gap-2 rounded-2xl border border-orange-500/40 bg-slate-900/95 p-3 text-slate-100 shadow-2xl backdrop-blur-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-orange-300">
            금지구역 작도 중 · 꼭짓점 {points.length}개 (3~60개)
          </span>
          <span className="text-[11px] text-slate-400">위성 지도를 탭해 경계 지정</span>
        </div>

        {errorMsg && !showConfirmModal && (
          <div className="rounded-lg bg-red-500/15 px-2.5 py-1 text-xs text-red-300">{errorMsg}</div>
        )}

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setClosedPreview(false);
                onUndo();
              }}
              disabled={points.length === 0}
              className="flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-40"
            >
              <Undo2 className="h-3.5 w-3.5" />
              실행취소
            </button>
            <button
              type="button"
              onClick={() => {
                setClosedPreview(false);
                onReset();
              }}
              disabled={points.length === 0}
              className="flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-40"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              초기화
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onCancel}
              className="flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
            >
              <X className="h-3.5 w-3.5" />
              취소
            </button>
            <button
              type="button"
              onClick={handleConfirmShape}
              disabled={points.length < 3}
              className="flex items-center gap-1 rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-40"
            >
              <Check className="h-3.5 w-3.5" />
              확인
            </button>
          </div>
        </div>
      </div>

      {showConfirmModal && (
        <div
          className="fixed inset-0 z-[75] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-4 text-slate-100 shadow-2xl"
          >
            <h3 className="text-base font-bold text-white">이 구역을 낚시금지구역으로 설정할까요?</h3>
            <p className="mt-1 text-xs text-slate-400">
              확정 시 다른 사용자에게도 참고용 제보 구역으로 즉시 표시됩니다.
            </p>

            <div className="mt-3 space-y-2.5">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-300">구역명 *</label>
                <input
                  type="text"
                  value={zoneName}
                  onChange={(e) => setZoneName(e.target.value)}
                  maxLength={60}
                  placeholder="예: ○○항 방파제 끝단 통제구역"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white outline-none focus:border-orange-500"
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-300">제한 유형</label>
                <select
                  value={restrictionScope}
                  onChange={(e) => setRestrictionScope(e.target.value as RestrictionScope)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white outline-none focus:border-orange-500"
                >
                  <option value="all_year">연중 낚시금지/통제</option>
                  <option value="seasonal">계절/특정 기간 제한</option>
                  <option value="night_only">야간 출입/낚시 통제</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-300">고시/현장 표지판 메모 (선택)</label>
                <input
                  type="text"
                  value={sourceNote}
                  onChange={(e) => setSourceNote(e.target.value)}
                  maxLength={200}
                  placeholder="예: ○○시 고시 제2025-00호 / 방파제 입구 표지판"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white outline-none focus:border-orange-500"
                />
              </div>
            </div>

            {errorMsg && (
              <div className="mt-2.5 rounded-lg bg-red-500/15 px-2.5 py-1.5 text-xs text-red-300">{errorMsg}</div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => {
                  setClosedPreview(false);
                  setShowConfirmModal(false);
                }}
                className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700"
              >
                다시 수정
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-orange-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
              >
                {submitting ? '저장 중...' : '금지구역 확정'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
};
