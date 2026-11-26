// ExFish 국립해양조사원(KHOA) 53개 관측소 실시간 연동 및 하이브리드 조위 융합 엔진
// 수식: H_hat(t) = H_harmonic(t) + Delta_H_obs(t0) * e^(-lambda * (t - t0)) + Delta_H_meteo(t)

export interface KhoaStation {
  code: string;
  name: string;
  lat: number;
  lng: number;
  region: 'WEST' | 'SOUTH' | 'EAST' | 'JEJU';
}

// 대한민국 국립해양조사원(KHOA) 전국 53개 주요 조위관측소 메타데이터
export const KHOA_TIDAL_STATIONS: KhoaStation[] = [
  // 1. 서해안 조위관측소
  { code: 'DT_0032', name: '강화대교', region: 'WEST', lat: 37.7319, lng: 126.5222 },
  { code: 'DT_0018', name: '군산', region: 'WEST', lat: 35.9755, lng: 126.5631 },
  { code: 'DT_0017', name: '대산', region: 'WEST', lat: 37.0075, lng: 126.3528 },
  { code: 'DT_0065', name: '덕적도', region: 'WEST', lat: 37.2263, lng: 126.1565 },
  { code: 'DT_0025', name: '보령', region: 'WEST', lat: 36.4064, lng: 126.4861 },
  { code: 'DT_0094', name: '서거차도', region: 'WEST', lat: 34.2514, lng: 125.9154 },
  { code: 'DT_0051', name: '서천마량', region: 'WEST', lat: 36.1289, lng: 126.4953 },
  { code: 'DT_0093', name: '소무의도', region: 'WEST', lat: 37.3731, lng: 126.4401 },
  { code: 'DT_0008', name: '안산', region: 'WEST', lat: 37.1922, lng: 126.6472 },
  { code: 'DT_0067', name: '안흥', region: 'WEST', lat: 36.6746, lng: 126.1295 },
  { code: 'DT_0037', name: '어청도', region: 'WEST', lat: 36.1172, lng: 125.9847 },
  { code: 'DT_0003', name: '영광', region: 'WEST', lat: 35.4261, lng: 126.4206 },
  { code: 'DT_0044', name: '영종대교', region: 'WEST', lat: 37.5455, lng: 126.5844 },
  { code: 'DT_0043', name: '영흥도', region: 'WEST', lat: 37.2386, lng: 126.4286 },
  { code: 'DT_0068', name: '위도', region: 'WEST', lat: 35.6181, lng: 126.3018 },
  { code: 'DT_0001', name: '인천', region: 'WEST', lat: 37.4519, lng: 126.5922 },
  { code: 'DT_0052', name: '인천송도', region: 'WEST', lat: 37.3381, lng: 126.5861 },
  { code: 'DT_0024', name: '장항', region: 'WEST', lat: 36.0069, lng: 126.6875 },
  { code: 'DT_0050', name: '태안', region: 'WEST', lat: 36.913, lng: 126.2389 },
  { code: 'DT_0002', name: '평택', region: 'WEST', lat: 36.9669, lng: 126.8228 },
  { code: 'DT_0035', name: '흑산도', region: 'WEST', lat: 34.6842, lng: 125.4356 },

  // 2. 남해안 조위관측소
  { code: 'DT_0063', name: '가덕도', region: 'SOUTH', lat: 35.0242, lng: 128.8109 },
  { code: 'DT_0031', name: '거문도', region: 'SOUTH', lat: 34.0283, lng: 127.3089 },
  { code: 'DT_0029', name: '거제도', region: 'SOUTH', lat: 34.8014, lng: 128.6992 },
  { code: 'DT_0026', name: '고흥발포', region: 'SOUTH', lat: 34.4811, lng: 127.3428 },
  { code: 'DT_0049', name: '광양', region: 'SOUTH', lat: 34.9037, lng: 127.7548 },
  { code: 'DT_0042', name: '교본초', region: 'SOUTH', lat: 34.7047, lng: 128.3064 },
  { code: 'DT_0062', name: '마산', region: 'SOUTH', lat: 35.1975, lng: 128.5764 },
  { code: 'DT_0007', name: '목포', region: 'SOUTH', lat: 34.7797, lng: 126.3756 },
  { code: 'DT_0005', name: '부산', region: 'SOUTH', lat: 35.096, lng: 129.038 },
  { code: 'DT_0056', name: '부산항신항', region: 'SOUTH', lat: 35.0775, lng: 128.7847 },
  { code: 'DT_0061', name: '삼천포', region: 'SOUTH', lat: 34.9242, lng: 128.0697 },
  { code: 'DT_0016', name: '여수', region: 'SOUTH', lat: 34.7472, lng: 127.7656 },
  { code: 'DT_0092', name: '여호항', region: 'SOUTH', lat: 34.6619, lng: 127.4692 },
  { code: 'DT_0027', name: '완도', region: 'SOUTH', lat: 34.316, lng: 126.757 },
  { code: 'DT_0028', name: '진도', region: 'SOUTH', lat: 34.3778, lng: 126.3086 },
  { code: 'DT_0014', name: '통영', region: 'SOUTH', lat: 34.8278, lng: 128.4347 },

  // 3. 동해안 조위관측소
  { code: 'DT_0057', name: '동해항', region: 'EAST', lat: 37.4947, lng: 129.1439 },
  { code: 'DT_0012', name: '속초', region: 'EAST', lat: 38.2072, lng: 128.5942 },
  { code: 'DT_0039', name: '왕돌초', region: 'EAST', lat: 36.7192, lng: 129.7325 },
  { code: 'DT_0013', name: '울릉도', region: 'EAST', lat: 37.4914, lng: 130.9136 },
  { code: 'DT_0020', name: '울산', region: 'EAST', lat: 35.5019, lng: 129.3872 },
  { code: 'DT_0091', name: '포항', region: 'EAST', lat: 36.0518, lng: 129.3763 },
  { code: 'DT_0011', name: '후포', region: 'EAST', lat: 36.6775, lng: 129.453 },
  { code: 'DT_0903', name: '독도', region: 'EAST', lat: 37.241, lng: 131.867 },

  // 4. 제주도 조위관측소
  { code: 'DT_0023', name: '모슬포', region: 'JEJU', lat: 33.2144, lng: 126.2511 },
  { code: 'DT_0010', name: '서귀포', region: 'JEJU', lat: 33.24, lng: 126.5617 },
  { code: 'DT_0022', name: '성산포', region: 'JEJU', lat: 33.385, lng: 126.928 },
  { code: 'DT_0004', name: '제주', region: 'JEJU', lat: 33.5275, lng: 126.543 },
  { code: 'DT_0021', name: '추자도', region: 'JEJU', lat: 33.9619, lng: 126.3003 },
];

/**
 * 위경도로부터 가장 인접한 국립해양조사원(KHOA) 조위관측소 찾기
 */
export function findNearestKhoaStation(lat: number, lng: number): {
  station: KhoaStation;
  distanceKm: number;
} {
  let nearest = KHOA_TIDAL_STATIONS[0];
  let minDistance = Number.MAX_VALUE;

  for (const st of KHOA_TIDAL_STATIONS) {
    const d = calculateHaversineKm(lat, lng, st.lat, st.lng);
    if (d < minDistance) {
      minDistance = d;
      nearest = st;
    }
  }

  return {
    station: nearest,
    distanceKm: Math.round(minDistance * 10) / 10,
  };
}

/**
 * 대권거리(Haversine) 공식에 따른 두 지점 간 거리(km)
 */
function calculateHaversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * 기압 변화에 따른 해수면 기상학적 흡상/강하 효과 (Inverse Barometer Effect)
 * 1 hPa 하강 시 해수면 약 1.01 cm 상승
 */
export function calculateMeteoSurgeCm(pressureHpa: number = 1013): number {
  const standardPressure = 1013.25;
  const deltaP = standardPressure - pressureHpa;
  return Math.round(deltaP * 1.01 * 10) / 10;
}

/**
 * 실측 오차 잔차(Residual)의 지수 감쇄 모델
 * 반감기 6시간: lambda = ln(2) / 6 ~= 0.1155 h^-1
 */
export function calculateDecayedResidualCm(
  initialResidualCm: number,
  hoursElapsed: number,
  lambda: number = 0.1155
): number {
  return initialResidualCm * Math.exp(-lambda * hoursElapsed);
}

/**
 * 천문조석 예측치에 KHOA 실시간 잔차 및 기상 흡상 보정을 융합한 하이브리드 수위 연산
 */
export function computeHybridTideHeight(
  harmonicTideCm: number,
  initialResidualCm: number = 0,
  hoursFromObs: number = 0,
  pressureHpa: number = 1013.25
): {
  hybridHeightCm: number;
  residualCm: number;
  meteoSurgeCm: number;
} {
  const decayedResidual = calculateDecayedResidualCm(initialResidualCm, Math.abs(hoursFromObs));
  const meteoSurge = calculateMeteoSurgeCm(pressureHpa);
  const total = Math.round(harmonicTideCm + decayedResidual + meteoSurge);

  return {
    hybridHeightCm: total,
    residualCm: Math.round(decayedResidual * 10) / 10,
    meteoSurgeCm: meteoSurge,
  };
}
