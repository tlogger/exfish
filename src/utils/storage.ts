import { CatchLog, FishingSpot } from '../types';

export const INITIAL_SPOTS: FishingSpot[] = [
  {
    id: 'spot-incheon-yeongheung',
    user_id: 'user-esper-1',
    author_name: '바다의루크',
    is_public: true,
    name: '영흥도 진두선착장 우측 갯바위/석축',
    spot_type: 'ROCK',
    lat: 37.2541,
    lng: 126.4982,
    directions: '영흥대교 건넌 후 진두선착장 공영주차장에 주차(무료). 선착장 우측 해안길을 따라 도보 5분 진입. 만조 시 갯바위 퇴로가 막힐 수 있으니 장화 필수.',
    photo_urls: [],
    fishing_methods: ['LURE', 'SURF'],
    target_species: ['우럭', '광어', '농어'],
    best_tides: ['7물 (사리)', '8물', '9물'],
    best_times: ['초들물~중들물', '해질녘 피딩'],
    best_seasons: [5, 6, 9, 10, 11],
    description: '조류 소통이 원활하고 전방 30m 지점에 잘 발달된 수중여가 있습니다. 1/2oz 지그헤드에 4인치 그럽웜 폴링 바이트 유효.',
    created_at: '2026-10-18T10:00:00Z',
  },
  {
    id: 'spot-tae-an-manridang',
    user_id: 'user-esper-2',
    author_name: '서해원투마스터',
    is_public: true,
    name: '태안 만리포 북측 갯바위 닭섬 부근',
    spot_type: 'ROCK',
    lat: 36.7915,
    lng: 126.1384,
    directions: '만리포 해수욕장 북단 끝 주차 후 해안 산책로 데크를 지나 갯바위로 진입. 간조 시 닭섬 방향으로 워킹 가능.',
    photo_urls: [],
    fishing_methods: ['LURE', 'SURF'],
    target_species: ['광어', '우럭', '갑오징어'],
    best_tides: ['4물~6물', '초들물'],
    best_times: ['새벽 해창', '오전 8시'],
    best_seasons: [9, 10, 11],
    description: '가을철 쭈갑 에깅 및 30호 봉돌 원투낚시에 도다리, 우럭 입질 우수. 밑걸림 보통.',
    created_at: '2026-10-17T14:30:00Z',
  },
  {
    id: 'spot-tongyeong-cheokpo',
    user_id: 'user-esper-3',
    author_name: '남해찌낚신',
    is_public: true,
    name: '통영 척포방파제 외항 테트라포드 끝바리',
    spot_type: 'BREAKWATER',
    lat: 34.7892,
    lng: 128.4312,
    directions: '척포항 입구 방파제 초입에 주차 후 외항 테트라포드 능선 따라 150m 도보. 테트라포드가 크고 미끄러우니 펠트 갯바위화 필수 착용.',
    photo_urls: [],
    fishing_methods: ['FLOAT', 'LURE'],
    target_species: ['감성돔', '벵에돔', '무늬오징어'],
    best_tides: ['8물', '9물', '10물'],
    best_times: ['아침 6시~9시', '만조 물돌이'],
    best_seasons: [10, 11, 12, 1],
    description: '통영 최고의 감성돔 명소. 수심 9~12m 권. 1호 반유동 찌낚시로 본류대 태우면 4짜 이상 감성돔 및 가을철 팁런/에깅에 무늬오징어 폭발.',
    created_at: '2026-10-15T08:15:00Z',
  },
  {
    id: 'spot-busan-songjeong',
    user_id: 'user-esper-1',
    author_name: '바다의루크',
    is_public: true,
    name: '기장 대변항 동방파제 외항',
    spot_type: 'BREAKWATER',
    lat: 35.2215,
    lng: 129.2312,
    directions: '대변항 수산시장 뒤편 주차장 이용. 도보 3분 진입. 발판이 매우 편해 생활낚시 및 가족 낚시도 가능.',
    photo_urls: [],
    fishing_methods: ['SURF', 'FLOAT', 'LURE'],
    target_species: ['고등어', '전갱이', '볼락', '풀치(갈치)'],
    best_tides: ['조금', '1~3물', '중들물'],
    best_times: ['야간 (가로등 불빛 주변)', '해질녘'],
    best_seasons: [8, 9, 10, 11],
    description: '야간 집어등 켜고 던질찌 볼락 루어 또는 집어등 아래 전갱이 아징 낚시 최적 포인트.',
    created_at: '2026-10-12T19:00:00Z',
  },
  {
    id: 'spot-gangneung-jumunjin',
    user_id: 'user-esper-4',
    author_name: '동해쇼어지거',
    is_public: true,
    name: '강릉 주문진 소돌해변 갯바위(아들바위 공원)',
    spot_type: 'ROCK',
    lat: 37.9023,
    lng: 128.8285,
    directions: '소돌해변 아들바위공원 주차장(무료). 해상 데크로드 끝에서 갯바위로 연결.',
    photo_urls: [],
    fishing_methods: ['LURE', 'SURF'],
    target_species: ['우럭', '노래미', '삼치', '농어'],
    best_tides: ['조금~3물', '동해는 물때 영향 적고 너울 파고가 핵심'],
    best_times: ['일출 전후 1시간'],
    best_seasons: [5, 6, 9, 10],
    description: '동해 특성상 맑은 물색과 너울 파도가 관건. 파고 0.6m 이하일 때 메탈지그 30g 캐스팅으로 가을 삼치 폭조.',
    created_at: '2026-10-10T12:00:00Z',
  }
];

export const INITIAL_CATCH_LOGS: CatchLog[] = [
  {
    id: 'log-1',
    spot_id: 'spot-incheon-yeongheung',
    user_id: 'user-esper-1',
    user_name: '바다의루크',
    catch_date: '2026-10-18',
    catch_time: '17:40',
    fish_species: '우럭',
    fish_size_cm: 32.5,
    fish_count: 3,
    catch_method: 'LURE',
    lure_bait: '1/2oz 지그헤드 + 다크그린 4인치 그럽',
    catch_mul: '8물',
    tide_state: '중들물 (조위 540cm)',
    water_temp: 18.2,
    wind_speed: 2.4,
    wind_direction: 320,
    memo: '해질녘 만조 1시간 전, 수중여 뒷편 와류 구역에서 강하게 받아먹음. 손맛 묵직!',
    created_at: '2026-10-18T18:00:00Z',
  },
  {
    id: 'log-2',
    spot_id: 'spot-tongyeong-cheokpo',
    user_id: 'user-esper-3',
    user_name: '남해찌낚신',
    catch_date: '2026-10-16',
    catch_time: '07:20',
    fish_species: '감성돔',
    fish_size_cm: 43.0,
    fish_count: 1,
    catch_method: 'FLOAT',
    lure_bait: '크릴 미끼 + 옥수수 복합',
    catch_mul: '7물 (사리)',
    tide_state: '초들물 (조류속 1.4kt)',
    water_temp: 19.5,
    wind_speed: 3.1,
    wind_direction: 15,
    photo_url: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=600&q=80',
    memo: '북풍 등바람이라 원줄 관리 수월했음. 본류와 지류가 만나는 조경지대 10m 수심에서 찌가 스르륵 잠김.',
    created_at: '2026-10-16T08:00:00Z',
  }
];

const STORAGE_KEY_SPOTS = 'exfish_spots_v1';
const STORAGE_KEY_LOGS = 'exfish_logs_v1';
const LEGACY_STORAGE_KEY_SPOTS = 'esperfish_spots_v1';
const LEGACY_STORAGE_KEY_LOGS = 'esperfish_logs_v1';

export function loadSpotsFromStorage(): FishingSpot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SPOTS) || localStorage.getItem(LEGACY_STORAGE_KEY_SPOTS);
    if (!raw) {
      saveSpotsToStorage(INITIAL_SPOTS);
      return INITIAL_SPOTS;
    }
    return JSON.parse(raw);
  } catch {
    return INITIAL_SPOTS;
  }
}

export function saveSpotsToStorage(spots: FishingSpot[]) {
  try {
    localStorage.setItem(STORAGE_KEY_SPOTS, JSON.stringify(spots));
  } catch (e) {
    console.error('Failed to save spots to localStorage', e);
  }
}

export function loadLogsFromStorage(): CatchLog[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LOGS) || localStorage.getItem(LEGACY_STORAGE_KEY_LOGS);
    if (!raw) {
      saveLogsToStorage(INITIAL_CATCH_LOGS);
      return INITIAL_CATCH_LOGS;
    }
    return JSON.parse(raw);
  } catch {
    return INITIAL_CATCH_LOGS;
  }
}

export function saveLogsToStorage(logs: CatchLog[]) {
  try {
    // Base64 data: URL은 localStorage 5MB 용량 초과 및 전체 캐시 삭제(evictNonEssentialCachesFromStorage)를 유발하므로 제외
    const sanitized = logs.map((l) =>
      l.photo_url && l.photo_url.startsWith('data:') ? { ...l, photo_url: undefined } : l
    );
    localStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(sanitized));
  } catch (e) {
    console.error('Failed to save logs to localStorage', e);
  }
}
