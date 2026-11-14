import React from 'react';
import { Check, Cloud, Copy, Database, HelpCircle, Loader2, RefreshCw, Smartphone, Trash2, X } from 'lucide-react';
import {
  clearCloudConfig,
  DEFAULT_SUPABASE_KEY,
  DEFAULT_SUPABASE_URL,
  generateMobilePairingUrl,
  getSavedCloudConfig,
  saveCloudConfig,
  testCloudConnection,
  uploadLocalToCloud,
} from '../utils/cloudDb';
import type { CatchLog, FishingSpot } from '../types';

interface CloudSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  localSpots: FishingSpot[];
  localLogs: CatchLog[];
  onSyncComplete: () => void;
}

const SUPABASE_SCHEMA_SQL = `-- 1. 낚시 포인트 테이블 생성
CREATE TABLE IF NOT EXISTS fishing_spots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'user-me',
  author_name TEXT NOT NULL,
  is_public BOOLEAN NOT NULL DEFAULT true,
  name TEXT NOT NULL,
  spot_type TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  navi_name TEXT,
  navi_url TEXT,
  directions TEXT,
  photo_urls TEXT[] DEFAULT '{}',
  fishing_methods TEXT[] DEFAULT '{}',
  target_species TEXT[] DEFAULT '{}',
  best_tides TEXT[] DEFAULT '{}',
  best_times TEXT[] DEFAULT '{}',
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. 조과 기록 테이블 생성
CREATE TABLE IF NOT EXISTS catch_logs (
  id TEXT PRIMARY KEY,
  spot_id TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT 'user-me',
  user_name TEXT NOT NULL,
  catch_date TEXT NOT NULL,
  catch_time TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  fish_species TEXT NOT NULL,
  fish_size_cm DOUBLE PRECISION,
  fish_count INTEGER NOT NULL DEFAULT 1,
  catch_method TEXT NOT NULL,
  lure_bait TEXT,
  catch_mul TEXT NOT NULL,
  tide_state TEXT NOT NULL,
  water_temp DOUBLE PRECISION NOT NULL,
  wind_speed DOUBLE PRECISION NOT NULL,
  wind_direction DOUBLE PRECISION,
  photo_url TEXT,
  memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. 익명 및 공개 읽기/쓰기 RLS 정책 활성화 (무료 Supabase 클라이언트 직접 연동)
ALTER TABLE fishing_spots ENABLE ROW LEVEL SECURITY;
ALTER TABLE catch_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public all on fishing_spots" ON fishing_spots FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public all on catch_logs" ON catch_logs FOR ALL USING (true) WITH CHECK (true);

-- 4. 실시간 Realtime 변경 감지 활성화
ALTER PUBLICATION supabase_realtime ADD TABLE fishing_spots, catch_logs;`;

export const CloudSyncModal: React.FC<CloudSyncModalProps> = ({
  isOpen,
  onClose,
  localSpots,
  localLogs,
  onSyncComplete,
}) => {
  const [url, setUrl] = React.useState(DEFAULT_SUPABASE_URL);
  const [anonKey, setAnonKey] = React.useState(DEFAULT_SUPABASE_KEY);
  const [isConnected, setIsConnected] = React.useState(true);
  const [isLoading, setIsLoading] = React.useState(false);
  const [message, setMessage] = React.useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [showSql, setShowSql] = React.useState(true);
  const [copiedSql, setCopiedSql] = React.useState(false);
  const [copiedMobileLink, setCopiedMobileLink] = React.useState(false);

  React.useEffect(() => {
    if (isOpen) {
      const config = getSavedCloudConfig();
      if (config) {
        setUrl(config.url);
        setAnonKey(config.anonKey);
        setIsConnected(true);
      } else {
        setUrl(DEFAULT_SUPABASE_URL);
        setAnonKey(DEFAULT_SUPABASE_KEY);
        setIsConnected(true);
      }
      setMessage(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // 연결 테스트 및 저장
  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || !anonKey.trim()) {
      setMessage({ text: 'Project URL과 anon public key를 모두 입력해 주세요.', type: 'error' });
      return;
    }

    setIsLoading(true);
    setMessage(null);

    const ok = await testCloudConnection(url, anonKey);
    setIsLoading(false);

    if (ok) {
      saveCloudConfig(url, anonKey);
      setIsConnected(true);
      setMessage({
        text: '클라우드 DB에 성공적으로 연결되었습니다! 이제 PC와 모바일이 실시간 동기화됩니다.',
        type: 'success',
      });
      onSyncComplete();
    } else {
      setMessage({
        text: '연결 실패: URL 또는 anon key를 확인해 주세요. (아래 SQL 스크립트로 테이블을 먼저 생성했는지 확인하세요)',
        type: 'error',
      });
    }
  };

  // 로컬 데이터를 클라우드로 즉시 업로드
  const handleUploadLocal = async () => {
    setIsLoading(true);
    setMessage(null);
    try {
      const result = await uploadLocalToCloud(localSpots, localLogs);
      setMessage({
        text: `성공! 로컬 포인트 ${result.spotsCount}개와 조과 기록 ${result.logsCount}개가 클라우드로 업로드되었습니다.`,
        type: 'success',
      });
      onSyncComplete();
    } catch (err: any) {
      setMessage({
        text: `업로드 실패: ${err.message || '테이블이 생성되었는지 확인해 주세요.'}`,
        type: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  };

  // 연결 해제
  const handleDisconnect = () => {
    if (window.confirm('클라우드 DB 연동을 해제하고 로컬 모드로 전환하시겠습니까? (로컬 데이터는 유지됩니다)')) {
      clearCloudConfig();
      setUrl('');
      setAnonKey('');
      setIsConnected(false);
      setMessage({ text: '클라우드 연동이 해제되었습니다. 로컬 브라우저 모드로 동작합니다.', type: 'info' });
      onSyncComplete();
    }
  };

  // SQL 복사
  const handleCopySql = () => {
    navigator.clipboard.writeText(SUPABASE_SCHEMA_SQL);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2500);
  };

  // 모바일 페어링 URL 복사
  const handleCopyMobileLink = () => {
    const link = generateMobilePairingUrl();
    if (link) {
      navigator.clipboard.writeText(link);
      setCopiedMobileLink(true);
      setTimeout(() => setCopiedMobileLink(false), 2500);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-lg shadow-2xl text-slate-100 flex flex-col max-h-[90vh] overflow-hidden">
        {/* 모달 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/20 text-cyan-400">
              <Cloud size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>클라우드 DB 동기화 (PC ⇄ 모바일)</span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                    isConnected
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                  }`}
                >
                  {isConnected ? '● 전용 Supabase 연결됨' : '● 기본 클라우드 동기화 활성'}
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                기본 무료 클라우드로 자동 동기화되며, 전용 Supabase Project URL을 입력하면 실시간 DB로 전환됩니다.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white rounded-lg transition">
            <X size={18} />
          </button>
        </div>

        {/* 모달 본문 */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {message && (
            <div
              className={`p-3 rounded-xl border text-xs leading-relaxed ${
                message.type === 'success'
                  ? 'bg-emerald-950/60 border-emerald-800 text-emerald-200'
                  : message.type === 'error'
                  ? 'bg-rose-950/60 border-rose-800 text-rose-200'
                  : 'bg-blue-950/60 border-blue-800 text-blue-200'
              }`}
            >
              {message.text}
            </div>
          )}

          {/* 간편 안내 박스 */}
          <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl space-y-1.5 text-slate-300">
            <div className="font-bold text-cyan-300 flex items-center gap-1.5">
              <HelpCircle size={14} /> 전용 Supabase 연동 마무리 안내 (Publishable Key 입력 완료됨):
            </div>
            <ol className="list-decimal list-inside space-y-1 text-slate-400 pl-1">
              <li>
                현재 내장 클라우드 스토어를 통해 <strong>PC ⇄ 모바일 새로고침 시 포인트 및 조과가 즉시 동기화</strong>됩니다.
              </li>
              <li>
                전용 Supabase(<code>tlogger&apos;s Project</code>)의 좌측 메뉴 <strong>SQL Editor</strong>에서{' '}
                <button
                  type="button"
                  onClick={() => setShowSql(!showSql)}
                  className="text-cyan-400 underline font-semibold"
                >
                  [테이블 생성 SQL 보기/복사]
                </button>
                하여 Run 실행
              </li>
              <li>
                좌측 메뉴 <strong>Project Settings &gt; Data API</strong>에서 <code>Project URL</code> (예: <code>https://xxxx.supabase.co</code>)을 복사하여 아래에 입력
              </li>
            </ol>
          </div>

          {/* SQL 스크립트 접기/펼치기 */}
          {showSql && (
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
              <div className="flex justify-between items-center">
                <span className="font-bold text-slate-200">Supabase SQL Editor 실행 스크립트</span>
                <button
                  onClick={handleCopySql}
                  className="flex items-center gap-1 px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-[11px] font-bold transition"
                >
                  {copiedSql ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copiedSql ? '복사 완료!' : 'SQL 전체 복사'}</span>
                </button>
              </div>
              <pre className="p-2.5 bg-slate-900 rounded font-mono text-[10px] text-slate-300 overflow-x-auto max-h-40 border border-slate-800">
                {SUPABASE_SCHEMA_SQL}
              </pre>
            </div>
          )}

          {/* 설정 입력 폼 */}
          <form onSubmit={handleConnect} className="space-y-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Supabase Project URL
              </label>
              <input
                type="url"
                placeholder="https://your-project-id.supabase.co"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-400 font-mono"
                required
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Supabase Publishable / Anon Key (기본 세팅됨)
              </label>
              <input
                type="text"
                placeholder="sb_publishable_..."
                value={anonKey}
                onChange={(e) => setAnonKey(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-400 font-mono"
                required
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={isLoading}
                className="flex-1 py-2.5 px-4 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold rounded-lg transition flex items-center justify-center gap-1.5 shadow-md shadow-cyan-600/20"
              >
                {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
                <span>{isConnected ? '설정 재연결 및 검증' : '전용 Supabase DB 연결하기'}</span>
              </button>

              {isConnected && (
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="px-3 py-2.5 bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-300 rounded-lg transition"
                  title="전용 Supabase 연동 해제"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </form>

          {/* 원클릭 동기화 및 모바일 페어링 기능 */}
          <div className="pt-3 border-t border-slate-800 space-y-2.5">
            {isConnected && (
              <>
                <div className="flex justify-between items-center">
                  <span className="font-bold text-slate-200">📱 모바일 기기와 1초 연동:</span>
                  <button
                    onClick={handleCopyMobileLink}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded text-[11px] font-semibold border border-slate-700 transition"
                  >
                    {copiedMobileLink ? <Check size={12} className="text-emerald-400" /> : <Smartphone size={12} />}
                    <span>{copiedMobileLink ? '연동 링크 복사 완료!' : '모바일 자동 연동 링크 복사'}</span>
                  </button>
                </div>
                <p className="text-[11px] text-slate-400">
                  복사된 링크를 카카오톡이나 메시지로 스마트폰에 보내 열면, 별도 입력 없이 모바일 기기에서도 동일한 전용 DB로 즉시 연동됩니다.
                </p>
              </>
            )}

            <div className="pt-1 flex justify-between items-center">
              <span className="text-slate-400">
                현재 기기 포인트: <strong>{localSpots.length}개</strong>, 조과: <strong>{localLogs.length}건</strong>
              </span>
              <button
                type="button"
                onClick={handleUploadLocal}
                disabled={isLoading}
                className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded text-xs transition shadow"
              >
                <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
                <span>현재 기기 데이터 클라우드로 즉시 동기화</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
