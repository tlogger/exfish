# 🎣 ExFish - 스마트 바다낚시 & 비거리/물때 예측 플랫폼

한국 연안 갯바위·방파제·해변 낚시 포인트, KHOA 공식 7일 조석 예보·수온·조류, 채비별 공기역학 비거리/침강 물리 엔진, 실시간 출조 조과 기록을 제공하는 반응형 웹·Android(Capacitor) 하이브리드 플랫폼입니다.

---

## 🌟 주요 기능

1. **KHOA 공식 조석·해양 기상 연동**
   - 국립해양조사원(KHOA) 스마트조석예보 및 공공데이터 OpenAPI 연동 (Vercel Edge Rewrite `/api-khoa`, `/api-swtc` 기반 CORS 우회).
   - 항포구별 종속항 조석 개정수 및 72시간 물때·풍향·풍속·조류 시각화.
2. **채비 비거리 & 수심 침강 물리 엔진**
   - 로드(UL~H 루어대, 원투대), 합사(PE), 미끼(루어 g/oz/주꾸미·에기, 캐스팅볼, 메탈지그 1~80g)별 비거리 반경 및 침강 시간·조류 드리프트 계산.
3. **카카오맵 포인트 탐색 & 소셜 연동**
   - 카카오맵 기반 포인트 마커, 풍향/조류 방향 오버레이, 포인트 등록·공유 및 카카오내비/로드뷰 연결.
   - 카카오·네이버·구글 간편 로그인 및 Supabase 클라우드 동기화.

---

## 🚀 개발 및 배포 (Vercel)

```bash
# 의존성 설치
npm install

# 로컬 개발 서버 실행
npm run dev

# 단위 테스트 및 프로덕션 빌드 검증
npm test
npm run build

# Vercel 프로덕션 자동 배포 (GitHub origin/main 연동)
git push origin main
```

- **프로덕션 URL**: `https://exfish.vercel.app`
- Vercel CLI로 수동 배포할 때는 `npx vercel link`로 프로젝트를 연결한 뒤 `npm run deploy` (`npx vercel --prod --yes`)를 실행합니다.
