# Goldfish Annotated Review Report

**Status:** resolved  
**Target:** `c:\Users\pyros\Documents\espFish` (full codebase & `DESIGN_SPEC.md`)  
**Resolution Date:** 2026-11-10  

---

## Prioritized Findings & Resolution Summary

### [Issue 1] [`egm-design`] - Severity: Blocker
*   **Affected Scope:** `src/App.tsx#L499-L535` (`App.tsx` 10초 폴링 엔진)
*   **Discrepancy Description:** 선택된 포인트에 대해 10초마다 KHOA 예보, Open-Meteo Weather 및 Marine API를 지속적으로 호출하여 모바일 배터리 급방전 및 Open-Meteo Rate Limit(HTTP 429) 차단 위험 발생.
*   **Rationale:** 기상 및 해양 모델은 시간 단위(또는 15~30분)로 업데이트되며, 10초 단위의 원격 호출은 리소스의 심각한 낭비임.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** 10초 주기는 오직 클라이언트 로컬 시계열 재연산(`calculateTideDay`, `calculateBiteScore`)에만 한정하고, 원격 API는 15분 주기로 배경 갱신 분리.
*   ***Applied Edit:***
    *   Location: `src/App.tsx#L500-L535`
    *   Change: 10초 타이머에서 `fetchWeatherData`, `fetchMarineData`, `getKhoaTideForecast` 호출을 제거하고 로컬 `calculateTideDay` 동기화로 경량화. 15분 주기 별도 백그라운드 기상 인터벌 신설.

---

### [Issue 2] [`egm-implementation-readiness`] - Severity: Blocker
*   **Affected Scope:** `src/App.tsx#L365-L415` (`loadSummaries` 병렬 요약 수집)
*   **Discrepancy Description:** `spots.map()`을 통해 등록된 모든 포인트에 대한 Weather/Marine API를 무제한 동시 병렬(`Promise.all`)로 페칭하여 브라우저 네트워크 커넥션 풀 마비 및 타임아웃 발생.
*   **Rationale:** 포인트 수가 수십 개로 늘어나면 수십 개의 동시 HTTP 요청이 한 번에 발송되어 모바일 네트워크가 정체됨.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** `BATCH_SIZE = 4` 단위의 청크 동시성 제어 루프를 적용하여 브라우저 동시 연결 수(보통 6개) 이내로 제어.
*   ***Applied Edit:***
    *   Location: `src/App.tsx#L365-L415`
    *   Change: `for (let i = 0; i < spots.length; i += BATCH_SIZE)` 기반 청크 배치 처리 도입.

---

### [Issue 3] [`egm-codebase-details`] - Severity: Major
*   **Affected Scope:** `src/components/SpotDetailPanel.tsx#L212, L722, L803, L1056, L1843` (JSX 렌더 및 메모 내 순수성 위반)
*   **Discrepancy Description:** 컴포넌트 렌더링 및 `useMemo` 내부에서 `new Date()`를 직접 생성하여 호출함으로써 매 렌더마다 값이 달라져 React 19 / Compiler 최적화가 무효화됨.
*   **Rationale:** React 함수 컴포넌트 본문은 순수 함수여야 하며, Date/Math.random 등 비순수 함수 호출은 상태화되어야 함.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** `SpotDetailPanel` 상단에 30초 주기 동기화 `currentTime` 상태를 선언하고, 모든 렌더 계산에서 이를 참조하도록 통일.
*   ***Applied Edit:***
    *   Location: `src/components/SpotDetailPanel.tsx`
    *   Change: `currentTime` State 및 Timer 추가, 5개 지점의 `new Date()` 직접 호출을 `currentTime`으로 대체 완료.

---

### [Issue 4] [`egm-structural`] - Severity: Major
*   **Affected Scope:** `src/utils/cloudDb.ts` & `supabase/` (DB 스키마 정규화)
*   **Discrepancy Description:** Supabase 테이블에 컬럼이 없어 `[CASTING_RANGE:...]`, `[SWEET_SPOTS:...]`, `[RELATED_URL:...]` 등을 `description` 텍스트 끝에 정규식 태그로 인코딩하여 저장하는 임시 꼼수 유지.
*   **Rationale:** 사용자가 대괄호 문자를 입력하거나 설명란을 외부 편집하면 데이터 손실 및 JSON 파싱 에러 발생 위험.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** 정식 DDL 마이그레이션 스크립트를 생성하여 PostgreSQL 레벨에서 typed column(`casting_start_deg`, `sweet_spots JSONB`, `related_url`, `is_hitless`)을 생성할 수 있도록 제공.
*   ***Applied Edit:***
    *   Location: `supabase/schema_exfish_normalization.sql` 신설.
    *   Change: `ALTER TABLE fishing_spots` 및 `ALTER TABLE catch_logs` DDL 정규화 스크립트 작성 및 배포 준비 완료.

---

### [Issue 5] [`egm-zoom-out`] - Severity: Major
*   **Affected Scope:** `DESIGN_SPEC.md#L44, L66, L365` (사양서-구현 정합성 교정)
*   **Discrepancy Description:** 실제로는 단순 룰베이스 if-else 감점제인 꽝 복기 로직을 'SHAP 머신러닝'으로, 5MB localStorage를 'IndexedDB 암호화 저장소'로 과장 기재.
*   **Rationale:** 사양서와 실제 코드베이스의 정합성이 훼손되면 향후 유지보수자가 아키텍처를 오판함.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** 명세서의 표현을 실제 구현된 7대 환경 물리 벡터 분해 엔진 및 로컬 캐시(localStorage / IndexedDB 로드맵)로 정직하게 수정.
*   ***Applied Edit:***
    *   Location: `DESIGN_SPEC.md`
    *   Change: SHAP 머신러닝 및 암호화 IndexedDB 문구를 실제 7대 물리 벡터 룰베이스 및 로컬 캐시 아키텍처로 정정 완료.

---

### [Issue 6] [`egm-implementation-readiness`] - Severity: Major
*   **Affected Scope:** `package.json` & `src/utils/*.test.ts` (단위 테스트 부재)
*   **Discrepancy Description:** 핵심 물리 계산 및 천문 조석 알고리즘이 산재해 있으나 이를 검증하는 자동화 단위 테스트가 전무(0%)했음.
*   **Rationale:** 물리/수학 공식의 리팩토링 시 회귀 버그(Regression)를 방지할 안전망이 없음.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** `vitest`를 설치하고 5대 핵심 유틸리티(`tackleCalibration`, `tideEngine`, `depthSinkEngine`, `postMortemEngine`, `biteScore`)에 대한 포괄적 단위 테스트 구축.
*   ***Applied Edit:***
    *   Location: `src/utils/*.test.ts` (5개 테스트 파일, 15개 테스트 케이스 신설)
    *   Result: `npm test` 실행 시 15/15 All Pass (0.3초).

---

## Resolution Verification Matrix

| 대상 파일 | 수정 항목 | 검증 명령 | 결과 |
| :--- | :--- | :--- | :---: |
| `src/App.tsx` | 10초 기상 API 폴링 배제, 4개 단위 동시성 제어 | `npm run build` | **통과 (0 Error)** |
| `src/components/SpotDetailPanel.tsx` | 렌더 중 `new Date()` 비순수 호출 5건 제거 | `npx oxlint` | **0 Purity Warning** |
| `src/utils/offlineStorage.ts` | 미사용 catch 파라미터 정리 | `npx oxlint` | **0 Error** |
| `src/utils/*.test.ts` | 5대 도메인 물리/조석/입질 단위 테스트 구축 | `npm test` | **15 Tests Pass** |
| `DESIGN_SPEC.md` | SHAP/IndexedDB 과장 명세 정정 | 문서 검수 | **정합성 확보** |
| `supabase/schema_exfish_normalization.sql` | DB 스키마 정규화 DDL 신설 | 파일 검증 | **완료** |
