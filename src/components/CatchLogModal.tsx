import React from 'react';
import { ArrowUp, Clock, Compass, RefreshCw, ShieldAlert } from 'lucide-react';
import type { CatchLog, CurrentUnit, FishingMethod, TideDayInfo, WeatherData, WindUnit } from '../types';
import { syncCatchEnvironment } from '../utils/catchSync';
import { formatCurrentVelocity } from '../utils/weatherApi';
import { generatePostMortemReport } from '../utils/postMortemEngine';
import { SPECIES_ENCYCLOPEDIA } from '../utils/speciesDatabase';
import { compressImageFile } from '../utils/exifExtractor';

interface CatchLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  spotId: string;
  spotName: string;
  spotLat: number;
  spotLng: number;
  editingLog?: CatchLog | null;
  currentWeather: WeatherData | null;
  currentTide: TideDayInfo | null;
  currentWaterTemp: number;
  currentVelocity?: number;
  windUnit?: WindUnit;
  currentUnit?: CurrentUnit;
  extractExifFromImage: (file: File) => Promise<{ lat?: number; lng?: number; dateStr?: string; timeStr?: string }>;
  onSaveLog: (logData: Omit<CatchLog, 'id' | 'created_at'>) => void;
}

// 한국 기상청 표준 8방위 풍향 프리셋 (불어오는 방향 기준 '~풍' + 실제 바람 진행 화살표)
const WIND_DIR_PRESETS: { label: string; arrow: string; flow: string; deg: number }[] = [
  { label: '북풍', arrow: '↓', flow: '북→남', deg: 0 },
  { label: '북동풍', arrow: '↙', flow: '북동→남서', deg: 45 },
  { label: '동풍', arrow: '←', flow: '동→서', deg: 90 },
  { label: '남동풍', arrow: '↖', flow: '남동→북서', deg: 135 },
  { label: '남풍', arrow: '↑', flow: '남→북', deg: 180 },
  { label: '남서풍', arrow: '↗', flow: '남서→북동', deg: 225 },
  { label: '서풍', arrow: '→', flow: '서→동', deg: 270 },
  { label: '북서풍', arrow: '↘', flow: '북서→남동', deg: 315 },
];

/** 두 방위각(0-360°) 사이의 최소 사잇각(0-180°) 계산 */
function getAngularDiff(a: number, b: number): number {
  const diff = Math.abs(((a - b) % 360 + 360) % 360);
  return diff > 180 ? 360 - diff : diff;
}

/** 시작 시각과 종료 시각(HH:mm)으로부터 경과 시간(분)을 계산 */
function calcDurationMinutes(start: string, end: string): number {
  if (!start || !end) return 0;
  const [sH, sM] = start.split(':').map((v) => parseInt(v, 10));
  const [eH, eM] = end.split(':').map((v) => parseInt(v, 10));
  if (isNaN(sH) || isNaN(sM) || isNaN(eH) || isNaN(eM)) return 0;

  let startTotal = sH * 60 + sM;
  let endTotal = eH * 60 + eM;
  if (endTotal < startTotal) {
    // 자정을 넘긴 경우 (예: 22:00 ~ 02:00)
    endTotal += 24 * 60;
  }
  return Math.max(0, endTotal - startTotal);
}

export const CatchLogModal: React.FC<CatchLogModalProps> = ({
  isOpen,
  onClose,
  spotId,
  spotLat,
  spotLng,
  editingLog,
  currentWeather,
  currentTide,
  currentWaterTemp,
  currentVelocity = 0.3,
  windUnit = 'ms',
  currentUnit = 'ms',
  extractExifFromImage,
  onSaveLog,
}) => {
  const [fishSpecies, setFishSpecies] = React.useState('우럭');
  const [fishCount, setFishCount] = React.useState(1);
  const [fishCountInput, setFishCountInput] = React.useState('1');
  const [fishSizeInput, setFishSizeInput] = React.useState('28.5');
  const [catchMethod, setCatchMethod] = React.useState<FishingMethod>('LURE');
  const [lureBait, setLureBait] = React.useState('지그헤드 1/2oz + 웜');
  const [catchDate, setCatchDate] = React.useState(() => new Date().toISOString().split('T')[0]);

  // 출조 시간 분할 필드 (시작 시각, 종료 시각, 히트 시각 - 각 필드는 독립적으로 동작)
  const [startTime, setStartTime] = React.useState('14:00');
  const [endTime, setEndTime] = React.useState('18:30');
  const [catchTime, setCatchTime] = React.useState('16:30'); // 히트 시각

  // 낚시 시간은 종료 시각 - 시작 시각으로 자동 연산 (수동 입력 불가)
  const durationMins = React.useMemo(() => {
    return calcDurationMinutes(startTime, endTime);
  }, [startTime, endTime]);

  // 시간 포맷 헬퍼 (예: '3시간 20분')
  const formatDurationKor = (mins: number) => {
    if (mins <= 0) return '0분';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0 && m > 0) return `${h}시간 ${m}분`;
    if (h > 0) return `${h}시간`;
    return `${m}분`;
  };

  const triggerPicker = (e: React.MouseEvent<HTMLInputElement>) => {
    try {
      (e.target as any).showPicker?.();
    } catch {}
  };

  const [catchLat, setCatchLat] = React.useState<number | undefined>();
  const [catchLng, setCatchLng] = React.useState<number | undefined>();

  // 당시 환경 스냅샷 필드 (풍향, 풍속, 수온, 조류 등)
  const [catchMul, setCatchMul] = React.useState(currentTide?.mulText || '8물');
  const [tideState, setTideState] = React.useState('중들물 (조류 왕성)');
  const [waterTemp, setWaterTemp] = React.useState(currentWaterTemp || 18.0);
  const [windSpeed, setWindSpeed] = React.useState(currentWeather?.windSpeed || 2.5);
  const [windDirection, setWindDirection] = React.useState<number>(currentWeather?.windDirection ?? 315);
  const [simCurrentVel, setSimCurrentVel] = React.useState<number>(currentVelocity);
  const [photoUrl, setPhotoUrl] = React.useState('');
  const [memo, setMemo] = React.useState('');
  const [isAnalyzing, setIsAnalyzing] = React.useState(false);
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [exifNotice, setExifNotice] = React.useState('');

  // 모달 열림 시 1회만 초기화 (부모의 10초 타이머나 날씨 갱신으로 인한 입력값 초기화 버그 원천 방지)
  const initializedRef = React.useRef(false);
  const lastEditingLogIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      const currentLogId = editingLog ? editingLog.id : null;
      if (!initializedRef.current || lastEditingLogIdRef.current !== currentLogId) {
        initializedRef.current = true;
        lastEditingLogIdRef.current = currentLogId;

        if (editingLog) {
          setFishSpecies(editingLog.fish_species);
          const initialCount = editingLog.fish_count ?? (editingLog.is_hitless ? 0 : 1);
          setFishCount(initialCount);
          setFishCountInput(String(initialCount));
          setFishSizeInput(editingLog.fish_size_cm != null ? String(editingLog.fish_size_cm) : '');
          setCatchMethod(editingLog.catch_method);
          setLureBait(editingLog.lure_bait || '');
          setCatchDate(editingLog.catch_date);
          setCatchTime(editingLog.catch_time);
          setStartTime(editingLog.start_time || '14:00');
          setEndTime(editingLog.end_time || '18:30');
          setCatchLat(editingLog.lat);
          setCatchLng(editingLog.lng);
          setCatchMul(editingLog.catch_mul);
          setTideState(editingLog.tide_state);
          setWaterTemp(editingLog.water_temp);
          setWindSpeed(editingLog.wind_speed);
          if (editingLog.wind_direction != null) setWindDirection(editingLog.wind_direction);
          if (editingLog.current_velocity != null) setSimCurrentVel(editingLog.current_velocity);
          setPhotoUrl(editingLog.photo_url || '');
          setMemo(editingLog.memo || '');
          setExifNotice('');
        } else {
          setFishSpecies('우럭');
          setFishCount(1);
          setFishCountInput('1');
          setFishSizeInput('28.5');
          setCatchMethod('LURE');
          setLureBait('지그헤드 1/2oz + 웜');
          setCatchDate(new Date().toISOString().split('T')[0]);
          setStartTime('14:00');
          setEndTime('18:30');
          setCatchTime('16:30');
          setCatchLat(spotLat);
          setCatchLng(spotLng);
          if (currentTide) setCatchMul(currentTide.mulText);
          if (currentWaterTemp) setWaterTemp(currentWaterTemp);
          if (currentWeather) {
            setWindSpeed(currentWeather.windSpeed);
            if (currentWeather.windDirection != null) setWindDirection(currentWeather.windDirection);
          }
          if (currentVelocity) setSimCurrentVel(currentVelocity);
          setPhotoUrl('');
          setMemo('');
          setExifNotice('');
        }
      }
    } else {
      initializedRef.current = false;
      lastEditingLogIdRef.current = null;
    }
  }, [isOpen, editingLog, spotLat, spotLng]);

  const isHitless = fishCount === 0;

  // 마릿수가 0(꽝)일 때 7대 환경 벡터 기반 실시간 사후 복기 리포트 연산
  const postMortemReport = React.useMemo(() => {
    if (!isHitless) return null;
    return generatePostMortemReport({
      targetSpecies: fishSpecies.trim() || '우럭',
      catchTime: catchTime || '16:00',
      weather: currentWeather,
      marine: {
        seaSurfaceTemp: Number(waterTemp) || 16.5,
        waveHeight: currentWeather ? 0.8 : 0.6,
        wavePeriod: 6.0,
        currentVelocity: Number(simCurrentVel) || 0.35,
        waveDirection: 180,
        currentDirection: 135,
        hourly: { time: [], seaSurfaceTemp: [], waveHeight: [], currentVelocity: [], currentDirection: [] },
      },
      tide: currentTide,
      biteScore: null,
    });
  }, [isHitless, fishSpecies, catchTime, waterTemp, simCurrentVel, currentWeather, currentTide]);

  if (!isOpen) return null;

  // 일자/시각/위치 기반 환경 동기화 함수
  const handleAutoSyncEnvironment = async (dStr: string, tStr: string, latVal: number, lngVal: number) => {
    setIsSyncing(true);
    try {
      const syncRes = await syncCatchEnvironment(dStr, tStr, latVal, lngVal);
      setCatchMul(syncRes.catch_mul);
      setTideState(syncRes.tide_state);
      setWaterTemp(syncRes.water_temp);
      setWindSpeed(syncRes.wind_speed);
      if (syncRes.wind_direction != null) {
        setWindDirection(syncRes.wind_direction);
      }
      if (syncRes.current_velocity != null) {
        setSimCurrentVel(syncRes.current_velocity);
      }
      setExifNotice((prev) => `${prev} 🔄 당시 환경(물때 ${syncRes.catch_mul}, ${syncRes.tide_state}, 수온 ${syncRes.water_temp}°C, 조류 ${formatCurrentVelocity(syncRes.current_velocity || 0, currentUnit)}) 동기화 완료!`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 동일 파일 재선택 허용을 위해 input 값 초기화
    e.target.value = '';

    setIsAnalyzing(true);
    setExifNotice('');

    try {
      // 1. 스트림 소실 방지를 위해 EXIF GPS/일시 분석을 가장 먼저 수행
      const res = await extractExifFromImage(file);

      // 2. 영구 보전 가능한 고화질 압축 Base64 데이터 생성 (blob: URL 소실 원천 방지)
      const dataUrl = await compressImageFile(file);
      if (dataUrl) {
        setPhotoUrl(dataUrl);
      }

      const notices: string[] = [];

      let targetDate = catchDate;
      let targetTime = catchTime;
      let targetLat = catchLat || spotLat;
      let targetLng = catchLng || spotLng;

      if (res.dateStr) {
        setCatchDate(res.dateStr);
        targetDate = res.dateStr;
        notices.push(`출조일자: ${res.dateStr}`);
      }
      if (res.timeStr) {
        setCatchTime(res.timeStr);
        targetTime = res.timeStr;
        notices.push(`히트시각: ${res.timeStr}`);
      }
      if (res.lat != null && res.lng != null && !isNaN(res.lat) && !isNaN(res.lng)) {
        setCatchLat(res.lat);
        setCatchLng(res.lng);
        targetLat = res.lat;
        targetLng = res.lng;
        notices.push(`GPS: ${res.lat.toFixed(5)}, ${res.lng.toFixed(5)}`);
      }

      if (notices.length > 0) {
        setExifNotice(`📸 EXIF 인식 완료 (${notices.join(' | ')})`);
      } else {
        setExifNotice(
          'ℹ️ 선택된 사진에 EXIF 태그가 없어 기본 좌표·일시를 유지합니다. (갤러리 위치보호·클라우드 축소본인 경우 [📁 원본 파일로 선택]을 이용해 주세요.)'
        );
      }

      // 날짜/시각/좌표 기반 환경 자동 동기화 트리거
      await handleAutoSyncEnvironment(targetDate, targetTime, targetLat, targetLng);
    } catch {
      setExifNotice('사진 분석 중 오류가 발생했습니다.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fishSpecies.trim()) {
      alert('잡은 어종 또는 대상 어종을 입력해주세요.');
      return;
    }

    const parsedCount = parseInt(fishCountInput, 10);
    const countNum = isNaN(parsedCount) ? Math.max(0, Number(fishCount) || 0) : Math.max(0, parsedCount);
    const hitlessFlag = countNum === 0;

    const parsedSize = fishSizeInput.trim() ? parseFloat(fishSizeInput) : undefined;
    const finalSize = hitlessFlag || parsedSize == null || isNaN(parsedSize) ? undefined : parsedSize;

    onSaveLog({
      spot_id: spotId,
      user_id: 'user-me',
      user_name: '나의 조행기록',
      catch_date: catchDate,
      catch_time: catchTime,
      start_time: startTime,
      end_time: endTime,
      duration_minutes: durationMins,
      fish_species: fishSpecies.trim(),
      fish_size_cm: finalSize,
      fish_count: countNum,
      is_hitless: hitlessFlag,
      catch_method: catchMethod,
      lure_bait: lureBait,
      catch_mul: catchMul,
      tide_state: tideState,
      water_temp: Number(waterTemp),
      wind_speed: Number(windSpeed),
      wind_direction: windDirection,
      current_velocity: Number(simCurrentVel),
      lat: catchLat,
      lng: catchLng,
      photo_url: photoUrl.trim() ? photoUrl.trim() : undefined,
      memo,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg text-white shadow-2xl p-6 my-8 max-h-[90vh] overflow-y-auto">
        {/* 헤더 */}
        <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{isHitless ? '❌' : '🐟'}</span>
            <h2 className="text-xl font-bold text-emerald-400">
              {editingLog ? '조과 수정' : '새 조과 기록'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
          >
            ✕
          </button>
        </div>

        {/* 꽝/히트 빠른 결과 토글 바 */}
        <div className="mb-4 p-2 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              if (fishCount === 0) {
                setFishCount(1);
                setFishCountInput('1');
                if (!fishSizeInput) setFishSizeInput('28.5');
              }
            }}
            className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
              !isHitless
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30 ring-1 ring-emerald-400'
                : 'bg-slate-800/80 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            <span>🐟 히트</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setFishCount(0);
              setFishCountInput('0');
              setFishSizeInput('');
            }}
            className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
              isHitless
                ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30 ring-1 ring-rose-400'
                : 'bg-slate-800/80 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            <span>❌ 꽝</span>
          </button>
        </div>

        {isHitless && (
          <div className="mb-4 p-2.5 rounded-lg bg-rose-950/50 border border-rose-800/60 text-xs text-rose-300 leading-relaxed">
            💡 <strong>'꽝' 기록도 소중한 빅데이터입니다!</strong> 당시 바다 상황(수온, 물때, 풍향·풍속, 조류)을 함께 기록해 두시면, 추후 해당 포인트에서 <strong>'고기가 낚이지 않는 조건'을 분석하는 통계 자료</strong>로 매우 유용하게 활용됩니다.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-sm">
          {/* 어종 & 마릿수 & 체장 */}
          <div className="p-3.5 bg-slate-800/40 border border-slate-700/60 rounded-xl space-y-3">
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-slate-200 font-semibold text-xs flex items-center gap-1">
                  <span>🎣 어종 *</span>
                </label>
                <span className="text-[11px] text-slate-400">
                  {isHitless ? '(노렸던 대상 어종)' : '(실제 히트한 어종)'}
                </span>
              </div>
              <input
                type="text"
                required
                value={fishSpecies}
                onChange={(e) => setFishSpecies(e.target.value)}
                placeholder="감성돔, 우럭, 농어, 볼락, 쭈꾸미 등"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-medium focus:outline-none focus:border-cyan-400"
              />

              {/* 스마트 금어기 / 방생체장 실시간 안내 뱃지 */}
              {(() => {
                const trimmed = fishSpecies.trim();
                const matchedEcology =
                  SPECIES_ENCYCLOPEDIA[trimmed] ||
                  Object.values(SPECIES_ENCYCLOPEDIA).find(
                    (sp) => sp.name.includes(trimmed) || (trimmed && trimmed.includes(sp.name))
                  );

                if (!matchedEcology) return null;

                const hasMinLength = matchedEcology.minLengthCm != null;
                const hasProhibited = !!matchedEcology.prohibitedPeriod;
                const currentLen = fishSizeInput.trim() ? parseFloat(fishSizeInput) : undefined;
                const isUnderSize = !isHitless && currentLen != null && hasMinLength && currentLen <= (matchedEcology.minLengthCm || 0);

                return (
                  <div className="mt-1.5 p-2 rounded-lg bg-slate-950/70 border border-slate-800 text-[11px] space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-bold text-slate-300">[{matchedEcology.name}]</span>
                      {hasMinLength && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-600/40 font-semibold flex items-center gap-0.5">
                          <ShieldAlert size={11} />
                          <span>방생 기준: 전장 {matchedEcology.minLengthCm}cm 이하</span>
                        </span>
                      )}
                      {hasProhibited && (
                        <span className="px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-600/40 font-semibold">
                          금어기: {matchedEcology.prohibitedPeriod}
                        </span>
                      )}
                    </div>
                    {isUnderSize && (
                      <p className="text-rose-400 font-bold animate-pulse text-[11px] pt-0.5">
                        ⚠️ 측정 체장({currentLen}cm)이 법정 금지체장({matchedEcology.minLengthCm}cm) 이하입니다. 어린 치어는 즉시 방생하셨나요? (위반 시 과태료 최대 80만 원)
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 mb-1 font-medium text-xs">
                  마릿수 (0이면 자동 꽝 판정) *
                </label>
                <input
                  type="number"
                  min="0"
                  required
                  value={fishCountInput}
                  onChange={(e) => {
                    const val = e.target.value;
                    setFishCountInput(val);
                    if (val !== '') {
                      const parsed = parseInt(val, 10);
                      setFishCount(isNaN(parsed) ? 0 : Math.max(0, parsed));
                    }
                  }}
                  onBlur={() => {
                    if (fishCountInput.trim() === '') {
                      setFishCount(0);
                      setFishCountInput('0');
                    } else {
                      const parsed = parseInt(fishCountInput, 10);
                      const safe = isNaN(parsed) ? 0 : Math.max(0, parsed);
                      setFishCount(safe);
                      setFishCountInput(String(safe));
                    }
                  }}
                  className={`w-full bg-slate-900 border rounded-lg px-3 py-2 text-white font-bold font-mono focus:outline-none ${
                    isHitless ? 'border-rose-500 text-rose-300' : 'border-slate-700 focus:border-cyan-400'
                  }`}
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1 font-medium text-xs">
                  최대 체장 (cm)
                </label>
                <input
                  type="number"
                  step="0.5"
                  disabled={isHitless}
                  value={isHitless ? '' : fishSizeInput}
                  onChange={(e) => setFishSizeInput(e.target.value)}
                  placeholder={isHitless ? '꽝 (기록 생략)' : '선택 (예: 35.5)'}
                  className={`w-full bg-slate-900 border rounded-lg px-3 py-2 text-white font-mono focus:outline-none ${
                    isHitless ? 'border-slate-800 text-slate-500 bg-slate-950 cursor-not-allowed' : 'border-slate-700 focus:border-cyan-400'
                  }`}
                />
              </div>
            </div>
          </div>

          {/* AI 꽝 사후 복기 인텔리전스 카드 */}
          {isHitless && postMortemReport && (
            <div className="p-3.5 bg-rose-950/30 border border-rose-500/40 rounded-xl space-y-2.5 animate-in fade-in duration-200">
              <div className="flex items-center justify-between border-b border-rose-900/40 pb-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-rose-300">
                  <span>💔 AI 꽝 사후 복기 리포트</span>
                </div>
                <span className="text-[10px] text-slate-400 font-mono italic">
                  "떠나버린 물고기를 기리며..."
                </span>
              </div>
              <p className="text-[11.5px] text-slate-200 leading-snug">
                {postMortemReport.summary}
              </p>
              <div className="space-y-1.5 pt-1">
                {postMortemReport.topFactors.map((factor, idx) => (
                  <div key={factor.id} className="text-[11px] space-y-0.5">
                    <div className="flex justify-between items-center text-slate-300">
                      <span>{idx + 1}. {factor.name}</span>
                      <span className="font-mono font-bold text-rose-400">{factor.contributionPercent}%</span>
                    </div>
                    <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          idx === 0 ? 'bg-rose-500' : idx === 1 ? 'bg-amber-500' : 'bg-cyan-500'
                        }`}
                        style={{ width: `${factor.contributionPercent}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-slate-400">{factor.description}</div>
                  </div>
                ))}
              </div>
              <div className="p-2 bg-slate-900/90 rounded-lg border border-slate-800 text-[11px] text-amber-300 font-medium">
                {postMortemReport.tacticalAdvice}
              </div>
            </div>
          )}

          {/* 출조 일자 & 낚시 시간대 (시작, 종료, 총 낚시시간, 히트 시각) */}
          <div className="p-3.5 bg-slate-800/40 border border-slate-700/60 rounded-xl space-y-3">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-cyan-300 text-xs flex items-center gap-1.5">
                <Clock size={13} />
                <span>출조 일자 & 낚시 시간대</span>
              </span>
              <span className="text-[11px] font-bold text-amber-300 bg-amber-950/80 px-2 py-0.5 rounded border border-amber-800/60 font-mono">
                ⏱️ 총 {formatDurationKor(durationMins)} 낚시
              </span>
            </div>

            <div>
              <label className="block text-slate-300 mb-1 font-medium text-xs">출조 일자 *</label>
              <input
                type="date"
                required
                value={catchDate}
                onClick={triggerPicker}
                onChange={(e) => setCatchDate(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-cyan-400 cursor-pointer touch-manipulation min-h-[42px]"
              />
            </div>

            {/* 시작/종료 시각 (각각 독립적으로 수정되며, 낚시 시간은 자동 연산됨) */}
            {(() => {
              const isNextDay = Boolean(startTime && endTime && endTime < startTime);
              return (
                <div className="space-y-2.5">
                  <div>
                    <label className="block text-slate-400 mb-1 text-xs">시작 시각</label>
                    <input
                      type="time"
                      value={startTime}
                      onClick={triggerPicker}
                      onChange={(e) => setStartTime(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-400 cursor-pointer touch-manipulation min-h-[42px]"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-slate-400 text-xs flex items-center gap-1.5">
                        <span>종료 시각</span>
                        {isNextDay && (
                          <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold">
                            다음날
                          </span>
                        )}
                      </label>
                    </div>
                    <input
                      type="time"
                      value={endTime}
                      onClick={triggerPicker}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-400 cursor-pointer touch-manipulation min-h-[42px]"
                    />
                  </div>
                </div>
              );
            })()}

            <div className={`pt-2 border-t border-slate-800 ${isHitless ? '' : 'grid grid-cols-1 sm:grid-cols-2 gap-3'}`}>
              {!isHitless && (
                <div>
                  <label className="block text-slate-300 mb-1 font-medium text-xs">
                    결정적 히트 시각 *
                  </label>
                  <input
                    type="time"
                    required
                    value={catchTime}
                    onClick={triggerPicker}
                    onChange={(e) => setCatchTime(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-400 cursor-pointer touch-manipulation min-h-[42px]"
                  />
                </div>
              )}
              <div>
                <label className="text-slate-300 font-medium text-xs block mb-1">낚시 시간 (자동 계산)</label>
                <div className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-cyan-300 font-mono font-semibold flex items-center justify-between min-h-[42px]">
                  <span>{formatDurationKor(durationMins)}</span>
                  <span className="text-xs text-slate-400 font-normal">({durationMins}분)</span>
                </div>
              </div>
            </div>
          </div>

          {/* 낚시 장르 & 사용 채비 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 mb-1 font-medium text-xs">낚시 방법</label>
              <select
                value={catchMethod}
                onChange={(e) => setCatchMethod(e.target.value as FishingMethod)}
                className="w-full bg-slate-800/90 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-400"
              >
                <option value="LURE">루어 낚시</option>
                <option value="SURF">원투 낚시</option>
                <option value="FLOAT">찌 낚시</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-300 mb-1 font-medium text-xs">사용 채비 / 미끼</label>
              <input
                type="text"
                value={lureBait}
                onChange={(e) => setLureBait(e.target.value)}
                placeholder="지그헤드, 청갯지렁이, 크릴 등"
                className="w-full bg-slate-800/90 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-400"
              />
            </div>
          </div>

          {/* 당시 환경 자동 스냅샷 (Environment Snapshot) & 풍향 나침반 포함 */}
          <div className="p-3.5 bg-blue-950/40 border border-blue-800/60 rounded-xl space-y-3">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-blue-300 text-xs flex items-center gap-1.5">
                <Compass size={14} />
                <span>당시 해양·기상 환경 스냅샷 (통계 분석용)</span>
              </span>
              <button
                type="button"
                onClick={() =>
                  handleAutoSyncEnvironment(
                    catchDate,
                    catchTime,
                    catchLat || spotLat,
                    catchLng || spotLng
                  )
                }
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-blue-900/60 hover:bg-blue-800 text-[11px] text-blue-200 transition"
                title="입력된 날짜/시각/좌표로 환경 데이터 다시 가져오기"
              >
                <RefreshCw size={11} className={isSyncing ? 'animate-spin' : ''} />
                <span>환경 다시 동기화</span>
              </button>
            </div>

            {/* 풍향(Wind Direction) 화살표 선택기 (텍스트 없이 직관적 방향 화살표만 표출) */}
            <div className="p-2.5 rounded-lg bg-slate-900/90 border border-blue-900/50 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-slate-300 font-medium">당시 풍향</span>
                  <div
                    className="w-6 h-6 rounded-full bg-blue-600/30 border border-blue-400 flex items-center justify-center transition-transform duration-300"
                    style={{ transform: `rotate(${(windDirection + 180) % 360}deg)` }}
                  >
                    <ArrowUp size={14} className="text-cyan-300" />
                  </div>
                </div>
              </div>

              {/* 8방위 바람 진행 방향 화살표 선택 칩 */}
              <div className="grid grid-cols-8 gap-1 pt-0.5">
                {WIND_DIR_PRESETS.map((p) => {
                  const isSelected = getAngularDiff(windDirection, p.deg) <= 22.5;
                  return (
                    <button
                      key={p.deg}
                      type="button"
                      onClick={() => setWindDirection(p.deg)}
                      className={`py-1.5 rounded text-sm font-bold transition flex items-center justify-center ${
                        isSelected
                          ? 'bg-cyan-500 text-slate-950 ring-1 ring-cyan-300'
                          : 'bg-slate-800 text-cyan-300 hover:bg-slate-750'
                      }`}
                    >
                      {p.arrow}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <label className="text-slate-400 block mb-0.5">당시 물때</label>
                <input
                  type="text"
                  value={catchMul}
                  onChange={(e) => setCatchMul(e.target.value)}
                  className="w-full bg-slate-850 border border-slate-700 rounded p-1.5 text-white"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-0.5">당시 조석 상태</label>
                <input
                  type="text"
                  value={tideState}
                  onChange={(e) => setTideState(e.target.value)}
                  className="w-full bg-slate-850 border border-slate-700 rounded p-1.5 text-white"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-0.5">당시 표층 수온 (°C)</label>
                <input
                  type="number"
                  step="0.1"
                  value={waterTemp}
                  onChange={(e) => setWaterTemp(parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-850 border border-slate-700 rounded p-1.5 text-white"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-0.5">
                  당시 풍속 ({windUnit === 'knot' ? 'knot' : windUnit === 'kmh' ? 'km/h' : 'm/s'})
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={windSpeed}
                  onChange={(e) => setWindSpeed(parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-850 border border-slate-700 rounded p-1.5 text-white"
                />
              </div>
              <div className="col-span-2">
                <label className="text-slate-400 block mb-0.5">
                  당시 조류 속도 ({currentUnit === 'knot' ? 'knot' : currentUnit === 'cms' ? 'cm/s' : 'm/s'})
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="0.05"
                    value={simCurrentVel}
                    onChange={(e) => setSimCurrentVel(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-850 border border-slate-700 rounded p-1.5 text-white"
                  />
                  <span className="text-emerald-400 text-xs shrink-0 font-medium font-mono">
                    {formatCurrentVelocity(simCurrentVel, currentUnit)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 조과/현장 사진 & 촬영 메타데이터 */}
          <div className="p-3.5 bg-slate-800/40 border border-slate-700/60 rounded-xl space-y-2">
            <div className="flex justify-between items-center">
              <label className="font-semibold text-cyan-300 text-xs">
                📸 {isHitless ? '현장 풍경/발판 사진 (선택)' : '조과 인증 사진 (EXIF 자동인식)'}
              </label>
              {(isAnalyzing || isSyncing) && (
                <span className="text-xs text-cyan-400 animate-pulse font-bold">
                  {isAnalyzing ? 'EXIF 분석 중...' : '환경 데이터 동기화 중...'}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer transition shadow">
                <span>🖼️ 갤러리/카메라 선택</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
              </label>
              <label
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-emerald-500/50 text-emerald-300 text-xs font-semibold cursor-pointer transition"
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
            {exifNotice && (
              <div className="text-xs text-emerald-400 font-medium bg-emerald-950/60 p-2 rounded border border-emerald-800/60 leading-relaxed">
                {exifNotice}
              </div>
            )}
            {photoUrl && (
              <div className="flex items-center gap-2 mt-1">
                <div className="w-20 h-20 rounded-lg overflow-hidden border border-slate-700 shrink-0">
                  <img src={photoUrl} alt="Preview" className="w-full h-full object-cover" />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPhotoUrl('');
                    setExifNotice('');
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition active:scale-95 shadow"
                >
                  ✕ 사진 삭제
                </button>
              </div>
            )}
          </div>

          {/* 입질 패턴 & 메모 (최소 5줄 이상) */}
          <div>
            <label className="block text-slate-300 mb-1 font-medium text-xs">
              {isHitless ? '현장 상황 및 꽝 원인 분석 메모' : '히트 패턴 및 손맛 메모'}
            </label>
            <textarea
              rows={5}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder={
                isHitless
                  ? "예: 북서풍 8m/s로 너울 심함. 밑걸림 빈번하고 수온이 급락하여 바닥권 활성도 전무했음."
                  : "바닥을 긁는 도중 '툭' 하는 입질. 만조 1시간 전 와류에서 집중 발생."
              }
              className="w-full bg-slate-800/90 border border-slate-700 rounded-lg p-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400 text-xs min-h-[120px] leading-relaxed"
            />
          </div>

          {/* 하단 고정 액션 버튼 */}
          <div className="sticky bottom-0 bg-slate-900/95 backdrop-blur -mx-6 -mb-6 p-4 border-t border-slate-800 flex justify-end gap-3 z-10">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition"
            >
              취소
            </button>
            <button
              type="submit"
              className={`px-5 py-2.5 rounded-lg font-bold shadow-lg transition active:scale-95 ${
                isHitless
                  ? 'bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white shadow-rose-600/20'
                  : 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white shadow-emerald-500/20'
              }`}
            >
              {isHitless ? '❌ 꽝(노피시) 기록 등록' : (editingLog ? '조과 수정 완료' : '조과 등록 완료')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};