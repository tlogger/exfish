import { isNativePlatform } from './nativeBridge';

export type ExFishDataMode = 'local' | 'cdn' | 'supabase';

const DEFAULT_PROD_API_BASE = 'https://exfish.vercel.app';

/**
 * 웹(동일 오리진 '') vs Capacitor Android(절대경로) API 베이스 URL 단일 소스
 */
export function getApiBaseUrl(): string {
  const envBase = (import.meta.env?.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
  if (envBase) return envBase;
  if (isNativePlatform()) return DEFAULT_PROD_API_BASE;
  return '';
}

/**
 * 데이터 계층 동작 모드:
 * - 'local': Supabase 클라이언트를 호출하지 않는 무-Supabase 개발/테스트 모드
 * - 'cdn' (기본): 공개 읽기는 Vercel Edge CDN(/api/exfish-master), 비공개 읽기는 /api/my-private-data
 * - 'supabase': 레거시 직접 조회 모드
 */
export function getDataMode(): ExFishDataMode {
  const raw = String(import.meta.env?.VITE_DATA_MODE || 'cdn').trim().toLowerCase();
  if (raw === 'local' || raw === 'cdn' || raw === 'supabase') {
    return raw;
  }
  return 'cdn';
}

export function isLocalDataMode(): boolean {
  return getDataMode() === 'local';
}
