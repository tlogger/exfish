import type { MapSecondaryLang } from '../types';

export function getGoogleMapsApiKey(): string {
  try {
    return String(import.meta.env?.VITE_GOOGLE_MAPS_API_KEY || '').trim();
  } catch {
    return '';
  }
}

export function hasGoogleMapsApiKey(): boolean {
  return getGoogleMapsApiKey().length > 0;
}

let loadPromise: Promise<any> | null = null;
let loadedLanguage: MapSecondaryLang | null = null;

/**
 * Google Maps JavaScript API v3 동적 싱글톤 로더
 * - VITE_GOOGLE_MAPS_API_KEY가 없으면 명확한 에러를 throw
 * - 공식 Maps JS API + Places(New) 라이브러리를 비동기 로드
 */
export function loadGoogleMapsApi(language: MapSecondaryLang = 'ko'): Promise<any> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Maps API는 브라우저 환경에서만 사용할 수 있습니다.'));
  }

  const key = getGoogleMapsApiKey();
  if (!key) {
    return Promise.reject(new Error('MISSING_GOOGLE_MAPS_API_KEY'));
  }

  const win = window as any;
  if (win.google?.maps?.Map && win.google?.maps?.OverlayView) {
    return Promise.resolve(win.google.maps);
  }

  if (loadPromise && loadedLanguage === language) {
    return loadPromise;
  }

  loadedLanguage = language;
  loadPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-exfish-google-maps="1"]'
    );

    const finalize = async () => {
      try {
        const gMaps = win.google?.maps;
        if (!gMaps) {
          throw new Error('Google Maps 객체를 초기화하지 못했습니다.');
        }
        if (typeof gMaps.importLibrary === 'function') {
          await gMaps.importLibrary('maps');
          await gMaps.importLibrary('places').catch(() => null);
        }
        if (!gMaps.Map || !gMaps.OverlayView) {
          throw new Error('Google Maps 핵심 라이브러리가 준비되지 않았습니다.');
        }
        resolve(gMaps);
      } catch (err) {
        loadPromise = null;
        reject(err);
      }
    };

    if (existingScript) {
      if (win.google?.maps?.Map) {
        finalize();
      } else {
        existingScript.addEventListener('load', () => finalize(), { once: true });
        existingScript.addEventListener(
          'error',
          () => {
            loadPromise = null;
            reject(new Error('Google Maps 스크립트 로드에 실패했습니다.'));
          },
          { once: true }
        );
      }
      return;
    }

    const script = document.createElement('script');
    script.dataset.exfishGoogleMaps = '1';
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      key
    )}&v=weekly&language=${encodeURIComponent(language)}&libraries=places&loading=async`;
    script.onload = () => finalize();
    script.onerror = () => {
      loadPromise = null;
      reject(new Error('Google Maps 스크립트 로드에 실패했습니다. 네트워크 또는 API 키를 확인하세요.'));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}
