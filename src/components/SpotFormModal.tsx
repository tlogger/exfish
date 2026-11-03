import React from 'react';
import type { FishingMethod, FishingSpot, SpotType, SweetSpot } from '../types';
import { compressImageFile } from '../utils/exifExtractor';

interface SpotFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (spotData: {
    name: string;
    spot_type: SpotType;
    lat: number;
    lng: number;
    navi_name?: string;
    navi_url?: string;
    related_url?: string;
    directions: string;
    photo_urls: string[];
    fishing_methods: FishingMethod[];
    target_species: string[];
    best_tides: string[];
    best_times: string[];
    description: string;
    casting_start_deg?: number;
    casting_end_deg?: number;
    casting_directions?: string[];
    is_public: boolean;
    use_sweet_spot?: boolean;
    sweet_spots?: SweetSpot[];
  }) => void;
  editingSpot?: FishingSpot | null;
  initialLat?: number;
  initialLng?: number;
  extractExifFromImage: (file: File) => Promise<{ lat?: number; lng?: number; dateTime?: string }>;
}

export const SpotFormModal: React.FC<SpotFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  editingSpot,
  initialLat,
  initialLng,
  extractExifFromImage,
}) => {
  const [name, setName] = React.useState('');
  const [spotType, setSpotType] = React.useState<SpotType>('BREAKWATER');
  const [lat, setLat] = React.useState<number>(37.2541);
  const [lng, setLng] = React.useState<number>(126.4982);
  const [naviName, setNaviName] = React.useState('');
  const [relatedUrl, setRelatedUrl] = React.useState('');
  const [directions, setDirections] = React.useState('');
  const [photoUrls, setPhotoUrls] = React.useState<string[]>([]);
  const [selectedMethods, setSelectedMethods] = React.useState<FishingMethod[]>(['LURE']);
  const [targetSpeciesText, setTargetSpeciesText] = React.useState('우럭, 광어');
  const [bestTidesText, setBestTidesText] = React.useState('7물, 8물 (사리), 중들물');
  const [bestTimesText, setBestTimesText] = React.useState('새벽 해창, 일몰 피딩');
  const [description, setDescription] = React.useState('');
  const [isPublic, setIsPublic] = React.useState(true);

  const [isExtracting, setIsExtracting] = React.useState(false);
  const [exifSuccessMsg, setExifSuccessMsg] = React.useState('');

  // GPS 추출 확인 프롬프트 상태
  const [pendingGps, setPendingGps] = React.useState<{ lat: number; lng: number } | null>(null);

  React.useEffect(() => {
    if (editingSpot) {
      setName(editingSpot.name);
      setSpotType(editingSpot.spot_type);
      setLat(editingSpot.lat);
      setLng(editingSpot.lng);
      setNaviName(editingSpot.navi_name || '');
      setRelatedUrl(editingSpot.related_url || '');
      setDirections(editingSpot.directions || '');
      // Unsplash 기본 샘플 이미지 필터링 (사용자가 직접 올리지 않은 기본 사진 제외)
      setPhotoUrls(
        (editingSpot.photo_urls || []).filter((u) => !u.includes('images.unsplash.com'))
      );
      setSelectedMethods(editingSpot.fishing_methods || ['LURE']);
      setTargetSpeciesText(editingSpot.target_species?.join(', ') || '');
      setBestTidesText(editingSpot.best_tides?.join(', ') || '');
      setBestTimesText(editingSpot.best_times?.join(', ') || '');
      setDescription(editingSpot.description || '');
      setIsPublic(editingSpot.is_public ?? true);
      setExifSuccessMsg('');
      setPendingGps(null);
    } else {
      if (initialLat) setLat(initialLat);
      if (initialLng) setLng(initialLng);
      setName('');
      setSpotType('BREAKWATER');
      setNaviName('');
      setRelatedUrl('');
      setDirections('');
      setPhotoUrls([]);
      setSelectedMethods(['LURE']);
      setTargetSpeciesText('우럭, 광어');
      setBestTidesText('7물, 8물 (사리), 중들물');
      setBestTimesText('새벽 해창, 일몰 피딩');
      setDescription('');
      setIsPublic(true);
      setExifSuccessMsg('');
      setPendingGps(null);
    }
  }, [editingSpot, initialLat, initialLng, isOpen]);

  if (!isOpen) return null;

  const handleMethodToggle = (method: FishingMethod) => {
    if (selectedMethods.includes(method)) {
      if (selectedMethods.length > 1) {
        setSelectedMethods(selectedMethods.filter((m) => m !== method));
      }
    } else {
      setSelectedMethods([...selectedMethods, method]);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 동일 파일 재선택 허용을 위해 input 값 초기화
    e.target.value = '';

    setIsExtracting(true);
    setExifSuccessMsg('');
    setPendingGps(null);

    try {
      // 1. 스트림 소실 방지를 위해 EXIF GPS 분석을 가장 먼저 수행
      const res = await extractExifFromImage(file);

      // 2. 브라우저 및 클라우드 DB 영구 보전용 압축 Base64 Data URL 생성
      const dataUrl = await compressImageFile(file);
      if (dataUrl) {
        setPhotoUrls((prev) => [...prev, dataUrl]);
      }

      if (res.lat != null && res.lng != null && !isNaN(res.lat) && !isNaN(res.lng)) {
        setPendingGps({ lat: res.lat, lng: res.lng });
        setExifSuccessMsg(`📍 사진에서 GPS 좌표(위도 ${res.lat.toFixed(5)}, 경도 ${res.lng.toFixed(5)})가 감지되었습니다!`);
      } else {
        setExifSuccessMsg(
          'ℹ️ 선택된 사진에 GPS 태그가 없습니다. (안드로이드 갤러리 위치보호·구글포토 클라우드 축소본·카톡 전송본인 경우 우측 [📁 원본 파일로 선택]에서 카메라 원본(DCIM)을 선택해 주세요.)'
        );
      }
    } catch {
      setExifSuccessMsg('사진을 분석하는 중 오류가 발생했습니다.');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleApplyPendingGps = (apply: boolean) => {
    if (apply && pendingGps) {
      setLat(pendingGps.lat);
      setLng(pendingGps.lng);
      setExifSuccessMsg(`✅ 포인트 좌표가 사진의 GPS(${pendingGps.lat.toFixed(5)}, ${pendingGps.lng.toFixed(5)})로 업데이트되었습니다.`);
    } else {
      setExifSuccessMsg('기존 좌표를 그대로 유지합니다.');
    }
    setPendingGps(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      alert('포인트 이름을 입력해주세요.');
      return;
    }

    const species = targetSpeciesText
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const tides = bestTidesText
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const times = bestTimesText
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    onSubmit({
      name,
      spot_type: spotType,
      lat: Number(lat),
      lng: Number(lng),
      navi_name: naviName.trim() || undefined,
      related_url: relatedUrl.trim() || undefined,
      directions,
      photo_urls: photoUrls, // 파일 미선택 시 빈 배열 유지 (5-1 버그 수정)
      fishing_methods: selectedMethods,
      target_species: species,
      best_tides: tides,
      best_times: times,
      description,
      // 캐스팅/스윗스팟은 맵에서 직접 설정하므로 기존 편집 값이 있다면 보존
      casting_start_deg: editingSpot?.casting_start_deg,
      casting_end_deg: editingSpot?.casting_end_deg,
      casting_directions: editingSpot?.casting_directions,
      is_public: isPublic,
      use_sweet_spot: editingSpot?.use_sweet_spot,
      sweet_spots: editingSpot?.sweet_spots,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl text-white shadow-2xl p-6 my-8 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-5 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🎣</span>
            <h2 className="text-xl font-bold text-cyan-400">
              {editingSpot ? '낚시 포인트 수정' : '새 낚시 포인트 등록'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-sm">
          {/* 현장 사진 업로드 & EXIF GPS 감지 및 사용자 확인 */}
          <div className="p-3.5 bg-cyan-950/40 border border-cyan-800/60 rounded-xl space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-cyan-300 flex items-center gap-1.5">
                📸 현장 사진 업로드 (스마트폰 GPS 자동 분석)
              </span>
              {isExtracting && <span className="text-xs text-cyan-400 animate-pulse font-bold">EXIF 분석 중...</span>}
            </div>
            <p className="text-xs text-slate-300">
              사진의 EXIF로부터 GPS 좌표를 자동 추출합니다. (갤러리 선택 시 GPS가 제거되면 <strong>원본 파일로 선택</strong>을 이용해 주세요)
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold cursor-pointer transition shadow">
                <span>🖼️ 갤러리/카메라 선택</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
              </label>
              <label
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-cyan-500/50 text-cyan-300 text-xs font-semibold cursor-pointer transition"
                title="안드로이드 포토피커가 GPS를 지우는 경우 내 파일(DCIM/Camera)에서 원본을 직접 선택합니다"
              >
                <span>📁 원본 파일로 선택 (GPS 보존)</span>
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.heic,.webp,application/octet-stream"
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
              </label>
            </div>

            {/* GPS 추출 성공 시 사용자 승인 질문 박스 */}
            {pendingGps && (
              <div className="p-3 bg-amber-950/80 border border-amber-500/70 rounded-xl space-y-2 text-amber-200">
                <div className="font-bold flex items-center gap-1.5 text-xs text-amber-300">
                  <span>📍 사진의 GPS 위치로 포인트 좌표를 업데이트할까요?</span>
                </div>
                <div className="text-xs font-mono bg-black/40 p-2 rounded text-slate-200">
                  위도(Lat): {pendingGps.lat.toFixed(6)} / 경도(Lng): {pendingGps.lng.toFixed(6)}
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => handleApplyPendingGps(false)}
                    className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium"
                  >
                    아니오 (현재 좌표 유지)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPendingGps(true)}
                    className="px-3 py-1 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold"
                  >
                    예, 이 좌표로 변경
                  </button>
                </div>
              </div>
            )}

            {exifSuccessMsg && !pendingGps && (
              <div className="text-xs text-emerald-400 font-medium bg-emerald-950/50 p-2 rounded border border-emerald-800/60">
                {exifSuccessMsg}
              </div>
            )}

            {/* 업로드된 사진 미리보기 */}
            {photoUrls.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pt-1">
                {photoUrls.map((url, i) => (
                  <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden shrink-0 border border-slate-700">
                    <img src={url} alt="upload" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setPhotoUrls(photoUrls.filter((_, idx) => idx !== i))}
                      className="absolute top-0.5 right-0.5 bg-black/70 text-white rounded-full w-4 h-4 text-[10px] flex items-center justify-center hover:bg-rose-600"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 포인트 명칭 및 지형 구분 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 mb-1 font-medium">포인트 이름 *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 영흥도 진두선착장 우측 갯바위"
                className="w-full bg-slate-800/90 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
              />
            </div>
            <div>
              <label className="block text-slate-300 mb-1 font-medium">지형 구분 *</label>
              <select
                value={spotType}
                onChange={(e) => setSpotType(e.target.value as SpotType)}
                className="w-full bg-slate-800/90 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-400"
              >
                <option value="ROCK">갯바위 (Rock)</option>
                <option value="SEAWALL">석축 (Seawall)</option>
                <option value="BREAKWATER">방파제 (Breakwater)</option>
                <option value="BEACH">해변 / 백사장 (Beach)</option>
                <option value="PIER">선착장 / 기타 (Pier)</option>
              </select>
            </div>
          </div>

          {/* 위경도 좌표 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 mb-1 font-medium">위도 (Lat) *</label>
              <input
                type="number"
                step="any"
                required
                value={lat}
                onChange={(e) => setLat(parseFloat(e.target.value))}
                className="w-full bg-slate-800/90 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-cyan-400"
              />
            </div>
            <div>
              <label className="block text-slate-300 mb-1 font-medium">경도 (Lng) *</label>
              <input
                type="number"
                step="any"
                required
                value={lng}
                onChange={(e) => setLng(parseFloat(e.target.value))}
                className="w-full bg-slate-800/90 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-cyan-400"
              />
            </div>
          </div>

          {/* 길찾기 & 도보 진입로/주차 안내 통합 (요구사항 5-3, 5-4) */}
          <div className="p-3.5 bg-slate-800/60 border border-slate-700 rounded-xl space-y-2.5">
            <div className="text-xs font-bold text-amber-300">
              <span>길찾기</span>
            </div>
            <div>
              <label className="block text-slate-300 text-xs mb-1 font-medium">
                길찾기 지명(선택)
              </label>
              <input
                type="text"
                value={naviName}
                onChange={(e) => setNaviName(e.target.value)}
                placeholder="예: 진두선착장 공영주차장 (미입력시 포인트명 사용)"
                className="w-full bg-slate-850 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
              />
            </div>
            <div>
              <label className="block text-slate-300 text-xs mb-1 font-medium">
                도보 진입로 & 진입 주의구간
              </label>
              <textarea
                rows={5}
                value={directions}
                onChange={(e) => setDirections(e.target.value)}
                placeholder="예: 공영주차장 주차 후 붉은 등대 방면 테트라포드 도보 5분 진입 (장화 착용 요망)"
                className="w-full bg-slate-850 border border-slate-700 rounded-lg p-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400 text-xs min-h-[110px] leading-relaxed"
              />
            </div>
          </div>

          {/* 낚시 방법 선택 (영문 제거) */}
          <div>
            <label className="block text-slate-300 mb-1.5 font-medium">주요 낚시 방법 (복수 선택 가능)</label>
            <div className="flex gap-2">
              {[
                { id: 'LURE', label: '루어' },
                { id: 'SURF', label: '원투' },
                { id: 'FLOAT', label: '찌낚시' },
              ].map((m) => {
                const isSelected = selectedMethods.includes(m.id as FishingMethod);
                return (
                  <button
                    type="button"
                    key={m.id}
                    onClick={() => handleMethodToggle(m.id as FishingMethod)}
                    className={`flex-1 py-1.5 px-3 rounded-lg border text-xs font-semibold transition ${
                      isSelected
                        ? 'bg-cyan-600/30 border-cyan-400 text-cyan-300'
                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    {isSelected ? '✓ ' : ''}{m.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 대상어종 & 선호 물때 & 시간대 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 mb-1 font-medium">대상 어종 (쉼표 구분)</label>
              <input
                type="text"
                value={targetSpeciesText}
                onChange={(e) => setTargetSpeciesText(e.target.value)}
                placeholder="우럭, 감성돔, 농어, 무늬오징어"
                className="w-full bg-slate-800/90 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-400"
              />
            </div>
            <div>
              <label className="block text-slate-300 mb-1 font-medium">잘 잡히는 물때 (선호 물때)</label>
              <input
                type="text"
                value={bestTidesText}
                onChange={(e) => setBestTidesText(e.target.value)}
                placeholder="7물~9물 (사리), 초들물~중들물"
                className="w-full bg-slate-800/90 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-400"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-300 mb-1 font-medium">잘 잡히는 시간대 & 공략 메모</label>
            <input
              type="text"
              value={bestTimesText}
              onChange={(e) => setBestTimesText(e.target.value)}
              placeholder="새벽 해창(05:00~07:00), 해질녘 골든타임"
              className="w-full bg-slate-800/90 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-400 mb-2"
            />
            <textarea
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="수심 7~9m, 30m 전방 수중여 넘겨서 호핑 액션에 반응 좋음"
              className="w-full bg-slate-800/90 border border-slate-700 rounded-lg p-2.5 text-white focus:outline-none focus:border-cyan-400 text-xs min-h-[110px] leading-relaxed"
            />
          </div>

          {/* 관련 URL 입력 (평범한 슬레이트 외곽선 적용) */}
          <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-1.5">
            <label className="block text-slate-300 text-xs font-semibold">
              관련 URL (선택)
            </label>
            <input
              type="url"
              value={relatedUrl}
              onChange={(e) => setRelatedUrl(e.target.value)}
              placeholder="https://... (포인트 소개 영상, 블로그 조행기 등)"
              className="w-full bg-slate-850 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-400 font-mono"
            />
          </div>

          {/* 공개 여부 설정 */}
          <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg border border-slate-700">
            <div>
              <span className="font-medium text-slate-200">공개</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
            </label>
          </div>

          {/* 버튼: 수정 버튼 이름 Ok로 변경 */}
          <div className="pt-4 border-t border-slate-800 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition cursor-pointer"
            >
              취소
            </button>
            <button
              type="submit"
              className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold shadow-lg shadow-cyan-500/20 transition active:scale-95 cursor-pointer"
            >
              {editingSpot ? 'Ok' : 'Ok'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
