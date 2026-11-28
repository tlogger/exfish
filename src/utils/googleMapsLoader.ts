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
let prewarmScheduled = false;

export function resetGoogleMapsLoader(): void {
  loadPromise = null;
  loadedLanguage = null;
}

async function waitForGoogleMapsNamespace(timeoutMs = 5000): Promise<any> {
  const win = window as any;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (win.google?.maps && (typeof win.google.maps.importLibrary === 'function' || win.google.maps.Map)) {
      return win.google.maps;
    }
    await new Promise((r) => setTimeout(r, 80));
  }
  return win.google?.maps || null;
}

async function resolveUnifiedGoogleMaps(): Promise<any> {
  const gMaps = await waitForGoogleMapsNamespace(5000);
  if (!gMaps) {
    throw new Error('Google Maps 객체를 초기화하지 못했습니다.');
  }

  let mapsLib: any = {};
  let coreLib: any = {};

  if (typeof gMaps.importLibrary === 'function') {
    const [mLib, cLib] = await Promise.all([
      gMaps.importLibrary('maps').catch(() => ({})),
      gMaps.importLibrary('core').catch(() => ({})),
      gMaps.importLibrary('places').catch(() => null),
    ]);
    mapsLib = mLib || {};
    coreLib = cLib || {};
  }

  const MapCtor = mapsLib.Map || gMaps.Map;
  const OverlayViewCtor = mapsLib.OverlayView || gMaps.OverlayView;

  if (!MapCtor || !OverlayViewCtor) {
    throw new Error('Google Maps 핵심 라이브러리가 준비되지 않았습니다.');
  }

  return {
    ...gMaps,
    ...coreLib,
    ...mapsLib,
    Map: MapCtor,
    OverlayView: OverlayViewCtor,
    ImageMapType: mapsLib.ImageMapType || gMaps.ImageMapType,
    LatLng: coreLib.LatLng || gMaps.LatLng,
    LatLngBounds: coreLib.LatLngBounds || gMaps.LatLngBounds,
    Size: coreLib.Size || gMaps.Size,
    Point: coreLib.Point || gMaps.Point,
    event: coreLib.event || gMaps.event,
    importLibrary: gMaps.importLibrary,
  };
}

/**
 * Google Maps JavaScript API v3 동적 싱글톤 로더
 * - loading=async 모드에서 importLibrary('maps') / importLibrary('core') 반환 객체를 병합해
 *   Map, OverlayView 등이 누락되는 비동기 레이스 컨디션을 원천 차단합니다.
 */
export function loadGoogleMapsApi(language: MapSecondaryLang = 'ko'): Promise<any> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Maps API는 브라우저 환경에서만 사용할 수 있습니다.'));
  }

  const key = getGoogleMapsApiKey();
  if (!key) {
    return Promise.reject(new Error('MISSING_GOOGLE_MAPS_API_KEY'));
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
        const unified = await resolveUnifiedGoogleMaps();
        resolve(unified);
      } catch (err) {
        loadPromise = null;
        reject(err);
      }
    };

    if (existingScript) {
      const win = window as any;
      if (win.google?.maps) {
        finalize();
      } else {
        existingScript.addEventListener('load', () => finalize(), { once: true });
        existingScript.addEventListener(
          'error',
          () => {
            loadPromise = null;
            existingScript.remove();
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
      script.remove();
      reject(new Error('Google Maps 스크립트 로드에 실패했습니다. 네트워크 또는 API 키를 확인하세요.'));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}

/**
 * 유휴 시점에 Google Maps JS API를 백그라운드 사전 예열(Pre-warm)
 */
export function prewarmGoogleMapsApi(language: MapSecondaryLang = 'ko'): void {
  if (typeof window === 'undefined' || prewarmScheduled || !hasGoogleMapsApiKey()) return;
  prewarmScheduled = true;

  const run = () => {
    loadGoogleMapsApi(language).catch(() => {
      // 사전 예열 실패는 무시 (실제 선택 시 재시도)
    });
  };

  const ric = (window as any).requestIdleCallback;
  if (typeof ric === 'function') {
    ric(run, { timeout: 3000 });
  } else {
    window.setTimeout(run, 2000);
  }
}
