import { calculateTideDay, getMulInfo, getMoonAge, findNearestHarbor } from '../src/utils/tideEngine.ts';

console.log('===========================================================');
console.log('1. 오늘 날짜 (2026-11-10) 군산/통영 물때 검증 (바다타임 대조)');
console.log('===========================================================');
const todayDate = new Date('2026-11-10T12:00:00+09:00');
const gunsanTide = calculateTideDay(35.976, 126.554, todayDate);
const gunsanHarbor = findNearestHarbor(35.976, 126.554);
const tongyeongTideToday = calculateTideDay(34.84, 128.43, todayDate);
const tongyeongHarborToday = findNearestHarbor(34.84, 128.43);

console.log(`- 군산 (${gunsanHarbor.region}) : ${gunsanTide.mulText} (${gunsanTide.lunarDateStr}) -> 기대값: 8물 (바다타임 공식)`);
console.log(`- 통영 (${tongyeongHarborToday.region}) : ${tongyeongTideToday.mulText} (${tongyeongTideToday.lunarDateStr}) -> 기대값: 9물`);

if (gunsanTide.mulNumber === 8 && tongyeongTideToday.mulNumber === 9) {
  console.log('>>> [성공] 2026-11-10 군산 8물 / 통영 9물 정상 일치! 바다타임 오차 완전 해소!');
} else {
  console.error('>>> [실패] 2026-11-10 물때 불일치!');
  process.exit(1);
}

console.log('\n===========================================================');
console.log('2. 과거 검증일 (2026-10-27) 회귀 테스트');
console.log('===========================================================');
const testDate = new Date('2026-10-27T12:00:00+09:00');
const moonAge = getMoonAge(testDate);
const westMul = getMulInfo(moonAge, 'WEST');
const southMul = getMulInfo(moonAge, 'SOUTH');
console.log(`- 10-27 서해 : ${westMul.mulText} -> 기대값: 8물`);
console.log(`- 10-27 남해 : ${southMul.mulText} -> 기대값: 9물`);

if (westMul.mulNumber === 8 && southMul.mulNumber === 9) {
  console.log('>>> [성공] 2026-10-27 검증 통과!');
} else {
  console.error('>>> [실패] 2026-10-27 회귀 오류 발생!');
  process.exit(1);
}
