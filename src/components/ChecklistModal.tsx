import React from 'react';
import {
  CheckSquare,
  Square,
  Shield,
  Fish,
  Sun,
  Share2,
  RotateCcw,
  X,
  CheckCircle2,
} from 'lucide-react';

interface ChecklistItem {
  id: string;
  category: 'SAFETY' | 'TACKLE' | 'COMFORT';
  text: string;
  detail: string;
  essential?: boolean;
}

const DEFAULT_CHECKLIST: ChecklistItem[] = [
  // 1. 생명 안전 & 방재
  {
    id: 'safe-1',
    category: 'SAFETY',
    text: '구명조끼 (라이프자켓)',
    detail: '팽창식 가스 실린더 및 호루라기/스트랩 체결 점검',
    essential: true,
  },
  {
    id: 'safe-2',
    category: 'SAFETY',
    text: '갯바위 펠트/스파이크 슈즈',
    detail: '테트라포드 및 미끄러운 갯바위 실족/낙상 원천 방지',
    essential: true,
  },
  {
    id: 'safe-3',
    category: 'SAFETY',
    text: '방수 헤드랜턴 & 보조 배터리',
    detail: '야간 출조 및 해창/일몰 전후 시야 확보, C타입 충전선',
    essential: true,
  },
  {
    id: 'safe-4',
    category: 'SAFETY',
    text: '핀온릴 라인커터 & 포셉(바늘빼기)',
    detail: '밑걸림 시 빠른 합사 커팅 및 고기 입술 바늘 안전 제거',
    essential: false,
  },

  // 2. 태클 & 채비
  {
    id: 'tackle-1',
    category: 'TACKLE',
    text: '낚싯대(로드) & 릴',
    detail: '가이드 크랙 점검, 드랙 노브 팽팽함 세팅 확인',
    essential: true,
  },
  {
    id: 'tackle-2',
    category: 'TACKLE',
    text: '쇼크리더 & 합사 원줄',
    detail: '여밭 쓸림 대비 카본 2.5~3.5호 여분 스풀 준비',
    essential: true,
  },
  {
    id: 'tackle-3',
    category: 'TACKLE',
    text: '루어/웜/에기 & 지그헤드·봉돌',
    detail: '조류 세기별 1/4, 3/8, 1/2oz 봉돌 및 대상어 맞춤 미끼',
    essential: true,
  },
  {
    id: 'tackle-4',
    category: 'TACKLE',
    text: '두레박 & 피시그립 & 삐꾸통',
    detail: '손 씻기 및 바닷물 취수, 안전한 물고기 제압',
    essential: false,
  },

  // 3. 편의 & 위생 & 환경보호
  {
    id: 'comf-1',
    category: 'COMFORT',
    text: '아이스박스(쿨러) & 각얼음',
    detail: '잡은 고기 선도 유지 및 시원한 음료 보관',
    essential: true,
  },
  {
    id: 'comf-2',
    category: 'COMFORT',
    text: '종량제 쓰레기 봉투 (LNT 문화)',
    detail: '사용한 채비줄, 미끼 통 등 머문 자리 청소하기',
    essential: true,
  },
  {
    id: 'comf-3',
    category: 'COMFORT',
    text: '편광 선글라스 & 선크림',
    detail: '수면 반사광 차단(수중 여/베이트피시 관측) 및 자외선 보호',
    essential: false,
  },
  {
    id: 'comf-4',
    category: 'COMFORT',
    text: '모기·진드기 기피제 & 방수 장갑',
    detail: '갯바위 해충 방지 및 손 베임 보호',
    essential: false,
  },
];

interface ChecklistModalProps {
  isOpen: boolean;
  onClose: () => void;
  spotName?: string;
  mulText?: string;
}

export const ChecklistModal: React.FC<ChecklistModalProps> = ({
  isOpen,
  onClose,
  spotName = '출조 포인트',
  mulText = '물때 확인 요망',
}) => {
  const [checkedIds, setCheckedIds] = React.useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('exfish_checklist_v1');
      return saved ? JSON.parse(saved) : ['safe-1', 'safe-2'];
    } catch {
      return ['safe-1', 'safe-2'];
    }
  });

  const [copied, setCopied] = React.useState(false);

  // 로컬스토리지 자동 영구 저장
  const toggleItem = (id: string) => {
    setCheckedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id];
      try {
        localStorage.setItem('exfish_checklist_v1', JSON.stringify(next));
      } catch (e) {
        console.error(e);
      }
      return next;
    });
  };

  const handleReset = () => {
    if (confirm('체크리스트를 초기화하시겠습니까?')) {
      setCheckedIds([]);
      try {
        localStorage.removeItem('exfish_checklist_v1');
      } catch (e) {
        console.error(e);
      }
    }
  };

  const totalCount = DEFAULT_CHECKLIST.length;
  const completedCount = checkedIds.length;
  const percent = Math.round((completedCount / totalCount) * 100);

  // 동행 출조자 공유 메시지 생성
  const handleShare = async () => {
    const uncompleted = DEFAULT_CHECKLIST.filter((i) => !checkedIds.includes(i.id));
    const text = `[ExFish 🎒 출조 준비 & 안전 체크리스트]
📍 출조지: ${spotName} (${mulText})
📊 준비 완료도: ${completedCount}/${totalCount} (${percent}%)
${uncompleted.length > 0 ? `\n⚠️ 아직 챙기지 않은 품목:\n${uncompleted.map((u) => `· ${u.text}`).join('\n')}` : '\n🎉 모든 출조 준비가 완벽히 끝났습니다!'}
\n🦺 구명조끼와 갯바위 펠트화는 안전을 위해 필수입니다! 안전하고 즐거운 손맛 되세요!`;

    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      } else {
        alert(text);
      }
    } catch {
      alert(text);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg max-h-[90vh] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100">
        {/* 헤더 */}
        <div className="p-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/20 text-cyan-300 flex items-center justify-center">
              🎒
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-1.5">
                <span>출조 필수품 & 안전 점검표</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                  {spotName}
                </span>
              </h2>
              <p className="text-[11px] text-slate-400">
                출조 전 누락된 장비와 생명 안전 물품을 꼼꼼히 점검하세요.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* 진행률 바 */}
        <div className="px-4 py-3 bg-slate-850 border-b border-slate-800/80 space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="font-semibold text-slate-300 flex items-center gap-1">
              <CheckCircle2 size={13} className="text-cyan-400" /> 준비 진행률
            </span>
            <span className="font-mono font-bold text-cyan-300">
              {completedCount} / {totalCount} ({percent}%)
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-300 rounded-full"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        {/* 체크리스트 본문 (스크롤) */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {/* 섹션 1: 생명 안전 */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 font-bold text-rose-400 text-xs">
              <Shield size={14} />
              <span>1. 연안 안전 & 생명 보호 (필수)</span>
            </div>
            <div className="space-y-1.5">
              {DEFAULT_CHECKLIST.filter((i) => i.category === 'SAFETY').map((item) => {
                const isChecked = checkedIds.includes(item.id);
                return (
                  <div
                    key={item.id}
                    onClick={() => toggleItem(item.id)}
                    className={`p-2.5 rounded-xl border flex items-start gap-2.5 cursor-pointer transition select-none ${
                      isChecked
                        ? 'bg-slate-800/40 border-slate-700/60 opacity-60'
                        : 'bg-slate-800/90 border-slate-700 hover:border-cyan-500/60 shadow-sm'
                    }`}
                  >
                    <button type="button" className="pt-0.5 text-cyan-400 shrink-0">
                      {isChecked ? <CheckSquare size={17} /> : <Square size={17} className="text-slate-500" />}
                    </button>
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-bold ${isChecked ? 'line-through text-slate-400' : 'text-slate-100'}`}>
                          {item.text}
                        </span>
                        {item.essential && (
                          <span className="px-1 py-0.2 rounded bg-rose-500/20 text-rose-300 text-[9px] font-bold border border-rose-500/40">
                            필수
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 pt-0.5 leading-tight">{item.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 섹션 2: 태클 & 채비 */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 font-bold text-cyan-400 text-xs">
              <Fish size={14} />
              <span>2. 낚시 장비 & 채비 준비</span>
            </div>
            <div className="space-y-1.5">
              {DEFAULT_CHECKLIST.filter((i) => i.category === 'TACKLE').map((item) => {
                const isChecked = checkedIds.includes(item.id);
                return (
                  <div
                    key={item.id}
                    onClick={() => toggleItem(item.id)}
                    className={`p-2.5 rounded-xl border flex items-start gap-2.5 cursor-pointer transition select-none ${
                      isChecked
                        ? 'bg-slate-800/40 border-slate-700/60 opacity-60'
                        : 'bg-slate-800/90 border-slate-700 hover:border-cyan-500/60 shadow-sm'
                    }`}
                  >
                    <button type="button" className="pt-0.5 text-cyan-400 shrink-0">
                      {isChecked ? <CheckSquare size={17} /> : <Square size={17} className="text-slate-500" />}
                    </button>
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-bold ${isChecked ? 'line-through text-slate-400' : 'text-slate-100'}`}>
                          {item.text}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 pt-0.5 leading-tight">{item.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 섹션 3: 편의 & 보관 & LNT */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 font-bold text-emerald-400 text-xs">
              <Sun size={14} />
              <span>3. 보관, 편의 & 환경 보호 (LNT)</span>
            </div>
            <div className="space-y-1.5">
              {DEFAULT_CHECKLIST.filter((i) => i.category === 'COMFORT').map((item) => {
                const isChecked = checkedIds.includes(item.id);
                return (
                  <div
                    key={item.id}
                    onClick={() => toggleItem(item.id)}
                    className={`p-2.5 rounded-xl border flex items-start gap-2.5 cursor-pointer transition select-none ${
                      isChecked
                        ? 'bg-slate-800/40 border-slate-700/60 opacity-60'
                        : 'bg-slate-800/90 border-slate-700 hover:border-cyan-500/60 shadow-sm'
                    }`}
                  >
                    <button type="button" className="pt-0.5 text-cyan-400 shrink-0">
                      {isChecked ? <CheckSquare size={17} /> : <Square size={17} className="text-slate-500" />}
                    </button>
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-bold ${isChecked ? 'line-through text-slate-400' : 'text-slate-100'}`}>
                          {item.text}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 pt-0.5 leading-tight">{item.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 푸터 액션 버튼 */}
        <div className="p-3 border-t border-slate-800 bg-slate-950 flex items-center justify-between gap-2">
          <button
            onClick={handleReset}
            className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1 transition"
          >
            <RotateCcw size={12} /> 초기화
          </button>

          <button
            onClick={handleShare}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition shadow-lg ${
              copied
                ? 'bg-emerald-600 text-white'
                : 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-cyan-600/20'
            }`}
          >
            <Share2 size={13} />
            <span>{copied ? '📋 체크리스트가 복사되었습니다!' : '동행자에게 체크리스트 공유'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
