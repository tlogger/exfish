
export type FishingMethodType =
  | 'SURF_CASTING' // 원투 낚시 (처넣기, 백사장/방파제)
  | 'FLOAT_FISHING' // 바다 찌낚시 (구멍찌, 막대찌, 반유동, 전유동)
  | 'LURE' // 바다 루어 (지그헤드, 다운샷, 미노우, 메탈지그)
  | 'EGI' // 두족류 에깅 (에기, 삼봉, 왕눈이)
  | 'BOAT_VERTICAL' // 선상 지깅 / 타이라바 / 외줄
  | 'FLOAT_SURF'; // 찌원투 / 던질찌 / 떡밥 스프링 채비

export interface RigDetail {
  methodType: FishingMethodType;
  methodName: string; // 예: "원투 낚시 (초원투/사비키)", "바다 찌낚시 (반유동)"
  rodReel: string; // 추천 로드 및 릴 스펙
  mainLine: string; // 원줄 규격
  leaderSinker: string; // 목줄 및 봉돌/싱커/찌
  hookRig: string; // 바늘 규격 및 채비 형태
  bait: string; // 주력 생미끼 또는 루어/에기
  action: string; // 필수 운용법 및 챔질 타이밍
  isLureApplicable: boolean; // 루어 적용 가능 여부 (false면 원투/생미끼 전용)
  lureAltText?: string; // 루어 불가 시 대체 안내 문구
}

export interface SpeciesRigInfo {
  speciesName: string;
  primaryMethod: FishingMethodType;
  primaryMethodName: string; // 뱃지용 간략 명칭 (예: "원투 낚시 전용", "바다 찌낚시 메인")
  methodBadgeColor: {
    bg: string;
    text: string;
    border: string;
  };
  rig: RigDetail;
  recommendedRig: {
    lure: string;
    bait: string;
    line: string;
    hookWeight: string;
    action: string;
  };
  feedingStrategy: string;
  goldenHoursText: (_sunrise: string, _sunset: string, _mulNumber?: number) => string;
}

const METHOD_STYLES: Record<FishingMethodType, { bg: string; text: string; border: string }> = {
  SURF_CASTING: {
    bg: 'bg-amber-500/20',
    text: 'text-amber-300',
    border: 'border-amber-500/40',
  },
  FLOAT_FISHING: {
    bg: 'bg-emerald-500/20',
    text: 'text-emerald-300',
    border: 'border-emerald-500/40',
  },
  LURE: {
    bg: 'bg-cyan-500/20',
    text: 'text-cyan-300',
    border: 'border-cyan-500/40',
  },
  EGI: {
    bg: 'bg-purple-500/20',
    text: 'text-purple-300',
    border: 'border-purple-500/40',
  },
  BOAT_VERTICAL: {
    bg: 'bg-blue-500/20',
    text: 'text-blue-300',
    border: 'border-blue-500/40',
  },
  FLOAT_SURF: {
    bg: 'bg-orange-500/20',
    text: 'text-orange-300',
    border: 'border-orange-500/40',
  },
};

export const SPECIES_RIG_DATABASE: Record<string, SpeciesRigInfo> = {
  // ==========================================
  // 1. 원투 낚시 전용 어종 (루어 불가)
  // ==========================================
  노랑가오리: {
    speciesName: '노랑가오리',
    primaryMethod: 'SURF_CASTING',
    primaryMethodName: '대물 원투 전용 (루어 불가)',
    methodBadgeColor: METHOD_STYLES.SURF_CASTING,
    rig: {
      methodType: 'SURF_CASTING',
      methodName: '초원투 대물 처넣기 채비',
      rodReel: '서프대 30~35호 4.5m 이상 + 대형 스피닝릴 5000~6000번 (드랙력 12kg 이상)',
      mainLine: '합사 3.0~4.0호 (원투 비거리 확보) or 나일론 8.0~10.0호',
      leaderSinker: '30~40호 스파이크 봉돌 (강한 조류에 굴러가지 않도록 바닥 고정)',
      hookRig: '와이어 목줄 38번 (날카로운 가시 및 거친 바닥 대비) + 대물 전용 서프 바늘 20~24호',
      bait: '통오징어 통째 꿰기, 개불 통꿰기, 참갯지렁이(혼무시) 3~4마리 뭉쳐꿰기',
      action: '원투 투척 후 드랙을 살짝 풀어놓고 삼각대 거치. 초릿대가 쿡쿡 박히다가 낚싯대 허리까지 가져가는 본입질 시 힘껏 챔질.',
      isLureApplicable: false,
      lureAltText: '루어 낚시 불가 (초대형 생미끼 원투 처넣기 전용)',
    },
    recommendedRig: {
      lure: '루어 낚시 불가 (생미끼 원투 전용 어종)',
      bait: '통오징어 1마리 통꿰기, 대형 개불, 참갯지렁이(혼무시) 다발',
      line: '원줄 합사 3.0~4.0호 + 와이어 목줄 38번 (대물 꼬리 가시 쓸림 방지)',
      hookWeight: '30~40호 스파이크 봉돌 (서해 갯골 강류 고정용)',
      action: '바닥 착저 후 드랙 프리 거치 → 초릿대 처박히는 본입질 시 대물 강한 챔질',
    },
    feedingStrategy: '서해 조간대 갯골과 펄 모래밭에서 만조를 타고 올라와 바닥의 조개, 게, 갯지렁이를 흡입합니다.',
    goldenHoursText: (_sunrise, _sunset, _mul) =>
      `여름철(7~9월) 사리 물때(6~10물) 중들물~만조 직전 갯골 수위 상승 타임`,
  },
  보리멸: {
    speciesName: '보리멸',
    primaryMethod: 'SURF_CASTING',
    primaryMethodName: '백사장 초원투 전용 (루어 불가)',
    methodBadgeColor: METHOD_STYLES.SURF_CASTING,
    rig: {
      methodType: 'SURF_CASTING',
      methodName: '백사장 다단 편대 사비키 채비',
      rodReel: '서프 연질 원투대 25~30호 4.05~4.25m + 서프 전용 4000번 스피닝릴',
      mainLine: '합사 0.8~1.0호 (원투 80~120m 비거리) + 힘줄(테이퍼라인 1~6호)',
      leaderSinker: 'L형 유동 편대 봉돌 20~27호 or 모래밭 미끄럼 고리봉돌',
      hookRig: '보리멸 전용 3~5단 바늘 채비 (바늘 6~8호, 목줄 1.0~1.5호 20cm)',
      bait: '싱싱한 모래지렁이(홍갯지렁이) 1~2cm 작게 토막내어 바늘 끝만 감싸기',
      action: '백사장 80m 이상 장타 후 1분에 3~5m씩 매우 천천히 릴링하며 바닥 긁기. 특유의 투두둑 입질 후 살살 끌어 줄타기 유도.',
      isLureApplicable: false,
      lureAltText: '루어 낚시 불가 (모래지렁이 초원투 바닥 긁기 전용)',
    },
    recommendedRig: {
      lure: '루어 낚시 불가 (모래지렁이 초원투 전용 어종)',
      bait: '싱싱한 모래지렁이(홍갯지렁이) 1~2cm 바늘 끝 토막꿰기',
      line: '원줄 합사 0.8~1.0호 + 힘줄(테이퍼라인 1~6호) + 목줄 1.2호',
      hookWeight: 'L형 유동 편대 봉돌 20~27호 (백사장 원투 비거리용)',
      action: '원투 후 초슬로우 릴링으로 바닥 모래 긁기(사비키) → 투두둑 입질 시 천천히 줄타기',
    },
    feedingStrategy: '백사장 얕은 모래밭과 쇄파대(파도가 부서지는 곳) 안쪽에서 무리지어 갯지렁이를 쪼아먹습니다.',
    goldenHoursText: (_sunrise, _sunset, _mul) =>
      `주간 맑은 물때(조금~4물, 11~14물) 오전 07:00 ~ 11:00 햇살 비출 때 활성 극대화`,
  },
  붕장어: {
    speciesName: '붕장어',
    primaryMethod: 'SURF_CASTING',
    primaryMethodName: '야간 원투 낚시 전용 (루어 불가)',
    methodBadgeColor: METHOD_STYLES.SURF_CASTING,
    rig: {
      methodType: 'SURF_CASTING',
      methodName: '야간 원투 처넣기 채비',
      rodReel: '경질 원투대 25~30호 4.2~4.5m + 4000~5000번 스피닝릴',
      mainLine: '합사 2.0~3.0호 or 나일론 5.0~6.0호',
      leaderSinker: '25~30호 구멍봉돌 편대 or 3단 묶음추 (야광 방울/발광 케미 필수)',
      hookRig: '세이코(우럭/장어) 바늘 16~18호 + 카본 4~5호 or 케블라 목줄 (몸통 꼬기 방지)',
      bait: '꽁치 살 포뜬 것(피비린내 집어), 싱싱한 고등어 살, 오징어 채, 청갯지렁이 여러 마리 꿰기',
      action: '야간 방파제 석축 끝 물골이나 모래뻘 경계면에 투척 후 삼각대 거치. 초릿대 방울이 딸랑거리며 연속 요동칠 때 챔질.',
      isLureApplicable: false,
      lureAltText: '루어 낚시 불가 (야간 꽁치/지렁이 처넣기 원투 전용)',
    },
    recommendedRig: {
      lure: '루어 낚시 불가 (야간 생미끼 처넣기 원투 전용)',
      bait: '꽁치 살 포(염장), 고등어 살, 오징어 채, 청갯지렁이 2~3마리 통꿰기',
      line: '원줄 합사 2~3호 or 나일론 5호 + 케블라/카본 4호 목줄',
      hookWeight: '25~30호 구멍봉돌 편대 or 묶음추',
      action: '원투 후 텐션 잡고 거치 → 초릿대 딸랑거리는 연속 예신 후 강한 본입질 시 챔질',
    },
    feedingStrategy: '완전한 야행성으로 일몰 직후 굴에서 나와 발달된 후각으로 썩은 생선과 지렁이 냄새를 쫓습니다.',
    goldenHoursText: (_sunrise, _sunset, _mul) =>
      `일몰 후 어두워진 20:00 ~ 새벽 02:00, 들물 진행 중 수심이 차오를 때`,
  },
  도다리: {
    speciesName: '도다리',
    primaryMethod: 'SURF_CASTING',
    primaryMethodName: '봄 원투 낚시 전용 (루어 불가)',
    methodBadgeColor: METHOD_STYLES.SURF_CASTING,
    rig: {
      methodType: 'SURF_CASTING',
      methodName: '모래/뻘바닥 L형 편대 2단 원투 채비',
      rodReel: '원투대 25~30호 4.2m + 3000~4000번 스피닝릴',
      mainLine: '합사 1.5~2.0호 or 나일론 4.0~5.0호',
      leaderSinker: '20~30호 L형 편대 봉돌 or 양핀도래 편대',
      hookRig: '도다리/가자미 전용 바늘 11~13호, 목줄 카본 2.0~2.5호 (바늘 2개)',
      bait: '청갯지렁이 2~3마리 통꿰기 (바늘 밖으로 꼬리가 2~3cm 나와 꿈틀거리도록 유도)',
      action: '모래밭 투척 후 3~5분에 한 번씩 1~2m 살살 끌어당겨 바닥에 모래 연무를 일으켜 호기심 유발. 묵직한 당김에 챔질.',
      isLureApplicable: false,
      lureAltText: '루어 낚시 불가 (청갯지렁이 바닥 유혹 원투 전용)',
    },
    recommendedRig: {
      lure: '루어 낚시 불가 (청갯지렁이 원투 전용 어종)',
      bait: '청갯지렁이 2~3마리 통꿰기 (꼬리 꿈틀거림 유지)',
      line: '원줄 합사 1.5~2.0호 + 목줄 카본 2.0~2.5호',
      hookWeight: '20~30호 L형 편대 봉돌 (조류에 밀리지 않는 무게)',
      action: '원투 후 3분 간격 1m 슬로우 드래깅으로 모래먼지 유발 → 묵직한 입질 시 챔질',
    },
    feedingStrategy: '봄철 산란 후 체력을 회복하기 위해 모래뻘 바닥에 매복하여 기어 다니는 갯지렁이를 적극 흡입합니다.',
    goldenHoursText: (_sunrise, _sunset, _mul) =>
      `봄철(3~5월) 오전 08:00 ~ 14:00, 들물 조류가 모래 언덕을 타고 넘을 때`,
  },
  돌돔: {
    speciesName: '돌돔',
    primaryMethod: 'SURF_CASTING',
    primaryMethodName: '갯바위 대물 원투 전용 (루어 불가)',
    methodBadgeColor: METHOD_STYLES.SURF_CASTING,
    rig: {
      methodType: 'SURF_CASTING',
      methodName: '갯바위 버림봉돌 와이어 원투 채비',
      rodReel: '돌돔 전용 경질 원투대 5.0~5.4m + 돌돔 전용 장구통(양축)릴 (드랙 프리 세팅)',
      mainLine: '돌돔 전용 나일론 원줄 18~22호 or 합사 8~10호',
      leaderSinker: '버림봉돌 30~50호 (삼각도래에 얇은 버림줄 연결)',
      hookRig: '와이어 목줄 36~37번 (이빨 쓸림 절대 방지) + 돌돔 전용 바늘 13~15호',
      bait: '보라성게, 말똥성게(가시 자르고 통꿰기), 참전복, 소라, 참갯지렁이(혼무시)',
      action: '거친 조류가 흐르는 본류대 수중 여턱에 정확히 캐스팅. 툭툭 치는 예신에 절대 낚싯대를 건드리지 말고, 받침대 허리까지 고꾸라지는 삼킴 본입질 시 온몸으로 후킹.',
      isLureApplicable: false,
      lureAltText: '루어 낚시 불가 (성게/소라 갯바위 돌돔 원투 전용)',
    },
    recommendedRig: {
      lure: '루어 낚시 불가 (성게/소라 갯바위 원투 전용 어종)',
      bait: '보라성게, 소라 살, 참전복 살, 참갯지렁이(혼무시)',
      line: '원줄 나일론 20호 or 합사 8~10호 + 와이어 목줄 37번',
      hookWeight: '30~50호 버림봉돌 (거센 본류대 갯바위 여턱 고정)',
      action: '여턱 안착 후 예신(툭툭) 대기 → 낚싯대 허리까지 처박히는 3단 본입질 시 풀파워 챔질',
    },
    feedingStrategy: '강한 이빨로 성게 가시와 패류 껍질을 부수어 섭이하므로 거센 조류가 수중 암초에 부딪히는 곳에 붙습니다.',
    goldenHoursText: (_sunrise, _sunset, _mul) =>
      `사리 물때(7~10물)의 거센 조류 소통 시간대 및 정조 직전 물돌이 타임`,
  },
  '문절망둑 (망둥어)': {
    speciesName: '문절망둑 (망둥어)',
    primaryMethod: 'SURF_CASTING',
    primaryMethodName: '생활 원투 낚시 (루어 비권장)',
    methodBadgeColor: METHOD_STYLES.SURF_CASTING,
    rig: {
      methodType: 'SURF_CASTING',
      methodName: '연안 갯벌 묶음추 원투 채비',
      rodReel: '생활 원투대 or 루어 낚싯대 + 2000~2500번 스피닝릴',
      mainLine: '나일론 2.5~3.0호 or 합사 1.0~1.5호',
      leaderSinker: '8~15호 묶음추 or 구멍봉돌 편대',
      hookRig: '망둥어/세이코 바늘 9~12호',
      bait: '청갯지렁이 2~3cm 토막, 바지락 조갯살, 오징어 살',
      action: '갯벌 얕은 턱이나 석축 주변에 던져놓고 천천히 감아들이면 톡톡 후두둑 공격.',
      isLureApplicable: false,
      lureAltText: '루어 낚시 비권장 (청갯지렁이 원투 채비가 압도적 조과)',
    },
    recommendedRig: {
      lure: '루어 비권장 (청갯지렁이 원투가 10배 이상 유리)',
      bait: '청갯지렁이 토막, 조갯살, 오징어 살',
      line: '원줄 나일론 3호 + 묶음추 기성 채비',
      hookWeight: '8~15호 묶음추 봉돌',
      action: '던져두고 1분에 한 번씩 살짝 끌어주면 톡톡거리며 물고 달아남',
    },
    feedingStrategy: '가을철 몸집을 불리기 위해 얕은 갯벌로 몰려와 바닥의 지렁이와 갑각류를 닥치는 대로 삼킵니다.',
    goldenHoursText: (_sunrise, _sunset, _mul) =>
      `가을(9~11월) 낮 10:00 ~ 16:00, 들물이 시작되며 갯벌로 바닷물이 유입될 때`,
  },

  // ==========================================
  // 2. 바다 찌낚시 전용/메인 어종 (루어 불가/제한)
  // ==========================================
  벵에돔: {
    speciesName: '벵에돔',
    primaryMethod: 'FLOAT_FISHING',
    primaryMethodName: '바다 찌낚시 전용 (루어 불가)',
    methodBadgeColor: METHOD_STYLES.FLOAT_FISHING,
    rig: {
      methodType: 'FLOAT_FISHING',
      methodName: '0호찌(제로찌) 전유동 찌낚시 채비',
      rodReel: '1호~1.25호 5.3m 갯바위 릴낚싯대 + 2500번 LBD(레버브레이크) 스피닝릴',
      mainLine: '플로팅 원줄 1.5~2.0호 (수면 위에 뜨는 라인)',
      leaderSinker: '0(제로)찌 or 00(투제로)찌 + 조수우키고무 + G2~B 좁쌀봉돌',
      hookRig: '카본 목줄 1.0~1.5호 (3~4m 직결) + 벵에돔 전용 바늘 4~6호',
      bait: '밑밥(크릴+빵가루 혼합) 품질 필수, 미끼는 각크릴 또는 빵가루 경단',
      action: '조류 상류에 밑밥을 뿌리고 그 띠에 채비를 태워 자연스럽게 흘리며 서서히 하강시킴. 원줄을 손가락으로 잡았다 놓는 견제 동작 필수.',
      isLureApplicable: false,
      lureAltText: '루어 낚시 불가 (밑밥 동조 제로찌 전유동 찌낚시 전용)',
    },
    recommendedRig: {
      lure: '루어 낚시 불가 (0호찌 빵가루/크릴 찌낚시 전용 어종)',
      bait: '선별 각크릴, 빵가루 경단 (밑밥 크릴+빵가루 동조 필수)',
      line: '원줄 플로팅 1.5~1.75호 + 목줄 카본 1.0~1.25호 (3~4m)',
      hookWeight: '0(제로)찌 or 00찌 + G2 조수우키고무 (전유동 침강)',
      action: '밑밥 투입 후 조류에 찌를 태워 동조 흘림 → 원줄 살짝 잡아주는 견제 시 찌가 쏜살같이 입수',
    },
    feedingStrategy: '밑밥의 빵가루와 크릴 부유물을 먹기 위해 수중 여 틈에서 표·중층(수심 2~5m)으로 피어오릅니다.',
    goldenHoursText: (_sunrise, sunset, _mul) =>
      `해질녘 일몰(${sunset}) 전후 1.5시간 피딩 타임 및 오전 맑은 조류 소통 시간`,
  },
  감성돔: {
    speciesName: '감성돔',
    primaryMethod: 'FLOAT_FISHING',
    primaryMethodName: '바다 찌낚시 메인 (구멍찌 반유동)',
    methodBadgeColor: METHOD_STYLES.FLOAT_FISHING,
    rig: {
      methodType: 'FLOAT_FISHING',
      methodName: '바닥 공략 구멍찌/막대찌 반유동 채비',
      rodReel: '1호 5.3m 감성돔 전용대 + 2500~3000번 LBD 스피닝릴',
      mainLine: '세미플로트 원줄 2.0~2.5호',
      leaderSinker: '0.5호~1.5호 구멍찌/수중찌 세트 + 목줄 분할 좁쌀봉돌(G2)',
      hookRig: '카본 목줄 1.5~1.75호 (3m) + 감성돔 전용 바늘 2~3호',
      bait: '생크릴, 참갯지렁이(혼무시), 깐새우, 바다게, 옥수수',
      action: '면사매듭으로 바닥 수심(바닥 20~30cm 위)을 정밀 세팅 후, 조류를 태워 여 뒷편 와류로 흘림. 주기적인 뒷줄 견제로 바늘 띄우기.',
      isLureApplicable: false,
      lureAltText: '루어 낚시 극히 제한적 (극소수 기수역 치닝 외에는 찌낚시가 정석)',
    },
    recommendedRig: {
      lure: '극히 제한적 (치닝 루어 외 95% 이상 구멍찌 반유동 찌낚시)',
      bait: '생크릴, 참갯지렁이(혼무시), 바다게, 옥수수 (밑밥 압맥 동조)',
      line: '원줄 세미플로트 2.0~2.5호 + 목줄 카본 1.5~1.75호',
      hookWeight: '구멍찌 0.8~1.5호 + 규격 수중찌 (바닥층 직공)',
      action: '바닥 수심에서 30cm 띄워 흘리며 10초마다 뒷줄 살짝 당겨 밑걸림 회피 및 유혹',
    },
    feedingStrategy: '수중 여 뿌리와 조류가 부딪히는 훈수 지대 바닥에서 밑밥의 압맥과 크릴, 패류를 섭이합니다.',
    goldenHoursText: (sunrise, _sunset, _mul) =>
      `새벽 여명(${sunrise} 1시간 전) 및 일몰 전후, 간조 후 초들물~중들물 수위 상승기`,
  },
  '쥐치 (말쥐치)': {
    speciesName: '쥐치 (말쥐치)',
    primaryMethod: 'FLOAT_FISHING',
    primaryMethodName: '예민한 찌낚시/외줄 (루어 불가)',
    methodBadgeColor: METHOD_STYLES.FLOAT_FISHING,
    rig: {
      methodType: 'FLOAT_FISHING',
      methodName: '고감도 막대찌/외줄 소형 바늘 채비',
      rodReel: '0.8~1호 연질 릴찌낚싯대 + 2000번 스피닝릴',
      mainLine: '나일론 1.5~2.0호',
      leaderSinker: 'B~0.5호 예민한 자립 막대찌 + 소형 수중찌',
      hookRig: '쥐치 전용 초소형 바늘 1~3호 (목줄 0.8~1.0호 10~15cm 극도로 짧게)',
      bait: '바지락 조갯살, 청갯지렁이 바늘귀까지 꼭꼭 밀어 넣어 아주 작게 꿰기',
      action: '미끼 도둑이므로 찌 톱이 반 마디 살짝 잠기는 극미세 어신 발생 즉시 손목 스냅으로 짧고 날카로운 챔질.',
      isLureApplicable: false,
      lureAltText: '루어 낚시 불가 (초소형 바늘 생미끼 찌낚시 전용)',
    },
    recommendedRig: {
      lure: '루어 낚시 불가 (입이 작아 소형 바늘 생미끼 전용)',
      bait: '바지락 살, 청갯지렁이 초소형 토막 (바늘 끝 감추기)',
      line: '원줄 1.5호 + 목줄 0.8~1.0호 (15cm 이내 짧게)',
      hookWeight: '고감도 자립 막대찌 B~0.5호',
      action: '찌가 한 마디 쏙 들어가는 순간 즉각적인 손목 스냅 챔질',
    },
    feedingStrategy: '작고 날카로운 주둥이로 미끼만 갉아먹으므로 방파제 직벽이나 테트라포드 사이에 붙어 있습니다.',
    goldenHoursText: (_sunrise, _sunset, _mul) =>
      `주간 09:00 ~ 15:00 맑은 물색과 잔잔한 조류 상태일 때`,
  },
  학꽁치: {
    speciesName: '학꽁치',
    primaryMethod: 'FLOAT_FISHING',
    primaryMethodName: '이단 발포찌 찌낚시 (루어 불가)',
    methodBadgeColor: METHOD_STYLES.FLOAT_FISHING,
    rig: {
      methodType: 'FLOAT_FISHING',
      methodName: '표층 전용 2단 던질찌/발포찌 채비',
      rodReel: '0.6~1호 연질 낚싯대 or 볼락 루어대 + 2000번 스피닝릴',
      mainLine: '나일론 1.5~2.0호',
      leaderSinker: '원투용 던질찌(발포찌 2~3호) + 목줄 어신찌(소형 발포찌)',
      hookRig: '학꽁치 전용 바늘 4~6호, 목줄 모노 0.8호 (50cm)',
      bait: '곤쟁이, 초소형 각크릴 (머리/꼬리 떼고 바늘에 꿰기)',
      action: '수면 아래 50cm~1m 표층을 공략하며, 던진 후 릴을 천천히 감아들이면 찌가 옆으로 차고 나갈 때 챔질.',
      isLureApplicable: false,
      lureAltText: '루어 낚시 불가 (표층 곤쟁이/크릴 2단찌 찌낚시 전용)',
    },
    recommendedRig: {
      lure: '루어 낚시 불가 (표층 크릴 2단찌 찌낚시 전용 어종)',
      bait: '곤쟁이, 초소형 각크릴 (머리 떼고 알맹이만)',
      line: '원줄 나일론 1.5호 + 목줄 모노 0.8호 (50cm)',
      hookWeight: '원투용 던질찌 + 목줄 소형 어신찌 (수심 50cm 고정)',
      action: '원투 후 채비 정렬 → 슬로우 리트리브 중 어신찌가 수평으로 째질 때 챔질',
    },
    feedingStrategy: '표층 1m 이내를 떼지어 회유하며 떠다니는 곤쟁이와 부유 플랑크톤을 공격합니다.',
    goldenHoursText: (_sunrise, _sunset, _mul) =>
      `가을~겨울 낮 10:00 ~ 15:00 햇살이 따스한 맑은 날 표층 부상`,
  },
  '숭어 (가숭어/밀치)': {
    speciesName: '숭어 (가숭어/밀치)',
    primaryMethod: 'FLOAT_SURF',
    primaryMethodName: '스프링 떡밥 찌원투 (루어 불가)',
    methodBadgeColor: METHOD_STYLES.FLOAT_SURF,
    rig: {
      methodType: 'FLOAT_SURF',
      methodName: '숭어 전용 대형 고추찌 떡밥 스프링 채비',
      rodReel: '3~4호 5.3m 경질 원투/찌낚시대 + 4000~5000번 스피닝릴',
      mainLine: '나일론 4.0~5.0호',
      leaderSinker: '숭어 대형 고추찌 5~10호 + 떡밥 스프링 채비',
      hookRig: '원형 다단 바늘 (바늘 5~7개 묶음)',
      bait: '전용 숭어 떡밥(밀가루+곡물+사료 배합)을 야구공 크기로 스프링에 뭉치기',
      action: '표층~중층(수심 1~2m)에 띄워 조류에 흘리면 숭어 무리가 떡밥을 흡입하다가 바늘에 걸림. 찌가 물속으로 쑥 빨려갈 때 챔질.',
      isLureApplicable: false,
      lureAltText: '루어 낚시 불가 (떡밥 스프링 찌낚시 전용)',
    },
    recommendedRig: {
      lure: '루어 낚시 불가 (떡밥 스프링 찌낚시 전용 어종)',
      bait: '숭어 전용 곡물 떡밥 (스프링에 단단히 뭉침)',
      line: '원줄 나일론 4.0~5.0호 직결',
      hookWeight: '숭어 전용 대형 고추찌 5~8호',
      action: '조류에 흘려두면 떡밥을 쪼아먹다 찌가 쑥 사라질 때 강한 챔질',
    },
    feedingStrategy: '플랑크톤과 유기물을 흡입 섭식하므로 일반 루어에는 일절 반응하지 않습니다.',
    goldenHoursText: (_sunrise, _sunset, _mul) =>
      `봄/겨울철 주간 10:00 ~ 16:00 조류가 완만하게 흐르는 만조 시간대`,
  },
  전어: {
    speciesName: '전어',
    primaryMethod: 'FLOAT_SURF',
    primaryMethodName: '카드채비 사비키 찌낚시 (루어 불가)',
    methodBadgeColor: METHOD_STYLES.FLOAT_SURF,
    rig: {
      methodType: 'FLOAT_SURF',
      methodName: '사비키 어피 카드채비 찌낚시',
      rodReel: '1.5~2호 바다 찌낚시대 + 2500번 스피닝릴',
      mainLine: '나일론 2.5~3.0호',
      leaderSinker: '3~5호 구멍찌/고추찌 + 하단 고리봉돌 3~5호',
      hookRig: '전어 전용 어피 사비키 카드채비 4~6호 (어피 바늘 5~7개)',
      bait: '미끼 없음 (어피 반짝임) + 떡밥망(크릴 밑밥) 장착',
      action: '채비를 던져 가볍게 들었다 놓아주는 고패질(상하 액션)로 어피 반짝임 연출.',
      isLureApplicable: false,
      lureAltText: '루어 낚시 불가 (어피 카드채비 사비키 전용)',
    },
    recommendedRig: {
      lure: '루어 낚시 불가 (어피 사비키 카드채비 전용 어종)',
      bait: '어피 바늘 자체 반짝임 (크릴 밑밥망 살포 병행)',
      line: '원줄 나일론 3호 + 기성 전어 카드채비',
      hookWeight: '3~5호 고추찌 + 3~5호 하단 봉돌',
      action: '가벼운 고패질로 어피 날갯짓 연출 → 우르르 타닥 물릴 때 랜딩',
    },
    feedingStrategy: '떼를 지어 표층을 돌며 플랑크톤을 먹으므로 반짝이는 어피 바늘에 군집 반응합니다.',
    goldenHoursText: (_sunrise, _sunset, _mul) =>
      `가을(9~11월) 오전 07:00 ~ 11:00 맑고 잔잔한 내만 방파제`,
  },
  벤자리: {
    speciesName: '벤자리',
    primaryMethod: 'FLOAT_FISHING',
    primaryMethodName: '야간 본류 찌낚시 전용',
    methodBadgeColor: METHOD_STYLES.FLOAT_FISHING,
    rig: {
      methodType: 'FLOAT_FISHING',
      methodName: '야간 본류대 잠길찌/전유동 채비',
      rodReel: '1.75~2호 갯바위 릴대 + 3000~4000번 LBD 릴',
      mainLine: '플로팅 원줄 3.0~4.0호',
      leaderSinker: '0.8~1.5호 전자찌 or 잠길찌 + 수중찌',
      hookRig: '카본 목줄 2.5~3.0호 + 참돔/구레 바늘 8~10호',
      bait: '싱싱한 생크릴 2마리 등꿰기',
      action: '거센 본류대에 태워 50~100m 원거리까지 흘리며 중층(5~10m) 탐색. 원줄이 핑 하고 풀려나가는 통쾌한 입질.',
      isLureApplicable: false,
      lureAltText: '루어 낚시 불가 (야간 본류대 크릴 찌낚시 전용)',
    },
    recommendedRig: {
      lure: '루어 낚시 불가 (본류대 크릴 흘림 찌낚시 전용 어종)',
      bait: '생크릴 2마리 겹쳐꿰기',
      line: '원줄 3~4호 + 목줄 카본 2.5~3.0호',
      hookWeight: '1.0~1.5호 전자찌/수중찌 (본류 침강용)',
      action: '본류대에 찌를 태워 70m 이상 흘리며 원줄 뭉치가 풀려나갈 때 챔질',
    },
    feedingStrategy: '여름밤 먼바다 거센 본류대 중층을 무리지어 회유하며 크릴 띠를 맹렬히 공격합니다.',
    goldenHoursText: (_sunrise, _sunset, _mul) =>
      `초여름~한여름 밤 20:00 ~ 새벽 03:00, 사리 물때의 힘찬 본류대`,
  },

  // ==========================================
  // 3. 두족류 에깅 전용 어종 (생미끼 찌낚시 병행)
  // ==========================================
  주꾸미: {
    speciesName: '주꾸미',
    primaryMethod: 'EGI',
    primaryMethodName: '에깅 전용 (왕눈이 직결)',
    methodBadgeColor: METHOD_STYLES.EGI,
    rig: {
      methodType: 'EGI',
      methodName: '왕눈이 에기 직결 바닥 콩콩 채비 (4~6호 경량 봉돌)',
      rodReel: '주꾸미 전용 베이트/스피닝 루어대 (연질 팁) + 소형 릴',
      mainLine: '합사 0.8~1.0호',
      leaderSinker: '4~6호 봉돌 (15~22.5g, 조류 약할 시 3~4호, 본류 시 최대 6호)',
      hookRig: '왕눈이 에기 1개 + 4~6호 봉돌 양핀도래 직결',
      bait: '인조 왕눈이 에기 (마른 오징어나 쥐포 살짝 감아 집어력 극대화 가능)',
      action: '바닥 착저 후 낚싯대 끝을 톡톡 털어주며 3초 스테이. 가벼운 4~6호 봉돌을 사용해야 주꾸미가 에기에 올라탄 미세한 무게감을 정확히 감지할 수 있습니다.',
      isLureApplicable: true,
    },
    recommendedRig: {
      lure: '소형 왕눈이 에기(축광/수박/고추장) + 봉돌 4~6호 직결',
      bait: '에기에 마른 오징어나 쥐포 살짝 감기(선택)',
      line: '합사 0.8~1.0호 원줄 직결',
      hookWeight: '4~6호 고리봉돌 (15~22.5g, 8호 이상은 무게감 감지 저하)',
      action: '바닥을 콩콩 2~3회 찍어준 뒤 3초 스테이 (가벼운 봉돌로 올라탄 무게감 감지 후 강한 챔질)',
    },
    feedingStrategy: '완만한 조류의 모래뻘 바닥을 기어 다니며 작은 갑각류와 조개를 사냥합니다.',
    goldenHoursText: (_sunrise, _sunset, _mul) =>
      `주간 08:00 ~ 15:00 조류가 완만하게 흐르는 조금~3물 낮 시간대`,
  },
  갑오징어: {
    speciesName: '갑오징어',
    primaryMethod: 'EGI',
    primaryMethodName: '다운샷 에깅 전용 (수평 에기)',
    methodBadgeColor: METHOD_STYLES.EGI,
    rig: {
      methodType: 'EGI',
      methodName: '단차 가짓줄 다운샷 수평 에기 채비',
      rodReel: '갑오징어 전용 감도대 (초릿대 9:1 또는 8:2) + 2000번 릴',
      mainLine: '합사 0.8~1.0호',
      leaderSinker: '봉돌 3~6호 (주꾸미와 동일 경량 세팅) + 바닥 버림줄 단차 15~25cm',
      hookRig: '봉돌 위 단차 15~25cm 지점에 가짓줄(10~15cm)을 내어 수평 에기(2.2~2.5호) 세팅',
      bait: '수평 밸런스 에기 (삼봉 에기에 학꽁치 포 부착 시 강력)',
      action: '봉돌이 바닥에 닿은 상태에서 라인 텐션을 살짝 유지하여 에기가 바닥 위 15~20cm 단차를 유지하도록 천천히 바닥 긁기 후 5초 정지. 끈적한 당김이나 펀치 시 즉각 챔질.',
      isLureApplicable: true,
    },
    recommendedRig: {
      lure: '수평 에기 2.2~2.5호 (삼봉 에기 학꽁치 포 부착 추천)',
      bait: '학꽁치 포(삼봉 에기 장착)',
      line: '합사 0.8~1.0호 + 카본 2.5호 쇼크리더',
      hookWeight: '봉돌 3~6호 (주꾸미와 동일 경량) + 에기 단차 15~25cm 필수 (바닥에서 에기를 띄우는 단차가 핵심)',
      action: '에기가 바닥에서 15~20cm 단차로 수평을 유지하도록 천천히 바닥 긁기 후 5초 정지',
    },
    feedingStrategy: '수중 턱과 모래가 만나는 경계 물골에 매복하여 단차를 두고 떠 있는 에기를 촉수로 감아챕니다.',
    goldenHoursText: (_sunrise, _sunset, _mul) =>
      `초들물~중들물로 바뀌며 맑은 물이 들어오는 오전 09:00 ~ 13:00`,
  },
  무늬오징어: {
    speciesName: '무늬오징어',
    primaryMethod: 'EGI',
    primaryMethodName: '쇼어에깅 전용 (샤크리 액션)',
    methodBadgeColor: METHOD_STYLES.EGI,
    rig: {
      methodType: 'EGI',
      methodName: '쇼어에깅 2단 저킹 채비',
      rodReel: '에깅 전용대 8.3~8.6ft M/ML + 2500~3000번 스피닝릴',
      mainLine: '에깅 전용 8합사 0.6~0.8호',
      leaderSinker: '카본 쇼크리더 2.0~2.5호 (1.5m FG노트 결속)',
      hookRig: '에기 3.0~3.5호 (베이직/셸로우, 케이무라/네온 색상)',
      bait: '인조 에기 3.0~3.5호',
      action: '바닥 착저 후 강력한 2단 저킹(샤크리) 3~4회로 에기를 치솟게 한 뒤 텐션 폴링(입질은 반드시 가라앉을 때 가져감).',
      isLureApplicable: true,
    },
    recommendedRig: {
      lure: '에기 3.0~3.5호 (케이무라, 핑크, 오렌지 베이직)',
      bait: '에깅 전용 인조 에기',
      line: '합사 0.6~0.8호 + 카본 쇼크리더 2.0~2.5호',
      hookWeight: '에기 3.5호 자체 침강 (침강속도 약 3초/m)',
      action: '바닥 안착 → 2단 저킹 3~4회 → 슬로우 텐션 폴링 (입질은 폴링 시 낚싯줄 당김)',
    },
    feedingStrategy: '잘피밭과 수중 여가 발달한 곶부리 조류 소통 구역을 회유하며 물고기를 덮칩니다.',
    goldenHoursText: (sunrise, sunset, _mul) =>
      `새벽 해창(${sunrise}) 및 일몰(${sunset}) 전후 피딩 2시간 골든타임`,
  },
  낙지: {
    speciesName: '낙지',
    primaryMethod: 'EGI',
    primaryMethodName: '바닥 긁기 에깅 / 갯벌',
    methodBadgeColor: METHOD_STYLES.EGI,
    rig: {
      methodType: 'EGI',
      methodName: '낙지 전용 에기/살포시 바닥 채비',
      rodReel: '연질 루어대 + 2000번 릴',
      mainLine: '합사 1.0~1.2호',
      leaderSinker: '8~12호 봉돌',
      hookRig: '왕눈이 에기 + 낙지 바늘',
      bait: '왕눈이 에기 or 참갯지렁이 바닥 흘림',
      action: '뻘바닥을 천천히 긁어오며 멈추기를 반복, 빨판으로 감싸는 끈적한 느낌에 챔질.',
      isLureApplicable: true,
    },
    recommendedRig: {
      lure: '왕눈이 에기 + 하단 싱커 10호',
      bait: '에기에 오징어 살 감기 or 청갯지렁이',
      line: '합사 1.0~1.2호 직결',
      hookWeight: '8~12호 봉돌',
      action: '뻘바닥을 아주 느리게 긁으며 끈적한 묵직함 발생 시 부드러운 만세 챔질',
    },
    feedingStrategy: '뻘바닥 구멍 주변을 기어 다니며 저서 생물을 감싸 흡입합니다.',
    goldenHoursText: (_sunrise, _sunset, _mul) =>
      `가을철 야간 21:00 ~ 02:00 간조 전후 뻘이 드러나는 얕은 연안`,
  },
  '문어 (참문어/돌문어)': {
    speciesName: '문어 (참문어/돌문어)',
    primaryMethod: 'EGI',
    primaryMethodName: '문어 전용 헤비 에깅',
    methodBadgeColor: METHOD_STYLES.EGI,
    rig: {
      methodType: 'EGI',
      methodName: '문어 전용 트리블 에기 + 반짝이 스커트 채비',
      rodReel: '헤비급 문어 전용대(XH) + 파워 핸들 베이트릴 or 4000번 스피닝릴',
      mainLine: '합사 2.0~3.0호 (바닥 뜯어내기용)',
      leaderSinker: '20~35호 고리봉돌',
      hookRig: '색상별 왕눈이 에기 2~3개 + 반짝이 꼴뚜기 스커트',
      bait: '왕눈이 에기 + 돼지비계 살짝 묶기(선택)',
      action: '바닥에 밀착시켜 쿵쿵 찍어주며 흔들기. 바닥에 들러붙기 전에 묵직할 때 단숨에 뜯어올림.',
      isLureApplicable: true,
    },
    recommendedRig: {
      lure: '왕눈이 에기 2~3개 + 반짝이 스커트 + 돼지비계',
      bait: '돼지비계, 마른 오징어 살 묶기',
      line: '합사 2.5~3.0호 직결 (밑걸림 강제 회수)',
      hookWeight: '20~30호 봉돌',
      action: '바닥을 쿵쿵 찍으며 살랑거리다 묵직하게 바닥이 굳어지는 느낌 시 강제 기중기 릴링',
    },
    feedingStrategy: '수중 여밭과 테트라포드 틈새에 숨어 지나가는 게와 조개를 덮칩니다.',
    goldenHoursText: (_sunrise, _sunset, _mul) =>
      `조류가 약한 조금 물때(조금~3물, 12~14물) 주간 시간대`,
  },
  '대문어 (피문어)': {
    speciesName: '대문어 (피문어)',
    primaryMethod: 'BOAT_VERTICAL',
    primaryMethodName: '동해 심해 선상 에깅',
    methodBadgeColor: METHOD_STYLES.BOAT_VERTICAL,
    rig: {
      methodType: 'BOAT_VERTICAL',
      methodName: '동해 심해 피문어 전용 채비',
      rodReel: '피문어 전용 헤비 지깅대 + 전동릴 or 대형 베이트릴',
      mainLine: '합사 4.0~6.0호',
      leaderSinker: '40~60호 봉돌 + 대형 반짝이 철판',
      hookRig: '대형 문어 바늘 3~4개 + 대형 축광 웜/에기',
      bait: '대형 문어 에기, 돼지비계, 꽁치 통마리',
      action: '수심 30~80m 심해 바닥 착저 후 바닥 긁기 및 전동릴 감아올리기.',
      isLureApplicable: true,
    },
    recommendedRig: {
      lure: '대형 피문어 에기 + 반짝이 철판',
      bait: '돼지비계, 꽁치 통째 묶기',
      line: '합사 4.0~6.0호',
      hookWeight: '40~60호 봉돌 (수심 50m 돌파)',
      action: '심해 바닥 안착 후 큰 고패질 → 흡착 시 전동릴 파워 권사',
    },
    feedingStrategy: '동해 차가운 심해 모래자갈 바닥을 기어 다니며 대형 물고기와 패류를 사냥합니다.',
    goldenHoursText: (_sunrise, _sunset, _mul) =>
      `겨울~봄 오전 07:00 ~ 12:00 파도가 잔잔한 출항일`,
  },
  '한치 (창꼴뚜기)': {
    speciesName: '한치 (창꼴뚜기)',
    primaryMethod: 'EGI',
    primaryMethodName: '오모리그 / 메탈리더 에깅',
    methodBadgeColor: METHOD_STYLES.EGI,
    rig: {
      methodType: 'EGI',
      methodName: '한치 전용 오모리그 & 거치식 메탈스ッテ 채비',
      rodReel: '한치 전용 스피닝대 (오모리그) + 2500번 릴',
      mainLine: '합사 0.6~0.8호',
      leaderSinker: '오모리그 싱커 20~30호 + 카본 목줄 1.5m',
      hookRig: '수평 삼봉에기 or 1.8~2.2호 소형 에기',
      bait: '학꽁치 포를 감은 삼봉 에기 or 인조 에기',
      action: '캐스팅 후 텐션 폴링 → 큰 저킹 2회 후 스테이 10초. 예민한 초릿대 끝 흔들림에 챔질.',
      isLureApplicable: true,
    },
    recommendedRig: {
      lure: '수평 삼봉에기(학꽁치 포 장착) or 2.0호 에기',
      bait: '학꽁치 포',
      line: '합사 0.6~0.8호 + 쇼크리더 2.5호',
      hookWeight: '오모리그 싱커 20~30호',
      action: '캐스팅 후 큰 저킹 2~3회 → 10초 롱 스테이 중 살포시 가져갈 때 챔질',
    },
    feedingStrategy: '야간 집어등 불빛 아래 중층(15~30m)으로 떠올라 베이트피시를 사냥합니다.',
    goldenHoursText: (_sunrise, _sunset, _mul) =>
      `여름밤 21:00 ~ 새벽 03:00 집어등 불빛 아래 한치 무리 형성 시간`,
  },

  // ==========================================
  // 4. 바다 루어 / 쇼어지깅 / 타이라바 어종
  // ==========================================
  우럭: {
    speciesName: '우럭',
    primaryMethod: 'LURE',
    primaryMethodName: '지그헤드 락피시 루어 (원투 겸용)',
    methodBadgeColor: METHOD_STYLES.LURE,
    rig: {
      methodType: 'LURE',
      methodName: '지그헤드 웜 바닥 리프트앤폴 채비',
      rodReel: '루어 낚싯대 ML~M 7~8ft + 2500번 스피닝릴',
      mainLine: '합사 0.8~1.0호 + 카본 쇼크리더 2.5~3.0호 (여밭 쓸림 대비)',
      leaderSinker: '지그헤드 1/4oz ~ 1/2oz (조류 세기에 맞춤)',
      hookRig: '3~4인치 그럽웜 / 테일웜 (모터오일, 화이트, 워터멜론)',
      bait: '그럽웜 or 생미끼(청갯지렁이, 미꾸라지, 꼴뚜기 병행 시 폭발적)',
      action: '바닥 착저 후 1~2바퀴 호핑 & 리프트앤폴, 갯바위 턱 직벽 바짝 붙이기.',
      isLureApplicable: true,
    },
    recommendedRig: {
      lure: '지그헤드 1/4 ~ 1/2oz + 3~4인치 그럽웜 (모터오일/화이트)',
      bait: '청갯지렁이, 미꾸라지, 꼴뚜기 (생미끼 반응 우수)',
      line: '합사 0.8~1.0호 + 카본 쇼크리더 2.5~3.0호 (암초 쓸림 대비)',
      hookWeight: '조류 세기에 따라 1/4oz(약류) ~ 1/2oz(본류)',
      action: '바닥 착저 후 1~2바퀴 호핑 & 리프트앤폴, 갯바위 턱 직벽 바짝 붙이기',
    },
    feedingStrategy: '어두워진 직후 및 일몰 해창에 여밭 은신처에서 부상하여 왕성한 먹이활동을 합니다.',
    goldenHoursText: (_sunrise, sunset, _mul) =>
      `일몰 피딩(${sunset} 전후 1.5시간) 및 밤 21시~24시 여밭 중들물 구간`,
  },
  광어: {
    speciesName: '광어',
    primaryMethod: 'LURE',
    primaryMethodName: '다운샷 / 웜 루어 낚시',
    methodBadgeColor: METHOD_STYLES.LURE,
    rig: {
      methodType: 'LURE',
      methodName: '다운샷 리그 & 지그헤드 바닥 드래깅 채비',
      rodReel: '루어대 M~MH 8ft 이상 + 3000번 스피닝릴',
      mainLine: '합사 1.0~1.2호 + 카본 쇼크리더 3.0~3.5호',
      leaderSinker: '다운샷 싱커 3/4oz ~ 1oz or 지그헤드 1/2~3/4oz',
      hookRig: '와이드갭 바늘 3/0~4/0호 + 4~5인치 섀드웜 (핑크, 화이트, 워터멜론)',
      bait: '섀드웜, 미노우 or 산 미꾸라지/생새우',
      action: '바닥을 절대 띄우지 않고 드래깅(끌기)과 호핑 반복, 스테이(멈춤) 3초 필수.',
      isLureApplicable: true,
    },
    recommendedRig: {
      lure: '다운샷 리그 (싱커 3/4 ~ 1oz + 4인치 섀드웜) or 메탈지그 20~30g',
      bait: '살아있는 미꾸라지, 멸치, 전어 생미끼',
      line: '합사 1.0호 + 카본 쇼크리더 3.0호',
      hookWeight: '바닥을 확실히 읽을 수 있는 3/4oz 이상 봉돌/지그헤드',
      action: '바닥을 절대 띄우지 않고 드래깅(끌기)과 호핑 반복, 스테이(멈춤) 3초 필수',
    },
    feedingStrategy: '모래와 자갈이 섞인 사니질 바닥에 매복하여 상층을 지나가는 루어를 덮칩니다.',
    goldenHoursText: (sunrise, _sunset, _mul) =>
      `아침 해창(${sunrise} 전후 1시간) 및 중들물~만조 직전 수온 상승기`,
  },
  농어: {
    speciesName: '농어',
    primaryMethod: 'LURE',
    primaryMethodName: '미노우 / 펜슬 바다 루어',
    methodBadgeColor: METHOD_STYLES.LURE,
    rig: {
      methodType: 'LURE',
      methodName: '포말 지대 플로팅 미노우 캐스팅 채비',
      rodReel: '농어 전용대 8.6~9.6ft M~ML + 3000~4000번 고속 릴',
      mainLine: '합사 1.0~1.2호 + 카본 쇼크리더 4.0~5.0호 (1.5m)',
      leaderSinker: '싱커 없음 (루어 자체 중량 20~28g)',
      hookRig: '플로팅 미노우 120~140mm, 싱킹 펜슬 20~28g, 바이브레이션 20g',
      bait: '인조 미노우 or 청갯지렁이/생새우 찌낚시',
      action: '갯바위 부딪히는 하얀 파도 포말(화이트 워터) 안쪽으로 캐스팅 후 슬로우 릴링.',
      isLureApplicable: true,
    },
    recommendedRig: {
      lure: '플로팅 미노우 120~140mm, 싱킹 펜슬 20~28g, 바이브레이션 20g',
      bait: '청갯지렁이 찌낚시 or 산 생새우',
      line: '합사 1.0~1.2호 + 카본 쇼크리더 4.0~5.0호',
      hookWeight: '비거리 60m 이상 확보 가능한 무게중심 이동형 미노우',
      action: '갯바위 부딪히는 하얀 파도 포말(화이트 워터) 안쪽으로 캐스팅 후 슬로우 릴링',
    },
    feedingStrategy: '파도가 갯바위에 부딪혀 포말이 이는 자리와 강한 조류 물골에서 베이트를 사냥합니다.',
    goldenHoursText: (sunrise, _sunset, _mul) =>
      `새벽 여명(${sunrise} 30분 전) 및 밤 21시~24시 중들물 강류대`,
  },
  '풀치(갈치)': {
    speciesName: '풀치(갈치)',
    primaryMethod: 'LURE',
    primaryMethodName: '역지그헤드 웜 루어 / 찌낚시',
    methodBadgeColor: METHOD_STYLES.LURE,
    rig: {
      methodType: 'LURE',
      methodName: '역지그헤드 다팅 & 축광 웜 채비',
      rodReel: '아징/볼락 UL~L 루어대 + 2000번 스피닝릴',
      mainLine: '합사 0.6~0.8호 + 쇼크리더 2.5호 + 와이어 목줄 10cm (이빨 대비)',
      leaderSinker: '역지그헤드(다팅용) 5~10g + 물방울 케미 장착',
      hookRig: '축광/야광 2.5~3인치 스트레이트 웜 + 어시스트 트레블훅',
      bait: '축광 루어 or 꽁치 살 포(생미끼 찌낚시 병행)',
      action: '캐스팅 후 카운트다운(5~10초) → 숏 트위칭 2~3회 후 슬로우 텐션 폴링.',
      isLureApplicable: true,
    },
    recommendedRig: {
      lure: '역지그헤드(다팅) 5~10g + 야광/축광 스트레이트 웜, 물방울 케미 장착',
      bait: '꽁치 살 포뜬 것, 생미끼 바늘 채비',
      line: '합사 0.6~0.8호 + 쇼크리더 2.5호 + 와이어 목줄 10cm (이빨 쓸림 방지)',
      hookWeight: '표층 부상 시 5~7g, 중층 공략 시 10~14g',
      action: '캐스팅 후 카운트다운(5~10초) → 숏 트위칭 2~3회 후 슬로우 텐션 폴링',
    },
    feedingStrategy: '방파제 가로등이나 집어등 불빛 경계면의 명암 구역에 베이트피시가 모일 때 입질 폭발.',
    goldenHoursText: (sunrise, _sunset, _mul) =>
      `야간 20:00 ~ 02:00 집어등 집중 시간대 및 해창 직전(${sunrise} 1시간 전)`,
  },
  갈치: {
    speciesName: '갈치',
    primaryMethod: 'LURE',
    primaryMethodName: '루어 / 생미끼 찌낚시 겸용',
    methodBadgeColor: METHOD_STYLES.LURE,
    rig: {
      methodType: 'LURE',
      methodName: '다팅 루어 및 텐야/생미끼 채비',
      rodReel: '바다 루어대 L~ML + 2500번 릴',
      mainLine: '합사 0.8~1.0호 + 와이어 목줄',
      leaderSinker: '지그헤드 7~14g or 텐야 15~30g',
      hookRig: '와이어 목줄 + 트레블 훅',
      bait: '축광 웜, 꽁치 살',
      action: '중층 리트리브 및 텐션 폴링.',
      isLureApplicable: true,
    },
    recommendedRig: {
      lure: '다팅 지그헤드 7~14g + 3인치 축광 웜 or 텐야',
      bait: '꽁치 살 포',
      line: '합사 0.8호 + 와이어 목줄 10cm',
      hookWeight: '7~14g 지그헤드',
      action: '중층 숏 저킹 후 텐션 폴링 중 툭 치는 입질 후킹',
    },
    feedingStrategy: '표층 및 중층에서 멸치 떼를 수직으로 기습 사냥합니다.',
    goldenHoursText: (_sunrise, _sunset, _mul) =>
      `야간 20:00 ~ 03:00 집어등 집중 시간`,
  },
  볼락: {
    speciesName: '볼락',
    primaryMethod: 'LURE',
    primaryMethodName: '마이크로 지그헤드 락피시 루어',
    methodBadgeColor: METHOD_STYLES.LURE,
    rig: {
      methodType: 'LURE',
      methodName: '마이크로 지그헤드 & 던질찌(플로트) 채비',
      rodReel: '볼락 전용대 UL 7~7.6ft (솔리드/튜블러) + 1000~2000번 릴',
      mainLine: '에스테르 라인 0.3~0.4호 or 합사 0.3호 + 쇼크리더 0.8~1.0호',
      leaderSinker: '지그헤드 1.0~2.5g or 원투용 던질찌 5~10g',
      hookRig: '1.5~2인치 핀테일 웜 / 빔스틱 (클리어, 핑크, 글로우)',
      bait: '소형 루어 웜 or 청갯지렁이(1cm 바늘 끝 꿰기)',
      action: '표층 리트리브 및 텐션 폴링, 집어등 불빛이 끝나는 어둠의 경계면 공략.',
      isLureApplicable: true,
    },
    recommendedRig: {
      lure: '볼락용 지그헤드 1.0~2.5g + 1.5~2인치 핀테일 웜, 던질찌(플로트 리그)',
      bait: '청갯지렁이(1cm 작게 꿸 것)',
      line: '에스테르 라인 0.3~0.4호 or 합사 0.3호 + 쇼크리더 0.8~1.0호',
      hookWeight: '1.5g 내외 마이크로 지그헤드',
      action: '표층 리트리브 및 텐션 폴링, 집어등 불빛이 끝나는 어둠의 경계면 공략',
    },
    feedingStrategy: '야간에 해초대와 수중 여 위로 떠올라 플랑크톤과 치어를 공격합니다.',
    goldenHoursText: (_sunrise, sunset, _mul) =>
      `해질녘(${sunset}) 직후부터 밤 23시까지의 잔잔한 만조 전후 물돌이 타임`,
  },
  참돔: {
    speciesName: '참돔',
    primaryMethod: 'BOAT_VERTICAL',
    primaryMethodName: '타이라바 / 본류대 찌낚시',
    methodBadgeColor: METHOD_STYLES.BOAT_VERTICAL,
    rig: {
      methodType: 'BOAT_VERTICAL',
      methodName: '타이라바 텅스텐 헤드 & 스커트 채비',
      rodReel: '타이라바 전용 연질 베이트대 + 소형 베이트릴',
      mainLine: '합사 0.8~1.0호 + 카본 쇼크리더 3.0~3.5호',
      leaderSinker: '타이라바 헤드 45~80g (오렌지/레드/형광)',
      hookRig: '타이라바 어시스트훅 2개 + 스트레이트/컬리 실리콘 스커트',
      bait: '타이라바 스커트 or 웜 / 지렁이(청갯지렁이 2마리 꿰기)',
      action: '바닥 착저 후 즉시 일정한 속도로 리트리브(감아올리기) 10~15바퀴 후 재착저.',
      isLureApplicable: true,
    },
    recommendedRig: {
      lure: '타이라바 45~80g (헤드 형광/레드 + 스트레이트 스커트)',
      bait: '크릴, 혼무시, 생새우',
      line: '원줄 합사 0.8~1.0호 + 쇼크리더 3.0~3.5호',
      hookWeight: '조류를 타고 바닥을 찍을 수 있는 고비중 텅스텐 헤드',
      action: '바닥 착저 후 즉시 일정한 속도로 리트리브(감아올리기) 10~15바퀴 후 재착저',
    },
    feedingStrategy: '사리 물때의 거센 본류대 바닥층에서 회유하며 크릴과 패류, 새우류를 섭이합니다.',
    goldenHoursText: (_sunrise, _sunset, _mul) =>
      `사리 물때(6~10물)의 본류대가 힘차게 뻗어나가는 3물~7물 조류 최성기`,
  },
  붉바리: {
    speciesName: '붉바리',
    primaryMethod: 'LURE',
    primaryMethodName: '하드락피싱 / 외줄 타이라바',
    methodBadgeColor: METHOD_STYLES.LURE,
    rig: {
      methodType: 'LURE',
      methodName: '헤비 프리리그 & 텍사스리그 채비',
      rodReel: '하드락피싱 MH~H 루어대 + 3000~4000번 스피닝/베이트릴',
      mainLine: '합사 1.5~2.0호 + 카본 쇼크리더 4.0~5.0호 (암초 쓸림 대응)',
      leaderSinker: '싱커 1/2oz ~ 1oz or 인치쿠 60~80g',
      hookRig: '와이드갭 바늘 2/0~3/0호 + 3.5~4인치 호그웜/크로우웜 (오렌지, 레드)',
      bait: '호그웜 or 산 생새우, 전갱이 생미끼',
      action: '바닥 암초 직공 후 큰 호핑 및 텐션 폴링. 돌 틈으로 파고들기 전에 강제 집행.',
      isLureApplicable: true,
    },
    recommendedRig: {
      lure: '프리리그 1/2~1oz + 3.5~4인치 호그웜 (오렌지/레드)',
      bait: '산 생새우, 전갱이 생미끼',
      line: '합사 1.5~2.0호 + 카본 쇼크리더 4~5호',
      hookWeight: '1/2oz ~ 1oz 싱커',
      action: '암초 급심 바닥 착저 후 큰 호핑 → 여 틈으로 파고들기 전 강제 집행',
    },
    feedingStrategy: '수온 18°C 이상의 따뜻한 남해/제주 암초 틈에 서식하며 게와 새우를 급습합니다.',
    goldenHoursText: (_sunrise, _sunset, _mul) =>
      `여름철(7~9월) 낮 11:00 ~ 16:00 수온 최고조 시간대`,
  },
  쥐노래미: {
    speciesName: '쥐노래미',
    primaryMethod: 'LURE',
    primaryMethodName: '루어 & 원투 겸용',
    methodBadgeColor: METHOD_STYLES.LURE,
    rig: {
      methodType: 'LURE',
      methodName: '지그헤드 바닥 탐색 & 묶음추 원투 겸용',
      rodReel: '루어대 ML~M + 2500번 릴',
      mainLine: '합사 0.8~1.2호 or 나일론 3호',
      leaderSinker: '지그헤드 1/4~3/8oz or 묶음추 16~20호',
      hookRig: '지그헤드 바늘 + 3인치 그럽웜 or 세이코 바늘 12~14호',
      bait: '그럽웜 or 청갯지렁이',
      action: '바닥 여밭 틈새를 툭툭 치며 호핑.',
      isLureApplicable: true,
    },
    recommendedRig: {
      lure: '지그헤드 1/4~3/8oz + 3인치 그럽웜',
      bait: '청갯지렁이',
      line: '합사 1.0호 + 카본 2.5호',
      hookWeight: '1/4~3/8oz 지그헤드 or 16호 원투 봉돌',
      action: '바닥 돌 틈새를 콕콕 찍으며 슬로우 드래깅',
    },
    feedingStrategy: '주행성으로 낮 동안 갯바위 여밭 틈새에서 먹이를 찾습니다.',
    goldenHoursText: (_sunrise, _sunset, _mul) =>
      `낮 09:00 ~ 16:00, 들물 진행 시 바위 틈 활성 상승`,
  },
  노래미: {
    speciesName: '노래미',
    primaryMethod: 'LURE',
    primaryMethodName: '루어 & 원투 겸용',
    methodBadgeColor: METHOD_STYLES.LURE,
    rig: {
      methodType: 'LURE',
      methodName: '지그헤드 바닥 탐색 채비',
      rodReel: '루어대 ML + 2500번 릴',
      mainLine: '합사 0.8~1.0호',
      leaderSinker: '지그헤드 1/4oz',
      hookRig: '그럽웜 3인치 or 청갯지렁이',
      bait: '청갯지렁이',
      action: '바닥 돌 틈새를 두드림.',
      isLureApplicable: true,
    },
    recommendedRig: {
      lure: '지그헤드 1/4oz + 3인치 그럽웜',
      bait: '청갯지렁이',
      line: '합사 0.8~1.0호',
      hookWeight: '지그헤드 1/4oz',
      action: '바닥 호핑',
    },
    feedingStrategy: '여밭 틈새에서 갯지렁이와 작은 갑각류를 쪼아먹습니다.',
    goldenHoursText: (_sunrise, _sunset) => `주간 10:00 ~ 15:00`,
  },
  전갱이: {
    speciesName: '전갱이',
    primaryMethod: 'LURE',
    primaryMethodName: '아징 마이크로 루어 / 카드채비',
    methodBadgeColor: METHOD_STYLES.LURE,
    rig: {
      methodType: 'LURE',
      methodName: '아징 0.8~1.5g 마이크로 지그헤드 채비',
      rodReel: '아징 전용 엑스트라 패스트 UL대 + 1000~2000번 릴',
      mainLine: '에스테르 라인 0.25~0.35호 + 쇼크리더 0.6~0.8호',
      leaderSinker: '아징 전용 오픈벤트 지그헤드 0.8~1.5g',
      hookRig: '1.5~2인치 슬림 스트레이트 웜',
      bait: '루어 웜 or 크릴 미끼 찌낚시',
      action: '표층~중층 텐션 폴링 중 톡 하는 흡입 어신에 즉각 챔질.',
      isLureApplicable: true,
    },
    recommendedRig: {
      lure: '아징 마이크로 지그헤드 0.8~1.5g + 2인치 슬림 웜',
      bait: '크릴, 청갯지렁이 토막',
      line: '에스테르 0.3호 + 쇼크리더 0.8호',
      hookWeight: '1.0g 내외 지그헤드',
      action: '중층 트위칭 후 텐션 폴링 중 톡 치는 흡입 즉시 손목 챔질',
    },
    feedingStrategy: '야간 집어등 불빛 아래 표·중층에서 요각류와 치어를 사냥합니다.',
    goldenHoursText: (_sunrise, _sunset, _mul) =>
      `야간 20:00 ~ 01:00 집어등 불빛 주변`,
  },
  고등어: {
    speciesName: '고등어',
    primaryMethod: 'LURE',
    primaryMethodName: '라이트 쇼어지깅 / 카드채비',
    methodBadgeColor: METHOD_STYLES.LURE,
    rig: {
      methodType: 'LURE',
      methodName: '소형 메탈지그 10~20g 캐스팅 채비',
      rodReel: '루어대 L~ML + 2500번 릴',
      mainLine: '합사 0.6~0.8호 + 쇼크리더 2.0호',
      leaderSinker: '마이크로 메탈지그 10~20g (어시스트훅 장착)',
      hookRig: '메탈지그 어시스트훅 or 카드채비 6~8호',
      bait: '메탈지그 or 크릴',
      action: '고속 리트리브 및 저킹 후 폴링.',
      isLureApplicable: true,
    },
    recommendedRig: {
      lure: '마이크로 메탈지그 10~20g or 3g 지그헤드',
      bait: '크릴, 꽁치 살',
      line: '합사 0.6~0.8호 + 쇼크리더 2.0호',
      hookWeight: '메탈 10~20g',
      action: '캐스팅 후 중층 고속 릴링 & 폴링',
    },
    feedingStrategy: '떼를 지어 맹렬한 속도로 베이트피시를 쫓습니다.',
    goldenHoursText: (sunrise, sunset, _mul) =>
      `아침 해창(${sunrise}) 및 해질녘(${sunset}) 1시간 피딩`,
  },
  삼치: {
    speciesName: '삼치',
    primaryMethod: 'LURE',
    primaryMethodName: '쇼어지깅 고속 릴링 전용',
    methodBadgeColor: METHOD_STYLES.LURE,
    rig: {
      methodType: 'LURE',
      methodName: '메탈지그 30~40g 초고속 릴링 채비',
      rodReel: '쇼어지깅대 9ft M~MH + 4000번 고속 스피닝릴 (기어비 6.2:1)',
      mainLine: '합사 1.0~1.5호 + 와이어 목줄 10cm or 카본 5호',
      leaderSinker: '메탈지그 30~40g (블루/핑크)',
      hookRig: '메탈지그 리어 트레블훅 + 프론트 어시스트훅',
      bait: '메탈지그 인조 루어',
      action: '원투 후 바닥 또는 중층에서 릴 손잡이가 안 보일 정도의 초고속 리트리브.',
      isLureApplicable: true,
    },
    recommendedRig: {
      lure: '메탈지그 30~40g (블루/실버/핑크)',
      bait: '루어 전용 (생미끼 미사용)',
      line: '합사 1.2~1.5호 + 와이어 10cm or 쇼크리더 5호',
      hookWeight: '30~40g 메탈지그',
      action: '원투 후 릴이 부서져라 초고속 리트리브(빠를수록 반응 급상승)',
    },
    feedingStrategy: '날카로운 이빨로 멸치를 반토막 내며 고속 돌진하므로 빠른 속도가 생명입니다.',
    goldenHoursText: (sunrise, _sunset, _mul) =>
      `아침 일출(${sunrise}) 전후 2시간 수면 베이트 보일링 시간`,
  },
  방어: {
    speciesName: '방어',
    primaryMethod: 'LURE',
    primaryMethodName: '헤비 쇼어지깅 / 팝핑',
    methodBadgeColor: METHOD_STYLES.LURE,
    rig: {
      methodType: 'LURE',
      methodName: '쇼어지깅 메탈 40~60g & 펜슬 탑워터',
      rodReel: '쇼어지깅 MH~H + 5000~6000번 고속 릴',
      mainLine: '합사 2.0~3.0호 + 카본 쇼크리더 6.0~8.0호',
      leaderSinker: '메탈지그 40~80g or 포퍼/펜슬 40g',
      hookRig: '지깅 전용 헤비 어시스트훅 4/0~5/0',
      bait: '인조 루어 or 생미끼(전갱이 통마리 외줄)',
      action: '원거리 장타 후 하이피치 쇼트 저킹 반복.',
      isLureApplicable: true,
    },
    recommendedRig: {
      lure: '메탈지그 40~80g or 펜슬베이트 40g',
      bait: '살아있는 전갱이',
      line: '합사 2.0~3.0호 + 쇼크리더 30~40lb',
      hookWeight: '40~80g 메탈지그',
      action: '힘찬 원투 후 연속 하이피치 저킹',
    },
    feedingStrategy: '거센 물골에서 멸치 떼를 수면으로 몰아붙여 보일링을 일으킵니다.',
    goldenHoursText: (sunrise, _sunset, _mul) =>
      `새벽 일출(${sunrise}) 직후 및 사리 물때 조류 급류 시간`,
  },
  '부시리 (히라마사)': {
    speciesName: '부시리 (히라마사)',
    primaryMethod: 'LURE',
    primaryMethodName: '헤비 쇼어지깅 / 팝핑',
    methodBadgeColor: METHOD_STYLES.LURE,
    rig: {
      methodType: 'LURE',
      methodName: '파워 쇼어지깅 & 탑워터 플러깅',
      rodReel: '헤비 쇼어지깅 H대 + 6000~8000번 스피닝릴',
      mainLine: '합사 3.0~4.0호 + 카본 쇼크리더 10호',
      leaderSinker: '메탈지그 60~100g or 펜슬베이트 60g',
      hookRig: '대물 싱글 어시스트훅 5/0 이상',
      bait: '루어 or 생미끼',
      action: '조류 물골 방향으로 원투 후 빠른 피치 저킹.',
      isLureApplicable: true,
    },
    recommendedRig: {
      lure: '메탈지그 60~100g or 플로팅 펜슬',
      bait: '산 전갱이',
      line: '합사 3~4호 + 쇼크리더 40~50lb',
      hookWeight: '60~100g',
      action: '본류대 파워 저킹 및 탑워터 파동 연출',
    },
    feedingStrategy: '갯바위 턱이나 수중 여를 끼고 쏜살같이 회유하며 베이트를 삼킵니다.',
    goldenHoursText: (_sunrise, _sunset, _mul) =>
      `사리 물때의 거센 조류 분출 시간 및 일출 피딩`,
  },
  양태: {
    speciesName: '양태',
    primaryMethod: 'LURE',
    primaryMethodName: '바닥 지그헤드 루어 (원투 겸용)',
    methodBadgeColor: METHOD_STYLES.LURE,
    rig: {
      methodType: 'LURE',
      methodName: '지그헤드/다운샷 바닥 드래깅 채비',
      rodReel: '루어대 M~MH 8ft + 2500~3000번 릴',
      mainLine: '합사 1.0~1.2호 + 쇼크리더 3.0호',
      leaderSinker: '지그헤드 1/2~3/4oz or 프리리그 싱커 18~24g',
      hookRig: '3.5~4인치 섀드웜 or 청갯지렁이',
      bait: '섀드웜 or 청갯지렁이',
      action: '모래/뻘 바닥에 바짝 붙여 먼지를 일으키며 릴링 및 숏 호핑.',
      isLureApplicable: true,
    },
    recommendedRig: {
      lure: '지그헤드 1/2~3/4oz + 4인치 섀드웜 (바닥 먼지 유발)',
      bait: '청갯지렁이, 생새우',
      line: '합사 1.0호 + 쇼크리더 3.0호',
      hookWeight: '1/2~3/4oz 지그헤드',
      action: '바닥을 긁으며 숏 호핑 → 턱 하는 강한 입질 시 후킹',
    },
    feedingStrategy: '모래뻘에 몸을 묻고 눈만 내놓은 채 지나가는 작은 물고기를 덮칩니다.',
    goldenHoursText: (_sunrise, _sunset, _mul) =>
      `여름철 낮 10:00 ~ 16:00 수온이 오르는 중들물 타임`,
  },
  성대: {
    speciesName: '성대',
    primaryMethod: 'SURF_CASTING',
    primaryMethodName: '원투 묶음추 & 마이크로 루어',
    methodBadgeColor: METHOD_STYLES.SURF_CASTING,
    rig: {
      methodType: 'SURF_CASTING',
      methodName: '모래밭 원투 묶음추 & 마이크로 메탈 채비',
      rodReel: '원투대 or 루어대 ML~M + 2500번 릴',
      mainLine: '합사 1.0~1.5호 or 나일론 3호',
      leaderSinker: '15~20호 원투 묶음추 or 15g 마이크로 메탈지그',
      hookRig: '세이코 12~14호 바늘 or 메탈지그 바늘',
      bait: '청갯지렁이 (원투 시) or 메탈지그',
      action: '모래밭 바닥을 살살 끌어주면 가슴지느러미로 바닥을 짚으며 덤벼듦.',
      isLureApplicable: true,
    },
    recommendedRig: {
      lure: '마이크로 메탈지그 10~15g or 3/8oz 지그헤드 웜',
      bait: '청갯지렁이 2~3cm 토막',
      line: '합사 0.8~1.0호',
      hookWeight: '15호 묶음추 or 15g 메탈',
      action: '모래 바닥 착저 후 툭툭 끌어오기',
    },
    feedingStrategy: '모래 바닥에서 게와 작은 조개를 섭이하며 꾸우욱 소리를 냅니다.',
    goldenHoursText: (_sunrise, _sunset, _mul) =>
      `초여름~가을 낮 09:00 ~ 15:00 맑은 바다`,
  },
  쏨뱅이: {
    speciesName: '쏨뱅이',
    primaryMethod: 'LURE',
    primaryMethodName: '바닥 암초 지그헤드 루어 / 외줄',
    methodBadgeColor: METHOD_STYLES.LURE,
    rig: {
      methodType: 'LURE',
      methodName: '지그헤드 3/8oz 바닥 직벽 공략 채비',
      rodReel: '루어대 ML + 2000~2500번 릴',
      mainLine: '합사 0.8~1.0호 + 쇼크리더 2.5호',
      leaderSinker: '지그헤드 1/4~3/8oz',
      hookRig: '그럽웜 3인치 or 청갯지렁이/미꾸라지',
      bait: '그럽웜 or 미꾸라지',
      action: '바닥 착저 후 작은 호핑.',
      isLureApplicable: true,
    },
    recommendedRig: {
      lure: '지그헤드 1/4~3/8oz + 3인치 그럽웜',
      bait: '미꾸라지, 청갯지렁이',
      line: '합사 0.8~1.0호 + 쇼크리더 2.5호',
      hookWeight: '1/4~3/8oz 지그헤드',
      action: '바닥 착저 후 1바퀴 감고 스테이',
    },
    feedingStrategy: '암초 구멍에 은신해 있다가 머리 위를 지나가는 먹이를 즉각 삼킵니다.',
    goldenHoursText: (_sunrise, _sunset) => `일몰 전후 및 야간 시간대`,
  },
};

/**
 * 어종명으로 추천 채비 및 전략 정보 조회 (부분 일치 매칭 지원)
 */
export function getSpeciesRigInfo(speciesName: string): SpeciesRigInfo {
  const normalized = speciesName.replace(/\s+/g, '');
  if (SPECIES_RIG_DATABASE[speciesName]) {
    return SPECIES_RIG_DATABASE[speciesName];
  }
  if (SPECIES_RIG_DATABASE[normalized]) {
    return SPECIES_RIG_DATABASE[normalized];
  }
  const found = Object.values(SPECIES_RIG_DATABASE).find(
    (info) => {
      const dbNorm = info.speciesName.replace(/\s+/g, '');
      return dbNorm.includes(normalized) || normalized.includes(dbNorm);
    }
  );
  if (found) return found;

  // 기본 Fallback (바다 범용 루어/생미끼)
  return {
    speciesName,
    primaryMethod: 'LURE',
    primaryMethodName: '바다 범용 루어 / 생미끼',
    methodBadgeColor: METHOD_STYLES.LURE,
    rig: {
      methodType: 'LURE',
      methodName: '범용 지그헤드 및 생미끼 채비',
      rodReel: '바다 루어대 ML 7~8ft + 2500번 릴',
      mainLine: '합사 1.0호 + 카본 쇼크리더 2.5호',
      leaderSinker: '지그헤드 3/8oz or 고리봉돌 10~15호',
      hookRig: '3인치 그럽웜 or 세이코 바늘 12호',
      bait: '청갯지렁이, 생새우, 그럽웜',
      action: '바닥 착저 후 천천히 감아들이며 숏 호핑 액션 부여.',
      isLureApplicable: true,
    },
    recommendedRig: {
      lure: '범용 지그헤드 3/8oz + 3인치 그럽웜 또는 20g 스푼/메탈',
      bait: '청갯지렁이, 생새우 (가장 무난한 생미끼)',
      line: '합사 1.0호 + 카본 쇼크리더 2.5호',
      hookWeight: '조류 세기에 맞춘 1/4 ~ 1/2oz 봉돌',
      action: '바닥 착저 후 천천히 감아들이며 숏 호핑 액션 부여',
    },
    feedingStrategy: '조류가 흐르기 시작하는 물돌이 타임 및 일출/일몰 시간대에 입질 확률이 가장 높습니다.',
    goldenHoursText: (sunrise, sunset) =>
      `일출(${sunrise}) 및 일몰(${sunset}) 전후 1.5시간 피딩 타임`,
  };
}
