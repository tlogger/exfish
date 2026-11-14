/**
 * 국립해양조사원(KHOA) 스마트조석예보 공식 모바일 시스템(https://www.khoa.go.kr/swtc/mobile.do) 연동 모듈
 * getWeeklyData.do 엔드포인트를 통해 7일간의 공식 고조/저조 극점, 수위, 음력, 물때 명칭을 단 1회 호출로 전수 수신
 */

import { getOrFetchKhoaData } from './khoaDbCache';
import { isNativePlatform } from './nativeBridge';
import { CapacitorHttp } from '@capacitor/core';

export interface KhoaSwtcDayInfo {
  searchDate: string; // YYYY-MM-DD
  dateMoon: string; // MM.DD (음력)
  moonState: string; // 대조기, 소조기, 중조기
  moolNormal: string; // 예: "한사리"
  mool7: string; // 예: "여덟매"
  mool8: string; // 예: "아홉물"
  sunrise: string; // HH:mm
  sunset: string; // HH:mm
  events: {
    type: 'HIGH' | 'LOW';
    typeLabel: '만조' | '간조';
    time: string; // HH:mm
    height: number; // cm
    diff?: number; // 조위차 cm
    minutesFromMidnight: number; // 당일 00:00 기준 분
  }[];
}

export interface KhoaSwtcWeeklyResult {
  obsPostId: string;
  stDate: string;
  days: KhoaSwtcDayInfo[];
  allExtremums: {
    dayIdx: number;
    date: string;
    type: 'HIGH' | 'LOW';
    typeLabel: '만조' | '간조';
    time: string;
    height: number;
    diff?: number;
    totalMinutesFromStart: number; // 1일차 00:00 기준 누적 분
  }[];
}

function getSwtcApiBaseUrl(): string {
  // 모바일 네이티브 앱 환경에서는 KHOA 공식 도메인으로 직접 통신 (CapacitorHttp / Native)
  if (isNativePlatform()) {
    return 'https://www.khoa.go.kr';
  }
  // PC 웹 로컬 개발(localhost) 및 Vercel 배포 환경에서는 프록시(/api-swtc) 사용
  if (
    typeof window !== 'undefined' &&
    window.location &&
    window.location.protocol &&
    window.location.protocol.startsWith('http') &&
    (window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname.endsWith('.vercel.app'))
  ) {
    return '/api-swtc';
  }
  return 'https://www.khoa.go.kr';
}

function formatDateToYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * KHOA 모바일 공식 7일치 조석 예보 데이터 취득 (Supabase 중앙 DB 24시간 캐싱)
 */
export async function fetchKhoaSwtcWeekly(
  obsCode: string,
  baseDate: Date = new Date()
): Promise<KhoaSwtcWeeklyResult | null> {
  const dateStr = formatDateToYmd(baseDate);
  const cleanDate = dateStr.replace(/-/g, '');
  const cacheKey = `SWTC:${obsCode}:${cleanDate}`;
  const ttlMs = 24 * 60 * 60 * 1000; // 24시간 유효

  return getOrFetchKhoaData<KhoaSwtcWeeklyResult>(
    cacheKey,
    'TIDE',
    obsCode,
    ttlMs,
    async () => {
      const baseUrl = getSwtcApiBaseUrl();
      const url = `${baseUrl}/swtc/getWeeklyData.do`;

      const body = new URLSearchParams({
        stDate: dateStr,
        obsPostId: obsCode,
      });

      try {
        let json: any = null;

        if (isNativePlatform()) {
          // Android Native CapacitorHttp: 브라우저 CORS/보안 정책을 완전 우회하여 KHOA 서버 직접 통신
          const capRes = await CapacitorHttp.post({
            url: 'https://www.khoa.go.kr/swtc/getWeeklyData.do',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 ExFishApp',
            },
            data: body.toString(),
            connectTimeout: 9000,
            readTimeout: 9000,
          });
          json = typeof capRes.data === 'string' ? JSON.parse(capRes.data) : capRes.data;
        } else {
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
            },
            body: body.toString(),
            signal: AbortSignal.timeout(9000),
          });

          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          json = await res.json();
        }

        const rawWeekly = json?.weeklyData;
        if (!Array.isArray(rawWeekly) || rawWeekly.length === 0) return null;

        const days: KhoaSwtcDayInfo[] = [];
        const allExtremums: KhoaSwtcWeeklyResult['allExtremums'] = [];

        rawWeekly.forEach((item: any, dayIdx: number) => {
          const sDate = item.searchDate;
          const dateMoon = item.dateMoon ? `${item.dateMoon.split('/')[1]}.${item.dateMoon.split('/')[2]}` : '';
          const mState = item.moonState || '';
          const mNormal = item.moolNormal || '';
          const m7 = item.mool7 || '';
          const m8 = item.mool8 || '';

          const dayEvents: KhoaSwtcDayInfo['events'] = [];

          ['lvl1', 'lvl2', 'lvl3', 'lvl4'].forEach((k) => {
            const val = item[k];
            if (!val || typeof val !== 'string' || val.includes('--:--')) return;
            const parts = val.split('/');
            if (parts.length < 4) return;
            const time = parts[0];
            const typeStr = parts[1].toLowerCase();
            const type: 'HIGH' | 'LOW' = typeStr === 'high' ? 'HIGH' : 'LOW';
            const height = Number(parts[3]);
            if (isNaN(height)) return;

            const [hh, mm] = time.split(':').map(Number);
            const minutesFromMidnight = (hh || 0) * 60 + (mm || 0);
            const totalMinutesFromStart = dayIdx * 1440 + minutesFromMidnight;

            const ev = {
              type,
              typeLabel: (type === 'HIGH' ? '만조' : '간조') as '만조' | '간조',
              time,
              height,
              minutesFromMidnight,
            };
            dayEvents.push(ev);

            allExtremums.push({
              dayIdx,
              date: sDate,
              type,
              typeLabel: ev.typeLabel,
              time,
              height,
              totalMinutesFromStart,
            });
          });

          // 조위차(diff) 계산
          for (let i = 0; i < dayEvents.length; i++) {
            const cur = dayEvents[i];
            const opp = dayEvents.find((o, idx) => idx !== i && o.type !== cur.type);
            cur.diff = opp ? Math.abs(cur.height - opp.height) : undefined;
          }

          days.push({
            searchDate: sDate,
            dateMoon,
            moonState: mState,
            moolNormal: mNormal,
            mool7: m7,
            mool8: m8,
            sunrise: item.sunRise || '',
            sunset: item.sunDown || '',
            events: dayEvents,
          });
        });

        // 전체 극점 간 조위차도 계산
        for (let i = 0; i < allExtremums.length; i++) {
          const cur = allExtremums[i];
          const prev = allExtremums[i - 1];
          const next = allExtremums[i + 1];
          const opp = (prev && prev.type !== cur.type) ? prev : (next && next.type !== cur.type) ? next : null;
          cur.diff = opp ? Math.abs(cur.height - opp.height) : undefined;
        }

        return {
          obsPostId: obsCode,
          stDate: dateStr,
          days,
          allExtremums,
        };
      } catch (e) {
        console.warn(`[KHOA SWTC API] fetchKhoaSwtcWeekly failed (${obsCode}):`, e);
        return null;
      }
    }
  );
}
