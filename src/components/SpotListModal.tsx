import React from 'react';
import {
  Compass,
  Filter,
  Flame,
  List,
  MapPin,
  Navigation2,
  SlidersHorizontal,
  Thermometer,
  Waves,
  Wind,
  X,
  Star
} from 'lucide-react';
import type {
  CurrentUnit,
  FishingMethod,
  FishingSpot,
  WindUnit
} from '../types';
import {
  formatCurrentVelocity,
  formatWindSpeed,
} from '../utils/weatherApi';
import { getDistanceKm } from '../utils/tideEngine';

export type SpotSortOption = 'BITESCORE' | 'DISTANCE' | 'NAME' | 'LATEST';

export interface SpotRealtimeSummary {
  temp: number;
  weatherText: string;
  windSpeed: number;
  windDir: number;
  seaTemp: number;
  waveHeight: number;
  currentVel: number;
  currentDir: number;
  mulText: string;
  tideHeight: number;
  biteScore: number;
  distanceKm?: number;
}

interface SpotListModalProps {
  isOpen: boolean;
  onClose: () => void;
  spots: FishingSpot[];
  selectedSpot: FishingSpot | null;
  onSelectSpot: (spot: FishingSpot) => void;
  environmentMap: Record<string, SpotRealtimeSummary>;
  windUnit: WindUnit;
  currentUnit: CurrentUnit;
  currentUserId?: string;
  userCoords?: { lat: number; lng: number } | null;
  favoriteSpotIds?: string[];
  onToggleFavorite?: (spotId: string) => void;
}

export const SpotListModal: React.FC<SpotListModalProps> = ({
  isOpen,
  onClose,
  spots,
  selectedSpot,
  onSelectSpot,
  environmentMap,
  windUnit,
  currentUnit,
  currentUserId,
  userCoords,
  favoriteSpotIds = [],
  onToggleFavorite,
}) => {
  const [filterMethod, setFilterMethod] = React.useState<FishingMethod | 'ALL'>('ALL');
  const [onlyMySpots, setOnlyMySpots] = React.useState(false);
  const [sortBy, setSortBy] = React.useState<SpotSortOption>('DISTANCE');
  const [searchFilter, setSearchFilter] = React.useState('');

  if (!isOpen) return null;

  // 필터링 적용
  const filtered = spots.filter((spot) => {
    if (onlyMySpots) {
      if (spot.user_id !== 'user-me' && spot.user_id !== currentUserId) {
        return false;
      }
    }
    if (filterMethod !== 'ALL' && !spot.fishing_methods.includes(filterMethod)) {
      return false;
    }
    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase();
      const matchName = spot.name.toLowerCase().includes(q);
      const matchSpecies = spot.target_species.some((s) => s.toLowerCase().includes(q));
      const matchLoc = spot.directions.toLowerCase().includes(q);
      if (!matchName && !matchSpecies && !matchLoc) return false;
    }
    return true;
  });

  // 정렬 적용
  const sorted = [...filtered].sort((a, b) => {
    const envA = environmentMap[a.id];
    const envB = environmentMap[b.id];

    if (sortBy === 'BITESCORE') {
      const scoreA = envA?.biteScore ?? 50;
      const scoreB = envB?.biteScore ?? 50;
      return scoreB - scoreA;
    }
    if (sortBy === 'DISTANCE') {
      const distA = envA?.distanceKm ?? (userCoords ? getDistanceKm(userCoords.lat, userCoords.lng, a.lat, a.lng) : 999999);
      const distB = envB?.distanceKm ?? (userCoords ? getDistanceKm(userCoords.lat, userCoords.lng, b.lat, b.lng) : 999999);
      return distA - distB;
    }
    if (sortBy === 'NAME') {
      return a.name.localeCompare(b.name, 'ko');
    }
    // LATEST
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl text-white shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        {/* 모달 헤더 */}
        <div className="p-3.5 sm:p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-cyan-600/30 border border-cyan-500/50 flex items-center justify-center text-cyan-400">
              <List size={18} />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                낚시 포인트 리스트
                <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono">
                  {sorted.length}곳
                </span>
              </h2>
              <p className="text-[11px] text-slate-400">
                실시간 기상·해양·물때·입질지수를 한눈에 비교하고 탐색합니다.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition"
          >
            <X size={16} />
          </button>
        </div>

        {/* 필터 및 정렬 제어 툴바 */}
        <div className="p-3 bg-slate-900/90 border-b border-slate-800 flex flex-col gap-2 shrink-0">
          {/* 장르 & 내 포인트 & 검색 필터 */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-slate-400 flex items-center gap-1 text-[11px]">
                <Filter size={11} /> 장르:
              </span>
              {[
                { id: 'ALL', label: '전체' },
                { id: 'LURE', label: '🎣 루어' },
                { id: 'SURF', label: '⚓ 원투' },
                { id: 'FLOAT', label: '🔴 찌낚' },
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() => setFilterMethod(m.id as any)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${
                    filterMethod === m.id
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 font-bold'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {m.label}
                </button>
              ))}
              <button
                onClick={() => setOnlyMySpots(!onlyMySpots)}
                className={`px-2.5 py-1 rounded-full text-xs transition border ${
                  onlyMySpots
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 font-bold'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                {onlyMySpots ? '✓ 내 포인트만' : '내 포인트만'}
              </button>
            </div>

            {/* 내부 검색 인풋 */}
            <input
              type="text"
              placeholder="목록 내 명칭·어종 필터..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-400 w-full sm:w-44"
            />
          </div>

          {/* 소팅(정렬) 옵션 탭 */}
          <div className="flex items-center gap-1.5 overflow-x-auto text-[11px] pt-1 border-t border-slate-800/60">
            <span className="text-slate-400 flex items-center gap-1 shrink-0">
              <SlidersHorizontal size={11} /> 정렬:
            </span>
            {[
              { id: 'BITESCORE', label: '입질 지수' },
              { id: 'DISTANCE', label: `가까운 순${userCoords ? '' : ' (GPS 필요)'}` },
              { id: 'NAME', label: '가나다 순' },
              { id: 'LATEST', label: '최신 순' },
            ].map((s) => (
              <button
                key={s.id}
                onClick={() => setSortBy(s.id as SpotSortOption)}
                className={`px-2.5 py-1 rounded-lg shrink-0 font-medium transition ${
                  sortBy === s.id
                    ? 'bg-cyan-600 text-white font-bold shadow-sm'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* 포인트 카드 리스트 영역 (스크롤) */}
        <div className="flex-1 overflow-y-auto p-2 sm:p-3 space-y-2">
          {sorted.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs">
              선택한 조건에 부합하는 포인트가 없습니다.
            </div>
          ) : (
            sorted.map((spot) => {
              const env = environmentMap[spot.id];
              const isSelected = selectedSpot?.id === spot.id;

              return (
                <div
                  key={spot.id}
                  onClick={() => {
                    onSelectSpot(spot);
                    onClose();
                  }}
                  className={`p-3 rounded-xl border transition cursor-pointer hover:bg-slate-800/80 group ${
                    isSelected
                      ? 'bg-cyan-950/40 border-cyan-500/70 shadow-lg ring-1 ring-cyan-500/50'
                      : 'bg-slate-850/90 border-slate-800'
                  }`}
                >
                  {/* 상단 라인: 포인트 이름, 지형, 어종, 거리, 입질지수 */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap mb-1">
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-cyan-600/30 text-cyan-300 border border-cyan-500/40">
                          {spot.spot_type === 'ROCK' ? '갯바위' : spot.spot_type === 'SEAWALL' ? '석축' : spot.spot_type === 'BREAKWATER' ? '방파제' : spot.spot_type === 'BEACH' ? '해변/백사장' : '선착장'}
                        </span>
                        <h3 className="font-bold text-sm sm:text-base text-white group-hover:text-cyan-300 transition truncate">
                          {spot.name}
                        </h3>
                        {env?.distanceKm != null && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-amber-300 border border-slate-700 font-mono">
                            📍 {env.distanceKm.toFixed(1)} km
                          </span>
                        )}
                      </div>

                      {/* 위치/지명 및 주요 어종 */}
                      <div className="flex items-center gap-2 text-[11px] text-slate-400 flex-wrap">
                        {spot.navi_name ? (
                          <span className="text-amber-300 font-medium truncate max-w-[200px]">
                            목적지: {spot.navi_name}
                          </span>
                        ) : (
                          <span className="truncate max-w-[200px] flex items-center gap-0.5">
                            <MapPin size={11} className="text-slate-500" />
                            {spot.directions ? spot.directions.slice(0, 30) + '...' : `${spot.lat.toFixed(3)}, ${spot.lng.toFixed(3)}`}
                          </span>
                        )}
                        <span className="text-slate-600">|</span>
                        <span className="text-slate-300 truncate">
                          어종: {spot.target_species.join(', ')}
                        </span>
                        {spot.casting_directions && spot.casting_directions.length > 0 && (
                          <>
                            <span className="text-slate-600">|</span>
                            <span className="text-cyan-400 text-[10px]">
                              투척: {spot.casting_directions.includes('ALL') ? '전방위' : spot.casting_directions.join(',')}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* 우측: 즐겨찾기(별표) 버튼 & ExFish 입질 지수 뱃지 (요구사항 6) */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {onToggleFavorite && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleFavorite(spot.id);
                          }}
                          className={`p-2 rounded-xl border transition active:scale-90 ${
                            favoriteSpotIds.includes(spot.id)
                              ? 'bg-amber-500/20 text-amber-400 border-amber-500/50 shadow-sm'
                              : 'bg-slate-900 text-slate-500 border-slate-700/80 hover:text-amber-400'
                          }`}
                          title={favoriteSpotIds.includes(spot.id) ? '즐겨찾기(찜) 해제' : '즐겨찾기(찜) 등록'}
                          aria-label="즐겨찾기"
                        >
                          <Star
                            size={16}
                            className={favoriteSpotIds.includes(spot.id) ? 'fill-amber-400 text-amber-400' : ''}
                          />
                        </button>
                      )}

                      {/* ExFish 입질 지수 뱃지 */}
                      {env && (
                        <div className="flex flex-col items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br from-cyan-600 to-blue-700 text-white font-black shadow shrink-0">
                          <span className="text-[9px] opacity-80 leading-none">Ex</span>
                          <span className="text-base leading-none">{env.biteScore}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 하단 라인: 실시간 환경 정보 그리드 (모바일 2줄 반응형 레이아웃)
                      풍향/풍속, 조류, 수온, 날씨/기온, 물때, 조위 */}
                  {env ? (
                    <div className="mt-2.5 pt-2 border-t border-slate-800/80 grid grid-cols-3 sm:grid-cols-6 gap-1.5 text-[11px] text-slate-300">
                      {/* 1. 풍향·풍속 (말 없이 방향 화살표 + 풍속만 표시) */}
                      <div className="p-1.5 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center gap-1.5 truncate">
                        <Wind size={12} className="text-cyan-400 shrink-0" />
                        <div className="flex items-center gap-1 truncate">
                          <span
                            className="inline-flex items-center justify-center w-3.5 h-3.5 text-cyan-300 font-bold text-xs shrink-0"
                            style={{ transform: `rotate(${env.windDir}deg)` }}
                          >
                            ↓
                          </span>
                          <span className="font-bold text-cyan-300 font-mono">
                            {formatWindSpeed(env.windSpeed, windUnit)}
                          </span>
                        </div>
                      </div>

                      {/* 2. 조류·해류 (방향 화살표 + 유속만 표시) */}
                      <div className="p-1.5 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center gap-1.5 truncate">
                        <Compass size={12} className="text-emerald-400 shrink-0" />
                        <div className="flex items-center gap-1 truncate">
                          <span
                            className="inline-flex items-center justify-center w-3.5 h-3.5 text-emerald-300 font-bold text-xs shrink-0"
                            style={{ transform: `rotate(${env.currentDir}deg)` }}
                          >
                            ↑
                          </span>
                          <span className="font-bold text-emerald-300 font-mono">
                            {formatCurrentVelocity(env.currentVel, currentUnit)}
                          </span>
                        </div>
                      </div>

                      {/* 3. 표층 수온 */}
                      <div className="p-1.5 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center gap-1.5 truncate">
                        <Thermometer size={12} className="text-rose-400 shrink-0" />
                        <div className="truncate">
                          <span className="text-[10px] text-slate-400 block -mb-0.5">수온</span>
                          <span className="font-bold text-rose-300 font-mono">
                            {env.seaTemp.toFixed(1)}°C
                          </span>
                        </div>
                      </div>

                      {/* 4. 날씨 & 기온 */}
                      <div className="p-1.5 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center gap-1.5 truncate">
                        <Waves size={12} className="text-blue-400 shrink-0" />
                        <div className="truncate">
                          <span className="text-[10px] text-slate-400 block -mb-0.5 truncate">
                            {env.weatherText}
                          </span>
                          <span className="font-bold text-blue-200 font-mono">
                            {env.temp.toFixed(1)}°C
                          </span>
                        </div>
                      </div>

                      {/* 5. 물때 */}
                      <div className="p-1.5 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center gap-1.5 truncate">
                        <span className="text-xs shrink-0">🌊</span>
                        <div className="truncate">
                          <span className="text-[10px] text-slate-400 block -mb-0.5">물때</span>
                          <span className="font-bold text-cyan-200">
                            {env.mulText}
                          </span>
                        </div>
                      </div>

                      {/* 6. 현재 조위 & 파고 */}
                      <div className="p-1.5 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center gap-1.5 truncate">
                        <span className="text-xs shrink-0">📏</span>
                        <div className="truncate">
                          <span className="text-[10px] text-slate-400 block -mb-0.5">
                            파고 {env.waveHeight.toFixed(1)}m
                          </span>
                          <span className="font-bold text-amber-300 font-mono">
                            {env.tideHeight} cm
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 text-[11px] text-slate-500 animate-pulse">
                      실시간 환경 데이터 수신 중...
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
