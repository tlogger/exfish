import React from 'react';
import {
  User as UserIcon,
  X,
  Check,
  Heart,
  Sparkles,
  Wind,
  Waves,
  Compass,
  ShieldCheck,
  LogOut,
  AlertCircle,
  Download,
} from 'lucide-react';
import { DEFAULT_POPULAR_SPECIES, SPECIES_ENCYCLOPEDIA } from '../utils/speciesDatabase';
import type { CurrentUnit, WindUnit } from '../types';
import { buildOAuthAuthorizeUrl, startSocialAuth, isUserAdmin, type AuthProvider } from '../services/oauthService';
import { APP_VERSION } from '../version';

export interface AuthUser {
  id: string; // 닉네임 또는 계정 ID
  email: string; // 사용자 이메일
  name: string; // 표시용 닉네임
  customNickname?: string; // 사용자가 직접 설정한 별칭
  profile_image?: string;
  provider?: 'naver' | 'kakao' | 'google' | 'email';
  isAdmin?: boolean; // 최고 관리자 권한 여부
  favoriteSpecies?: string[]; // 사용자가 설정한 관심 대상어 목록 (예: ['우럭', '광어'])
  windUnit?: WindUnit;
  currentUnit?: CurrentUnit;
  loggedInAt?: number;
  expiresAt?: number; // 30일간 유효
}

export interface UserPreferences {
  customNickname?: string;
  favoriteSpecies?: string[];
  windUnit?: WindUnit;
  currentUnit?: CurrentUnit;
}

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: AuthUser | null;
  onLogin: (user: AuthUser) => void;
  onLogout: () => void;
  onUpdateFavorites?: (favorites: string[]) => void;
  windUnit: WindUnit;
  currentUnit: CurrentUnit;
  onChangeWindUnit: (unit: WindUnit) => void;
  onChangeCurrentUnit: (unit: CurrentUnit) => void;
}

const STORAGE_KEY_AUTH_USER = 'exfish_auth_user_v2';
const LEGACY_STORAGE_KEY = 'espfish_auth_user';
const STORAGE_SAVED_CREDS = 'exfish_saved_login_credentials';
const COOKIE_LOGIN_EMAIL = 'exfish_saved_email';
const COOKIE_LOGIN_NICKNAME = 'exfish_saved_nickname';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** 쿠키 저장 헬퍼 (로그아웃 후에도 보전) */
export function setCookie(name: string, value: string, days: number = 365) {
  if (typeof document === 'undefined') return;
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

/** 쿠키 취득 헬퍼 */
export function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const matches = document.cookie.match(
    new RegExp('(?:^|; )' + encodeURIComponent(name).replace(/[\-\.\+\*]/g, '\\$&') + '=([^;]*)')
  );
  return matches ? decodeURIComponent(matches[1]) : null;
}

/** 이메일 & 닉네임 쿠키 및 로컬스토리지 영구 보전 */
export function saveRememberedCredentials(email: string, nickname: string) {
  try {
    if (email) setCookie(COOKIE_LOGIN_EMAIL, email, 365);
    if (nickname) setCookie(COOKIE_LOGIN_NICKNAME, nickname, 365);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_SAVED_CREDS, JSON.stringify({ email, nickname }));
    }
  } catch (e) {}
}

/** 보전된 이메일 & 닉네임 취득 */
export function getRememberedCredentials(): { email: string; nickname: string } {
  let email = getCookie(COOKIE_LOGIN_EMAIL) || '';
  let nickname = getCookie(COOKIE_LOGIN_NICKNAME) || '';
  if ((!email || !nickname) && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(STORAGE_SAVED_CREDS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (!email && parsed.email) email = parsed.email;
        if (!nickname && (parsed.nickname || parsed.name)) nickname = parsed.nickname || parsed.name;
      }
    } catch (e) {}
  }
  return { email, nickname };
}

export function saveUserPreferences(userId: string, email: string, prefs: UserPreferences): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const json = JSON.stringify(prefs);
    if (userId) localStorage.setItem(`exfish_user_prefs_${userId}`, json);
    if (email) localStorage.setItem(`exfish_user_prefs_${email.toLowerCase().trim()}`, json);
    if (prefs.customNickname) {
      saveRememberedCredentials(email, prefs.customNickname);
    }
    if (prefs.windUnit) localStorage.setItem('exfish_wind_unit', prefs.windUnit);
    if (prefs.currentUnit) localStorage.setItem('exfish_current_unit', prefs.currentUnit);
    if (prefs.favoriteSpecies) localStorage.setItem('exfish_favorite_species', JSON.stringify(prefs.favoriteSpecies));
  } catch (e) {
    console.warn('Failed to save user prefs:', e);
  }
}

export function getSavedUserPreferences(userId?: string, email?: string): UserPreferences | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    let raw: string | null = null;
    if (userId) raw = localStorage.getItem(`exfish_user_prefs_${userId}`);
    if (!raw && email) raw = localStorage.getItem(`exfish_user_prefs_${email.toLowerCase().trim()}`);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {}
  return null;
}

export function getSavedAuthUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_AUTH_USER) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const user: AuthUser = JSON.parse(raw);
    if (!user.name) {
      user.name = user.id;
    }
    if (user.email && isUserAdmin(user)) {
      user.isAdmin = true;
    }

    // 저장된 사용자 설정(별칭, 단위, 어종) 동기화
    const prefs = getSavedUserPreferences(user.id, user.email);
    if (prefs) {
      if (prefs.customNickname) user.name = prefs.customNickname;
      if (prefs.customNickname) user.customNickname = prefs.customNickname;
      if (prefs.favoriteSpecies) user.favoriteSpecies = prefs.favoriteSpecies;
      if (prefs.windUnit) user.windUnit = prefs.windUnit;
      if (prefs.currentUnit) user.currentUnit = prefs.currentUnit;
    }

    // 30일 세션 만료 검증
    if (user.expiresAt && Date.now() > user.expiresAt) {
      localStorage.removeItem(STORAGE_KEY_AUTH_USER);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      return null;
    }
    return user;
  } catch (e) {
    console.warn('Failed to parse auth user:', e);
  }
  return null;
}

export function saveAuthUser(user: AuthUser): void {
  try {
    if (!user.expiresAt) {
      user.expiresAt = Date.now() + THIRTY_DAYS_MS;
    }
    localStorage.setItem(STORAGE_KEY_AUTH_USER, JSON.stringify(user));
    // 이메일 및 닉네임 쿠키 영구 보전
    saveRememberedCredentials(user.email, user.name || user.id);
    saveUserPreferences(user.id, user.email, {
      customNickname: user.customNickname || user.name,
      favoriteSpecies: user.favoriteSpecies,
      windUnit: user.windUnit,
      currentUnit: user.currentUnit,
    });
  } catch (e) {
    console.error('Failed to save auth user:', e);
  }
}

export function clearAuthUser(): void {
  try {
    // 세션만 삭제하고, 이메일과 닉네임 쿠키/스토리지는 재로그인을 위해 보전
    localStorage.removeItem(STORAGE_KEY_AUTH_USER);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch (e) {
    console.error('Failed to remove auth user:', e);
  }
}

export const LoginModal: React.FC<LoginModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onLogin,
  onLogout,
  onUpdateFavorites,
  windUnit,
  currentUnit,
  onChangeWindUnit,
  onChangeCurrentUnit,
}) => {
  const [nickname, setNickname] = React.useState(() => currentUser?.customNickname || currentUser?.name || getRememberedCredentials().nickname);
  const [error, setError] = React.useState('');

  // 프로필 및 설정 상태
  const [selectedSpecies, setSelectedSpecies] = React.useState<string[]>(['우럭', '광어']);
  const [localWindUnit, setLocalWindUnit] = React.useState<WindUnit>(windUnit);
  const [localCurrentUnit, setLocalCurrentUnit] = React.useState<CurrentUnit>(currentUnit);

  React.useEffect(() => {
    if (isOpen) {
      setError('');
      if (currentUser) {
        setNickname(currentUser.customNickname || currentUser.name || '');
        setSelectedSpecies(
          currentUser.favoriteSpecies && currentUser.favoriteSpecies.length > 0
            ? currentUser.favoriteSpecies
            : ['우럭', '광어']
        );
        setLocalWindUnit(currentUser.windUnit || windUnit);
        setLocalCurrentUnit(currentUser.currentUnit || currentUnit);
      } else {
        const remembered = getRememberedCredentials();
        setNickname(remembered.nickname || '');
        setSelectedSpecies(['우럭', '광어']);
        setLocalWindUnit(windUnit);
        setLocalCurrentUnit(currentUnit);
      }
    }
  }, [isOpen, currentUser, windUnit, currentUnit]);

  if (!isOpen) return null;

  const handleToggleSpecies = (spName: string) => {
    if (selectedSpecies.includes(spName)) {
      if (selectedSpecies.length > 1) {
        setSelectedSpecies(selectedSpecies.filter((s) => s !== spName));
      } else {
        alert('최소 1개 이상의 관심 대상어를 선택해 주세요.');
      }
    } else {
      setSelectedSpecies([...selectedSpecies, spName]);
    }
  };

  const handleSocialAuth = async (provider: AuthProvider) => {
    setError('');
    const res = await startSocialAuth(provider);
    if (res.error) {
      setError(res.error);
    }
  };

  const handleSaveSettings = () => {
    if (!currentUser) return;
    const trimmedNick = nickname.trim() || currentUser.customNickname || currentUser.name || currentUser.id;
    const trimmedEmail = (currentUser.email || '').trim();

    const updated: AuthUser = {
      ...currentUser,
      id: currentUser.id, // 고유한 소셜 계정 ID 보존
      name: trimmedNick,
      customNickname: trimmedNick,
      email: trimmedEmail,
      isAdmin: isUserAdmin({ email: trimmedEmail, isAdmin: currentUser.isAdmin }),
      favoriteSpecies: selectedSpecies,
      windUnit: localWindUnit,
      currentUnit: localCurrentUnit,
    };
    saveAuthUser(updated);
    saveUserPreferences(currentUser.id, trimmedEmail, {
      customNickname: trimmedNick,
      favoriteSpecies: selectedSpecies,
      windUnit: localWindUnit,
      currentUnit: localCurrentUnit,
    });
    onChangeWindUnit(localWindUnit);
    onChangeCurrentUnit(localCurrentUnit);
    if (onUpdateFavorites) onUpdateFavorites(selectedSpecies);
    onLogin(updated);
    onClose();
  };

  const handleLogoutClick = () => {
    clearAuthUser();
    onLogout();
    onClose();
  };

  const expiryDateStr = currentUser?.expiresAt
    ? new Date(currentUser.expiresAt).toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-md shadow-2xl text-slate-100 flex flex-col max-h-[92vh] overflow-hidden my-4">
        {/* 모달 헤더 */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-950/70 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/20 text-cyan-400">
              <UserIcon size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                {currentUser ? '환경 설정' : '소셜 로그인'}
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg transition"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>

        {/* 본문 (스크롤) */}
        <div className="p-5 space-y-4 text-xs overflow-y-auto flex-1">
          {error && (
            <div className="p-3 rounded-xl bg-rose-950/70 border border-rose-500/50 text-rose-300 text-xs flex items-center gap-2 animate-in fade-in">
              <AlertCircle size={15} className="shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {currentUser ? (
            /* 로그인 완료 상태: 계정 정보 및 단위/어종 설정 */
            <div className="space-y-4">
              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    {currentUser.profile_image ? (
                      <img
                        src={currentUser.profile_image}
                        alt="Profile"
                        className="w-10 h-10 rounded-full object-cover border border-cyan-500/50 shadow"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-cyan-950 border border-cyan-500/40 text-cyan-300 flex items-center justify-center font-bold text-sm">
                        {(currentUser.name || currentUser.id).slice(0, 1)}
                      </div>
                    )}
                    <div>
                      <div className="font-bold text-white text-sm flex items-center gap-1.5 flex-wrap">
                        <span>{currentUser.name || currentUser.id}</span>
                        {isUserAdmin(currentUser) && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/60 font-bold flex items-center gap-0.5 shadow-sm">
                            👑 관리자
                          </span>
                        )}
                        {currentUser.provider === 'naver' && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/50 font-bold">네이버</span>
                        )}
                        {currentUser.provider === 'kakao' && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-950 text-amber-300 border border-amber-500/50 font-bold">카카오</span>
                        )}
                        {currentUser.provider === 'google' && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-950 text-blue-300 border border-blue-500/50 font-bold">Google</span>
                        )}
                      </div>
                      <span className="font-mono text-[11px] text-slate-400">{currentUser.email}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 닉네임 수정 */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  활동 닉네임 (포인트/조과 등록자명 수정)
                </label>
                <input
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="예: 영흥도감성돔"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                />
              </div>

              {/* 바람 및 조류 표시 단위 설정 */}
              <div className="p-3.5 bg-slate-950/80 border border-slate-800 rounded-xl space-y-3">
                <div className="font-bold text-cyan-300 flex items-center gap-1.5 text-xs">
                  <Compass size={14} className="text-cyan-400" />
                  <span>해양 기상 표시 단위 설정</span>
                </div>

                {/* 바람 단위 */}
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-slate-300">
                    <span className="flex items-center gap-1 text-[11px] text-slate-400">
                      <Wind size={12} className="text-amber-400" /> 바람 풍속 단위:
                    </span>
                    <span className="font-mono text-cyan-300 font-bold">{localWindUnit}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { id: 'ms', label: 'm/s' },
                      { id: 'knot', label: 'knot' },
                      { id: 'kmh', label: 'km/h' },
                    ].map((w) => (
                      <button
                        type="button"
                        key={w.id}
                        onClick={() => setLocalWindUnit(w.id as WindUnit)}
                        className={`py-1.5 px-2 rounded-lg border text-center text-xs font-medium transition ${
                          localWindUnit === w.id
                            ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 font-bold'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {w.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 조류 단위 */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex justify-between items-center text-slate-300">
                    <span className="flex items-center gap-1 text-[11px] text-slate-400">
                      <Waves size={12} className="text-blue-400" /> 조류 유속 단위:
                    </span>
                    <span className="font-mono text-cyan-300 font-bold">{localCurrentUnit}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { id: 'ms', label: 'm/s' },
                      { id: 'knot', label: 'knot' },
                      { id: 'cms', label: 'cm/s' },
                    ].map((c) => (
                      <button
                        type="button"
                        key={c.id}
                        onClick={() => setLocalCurrentUnit(c.id as CurrentUnit)}
                        className={`py-1.5 px-2 rounded-lg border text-center text-xs font-medium transition ${
                          localCurrentUnit === c.id
                            ? 'bg-blue-500/20 border-blue-400 text-blue-300 font-bold'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 관심 대상어종 선택 섹션 */}
              <div className="p-3.5 bg-slate-950/80 border border-cyan-500/30 rounded-xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-cyan-300 flex items-center gap-1.5 text-xs">
                    <Heart size={14} className="text-rose-400 fill-rose-400" />
                    <span>나의 관심 대상어종 (다중 선택)</span>
                  </span>
                  <span className="text-[11px] text-cyan-400 font-mono">
                    {selectedSpecies.length}종 선택됨
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-snug">
                  선택한 대상 어종에 따라 입질 지수 실시간 계산
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 pt-1 max-h-40 overflow-y-auto">
                  {DEFAULT_POPULAR_SPECIES.map((sp) => {
                    const isSelected = selectedSpecies.includes(sp);
                    const ecology = SPECIES_ENCYCLOPEDIA[sp];
                    const isTastiest = ecology?.tastiestMonths?.includes(new Date().getMonth() + 1);
                    return (
                      <button
                        type="button"
                        key={sp}
                        onClick={() => handleToggleSpecies(sp)}
                        className={`p-2 rounded-lg border text-left transition flex flex-col justify-between ${
                          isSelected
                            ? 'bg-cyan-950/80 border-cyan-400 text-white shadow-sm ring-1 ring-cyan-500/40'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between font-bold text-xs">
                          <span className="flex items-center gap-1">
                            {sp}
                            {isTastiest && (
                              <span className="text-[9px] px-1 py-0.2 rounded bg-amber-950 text-amber-300 border border-amber-500/40 font-bold" title="지금 제철 꿀맛">
                                🍽️제철
                              </span>
                            )}
                          </span>
                          {isSelected && <Check size={12} className="text-cyan-400" />}
                        </div>
                        <span className="text-[10px] text-slate-500 mt-0.5 truncate">
                          {ecology ? `${ecology.activityName.split(' ')[0]} · ${ecology.categoryName.split('(')[0]}` : ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 하단 버튼 그룹 */}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleSaveSettings}
                  className="flex-1 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold rounded-xl transition shadow flex items-center justify-center gap-1.5"
                >
                  <Sparkles size={14} />
                  <span>저장</span>
                </button>
                <button
                  type="button"
                  onClick={handleLogoutClick}
                  className="py-2.5 px-4 bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-200 font-bold rounded-xl transition flex items-center gap-1.5"
                >
                  <LogOut size={14} />
                  <span>로그아웃</span>
                </button>
              </div>
            </div>
          ) : (
            /* 미로그인 상태: 소셜 원클릭 로그인 */
            <div className="space-y-4">
              {/* 소셜 로그인 버튼 그룹 */}
              <div className="space-y-2.5">
                {/* 네이버 버튼 */}
                <button
                  type="button"
                  onClick={() => handleSocialAuth('naver')}
                  className="w-full py-2.5 px-4 bg-[#03C75A] hover:bg-[#02b350] text-white font-bold rounded-xl transition shadow flex items-center justify-center gap-2.5 cursor-pointer active:scale-98"
                >
                  <svg className="w-4 h-4 fill-white shrink-0" viewBox="0 0 24 24">
                    <path d="M16.273 12.845L7.37 0H0v24h7.727V11.155L16.63 24H24V0h-7.727v12.845z"/>
                  </svg>
                  <span>네이버로 시작하기</span>
                </button>

                {/* 카카오 버튼 */}
                <button
                  type="button"
                  onClick={() => handleSocialAuth('kakao')}
                  className="w-full py-2.5 px-4 bg-[#FEE500] hover:bg-[#ebd300] text-[#191919] font-bold rounded-xl transition shadow flex items-center justify-center gap-2.5 cursor-pointer active:scale-98"
                >
                  <svg className="w-4 h-4 fill-[#191919] shrink-0" viewBox="0 0 24 24">
                    <path d="M12 3c-4.97 0-9 3.185-9 7.115 0 2.557 1.708 4.8 4.27 6.054l-.87 3.23c-.08.3.18.57.46.45l3.87-2.54c.42.05.85.08 1.27.08 4.97 0 9-3.185 9-7.115C21 6.185 16.97 3 12 3z"/>
                  </svg>
                  <span>카카오로 시작하기</span>
                </button>

                {/* 구글 버튼 */}
                <button
                  type="button"
                  onClick={() => handleSocialAuth('google')}
                  className="w-full py-2.5 px-4 bg-white hover:bg-slate-100 text-slate-800 font-bold rounded-xl transition shadow flex items-center justify-center gap-2.5 border border-slate-300 cursor-pointer active:scale-98"
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.65v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.14z"/>
                    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/>
                    <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
                    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
                  </svg>
                  <span>Google 계정으로 시작하기</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 모바일 앱 최신 릴리즈 다운로드 및 버전 배지 */}
        <div className="px-5 py-2.5 bg-slate-950/90 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 shrink-0">
          <a
            href="./exfish.apk"
            download="exfish.apk"
            className="flex items-center gap-1.5 text-cyan-400 hover:text-cyan-300 font-bold transition py-1 px-2.5 rounded-lg bg-cyan-950/40 border border-cyan-500/30 hover:border-cyan-400 cursor-pointer"
            title="최신 ExFish Android APK 다운로드"
          >
            <Download size={13} />
            <span>최신 앱(.apk) 다운로드</span>
          </a>
          <span className="text-[11px] text-slate-500 font-mono">v{APP_VERSION}</span>
        </div>
      </div>
    </div>
  );
};
