import React from 'react';
import { Circle, CustomOverlayMap, Polygon } from 'react-kakao-maps-sdk';
import { AlertTriangle, Flag, ShieldAlert, Trash2, X } from 'lucide-react';
import type { ProhibitedZoneFeature } from '../types/prohibitedZone';
import { DEFAULT_CAUTION_RADIUS_M, toKakaoPolygonPaths } from '../utils/zoneSpatial';
import { isStrictPaedrosAdmin } from '../services/oauthService';
import { adminDeleteProhibitedZone, flagProhibitedZone } from '../utils/zoneCache';
import type { AuthUser } from './LoginModal';

interface ProhibitedZoneOverlayProps {
  enabled: boolean;
  zones: ProhibitedZoneFeature[];
  currentUser: AuthUser | null;
  onZonesMutated: () => void;
  onRequireLogin?: () => void;
}

const SCOPE_LABELS: Record<string, string> = {
  all_year: '연중 제한',
  seasonal: '계절/기간 제한',
  night_only: '야간 통제',
};

export const ProhibitedZoneOverlay: React.FC<ProhibitedZoneOverlayProps> = ({
  enabled,
  zones,
  currentUser,
  onZonesMutated,
  onRequireLogin,
}) => {
  const [selectedZone, setSelectedZone] = React.useState<ProhibitedZoneFeature | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [feedbackMsg, setFeedbackMsg] = React.useState<string | null>(null);

  const isAdmin = isStrictPaedrosAdmin(currentUser);

  if (!enabled) return null;

  const handleFlag = async () => {
    if (!selectedZone) return;
    if (!currentUser) {
      onRequireLogin?.();
      return;
    }
    setBusy(true);
    setFeedbackMsg(null);
    const res = await flagProhibitedZone({
      user: currentUser,
      zoneId: selectedZone.properties.zone_id,
      reason: '사용자 오탐/허위 신고',
    });
    setBusy(false);
    if (!res.ok) {
      setFeedbackMsg(res.error || '신고 처리 실패');
      return;
    }
    if (res.flagged) {
      setSelectedZone(null);
      onZonesMutated();
    } else {
      setFeedbackMsg('신고가 접수되었습니다 (3명 이상 신고 시 자동 숨김 처리됩니다).');
    }
  };

  const handleAdminDelete = async () => {
    if (!selectedZone || !isAdmin) return;
    const isUser = selectedZone.properties.tier === 'community_reported' || selectedZone.properties.zone_id.startsWith('usr_');
    setBusy(true);
    setFeedbackMsg(null);
    const res = await adminDeleteProhibitedZone({
      zoneId: selectedZone.properties.zone_id,
      targetType: isUser ? 'user' : 'public',
      reason: '관리자 지도 클릭 삭제',
    });
    setBusy(false);
    if (!res.ok) {
      setFeedbackMsg(res.error || '삭제 실패');
      return;
    }
    setSelectedZone(null);
    onZonesMutated();
  };

  return (
    <>
      {zones.map((feat) => {
        const { zone_id, tier, radius_m } = feat.properties;
        if (feat.geometry.type === 'Point') {
          const [lng, lat] = feat.geometry.coordinates;
          return (
            <React.Fragment key={zone_id}>
              <Circle
                center={{ lat, lng }}
                radius={radius_m ?? DEFAULT_CAUTION_RADIUS_M}
                strokeWeight={2}
                strokeColor="#f59e0b"
                strokeOpacity={0.9}
                strokeStyle="shortdash"
                fillColor="#f59e0b"
                fillOpacity={0.14}
                onClick={() => {
                  setFeedbackMsg(null);
                  setSelectedZone(feat);
                }}
              />
              <CustomOverlayMap position={{ lat, lng }} yAnchor={0.5} xAnchor={0.5}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFeedbackMsg(null);
                    setSelectedZone(feat);
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded-full border border-amber-300 bg-amber-500/90 text-white shadow-md"
                  title={feat.properties.zone_name}
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                </button>
              </CustomOverlayMap>
            </React.Fragment>
          );
        }

        const isCommunity = tier === 'community_reported';
        const pathsList = toKakaoPolygonPaths(feat.geometry);
        return pathsList.map((path, idx) => (
          <Polygon
            key={`${zone_id}_${idx}`}
            path={path}
            strokeWeight={2}
            strokeColor={isCommunity ? '#f97316' : '#ef4444'}
            strokeOpacity={0.9}
            strokeStyle={isCommunity ? 'shortdash' : 'solid'}
            fillColor={isCommunity ? '#fb923c' : '#ef4444'}
            fillOpacity={isCommunity ? 0.2 : 0.24}
            onClick={() => {
              setFeedbackMsg(null);
              setSelectedZone(feat);
            }}
          />
        ));
      })}

      {selectedZone && (
        <div
          className="fixed inset-x-0 bottom-20 z-[65] mx-auto w-[calc(100%-24px)] max-w-md rounded-2xl border border-slate-700 bg-slate-900/95 p-4 text-slate-100 shadow-2xl backdrop-blur-md"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldAlert
                className={`h-5 w-5 shrink-0 ${
                  selectedZone.properties.tier === 'confirmed_polygon'
                    ? 'text-red-400'
                    : selectedZone.properties.tier === 'community_reported'
                    ? 'text-orange-400'
                    : 'text-amber-400'
                }`}
              />
              <div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      selectedZone.properties.tier === 'confirmed_polygon'
                        ? 'bg-red-500/20 text-red-300'
                        : selectedZone.properties.tier === 'community_reported'
                        ? 'bg-orange-500/20 text-orange-300'
                        : 'bg-amber-500/20 text-amber-300'
                    }`}
                  >
                    {selectedZone.properties.tier === 'confirmed_polygon'
                      ? '공공 고시'
                      : selectedZone.properties.tier === 'community_reported'
                      ? '사용자 제보 · 공식 고시 미확인'
                      : '인근 통제고시 주의'}
                  </span>
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                    {SCOPE_LABELS[selectedZone.properties.restriction_scope] || '연중 제한'}
                  </span>
                </div>
                <h4 className="mt-1 text-sm font-bold text-white">{selectedZone.properties.zone_name}</h4>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedZone(null)}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <p className="mt-2 text-xs leading-relaxed text-slate-300">{selectedZone.properties.reason}</p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
            <span>출처: {selectedZone.properties.source_agency}</span>
            {selectedZone.properties.notice_number && <span>고시/도호: {selectedZone.properties.notice_number}</span>}
          </div>
          <p className="mt-2 text-[10px] text-slate-500">
            * 참고용 안내이며 실제 낚시 가능 여부는 현장 표지판 및 지자체 고시가 우선합니다.
          </p>

          {feedbackMsg && (
            <div className="mt-2 rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs text-amber-300">{feedbackMsg}</div>
          )}

          <div className="mt-3 flex items-center justify-end gap-2">
            {selectedZone.properties.tier === 'community_reported' && (
              <button
                type="button"
                disabled={busy}
                onClick={handleFlag}
                className="flex items-center gap-1 rounded-lg border border-orange-500/40 bg-orange-500/10 px-2.5 py-1.5 text-xs font-medium text-orange-300 hover:bg-orange-500/20 disabled:opacity-50"
              >
                <Flag className="h-3.5 w-3.5" />
                허위/오탐 신고
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                disabled={busy}
                onClick={handleAdminDelete}
                className="flex items-center gap-1 rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                금지구역 삭제(비노출)
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
};
