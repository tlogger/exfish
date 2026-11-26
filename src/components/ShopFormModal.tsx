import React from 'react';
import { X, Search, Store, Navigation } from 'lucide-react';
import type { FishingShop, ShopMemo } from '../types';
import { searchPoi, type PoiSearchResult } from '../utils/poiSearch';

interface ShopFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialCoords?: { lat: number; lng: number } | null;
  editingShop?: FishingShop | null;
  currentUserId: string;
  currentUserName: string;
  onSaveShop: (shop: FishingShop, initialMemo?: ShopMemo) => Promise<void>;
}

export const ShopFormModal: React.FC<ShopFormModalProps> = ({
  isOpen,
  onClose,
  initialCoords,
  editingShop,
  currentUserId,
  currentUserName,
  onSaveShop,
}) => {
  const [name, setName] = React.useState('');
  const [lat, setLat] = React.useState('');
  const [lng, setLng] = React.useState('');
  const [naviName, setNaviName] = React.useState('');
  const [naviUrl, setNaviUrl] = React.useState('');
  const [kakaoPlaceId, setKakaoPlaceId] = React.useState<string | undefined>(undefined);
  const [hasRestroom, setHasRestroom] = React.useState(false);
  const [hasStore, setHasStore] = React.useState(false);
  const [initialMemoText, setInitialMemoText] = React.useState('');

  const [poiQuery, setPoiQuery] = React.useState('');
  const [poiResults, setPoiResults] = React.useState<PoiSearchResult[]>([]);
  const [isSearchingPoi, setIsSearchingPoi] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
    setPoiResults([]);
    setPoiQuery('');
    setInitialMemoText('');

    if (editingShop) {
      setName(editingShop.name);
      setLat(String(editingShop.lat));
      setLng(String(editingShop.lng));
      setNaviName(editingShop.navi_name || '');
      setNaviUrl(editingShop.navi_url || '');
      setKakaoPlaceId(editingShop.kakao_place_id);
      setHasRestroom(Boolean(editingShop.has_restroom));
      setHasStore(Boolean(editingShop.has_store));
    } else {
      setName('');
      setLat(initialCoords ? initialCoords.lat.toFixed(6) : '');
      setLng(initialCoords ? initialCoords.lng.toFixed(6) : '');
      setNaviName('');
      setNaviUrl('');
      setKakaoPlaceId(undefined);
      setHasRestroom(false);
      setHasStore(false);
    }
  }, [isOpen, editingShop, initialCoords]);

  if (!isOpen) return null;

  const handlePoiSearch = async () => {
    if (poiQuery.trim().length < 2) return;
    setIsSearchingPoi(true);
    try {
      const results = await searchPoi(poiQuery.trim());
      setPoiResults(results.slice(0, 6));
    } finally {
      setIsSearchingPoi(false);
    }
  };

  const handlePickPoi = (poi: PoiSearchResult) => {
    const placeName = poi.place_name || poi.display_name;
    setName(placeName);
    setLat(poi.lat.toFixed(6));
    setLng(poi.lng.toFixed(6));
    setNaviName(placeName);
    setKakaoPlaceId(poi.place_id ? String(poi.place_id) : undefined);
    setPoiResults([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const trimmedName = name.trim();
    const parsedLat = Number(lat);
    const parsedLng = Number(lng);

    if (trimmedName.length < 2 || trimmedName.length > 80) {
      setErrorMsg('낚시점 상호는 2~80자 사이로 입력해 주세요.');
      return;
    }
    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
      setErrorMsg('올바른 위도·경도 좌표를 입력해 주세요.');
      return;
    }

    setIsSubmitting(true);
    try {
      const nowIso = new Date().toISOString();
      const shopId = editingShop?.id || `shop_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const shopPayload: FishingShop = {
        id: shopId,
        user_id: editingShop?.user_id || currentUserId,
        author_name: editingShop?.author_name || currentUserName,
        is_public: true,
        name: trimmedName,
        lat: parsedLat,
        lng: parsedLng,
        navi_name: naviName.trim() || undefined,
        navi_url: naviUrl.trim() || undefined,
        kakao_place_id: kakaoPlaceId || undefined,
        has_restroom: hasRestroom,
        has_store: hasStore,
        is_promoted: editingShop?.is_promoted,
        promoted_until: editingShop?.promoted_until,
        promo_badge_text: editingShop?.promo_badge_text,
        created_at: editingShop?.created_at || nowIso,
        updated_at: nowIso,
      };

      let initialMemo: ShopMemo | undefined;
      if (!editingShop && initialMemoText.trim().length > 0) {
        initialMemo = {
          id: crypto.randomUUID(),
          shop_id: shopId,
          user_id: currentUserId,
          user_name: currentUserName,
          content: initialMemoText.trim().slice(0, 500),
          tag: 'GENERAL',
          created_at: nowIso,
        };
      }

      await onSaveShop(shopPayload, initialMemo);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || '낚시점 저장 중 오류가 발생했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-3">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-2">
            <Store className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-bold text-white">
              {editingShop ? '낚시점 정보 수정' : '새 낚시점 등록 (관리자)'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3 overflow-y-auto text-xs">
          {/* 카카오 장소 검색 자동완성 */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-slate-300">카카오 장소 검색으로 자동 채우기</label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={poiQuery}
                onChange={(e) => setPoiQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handlePoiSearch();
                  }
                }}
                placeholder="예: 군산 비응항 낚시점"
                className="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 focus:border-amber-500 outline-none"
              />
              <button
                type="button"
                onClick={handlePoiSearch}
                disabled={isSearchingPoi}
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold flex items-center gap-1 disabled:opacity-50"
              >
                <Search className="w-3.5 h-3.5" />
                검색
              </button>
            </div>
            {poiResults.length > 0 && (
              <div className="bg-slate-950 border border-slate-700 rounded-lg divide-y divide-slate-800 max-h-36 overflow-y-auto">
                {poiResults.map((p, idx) => (
                  <button
                    key={`${p.place_id}-${idx}`}
                    type="button"
                    onClick={() => handlePickPoi(p)}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-slate-800/80 transition"
                  >
                    <div className="font-semibold text-amber-300 truncate">{p.place_name || p.display_name}</div>
                    <div className="text-[10px] text-slate-400 truncate">{p.road_address_name || p.address_name}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-slate-300">낚시점 상호 *</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 비응도 24시 낚시마트"
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 focus:border-amber-500 outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-300">위도 (lat) *</label>
              <input
                type="text"
                required
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-300">경도 (lng) *</label>
              <input
                type="text"
                required
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={() => setHasRestroom((v) => !v)}
              className={`px-3 py-2 rounded-xl border font-semibold transition ${
                hasRestroom
                  ? 'bg-emerald-950/60 border-emerald-500/70 text-emerald-300'
                  : 'bg-slate-950 border-slate-800 text-slate-400'
              }`}
            >
              화장실 {hasRestroom ? '있음' : '없음'}
            </button>
            <button
              type="button"
              onClick={() => setHasStore((v) => !v)}
              className={`px-3 py-2 rounded-xl border font-semibold transition ${
                hasStore
                  ? 'bg-sky-950/60 border-sky-500/70 text-sky-300'
                  : 'bg-slate-950 border-slate-800 text-slate-400'
              }`}
            >
              매점/편의점 {hasStore ? '있음' : '없음'}
            </button>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
              <Navigation className="w-3 h-3 text-amber-400" />
              카카오맵 내비 검색명 (선택)
            </label>
            <input
              type="text"
              value={naviName}
              onChange={(e) => setNaviName(e.target.value)}
              placeholder="미입력 시 낚시점 상호 사용"
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-100"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-slate-300">커스텀 내비 URL (선택)</label>
            <input
              type="url"
              value={naviUrl}
              onChange={(e) => setNaviUrl(e.target.value)}
              placeholder="https://map.kakao.com/..."
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-100"
            />
          </div>

          {!editingShop && (
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-300">초기 메모 (선택)</label>
              <textarea
                rows={2}
                maxLength={500}
                value={initialMemoText}
                onChange={(e) => setInitialMemoText(e.target.value)}
                placeholder="예: 새벽 4시 오픈, 청갯지렁이/밑밥 구비"
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 resize-none"
              />
            </div>
          )}

          {errorMsg && (
            <div className="p-2 rounded-lg bg-rose-950/70 border border-rose-500/50 text-rose-300 text-[11px]">
              {errorMsg}
            </div>
          )}

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 font-semibold"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold disabled:opacity-50"
            >
              {isSubmitting ? '저장 중...' : editingShop ? '수정 완료' : '낚시점 등록'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
