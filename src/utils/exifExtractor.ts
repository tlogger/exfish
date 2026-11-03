import exifr from 'exifr';

export interface ExifExtractionResult {
  lat?: number;
  lng?: number;
  dateTime?: string; // YYYY-MM-DD HH:mm
  dateStr?: string; // YYYY-MM-DD
  timeStr?: string; // HH:mm
  rawOutput?: string;
}

declare global {
  interface Window {
    __LAST_NATIVE_EXIF__?: {
      lat?: number | null;
      lng?: number | null;
      rawDateTime?: string | null;
      ts?: number;
    } | null;
  }
}

/** 2자리 숫자 패딩 */
function padZero(num: number): string {
  return num < 10 ? `0${num}` : `${num}`;
}

/** 위경도 유효성 검사 (0,0 또는 범위 밖 제외) */
function isValidCoord(lat?: number | null, lng?: number | null): boolean {
  if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return false;
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/** 도분초(DMS) 배열 또는 문자열을 십진수(Decimal Degrees)로 변환 */
function parseCoordValue(val: unknown, ref?: unknown): number | undefined {
  if (val == null) return undefined;
  const refStr = typeof ref === 'string' ? ref.trim().toUpperCase() : '';
  const sign = refStr === 'S' || refStr === 'W' ? -1 : 1;

  if (typeof val === 'number' && !isNaN(val)) {
    return val * (val < 0 ? 1 : sign);
  }

  if (Array.isArray(val) && val.length >= 2) {
    const deg = Number(val[0]) || 0;
    const min = Number(val[1]) || 0;
    const sec = Number(val[2]) || 0;
    const dec = deg + min / 60 + sec / 3600;
    return isNaN(dec) ? undefined : dec * sign;
  }

  if (typeof val === 'string') {
    const s = val.trim();
    const trailingRef = s.slice(-1).toUpperCase();
    const localSign =
      trailingRef === 'S' || trailingRef === 'W'
        ? -1
        : trailingRef === 'N' || trailingRef === 'E'
          ? 1
          : sign;

    // XMP 형식 예: "37,17.565294N" 또는 "37,17,33.91N"
    const clean = s.replace(/[NSEWnsew]/g, '').trim();
    if (clean.includes(',')) {
      const parts = clean.split(',').map((p) => parseFloat(p.trim()));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return (parts[0] + parts[1] / 60) * localSign;
      }
      if (parts.length >= 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
        return (parts[0] + parts[1] / 60 + parts[2] / 3600) * localSign;
      }
    }

    // 도/분/초 기호 또는 공백 구분 형식 예: 37° 17' 33.91" N
    const nums = clean.match(/\d+(?:\.\d+)?/g);
    if (nums && nums.length >= 3) {
      const deg = parseFloat(nums[0]);
      const min = parseFloat(nums[1]);
      const sec = parseFloat(nums[2]);
      return (deg + min / 60 + sec / 3600) * localSign;
    }

    const direct = parseFloat(clean);
    if (!isNaN(direct)) {
      return direct * (direct < 0 ? 1 : localSign);
    }
  }

  return undefined;
}

/** 날짜 객체 또는 EXIF 날짜 문자열("YYYY:MM:DD HH:mm:ss") 파싱 */
function parseExifDate(rawDate: unknown, fallbackTime?: unknown): {
  dateStr?: string;
  timeStr?: string;
  dateTime?: string;
} {
  let dateStr: string | undefined;
  let timeStr: string | undefined;

  if (rawDate instanceof Date && !isNaN(rawDate.getTime())) {
    const year = rawDate.getFullYear();
    const month = padZero(rawDate.getMonth() + 1);
    const day = padZero(rawDate.getDate());
    const hour = padZero(rawDate.getHours());
    const minute = padZero(rawDate.getMinutes());
    dateStr = `${year}-${month}-${day}`;
    timeStr = `${hour}:${minute}`;
  } else if (typeof rawDate === 'string' && rawDate.trim()) {
    const clean = rawDate.trim().replace('T', ' ');
    const parts = clean.split(/\s+/);
    if (parts.length >= 1) {
      const dPart = parts[0].replace(/:/g, '-');
      if (/^\d{4}-\d{2}-\d{2}$/.test(dPart)) {
        dateStr = dPart;
      }
    }
    if (parts.length >= 2) {
      const tParts = parts[1].split(':');
      if (tParts.length >= 2) {
        const hh = padZero(parseInt(tParts[0], 10));
        const mm = padZero(parseInt(tParts[1], 10));
        if (!isNaN(parseInt(tParts[0], 10)) && !isNaN(parseInt(tParts[1], 10))) {
          timeStr = `${hh}:${mm}`;
        }
      }
    }
  }

  if (!timeStr && fallbackTime != null) {
    if (Array.isArray(fallbackTime) && fallbackTime.length >= 2) {
      const hh = padZero(Number(fallbackTime[0]) || 0);
      const mm = padZero(Number(fallbackTime[1]) || 0);
      timeStr = `${hh}:${mm}`;
    } else {
      const tStr = String(fallbackTime).trim();
      if (/^\d{2}:\d{2}/.test(tStr)) {
        timeStr = tStr.slice(0, 5);
      }
    }
  }

  const dateTime = dateStr && timeStr ? `${dateStr} ${timeStr}` : dateStr;
  return { dateStr, timeStr, dateTime };
}

/**
 * 바이너리 버퍼에서 직접 EXIF TIFF 헤더("Exif\0\0" 또는 순수 TIFF)와 XMP XML 블록을 전수 스캔하여
 * 비표준 위치에 삽입된 삼성 갤럭시/모션포토/편집본 EXIF GPS까지 추출합니다.
 */
function scanBinaryExifAndXmp(buffer: ArrayBuffer): {
  lat?: number;
  lng?: number;
  rawDate?: string;
} {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const maxScan = Math.min(bytes.length, 1024 * 1024); // 최대 앞쪽 1MB 스캔

  let foundLat: number | undefined;
  let foundLng: number | undefined;
  let foundDate: string | undefined;

  const parseTiffAt = (tiffStart: number) => {
    if (tiffStart + 8 > bytes.length) return;
    const byteOrder = view.getUint16(tiffStart, false);
    const littleEndian = byteOrder === 0x4949; // 'II'
    if (!littleEndian && byteOrder !== 0x4d4d) return; // 'MM'

    const magic = view.getUint16(tiffStart + 2, littleEndian);
    if (magic !== 0x002a) return;

    const readAscii = (offset: number, count: number): string => {
      if (offset < 0 || offset + count > bytes.length) return '';
      let s = '';
      for (let i = 0; i < count; i++) {
        const c = bytes[offset + i];
        if (c === 0) break;
        s += String.fromCharCode(c);
      }
      return s.trim();
    };

    const readRationalArray = (offset: number, count: number): number[] => {
      const arr: number[] = [];
      if (offset < 0 || offset + count * 8 > bytes.length) return arr;
      for (let i = 0; i < count; i++) {
        const num = view.getUint32(offset + i * 8, littleEndian);
        const den = view.getUint32(offset + i * 8 + 4, littleEndian);
        arr.push(den !== 0 ? num / den : 0);
      }
      return arr;
    };

    const parseIfd = (ifdOffset: number, isGpsIfd: boolean) => {
      if (ifdOffset <= 0 || tiffStart + ifdOffset + 2 > bytes.length) return;
      const entries = view.getUint16(tiffStart + ifdOffset, littleEndian);
      if (entries > 512) return;

      let latRef = 'N';
      let lngRef = 'E';
      let latVals: number[] | undefined;
      let lngVals: number[] | undefined;
      let gpsDate: string | undefined;

      for (let i = 0; i < entries; i++) {
        const entryOffset = tiffStart + ifdOffset + 2 + i * 12;
        if (entryOffset + 12 > bytes.length) break;

        const tag = view.getUint16(entryOffset, littleEndian);
        const type = view.getUint16(entryOffset + 2, littleEndian);
        const count = view.getUint32(entryOffset + 4, littleEndian);
        const valOffset = view.getUint32(entryOffset + 8, littleEndian);

        if (!isGpsIfd) {
          // DateTime (0x0132) or DateTimeOriginal (0x9003) or DateTimeDigitized (0x9004)
          if ((tag === 0x9003 || tag === 0x9004 || tag === 0x0132) && type === 2 && count >= 10) {
            const dt = readAscii(tiffStart + valOffset, Math.min(count, 32));
            if (dt && (!foundDate || tag === 0x9003)) {
              foundDate = dt;
            }
          }
          // Exif IFD Pointer (0x8769)
          if (tag === 0x8769) {
            parseIfd(valOffset, false);
          }
          // GPS IFD Pointer (0x8825)
          if (tag === 0x8825) {
            parseIfd(valOffset, true);
          }
        } else {
          // GPSLatitudeRef (0x0001)
          if (tag === 0x0001) {
            const ch = String.fromCharCode(bytes[entryOffset + 8]).toUpperCase();
            if (ch === 'S' || ch === 'N') latRef = ch;
          }
          // GPSLatitude (0x0002)
          else if (tag === 0x0002 && (type === 5 || type === 10) && count === 3) {
            latVals = readRationalArray(tiffStart + valOffset, 3);
          }
          // GPSLongitudeRef (0x0003)
          else if (tag === 0x0003) {
            const ch = String.fromCharCode(bytes[entryOffset + 8]).toUpperCase();
            if (ch === 'W' || ch === 'E') lngRef = ch;
          }
          // GPSLongitude (0x0004)
          else if (tag === 0x0004 && (type === 5 || type === 10) && count === 3) {
            lngVals = readRationalArray(tiffStart + valOffset, 3);
          }
          // GPSDateStamp (0x001D)
          else if (tag === 0x001d && type === 2 && count >= 10) {
            gpsDate = readAscii(tiffStart + valOffset, Math.min(count, 16));
          }
        }
      }

      if (isGpsIfd && latVals && lngVals) {
        const parsedLat = parseCoordValue(latVals, latRef);
        const parsedLng = parseCoordValue(lngVals, lngRef);
        if (isValidCoord(parsedLat, parsedLng)) {
          foundLat = parsedLat;
          foundLng = parsedLng;
        }
        if (!foundDate && gpsDate) {
          foundDate = gpsDate;
        }
      }
    };

    const firstIfdOffset = view.getUint32(tiffStart + 4, littleEndian);
    parseIfd(firstIfdOffset, false);
  };

  // 1) 파일 자체가 TIFF 헤더로 시작하는 경우
  if (bytes.length > 8) {
    parseTiffAt(0);
  }

  // 2) 버퍼 전체에서 "Exif\0\0" (0x45 0x78 0x69 0x66 0x00 0x00) 시그니처 전수 탐색
  for (let i = 0; i < maxScan - 14; i++) {
    if (
      bytes[i] === 0x45 && // 'E'
      bytes[i + 1] === 0x78 && // 'x'
      bytes[i + 2] === 0x69 && // 'i'
      bytes[i + 3] === 0x66 && // 'f'
      bytes[i + 4] === 0x00 &&
      bytes[i + 5] === 0x00
    ) {
      parseTiffAt(i + 6);
      if (isValidCoord(foundLat, foundLng)) break;
    }
  }

  // 3) XMP 메타데이터 문자열 스캔 (<exif:GPSLatitude> 또는 exif:GPSLatitude="...")
  if (!isValidCoord(foundLat, foundLng)) {
    try {
      const decoder = new TextDecoder('utf-8', { fatal: false });
      const textChunk = decoder.decode(bytes.subarray(0, Math.min(bytes.length, 256 * 1024)));
      const latMatch =
        textChunk.match(/exif:GPSLatitude=["']([^"']+)["']/i) ||
        textChunk.match(/<exif:GPSLatitude>([^<]+)<\/exif:GPSLatitude>/i);
      const lngMatch =
        textChunk.match(/exif:GPSLongitude=["']([^"']+)["']/i) ||
        textChunk.match(/<exif:GPSLongitude>([^<]+)<\/exif:GPSLongitude>/i);
      if (latMatch && lngMatch) {
        const xLat = parseCoordValue(latMatch[1]);
        const xLng = parseCoordValue(lngMatch[1]);
        if (isValidCoord(xLat, xLng)) {
          foundLat = xLat;
          foundLng = xLng;
        }
      }
      if (!foundDate) {
        const dtMatch =
          textChunk.match(/exif:DateTimeOriginal=["']([^"']+)["']/i) ||
          textChunk.match(/<exif:DateTimeOriginal>([^<]+)<\/exif:DateTimeOriginal>/i) ||
          textChunk.match(/xmp:CreateDate=["']([^"']+)["']/i);
        if (dtMatch) {
          foundDate = dtMatch[1];
        }
      }
    } catch {
      // ignore text decode errors
    }
  }

  return { lat: foundLat, lng: foundLng, rawDate: foundDate };
}

/**
 * 사진 파일에서 EXIF GPS 위경도 및 촬영 일시 추출
 * - 1단계: ArrayBuffer 선점 로드 및 exifr (GPS 전용 + 전체 XMP/EXIF/TIFF 통합 파싱)
 * - 2단계: 커스텀 바이너리 TIFF/EXIF 시그니처 전수 스캐너 & XMP 정규식 파서
 * - 3단계: Android 네이티브 브릿지(MediaStore.setRequireOriginal + ExifInterface) 폴백
 */
export async function extractExifFromImage(file: File): Promise<ExifExtractionResult> {
  let lat: number | undefined;
  let lng: number | undefined;
  let dateStr: string | undefined;
  let timeStr: string | undefined;
  let dateTime: string | undefined;
  let rawOutputStr: string | undefined;

  try {
    // 스트림 잠김 방지를 위해 즉시 ArrayBuffer로 전체 메모리에 적재
    const buffer = await file.arrayBuffer();

    // [1단계-A] exifr.gps 고속 전용 파서 시도
    try {
      const gpsOnly = await exifr.gps(buffer);
      if (gpsOnly && isValidCoord(gpsOnly.latitude, gpsOnly.longitude)) {
        lat = Math.round(Number(gpsOnly.latitude) * 1000000) / 1000000;
        lng = Math.round(Number(gpsOnly.longitude) * 1000000) / 1000000;
      }
    } catch {
      // exifr.gps 실패 시 전체 파서로 진행
    }

    // [1단계-B] exifr.parse 전체 파서 (XMP 포함, 불필요한 ICC/JFIF 제외로 안정성 향상)
    try {
      const output = await exifr.parse(buffer, {
        gps: true,
        tiff: true,
        exif: true,
        xmp: true,
        icc: false,
        jfif: false,
        ihdr: false,
        translateValues: true,
        reviveValues: true,
        mergeOutput: true,
      });

      if (output) {
        rawOutputStr = JSON.stringify(output);
        if (!isValidCoord(lat, lng)) {
          const candLat =
            output.latitude != null
              ? Number(output.latitude)
              : parseCoordValue(output.GPSLatitude, output.GPSLatitudeRef);
          const candLng =
            output.longitude != null
              ? Number(output.longitude)
              : parseCoordValue(output.GPSLongitude, output.GPSLongitudeRef);

          if (isValidCoord(candLat, candLng)) {
            lat = Math.round(candLat! * 1000000) / 1000000;
            lng = Math.round(candLng! * 1000000) / 1000000;
          }
        }

        const rawDate =
          output.DateTimeOriginal ||
          output.CreateDate ||
          output.ModifyDate ||
          output.GPSDateStamp;
        const parsedDt = parseExifDate(rawDate, output.GPSTimeStamp);
        dateStr = parsedDt.dateStr;
        timeStr = parsedDt.timeStr;
        dateTime = parsedDt.dateTime;
      }
    } catch (parseErr) {
      console.warn('exifr.parse fallback triggered:', parseErr);
    }

    // [2단계] 바이너리 EXIF/TIFF/XMP 직접 스캔 (비표준 헤더 오프셋 및 삼성 모션포토 대응)
    if (!isValidCoord(lat, lng) || !dateStr) {
      const binRes = scanBinaryExifAndXmp(buffer);
      if (!isValidCoord(lat, lng) && isValidCoord(binRes.lat, binRes.lng)) {
        lat = Math.round(binRes.lat! * 1000000) / 1000000;
        lng = Math.round(binRes.lng! * 1000000) / 1000000;
      }
      if (!dateStr && binRes.rawDate) {
        const parsedDt = parseExifDate(binRes.rawDate);
        dateStr = parsedDt.dateStr;
        timeStr = parsedDt.timeStr || timeStr;
        dateTime = parsedDt.dateTime || dateTime;
      }
    }
  } catch (err) {
    console.warn('extractExifFromImage buffer error:', err);
  }

  // [3단계] Android 네이티브 ExifInterface 브릿지 폴백 (Android 포토피커가 WebView 스트림의 EXIF를 제거한 경우)
  if (typeof window !== 'undefined' && window.__LAST_NATIVE_EXIF__) {
    const nativeExif = window.__LAST_NATIVE_EXIF__;
    // 60초 이내에 네이티브에서 추출된 EXIF가 있으면 결합 후 초기화
    if (!nativeExif.ts || Date.now() - nativeExif.ts < 60000) {
      if (!isValidCoord(lat, lng) && isValidCoord(nativeExif.lat, nativeExif.lng)) {
        lat = Math.round(Number(nativeExif.lat) * 1000000) / 1000000;
        lng = Math.round(Number(nativeExif.lng) * 1000000) / 1000000;
      }
      if (!dateStr && nativeExif.rawDateTime) {
        const parsedDt = parseExifDate(nativeExif.rawDateTime);
        dateStr = parsedDt.dateStr;
        timeStr = parsedDt.timeStr || timeStr;
        dateTime = parsedDt.dateTime || dateTime;
      }
    }
    window.__LAST_NATIVE_EXIF__ = null;
  }

  return {
    lat,
    lng,
    dateStr,
    timeStr,
    dateTime,
    rawOutput: rawOutputStr,
  };
}

/**
 * 사진 파일을 HTML5 Canvas를 활용하여 지정된 최대 해상도(기본 1200px)와 압축 품질(기본 0.75)의 Base64 Data URL로 인코딩합니다.
 * 이를 통해 blob: URL 세션 소실 문제를 완벽히 해결하고, DB 및 로컬 스토리지에 안정적으로 영구 보전합니다.
 */
export async function compressImageFile(file: File, maxDim = 1200, quality = 0.75): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const resultStr = e.target?.result as string;
      if (!resultStr) {
        resolve('');
        return;
      }
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(resultStr);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => {
        resolve(resultStr);
      };
      img.src = resultStr;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
