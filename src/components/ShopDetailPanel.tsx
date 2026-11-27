import React from 'react';
import { X, Navigation, Store, Edit2, Trash2, MessageSquarePlus, Eye } from 'lucide-react';
import type { FishingShop, ShopMemo, ShopMemoTag } from '../types';
import { fetchShopMemos, saveShopMemo, deleteShopMemo } from '../utils/cloudDb';

interface ShopDetailPanelProps {
  shop: FishingShop;
  currentUser?: { id: string; name: string; email?: string | null } | null;
  isAdmin: boolean;
  onClose: () => void;
  onEditShop: (shop: FishingShop) => void;
  onDeleteShop: (shopId: string) => void;
}

const TAG_LABELS: Record<ShopMemoTag, string> = {
  RESTROOM: '화장실',
  STORE: '매점',
  BAIT: '미끼/채비',
  PARKING: '주차',
  GENERAL: '일반',
};

export const ShopDetailPanel: React.FC<ShopDetailPanelProps> = ({
  shop,
  currentUser,
  isAdmin,
  onClose,
  onEditShop,
  onDeleteShop,
}) => {
  const [memos, setMemos] = React.useState<ShopMemo[]>([]);
  const [isLoadingMemos, setIsLoadingMemos] = React.useState(false);
  const [memoInput, setMemoInput] = React.useState('');
  const [memoTag, setMemoTag] = React.useState<ShopMemoTag>('GENERAL');
  const [isSavingMemo, setIsSavingMemo] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    setIsLoadingMemos(true);
    fetchShopMemos(shop.id)
      .then((list) => {
        if (active) setMemos(list);
      })
      .finally(() => {
        if (active) setIsLoadingMemos(false);
      });
    return () => {
      active = false;
    };
  }, [shop.id]);

  const openExternalUrl = (url: string) => {
    try {
      const win = window.open(url, '_system');
      if (!win || win.closed) {
        window.location.href = url;
      }
    } catch {
      window.location.href = url;
    }
  };

  const destName = shop.navi_name && shop.navi_name.trim().length > 0 ? shop.navi_name.trim() : shop.name;
  const kakaoNaviUrl =
    shop.navi_url && shop.navi_url.trim().length > 0
      ? shop.navi_url
      : `https://map.kakao.com/link/to/${encodeURIComponent(destName)},${shop.lat},${shop.lng}`;
  const roadviewUrl = `https://map.kakao.com/link/roadview/${shop.lat},${shop.lng}`;

  const isPromoActive =
    Boolean(shop.is_promoted) &&
    (!shop.promoted_until || new Date(shop.promoted_until).getTime() > Date.now());

  const handleAddMemo = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = memoInput.trim();
    if (!content || !currentUser) return;
    setIsSavingMemo(true);
    try {
      const newMemo: ShopMemo = {
        id: crypto.randomUUID(),
        shop_id: shop.id,
        user_id: currentUser.id,
        user_name: currentUser.name,
        content: content.slice(0, 500),
        tag: memoTag,
        created_at: new Date().toISOString(),
      };
      await saveShopMemo(newMemo);
      setMemos((prev) => [newMemo, ...prev]);
      setMemoInput('');
    } finally {
      setIsSavingMemo(false);
    }
  };

  const handleDeleteMemo = async (memoId: string) => {
    await deleteShopMemo(memoId);
    setMemos((prev) => prev.filter((m) => m.id !== memoId));
  };

  return (
    <div className="h-full flex flex-col bg-[#0F172A] text-slate-100">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-slate-800 flex items-center justify-between gap-2 bg-[#0F172A]">
        <div className="min-w-0 flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center shrink-0">
            <Store className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] text-emerald-300 font-semibold">낚시점 · 편의시설</div>
            <h2 className="text-sm font-bold text-white truncate">{shop.name}</h2>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isAdmin && (
            <>
              <button
                type="button"
                onClick={() => onEditShop(shop)}
                title="낚시점 수정"
                className="p-1.5 rounded-lg bg-[#1E293B] text-slate-300 hover:text-white border border-slate-700/60"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`'${shop.name}' 낚시점을 삭제하시겠습니까?`)) {
                    onDeleteShop(shop.id);
                  }
                }}
                title="낚시점 삭제"
                className="p-1.5 rounded-lg bg-[#1E293B] text-amber-400 hover:bg-amber-500/15 border border-slate-700/60"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-[#1E293B] text-slate-300 hover:text-white border border-slate-700/60"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-[6px] space-y-[6px] bg-[#0F172A]">
        {isPromoActive && (
          <div className="p-[10px] rounded-[16px] bg-[#1E293B] border border-emerald-500/40 text-xs text-emerald-300 font-semibold">
            {shop.promo_badge_text || 'ExFish 제휴 추천 낚시점'}
          </div>
        )}

        {/* 편의시설 & 길안내 통합 카드 */}
        <div className="p-[10px] rounded-[16px] bg-[#1E293B] border border-slate-700/60 space-y-2">
          <div className="grid grid-cols-2 gap-1.5 text-xs">
            <div
              className={`px-3 py-2 rounded-xl border font-semibold text-center ${
                shop.has_restroom
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : 'bg-[#0F172A] border-slate-700/50 text-slate-400'
              }`}
            >
              화장실 {shop.has_restroom ? '있음' : '없음/미확인'}
            </div>
            <div
              className={`px-3 py-2 rounded-xl border font-semibold text-center ${
                shop.has_store
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : 'bg-[#0F172A] border-slate-700/50 text-slate-400'
              }`}
            >
              매점/편의점 {shop.has_store ? '있음' : '없음/미확인'}
            </div>
          </div>

          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => openExternalUrl(kakaoNaviUrl)}
              className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 shadow"
            >
              <Navigation className="w-3.5 h-3.5" />
              카카오맵 길안내
            </button>
            <button
              type="button"
              onClick={() => openExternalUrl(roadviewUrl)}
              className="py-2.5 px-3 rounded-xl bg-[#0F172A] hover:bg-slate-800 text-slate-200 border border-slate-700/60 font-semibold text-xs flex items-center justify-center gap-1"
            >
              <Eye className="w-3.5 h-3.5" />
              로드뷰
            </button>
          </div>

          <div className="text-[11px] font-mono text-slate-400">
            좌표: {shop.lat.toFixed(5)}, {shop.lng.toFixed(5)}
          </div>
        </div>

        {/* 누적 사용자 메모 카드 */}
        <div className="p-[10px] rounded-[16px] bg-[#1E293B] border border-slate-700/60 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-100">이용자 현장 메모 ({memos.length})</h3>
          </div>

          {currentUser ? (
            <form onSubmit={handleAddMemo} className="space-y-1.5 bg-[#0F172A] p-2.5 rounded-xl border border-slate-700/50">
              <div className="flex flex-wrap gap-1">
                {(Object.keys(TAG_LABELS) as ShopMemoTag[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setMemoTag(t)}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                      memoTag === t
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                        : 'bg-[#1E293B] border-slate-700/60 text-slate-400'
                    }`}
                  >
                    {TAG_LABELS[t]}
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  maxLength={500}
                  value={memoInput}
                  onChange={(e) => setMemoInput(e.target.value)}
                  placeholder="영업시간, 미끼 재고, 주차 팁 등을 남겨주세요"
                  className="flex-1 px-2.5 py-1.5 rounded-lg bg-[#1E293B] border border-slate-700/60 text-xs text-slate-100 outline-none focus:border-emerald-500"
                />
                <button
                  type="submit"
                  disabled={isSavingMemo || !memoInput.trim()}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center gap-1 disabled:opacity-40"
                >
                  <MessageSquarePlus className="w-3.5 h-3.5" />
                  등록
                </button>
              </div>
            </form>
          ) : (
            <div className="text-[11px] text-slate-400 bg-[#0F172A] p-2.5 rounded-xl border border-slate-700/50">
              로그인하시면 영업시간·미끼·편의시설 메모를 남길 수 있습니다.
            </div>
          )}

          {isLoadingMemos ? (
            <div className="text-xs text-slate-400 py-3 text-center">메모 불러오는 중...</div>
          ) : memos.length === 0 ? (
            <div className="text-xs text-slate-500 py-3 text-center">아직 등록된 현장 메모가 없습니다.</div>
          ) : (
            <div className="space-y-1.5">
              {memos.map((m) => (
                <div key={m.id} className="p-2.5 rounded-xl bg-[#0F172A] border border-slate-700/50 space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <div className="flex items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-semibold">
                        {TAG_LABELS[(m.tag as ShopMemoTag) || 'GENERAL'] || '일반'}
                      </span>
                      <span className="font-semibold text-slate-300">{m.user_name}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span>{m.created_at.slice(0, 10)}</span>
                      {(isAdmin || (currentUser && currentUser.id === m.user_id)) && (
                        <button
                          type="button"
                          onClick={() => handleDeleteMemo(m.id)}
                          className="text-amber-400 hover:text-amber-300"
                        >
                          삭제
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-slate-200 whitespace-pre-wrap">{m.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
