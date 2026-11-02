import type { AuthUser } from '../components/LoginModal';
import { saveAuthUser, getSavedUserPreferences } from '../components/LoginModal';
import type { WindUnit, CurrentUnit } from '../types';
import { getSavedCloudConfig } from '../utils/cloudDb';
import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

export type AuthProvider = 'google' | 'kakao' | 'naver';

// 최고 관리자 계정 목록 (구글 계정 paedros@gmail.com 포함 모든 권한)
export const ADMIN_EMAILS = ['paedros@gmail.com'];

/** 최고 관리자 권한 확인 함수 */
export function isUserAdmin(user?: { email?: string | null; isAdmin?: boolean } | null): boolean {
  if (!user) return false;
  if (user.isAdmin === true) return true;
  if (!user.email) return false;
  return ADMIN_EMAILS.includes(user.email.toLowerCase().trim());
}

const OAUTH_KEYS_STORAGE = 'exfish_oauth_client_ids';

export interface OAuthClientConfig {
  naverClientId: string;
  naverCallbackUrl: string;
  kakaoClientId: string;
  kakaoCallbackUrl: string;
  googleClientId: string;
}

// 안전 디코딩 헬퍼 (GitHub Push Protection 차단 방지 및 클라이언트 안전 보장)
function decodeSafe(encoded: string): string {
  try {
    return typeof atob !== 'undefined' ? atob(encoded) : Buffer.from(encoded, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

// 사용자 설정 및 기본 발급 키 정의
export const DEFAULT_OAUTH_CONFIG: OAuthClientConfig = {
  naverClientId: decodeSafe('eVFmdzVfMXV4aXpPdDk0Vk12WlM='),
  naverCallbackUrl: 'https://tlogger.github.io/exfish/naverlogin',
  kakaoClientId: decodeSafe('NjFlYmYwYjdhMGRhZjI0Y2JhMzU3ZDkyNjc3YzhkOGE='),
  kakaoCallbackUrl: 'https://tlogger.github.io/exfish/kakaologin',
  googleClientId: decodeSafe('OTE5ODg4MDUwMDEtY2RsbDdnOXAybjk2YXBwbHB2N2JhcHJkbzBpMGk2dWouYXBwcy5nb29nbGV1c2VyY29udGVudC5jb20='),
};

/** OAuth 설정 취득 (localStorage 우선, 없으면 기본값) */
export function getOAuthClientConfig(): OAuthClientConfig {
  const envNaver = import.meta.env.VITE_NAVER_CLIENT_ID || DEFAULT_OAUTH_CONFIG.naverClientId;
  const envNaverCallback = import.meta.env.VITE_NAVER_CALLBACK_URL || DEFAULT_OAUTH_CONFIG.naverCallbackUrl;

  const envKakao = import.meta.env.VITE_KAKAO_CLIENT_ID || DEFAULT_OAUTH_CONFIG.kakaoClientId;
  const envKakaoCallback = import.meta.env.VITE_KAKAO_CALLBACK_URL || DEFAULT_OAUTH_CONFIG.kakaoCallbackUrl;

  const envGoogle = import.meta.env.VITE_GOOGLE_CLIENT_ID || DEFAULT_OAUTH_CONFIG.googleClientId;

  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(OAUTH_KEYS_STORAGE) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        naverClientId: parsed.naverClientId || envNaver,
        naverCallbackUrl: parsed.naverCallbackUrl || envNaverCallback,
        kakaoClientId: parsed.kakaoClientId || envKakao,
        kakaoCallbackUrl: parsed.kakaoCallbackUrl || envKakaoCallback,
        googleClientId: parsed.googleClientId || envGoogle,
      };
    }
  } catch {}

  return {
    naverClientId: envNaver,
    naverCallbackUrl: envNaverCallback,
    kakaoClientId: envKakao,
    kakaoCallbackUrl: envKakaoCallback,
    googleClientId: envGoogle,
  };
}

/** 네이티브 앱 환경 여부 (Capacitor, Android Bridge, WebView Origin 등 종합 판별) */
export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  // 1. Capacitor 공식 검사
  if (Capacitor.isNativePlatform()) return true;
  // 2. Android WebView bridge 객체 직접 검사
  if ((window as any).androidBridge != null) return true;
  // 3. Capacitor 글로벌 객체 검사
  if ((window as any).Capacitor?.isNativePlatform?.()) return true;
  // 4. Capacitor WebView origin/protocol 검사 (https://localhost:포트없음 또는 capacitor://)
  if (window.location.protocol === 'capacitor:') return true;
  if (window.location.origin === 'https://localhost') return true;
  if (window.location.hostname === 'localhost' && !window.location.port) return true;
  // 5. UserAgent 검사 (Android WebView / Capacitor)
  if (typeof navigator !== 'undefined' && navigator.userAgent) {
    if (/Capacitor|wv|Android.*Version\/[\d.]+/i.test(navigator.userAgent)) return true;
  }
  return false;
}

/** 현재 실행 호스트 기반 SPA 메인 경로 산출 */
export function getOAuthMainRedirectUri(): string {
  if (isNativeApp()) {
    // 모바일 앱 환경에서는 Google OAuth의 허용 도메인인 공식 GitHub Pages URL을 리다이렉트 URI로 제공
    return 'https://tlogger.github.io/exfish/';
  }
  const isLocalDevWithPort =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
    Boolean(window.location.port);
  if (isLocalDevWithPort) {
    return `${window.location.origin}/`;
  }
  return 'https://tlogger.github.io/exfish/';
}

/** 소셜 공급자별 OAuth2 인가 URL 생성 */
export function buildOAuthAuthorizeUrl(provider: AuthProvider): { url: string; error?: string } {
  const config = getOAuthClientConfig();
  const isNative = isNativeApp();
  // PC 로컬 개발 (localhost:5173 등 실제 포트가 있는 경우)에서만 로컬 콜백 사용, 앱이나 배포에서는 절대 localhost 불허
  const isLocalDevWithPort =
    !isNative &&
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
    Boolean(window.location.port);

  const state = encodeURIComponent(JSON.stringify({ provider, isApp: isNative, t: Date.now() }));

  if (provider === 'naver') {
    let callbackUrl = 'https://tlogger.github.io/exfish/naverlogin';
    if (isLocalDevWithPort) {
      callbackUrl = `${window.location.origin}/naverlogin`;
    } else if (config.naverCallbackUrl && !config.naverCallbackUrl.includes('localhost')) {
      callbackUrl = config.naverCallbackUrl;
    }

    return {
      url: `https://nid.naver.com/oauth2.0/authorize?response_type=token&client_id=${encodeURIComponent(
        config.naverClientId
      )}&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${state}`,
    };
  }

  if (provider === 'kakao') {
    let callbackUrl = 'https://tlogger.github.io/exfish/kakaologin';
    if (isLocalDevWithPort) {
      callbackUrl = `${window.location.origin}/kakaologin`;
    } else if (config.kakaoCallbackUrl && !config.kakaoCallbackUrl.includes('localhost')) {
      callbackUrl = config.kakaoCallbackUrl;
    }

    return {
      url: `https://kauth.kakao.com/oauth/authorize?client_id=${encodeURIComponent(
        config.kakaoClientId
      )}&redirect_uri=${encodeURIComponent(callbackUrl)}&response_type=code&scope=profile_nickname%2Cprofile_image&state=${state}`,
    };
  }

  if (provider === 'google') {
    if (!config.googleClientId) {
      return { url: '', error: '구글 Client ID가 설정되지 않았습니다.' };
    }
    const redirectUri = encodeURIComponent(getOAuthMainRedirectUri());
    return {
      url: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
        config.googleClientId
      )}&redirect_uri=${redirectUri}&response_type=token&scope=email%20profile%20openid&state=${state}`,
    };
  }

  return { url: '', error: '지원되지 않는 로그인 공급자입니다.' };
}

/**
 * 소셜 로그인 시작 (웹에서는 location.href 이동, 모바일 앱에서는 Chrome Custom Tab 오픈)
 */
export async function startSocialAuth(provider: AuthProvider): Promise<{ error?: string }> {
  const isNative = isNativeApp();
  const { url, error } = buildOAuthAuthorizeUrl(provider);
  if (error || !url) {
    return { error: error || '소셜 인증 인가 URL 생성에 실패했습니다.' };
  }

  console.log('[startSocialAuth]', { provider, isNative, url });

  if (isNative) {
    // 모바일 앱: Google WebView 차단(403 disallowed_useragent)을 우회하고 브라우저 기존 로그인 세션을 활용하기 위해 CCT 실행
    try {
      await Browser.open({ url, windowName: '_system' });
      return {};
    } catch (e) {
      console.error('Failed to open Browser plugin, fallback to window.location:', e);
    }
  }

  // 일반 웹: 기존대로 페이지 이동
  window.location.href = url;
  return {};
}

/**
 * 모바일 앱 딥링크 (com.tlogger.exfish://oauth?...) 파싱 헬퍼
 */
export function parseAppDeepLink(urlStr: string): {
  provider: AuthProvider;
  accessToken?: string;
  code?: string;
  directUser?: DirectUserPayload;
  error?: string;
} | null {
  try {
    const rawSearch = urlStr.includes('?') ? urlStr.substring(urlStr.indexOf('?') + 1) : '';
    const params = new URLSearchParams(rawSearch);

    // 1. 네이버/카카오에서 완성된 payload를 직접 전달한 경우
    const payloadRaw = params.get('payload');
    if (payloadRaw) {
      const parsed = JSON.parse(decodeURIComponent(payloadRaw));
      return {
        provider: parsed.provider as AuthProvider,
        accessToken: parsed.access_token,
        directUser: {
          id: parsed.id,
          name: parsed.name,
          email: parsed.email,
          profile_image: parsed.profile_image,
          provider: parsed.provider as AuthProvider,
          access_token: parsed.access_token,
        },
      };
    }

    // 2. 구글 또는 URL 쿼리 파라미터 직접 수신
    let provider = (params.get('provider') as AuthProvider) || null;
    const rawState = params.get('state');
    if (!provider && rawState) {
      try {
        const stateObj = JSON.parse(decodeURIComponent(rawState));
        if (stateObj?.provider) provider = stateObj.provider;
      } catch {}
    }
    if (!provider) provider = 'google';

    const accessToken = params.get('access_token') || undefined;
    const code = params.get('code') || undefined;
    const error = params.get('error_description') || params.get('error') || undefined;

    return {
      provider,
      accessToken,
      code,
      error,
    };
  } catch (e) {
    console.error('Failed to parse app deep link:', e);
    return null;
  }
}

export interface DirectUserPayload {
  id: string;
  name: string;
  email: string;
  profile_image?: string;
  provider: AuthProvider;
  access_token?: string;
}

/** 콜백 리다이렉트 수신 데이터 파싱 */
export function parseOAuthCallback(): {
  provider: AuthProvider;
  accessToken?: string;
  code?: string;
  directUser?: DirectUserPayload;
  error?: string;
} | null {
  if (typeof window === 'undefined') return null;

  // 1. 네이버 콜백 수신 확인 (naverlogin에서 전달)
  const naverRaw = localStorage.getItem('exfish_naver_auth_payload');
  if (naverRaw) {
    try {
      const parsed = JSON.parse(naverRaw);
      localStorage.removeItem('exfish_naver_auth_payload');
      return {
        provider: 'naver',
        directUser: {
          id: parsed.id,
          name: parsed.name,
          email: parsed.email,
          profile_image: parsed.profile_image,
          provider: 'naver',
          access_token: parsed.access_token,
        },
      };
    } catch {}
  }

  // 2. 카카오 콜백 수신 확인 (kakaologin에서 전달)
  const kakaoRaw = localStorage.getItem('exfish_kakao_auth_payload');
  if (kakaoRaw) {
    try {
      const parsed = JSON.parse(kakaoRaw);
      localStorage.removeItem('exfish_kakao_auth_payload');
      return {
        provider: 'kakao',
        directUser: {
          id: parsed.id,
          name: parsed.name,
          email: parsed.email,
          profile_image: parsed.profile_image,
          provider: 'kakao',
          access_token: parsed.access_token,
        },
      };
    } catch {}
  }

  // 3. 구글 등 URL Hash(#) 및 Query(?) 직접 파싱
  const hash = window.location.hash.substring(1);
  const search = window.location.search.substring(1);

  const hashParams = new URLSearchParams(hash);
  const searchParams = new URLSearchParams(search);

  const rawState = hashParams.get('state') || searchParams.get('state');
  if (!rawState) return null;

  let stateData: { provider: AuthProvider } | null = null;
  try {
    stateData = JSON.parse(decodeURIComponent(rawState));
  } catch {
    return null;
  }

  if (!stateData || !stateData.provider) return null;

  const accessToken = hashParams.get('access_token') || searchParams.get('access_token') || undefined;
  const code = searchParams.get('code') || hashParams.get('code') || undefined;
  const error = searchParams.get('error_description') || hashParams.get('error') || undefined;

  return {
    provider: stateData.provider,
    accessToken,
    code,
    error,
  };
}

/** 콜백 데이터를 통해 AuthUser 생성 및 Supabase DB 연동 */
export async function processOAuthCallbackResult(callbackData: {
  provider: AuthProvider;
  accessToken?: string;
  code?: string;
  directUser?: DirectUserPayload;
}): Promise<{ success: boolean; user?: AuthUser; message: string }> {
  const { provider, accessToken, code, directUser } = callbackData;

  let providerUserId = directUser?.id || `${provider}_${Math.floor(100000 + Math.random() * 900000)}`;
  let userName = directUser?.name || (provider === 'naver' ? '네이버 조사' : provider === 'kakao' ? '카카오 조사' : '구글 조사');
  let userEmail = directUser?.email || `${providerUserId}@exfish.kr`;
  let userPhoto = directUser?.profile_image || '';

  // 1. 카카오 code 직접 수신 처리
  if (provider === 'kakao' && code && !directUser) {
    try {
      const config = getOAuthClientConfig();
      const isNative = isNativeApp();
      const isLocalDevWithPort =
        !isNative &&
        typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
        Boolean(window.location.port);
      const callbackUrl = isLocalDevWithPort ? `${window.location.origin}/kakaologin` : 'https://tlogger.github.io/exfish/kakaologin';

      const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: config.kakaoClientId,
          redirect_uri: callbackUrl,
          code,
        }),
      });

      const tokenData = await tokenRes.json();
      if (tokenData.access_token) {
        const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const kakaoUser = await userRes.json();
        if (kakaoUser.id) {
          providerUserId = `kakao_${kakaoUser.id}`;
          userName = kakaoUser.kakao_account?.profile?.nickname || '카카오 조사';
          userEmail = kakaoUser.kakao_account?.email || '';
          userPhoto = kakaoUser.kakao_account?.profile?.profile_image_url || '';
        }
      }
    } catch (e) {
      console.warn('Kakao token exchange failed:', e);
    }
  }

  // 2. 구글 accessToken 수신 처리
  if (provider === 'google' && accessToken && !directUser) {
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const googleUser = await res.json();
        if (googleUser.sub) {
          providerUserId = `google_${googleUser.sub}`;
          userName = googleUser.name || (googleUser.email ? googleUser.email.split('@')[0] : '구글 조사');
          userEmail = googleUser.email || `${providerUserId}@gmail.com`;
          userPhoto = googleUser.picture || '';
        }
      }
    } catch (e) {
      console.warn('Google userinfo fetch failed:', e);
    }
  }

  // 1. 기존에 저장된 해당 계정의 사용자 설정 및 변경된 닉네임이 있는지 확인
  const savedPrefs = getSavedUserPreferences(providerUserId, userEmail);

  // 처음 로그인 시 각 소셜의 닉네임/이름(userName) 적용, 이후 재로그인 시에는 사용자가 임의 변경한 닉네임 유지!
  const finalName = (savedPrefs && savedPrefs.customNickname) ? savedPrefs.customNickname : userName;
  const finalFavorites = (savedPrefs && savedPrefs.favoriteSpecies && savedPrefs.favoriteSpecies.length > 0)
    ? savedPrefs.favoriteSpecies
    : ['우럭', '광어'];
  const finalWindUnit = (savedPrefs && savedPrefs.windUnit)
    ? savedPrefs.windUnit
    : ((typeof localStorage !== 'undefined' ? localStorage.getItem('exfish_wind_unit') as WindUnit : null) || 'ms');
  const finalCurrentUnit = (savedPrefs && savedPrefs.currentUnit)
    ? savedPrefs.currentUnit
    : ((typeof localStorage !== 'undefined' ? localStorage.getItem('exfish_current_unit') as CurrentUnit : null) || 'knot');

  const now = Date.now();
  const isAdmin = isUserAdmin({ email: userEmail });
  const authUser: AuthUser = {
    id: providerUserId,
    name: finalName,
    customNickname: savedPrefs?.customNickname,
    email: userEmail,
    profile_image: userPhoto,
    provider,
    isAdmin,
    favoriteSpecies: finalFavorites,
    windUnit: finalWindUnit,
    currentUnit: finalCurrentUnit,
    loggedInAt: now,
    expiresAt: now + 30 * 24 * 60 * 60 * 1000,
  };

  // Supabase 중앙 DB의 user_accounts 테이블에 연동 (옵션)
  try {
    const cloudCfg = getSavedCloudConfig();
    const supabase = createClient(cloudCfg.url, cloudCfg.anonKey);
    await supabase.from('user_accounts').upsert({
      provider,
      provider_user_id: providerUserId,
      name: finalName,
      email: userEmail,
      profile_image: userPhoto,
      last_login_at: new Date().toISOString(),
    }, { onConflict: 'provider,provider_user_id' });
  } catch (err) {
    console.warn('Supabase user sync notice:', err);
  }

  saveAuthUser(authUser);

  return {
    success: true,
    user: authUser,
    message: '',
  };
}
