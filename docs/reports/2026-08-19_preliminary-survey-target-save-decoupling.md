# Phase A — 측정대상사업장 저장 ↔ 예비조사 V2 자동생성/재추천 결합 제거

- 실행일: 2026-08-19
- 브랜치: `feature/preliminary-survey-decouple-target-save` (base: origin/main ba66a2e, PR #34 머지 포함)
- 작업 유형: 코드 결합 제거 (V2 자동생성/재추천 호출 분리), schema/운영 데이터 변경 없음

> 결론 구분 표기
> - **[사실]** : 코드/운영 DB에서 직접 확인
> - **[제안]** : 기술적 구현 내용

---

## 1. 목적

측정대상사업장을 측정계획 원본(source of truth) 저장부로 단순화하고, 예비조사 V2 계획의 자동 생성/재추천 책임을 저장 경로에서 분리한다.

- 측정대상사업장 저장 시 V2 plan을 자동 생성/재추천하지 않는다.
- legacy `preliminary_survey` Integrated Sync는 유지한다.
- 새로운 추천 알고리즘은 구현하지 않는다.

---

## 2. 제거한 결합

### A. 신규 생성 직후

`app/api/businesses/create/route.ts`

- 제거: `ensureV2PlanForTarget(supabase, insertedData.id)` 호출
- 제거: 응답 `preliminarySurveyV2Plan` / `preliminarySurveyV2Notice`
- 제거: import `ensureV2PlanForTarget`

### B. 기존 사업장 수정(PATCH) 후 자동생성/재추천

`app/api/businesses/route.ts`

- 제거: `responsibleChanged` → `reconcileV2AfterTargetChange` 호출
- 제거: `steadyStateTriggered`(측정일/실측정자/사업장 유형/공정변경/기간 변경) → `ensureV2PlanForTarget` 호출
- 제거: 응답 `preliminarySurveyV2Notice` / `preliminarySurveyV2Plan`
- 제거: import `ensureV2PlanForTarget` / `reconcileV2AfterTargetChange` (GET용 `loadV2AutomationPolicy`는 유지)
- 유지: 측정일/실측정자/사업장 정보 저장, legacy Integrated Sync, GET 응답의 `preliminary_survey_v2_plan`(조회용)

### C. UI 후처리/문구

`components/features/MeasurementTargetBusinessManagement.tsx`

- 제거: 저장 응답 `preliminarySurveyV2Plan` 기반 수정 모달 즉시 갱신 블록
- 제거: "예비조사 계획 생성 대기", "저장하면 예비조사 계획이 자동 생성됩니다" 문구
- 변경: plan 없음 상태 → "아직 예비조사 계획이 없습니다." + "예비조사 일정·조사자는 예비조사 영역에서 별도 지정 (자동 생성되지 않습니다)"
- 유지: 정책 OFF 안내 배너("예비조사 자동추천 중지 상태")

---

## 3. 유지한 기능

- legacy `preliminary_survey` Integrated Sync (측정일별 1행 미러링)
- PR #34 legacy UNIQUE/UPSERT 방어 (`(code,year,period,measurement_date)` UNIQUE, `isLegacySurveyUniqueConflict`, 수동 필드 보존)
- `measurement_target_business` GET의 V2 plan 조회(읽기)
- V2 서비스 함수 자체 (`ensureV2PlanForTarget`/`reconcileV2AfterTargetChange`/`recommendAndPersistV2`/`recommendBatch` 등) — 삭제하지 않음
- V2 전용 API (`/api/preliminary-survey-v2/recommend`, `group-recommend`, `group-confirm`, `admin-repair`) + PAUSE 게이트
- `link_measurer_id` 필드, manual plan, audit 구조, 정책 OFF

---

## 4. 테스트

### 신규

`tests/preliminary-survey-target-save-decoupling.test.ts` (14건)

- PATCH/create에서 `ensureV2PlanForTarget`/`reconcileV2AfterTargetChange` 호출 없음
- 저장 응답에 `preliminarySurveyV2Plan`/`Notice` 자동생성 의존 없음
- UI 저장 응답 V2 즉시 갱신 없음 / 자동생성 전제 문구 없음
- legacy Integrated Sync 유지 / UNIQUE·UPSERT·excel-sync 유지
- V2 서비스 함수·전용 API·PAUSE 게이트·GET 조회 유지
- 저장 경로가 V2 실패에 의존하지 않음

### 수정 (설계 변경 반영)

- `tests/preliminary-survey-v2-steady-state.test.ts`: 저장 경로 결합 테스트 제거, 서비스 함수 순수 동작 테스트 유지
- `tests/preliminary-survey-v2-automation-pause.test.ts`: create/PATCH의 V2 호출 기대 → "호출 없음"으로 수정
- `tests/preliminary-survey-role-separation.test.ts`: PATCH 재추천 배선 테스트 → "호출 없음"으로 수정, plan 없음 문구 갱신
- `tests/preliminary-survey-v2-reconcile-change.test.ts`: PATCH→reconcile 배선 테스트 제거, reconcile 서비스 함수 자체 검증 유지
- `tests/preliminary-survey-legacy-unique-upsert.test.ts`: PAUSE 게이트 검증을 정책/서비스 레벨로 갱신

### 결과

- `npx tsc --noEmit`: 통과
- lint: 변경 파일 경고 0 (기존 1건 exhaustive-deps 경고는 이번 변경과 무관)
- 관련 테스트(decoupling/steady-state/PAUSE/legacy-unique/role-separation/reconcile/group/admin): 145/145 통과
- 전체 테스트: 449/453 — 실패 4건은 **변경 전 main에서도 동일하게 실패하던 기존 실패**
  - `national-support-flow-structure` (기존 알려진 실패)
  - `preliminary-survey-v2-3a-ui` 1건, `preliminary-survey-v2-persist-source-fix` 2건 (V2 migration 소스 검증, 이번 변경과 무관)

---

## 5. DB 영향

- schema 변경: **없음**
- 운영 데이터 변경: **없음** (READ-ONLY 확인만 수행)
- V2 plan 43건(auto 26/manual 17), audit 15, 정책 OFF — 이전 기준선과 동일

---

## 6. 정책

- `preliminary_survey_policy_settings.process_changed_preliminary_survey.enabled = false` 유지 확인
- 정책 ON 하지 않음

---

## 7. 브라우저 검증

- 로컬 dev 서버가 실행 중이지 않아 브라우저 직접 검증은 미수행.
- 코드/테스트/tsc/lint로 저장 경로 분리와 V2 자동생성 안내 제거를 검증. 운영 DB에 실제 사업장 수정을 수행하지 않음.

---

## 8. UI 보완 — 사업장 상세 수정 모달에서 예비조사 관련 UI 완전 제거 (PR #35 보완)

`components/features/MeasurementTargetBusinessManagement.tsx`에서 사업장 상세 수정 모달의 예비조사 관련 UI를 **완전히 제거**한다.

### 1차 보완 — 예비조사 정보 섹션 제거

- "예비조사 정보" 표시 섹션 전체 제거 (-181줄)
- 제거: 예비조사 정보 표시, 정책 중지 안내("예비조사 자동추천 중지"), plan 없음 안내, V2 plan 표시(예비조사일/조사방법/생성/예비조사자/예·측/상태 배지), "연결 정비" 진입 버튼

### 2차 보완 — 구형 "예비조사 자동추천 V2" 편집 UI 제거

- **"예비조사 자동추천 V2" 카드 전체 제거** (추천일 입력 · 예비조사자 체크박스 · "예비조사 계획 수정 저장" 버튼)
- `handleManualV2PlanChange` 핸들러(예비조사 전용 `[targetId]` PATCH 호출) 제거
- 모달 전용 helper 제거: `linkMeasurerCandidatesForForm` / `linkStatusForForm` / `v2SurveyorNames` / `actualMeasurerNames`
- 미사용 import 정리: `suggestLinkMeasurerCandidates`, `collectMeasurementStaffNames`
- 수정 모달에서 V2 plan 값을 직접 수정하는 편집 코드(추천일/참가자 onChange) 제거

### 최종 상태

- 사업장 상세 수정 모달에는 **예비조사 관련 UI 0개**
- 수정 모달은 **측정계획 원본 정보**(측정 정보·실시일·보고서 담당자·실측정자/조력자·다중 일자 배정·일자 추가·비고)만 다룸
- 유지: 관리자 예비조사 예외 정비 모달(별도 Modal), 목록 화면의 정책 OFF 안내/묶음 추천 버튼, `GET`의 V2 plan 조회(읽기)
- 예비조사 일정·조사자·추천·재검토·확정은 **예비조사 전용 영역** 책임으로 확정

---

## 8-1. 향후 필수 TODO — 구형 V2 데이터 정리 (별도 Phase)

기존 V2 DB와 데이터는 이번 작업에서 **삭제하지 않고 보존**한다.

- 과거 이력/참고 데이터로 유지
- 새 정책의 최종 추천 결과로 무조건 신뢰하지 않음
- 새 예비조사 시스템에서 필요 시 조회/참고 가능

**새 예비조사 시스템 안정화 후 별도 Phase로 반드시 수행:**

`구형 V2 데이터 분류 및 정리`

최소 분류:
- manual
- automatic
- 실제 사용/확정 이력
- 미사용
- 새 정책과 충돌
- 보존 필요
- 삭제 가능

그 후에만 삭제/이관/보존을 결정한다. 이 TODO는 **선택 사항이 아닌 예비조사 개편의 마감 작업**으로 기록한다.

---

## 9. 저장 경로 최종 구조

```
측정대상사업장 저장 (PATCH/POST)
 ├─ measurement_target_business 저장          (source of truth)
 ├─ 보조 동기화 (관할/좌표/국고/마스터)
 ├─ legacy preliminary_survey Integrated Sync (UNIQUE/UPSERT 방어 유지)
 ├─ syncBusinessToCalendar
 └─ 응답 (성공 + 기존 데이터)
    (V2 plan 자동 생성/재추천 없음)
```

---

## 10. 다음 단계

- 날짜 중심 예비조사 추천/재검토 구조 (별도 Phase)
- 기존 V2 plan의 `재검토 필요` 상태 (측정일/실측정자 변경 시 stale 처리)
- V2 추천 기능은 예비조사 전용 화면/API에서만 수행

---

## 부록. 변경 파일

- `app/api/businesses/route.ts` (PATCH V2 자동호출 제거, import 정리)
- `app/api/businesses/create/route.ts` (신규 생성 V2 자동호출 제거)
- `components/features/MeasurementTargetBusinessManagement.tsx` (UI 후처리/문구 정리 + 예비조사 정보 섹션 제거)
- `tests/preliminary-survey-target-save-decoupling.test.ts` (신규)
- `tests/preliminary-survey-v2-steady-state.test.ts`, `preliminary-survey-v2-automation-pause.test.ts`, `preliminary-survey-role-separation.test.ts`, `preliminary-survey-v2-reconcile-change.test.ts`, `preliminary-survey-legacy-unique-upsert.test.ts`, `preliminary-survey-admin-repair.test.ts` (설계 반영 수정)

민감정보(비밀값·DB 접속정보·개인정보 원문)는 포함하지 않았다.
