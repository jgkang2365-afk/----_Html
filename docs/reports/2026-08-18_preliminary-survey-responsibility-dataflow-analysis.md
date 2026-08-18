# 예비조사 책임·데이터 흐름 분리 분석

- 실행일: 2026-08-18
- 브랜치: `feature/preliminary-survey-v2-automation-pause` (HEAD 51704b2)
- 작업 유형: **READ-ONLY 분석/설계 전용** (코드 수정·DB 변경·migration·UI 구현 없음)
- 목적: 측정대상사업장 관리를 측정계획 원천정보 입력부로 단순화하고, 예비조사 계획·추천·조정을 예비조사 영역에서 독립 수행하도록 재구성하기 위한 설계자료 작성

> 결론 구분 표기
> - **[사실]** : 현재 코드/DB/schema에서 확인된 사실
> - **[업무규칙]** : 사용자 확정 업무 방향
> - **[제안]** : 분석을 바탕으로 한 기술 제안

---

## 1. 현재 기준선

| 항목 | 값 | 근거 |
|---|---|---|
| V2 plan 총 | 43건 | READ-ONLY 조회 |
| automatic / manual | 26 / 17 | 동일 |
| link set / null | 18 / 25 | 동일 |
| audit (exception_log) | 15건 | 동일 |
| 정책 `process_changed_preliminary_survey.enabled` | `false` | `preliminary_survey_policy_settings` |
| H0508 legacy | 08-03 1건 + 08-25 1건 | 1차/2차 정리 완료 |
| legacy `preliminary_survey` | 총 496건 유지 | READ-ONLY 조회 |

---

## 2. 현재 전체 데이터 흐름

```
측정대상사업장 저장 (PATCH/POST /api/businesses)
 ├─ 1. measurement_target_business UPDATE/INSERT        [사실]
 ├─ 2. Integrated Sync → legacy preliminary_survey      [사실] (측정일별 1행 미러링)
 │      └─ syncBusinessToCalendar → Google Calendar      [사실] (legacy 행이 캘린더 원천)
 ├─ 3. ensureV2PlanForTarget / reconcileV2AfterTargetChange → V2 plan  [사실] (정책 OFF 시 paused)
 │      └─ persist_preliminary_survey_v2_plan_batch RPC
 └─ 4. V2 plan 조회 → 응답 (preliminarySurveyV2Plan)

예비조사 화면 (app/survey/page.tsx)
 ├─ GET /api/survey → legacy preliminary_survey + V2 plan 조인 [사실]
 ├─ SurveyForm POST/PUT → legacy 행 저장                 [사실]
 └─ V2 계획 탭 → GET /api/preliminary-survey-v2/plans    [사실] (카드형, 읽기 전용)

측정일지 등록 (POST /api/journal)
 ├─ measurement_journal INSERT + sequence_number 부여     [사실]
 ├─ target is_registered=확정, journal_id 연동            [사실]
 ├─ syncBusinessToCalendar                                [사실]
 └─ V2 자동 생성 경로 없음 (V2는 읽기만)                  [사실]
```

---

## 3. 측정대상사업장 저장 흐름

### 3-1. PATCH `/api/businesses` 단일 요청에 혼재된 책임

| 처리 | 현재 실행 위치 | 현행 필요성 | 향후 위치 | 분리 필요 |
|---|---|---|---|---|
| measurement_target_business 저장 | `app/api/businesses/route.ts:683-697` | 필수 | 측정대상사업장 | 유지 |
| 보조 필드 동기화(관할/좌표/국고/마스터) | `route.ts:661-747, 913-1000` | 필수(현행 운영) | 측정대상사업장 | 유지 |
| **legacy preliminary_survey 동기화 (Integrated Sync)** | `route.ts:749-910` | **현행 운영 필수** (예비조사 목록·캘린더·이전데이터 원천) | 판정 (섹션 4) | **유지 권장, V2와 분리** |
| **V2 plan 자동생성 (ensureV2PlanForTarget)** | `route.ts:1047-1051` | 향후 제거 대상 | 예비조사 영역 | **YES** |
| V2 재추천 (reconcileV2AfterTargetChange) | `route.ts:1034-1046` | 향후 제거 대상(자동) | 예비조사 영역 | **YES** |
| 예비조사자 추천/예·측 계산 | `lib/preliminary-survey-v2/*` | V2 영역 책임 | 예비조사 | YES |

**[사실]** `PATCH /api/businesses` 하나가 측정계획 저장 + legacy 동기화 + V2 plan 자동생성/재추천을 모두 수행한다. 이 3책임이 같은 요청에 결합돼 있다.

### 3-2. POST `/api/businesses` (신규 등록)

**[사실]** `app/api/businesses/create/route.ts:114`에서 생성 직후 `ensureV2PlanForTarget` 호출. 정책 OFF면 paused 반환으로 자동 생성 없음. legacy 생성은 PATCH 경로의 Integrated Sync가 담당하며 create 경로에서는 확인되지 않음(신규 등록은 측정일 미입력 상태가 일반적).

### 3-3. 변경 유형별 트리거

| 변경 | 트리거 함수 | V2 영향 | 근거 |
|---|---|---|---|
| 보고서 담당자(measurer_id) 변경 | V2 재추천 **아님** | 없음(재추천 사유 아님) | `route.ts:1012-1016`, docs 규칙 §1.1 |
| 연계측정자(link_measurer_id) 변경 | `responsibleChanged` → reconcile | 재추천(정책 ON 시) | `route.ts:1014-1016` |
| 측정예정일 변경 | `steadyStateTriggered` | 재추천/갱신 | `route.ts:1027-1031, 1031-1052` |
| 실제 측정자(collaborators/daily_staff) 변경 | `staffChanged` → steadyState | 재추천/갱신 | `route.ts:1028-1030` |
| 사업장명 변경 | Integrated Sync | 표시 동기화 | `route.ts:757, 863` |
| business_type/process_changed/기간 변경 | reconcile | 재추천 | `service.ts:390-398` |

**[제안]** 목표 구조에서는 V2 자동 재추천 경로를 `businesses` PATCH에서 제거하고, 측정대상 저장은 원천정보 반영만 수행한다. 이후 예비조사 영역이 변경 이벤트를 감지해 재검토 대상으로 표시한다.

---

## 4. legacy `preliminary_survey` 역할 명확화

### 4-1. 현재 역할 목록

| 역할 | 사용처 | 근거 |
|---|---|---|
| 예비조사 목록 데이터 원천 | `/api/survey` GET | `app/api/survey/route.ts:257-262` |
| Google Calendar 이벤트 원천 | `syncBusinessToCalendar` | `lib/google/sync-service.ts:51-56, 92-100` |
| 측정대상 measurement_date/collaborators 역산 | `syncBusinessSchedule` | `lib/utils/survey-sync.ts:17-97` |
| 측정일지 이전데이터(예비조사자/공시료) | `previous-data` | `app/api/journal/previous-data/route.ts:198-213` |
| 요약 테이블 | `/api/summary` | `app/api/summary/route.ts:124-128` |
| 대시보드 보고서 담당 | `/api/dashboard` | `app/api/dashboard/route.ts:190-195` |
| 문서 스냅샷 | `document-generation/snapshot.ts` | `:176-184` |
| 관리자 정비 화면 비교 | `admin-repair` | `app/api/preliminary-survey-v2/admin-repair/route.ts:74-83` |
| 엑셀 내보내기 | `/api/export/survey` | `app/api/export/survey/route.ts:18-21` |

### 4-2. 질문별 답변

| 질문 | 답변 | 근거 |
|---|---|---|
| Q1. 역할은? | 예비조사 목록·수정·캘린더·이전데이터·요약·문서의 **기존 운영 원천** | 섹션 4-1 |
| Q2. 측정대상 저장 직후 반드시 필요한 정보? | 측정일(measurement_date)과 실측정자(actual_measurer), 보고서담당(report_writer)이 존재해야 캘린더/목록이 정상 동작 | `sync-service.ts:92-100`, `route.ts:858-864` |
| Q3. 예비조사자 미정이어도 행 필요? | **필요.** preliminary_surveyor가 null이어도 행은 캘린더·목록에 사용됨(실측정자/보고서담당으로 일정 표시) | `sync-service.ts:103-121` (preliminary_surveyor 미사용) |
| Q4. 향후에도 Integrated Sync 유지? | **유지 권장** — V2와 무관한 기존 운영 기능. 단 V2 자동생성과 분리해야 함 | 이번 진단(legacy 5건 유지 판정) |
| Q5. 동기화 필드 범위? | measurement_date/end_date/actual_measurer/report_writer/business_name. **preliminary_surveyor는 Integrated Sync가 건드리지 않음** | `route.ts:858-864` |
| Q6. 계획 저장 시점에만 생성 가능? | **가능성 있음** — 그러나 캘린더·목록이 측정일+실측정자 정보에 의존하므로, 생성 시점을 옮기면 기존 목록/캘린더가 공백이 될 수 있음. **[제안]** 단계적으로: 우선 V2 자동생성만 제거, legacy sync는 유지 | `sync-service.ts:92-100` |
| Q7. 캘린더가 legacy 행 존재에 의존? | **그렇다.** legacy 행 없으면 이벤트 생성 없음, 기존 이벤트는 orphan 정리로 삭제 | `sync-service.ts:51-56, 196-228` |

**[제안]** legacy sync는 "측정계획 원천정보의 표시 파생"으로 유지하되, `ensureV2PlanForTarget`/`reconcile`(V2 자동화)만 제거한다. 이렇게 하면 기존 운영(목록·캘린더·문서)은 그대로 동작하고 결합점만 분리된다.

---

## 5. V2 plan 역할과 자동화 경로

### 5-1. V2 책임 전체 목록

| 기능 | 함수/위치 | 호출자 | 읽기 | 쓰기 | 실행 방식 | 사업장 결합 | 새 구조 재사용 |
|---|---|---|---|---|---|---|---|
| steady-state 자동 생성 | `ensureV2PlanForTarget` `service.ts:484` | businesses PATCH/create | target/users/journal/blocks/plan | v2_plans (batch RPC) | 자동 | **강결합** | 폐기(자동화) 후 예비조사 영역으로 |
| 대상 변경 재조정 | `reconcileV2AfterTargetChange` `service.ts:364` | businesses PATCH | target/plan/users/journal | v2_plans | 자동 | **강결합** | 폐기(자동화), 이벤트 기반 재검토로 |
| 추천 계산 | `calculateV2Recommendations` `service.ts:174` | recommendAndPersistV2, dry-run | target/users/journal/plan | 없음(순수 계산) | 선택 | 중간 | **수정 후 재사용** |
| 추천 저장 | `persistV2Recommendations` `service.ts:324` | recommendAndPersistV2 | - | v2_plans | 선택 | 중간 | **수정 후 재사용** |
| 수동 plan 저장 | `/api/preliminary-survey-v2/[targetId]` PATCH | 측정대상 모달 | target/users | v2_plans | 사용자 | 중간 | **재사용** (가확정 저장 경로) |
| 묶음 추천 | `/api/preliminary-survey-v2/group-recommend` GET | 측정대상 모달 | target/users/journal/blocks | 없음 | 사용자 | 중간 | **재사용** (예비조사 화면 이동) |
| 묶음 확정 | `confirmGroupRecommendation` `service.ts:803` | 측정대상 모달 | target/users/journal/plan | v2_plans + link | 사용자 | 중간 | **재사용** |
| 관리자 예외 정비 | `admin-repair` RPC | 측정대상 모달 | - | v2_plans + link + audit | 사용자 | 중간 | **재사용** |
| 경력/인력 판정 | `recommendBatch` `engine.ts:222` | 계산 경로 | - | - | 계산 | 없음 | **그대로 재사용 가능** (유틸) |
| 날짜 계산 | `recommendationDates` `calendar.ts` | engine/group | - | - | 계산 | 없음 | **그대로 재사용 가능** |
| 예·측 후보 | `suggestLinkMeasurerCandidates` `link-measurer.ts:64` | 측정대상 모달 | target/users/plan | 없음 | 계산 | 중간 | **재사용** |

### 5-2. 정책 OFF가 막는/통과시키는 경로

**막는 경로(자동화):**
- `ensureV2PlanForTarget` (businesses PATCH/create) — paused 반환
- `reconcileV2AfterTargetChange` (businesses PATCH) — 미실행
- `/api/preliminary-survey-v2/recommend` — 403
- `/api/preliminary-survey-v2/group-recommend` — enabled:false
- `/api/preliminary-survey-v2/group-confirm` — 403

**OFF에도 동작(기존 운영):**
- measurement_target_business 저장 (legacy Integrated Sync 포함)
- `/api/survey` 목록·수정·삭제
- `/api/preliminary-survey-v2/[targetId]` 수동 plan 저장 (관리자)
- `admin-repair` 예외 정비
- plans GET 조회
- 캘린더 동기화

**[사실]** 정책 OFF 게이트는 V2 자동화 경로에만 적용되고, 기존 운영(legacy·목록·캘린더·수동 저장)은 영향받지 않는다. 이는 "V2 자동화만 분리 가능"함을 보여준다.

---

## 6. 예비조사 UI 현재 구조

| 화면 | 데이터 source | API | 수정 가능 | 저장 대상 | legacy/V2 의존 | 재사용 |
|---|---|---|---|---|---|---|
| 예비조사 목록 (테이블형) | `app/survey/page.tsx:890` | GET /api/survey | 목록 자체는 읽기 전용 | - | legacy + V2 조인 | **그대로 재사용** |
| 예비조사 등록/수정 모달 | `SurveyForm.tsx` | POST/PUT /api/survey | 예비조사일·조사자·방식·공시료 | legacy | legacy 전용 | **재사용** |
| V2 계획 탭 (카드형) | `PreliminarySurveyV2Plans.tsx:90` | GET /api/preliminary-survey-v2/plans | 없음(읽기 전용) | - | V2 | **수정 후 재사용** (테이블화) |
| 측정대상 수정 모달 내 V2 관리 | `MeasurementTargetBusinessManagement.tsx:3287-3356` | PATCH /v2/[targetId], /recommend, /group-* | 추천일·예비조사자·묶음 | V2 | V2 | **예비조사 화면 이동 대상** |
| 정책 패널 | `PreliminarySurveyPolicyPanel.tsx` | GET/PATCH /admin/preliminary-survey-policy | enabled·시작값 | policy_settings | - | **재사용** |

**[사실]** 예비조사 화면의 legacy 목록은 이미 **테이블형**이다. V2 계획 탭만 카드형이고, V2 추천/확정 기능의 진입점이 측정대상사업장 모달에 위치해 있다.

---

## 7. 측정자/조력자/보고서담당 데이터 의미

| 역할 | 필드/구조 | 의미 | 근거 |
|---|---|---|---|
| 보고서 담당자 | `measurer_id` | 보고서 작성·관리 책임. 실제 측정·예비조사와 무관 | `MeasurementTargetBusinessManagement.tsx:91`, docs §1.1 |
| 연계측정자(예·측) | `link_measurer_id` | 사업장 단위 1명, 예비조사자∩실측정자 | migration 20260816, docs §1.5 |
| 실제 측정 인력(단일일) | `collaborators` (쉼표 구분 이름) | 실제 측정 참여자 목록 | docs §1.2, link-measurer.ts:31-46 |
| 실제 측정 인력(다일) | `daily_staff` jsonb `[{date, measurer_id, collaborators[]}]` | 날짜별 인력 구성 | migration 20260411 |
| 공시료 | `preliminary_survey.survey_code` (원천: users.survey_code, 첫 측정자 이름 기준) | 메인 측정자 기준 코드 | `survey-assignment.ts:24-49,59` |

**[사실]**
- `measurer_id`는 "보고서 담당자"로 전수 사용되며 측정자로 취급하는 코드는 없음 (역할 분리 완료).
- 메인 측정자(대표)만의 단일 필드는 없음. `collaborators`/`daily_staff`가 인력 목록이고, "메인" 개념은 연계측정자(link_measurer_id)와 V2 responsible이 담당.
- 공시료는 `measurement_journal.survey_code`가 스키마에 없고, `preliminary_survey.survey_code`가 실질 원천. **첫 측정자(measurer 문자열 첫 이름) 기준**으로 계산되며 `measurer_id`와 무관.

**[업무규칙]** "공시료는 메인 측정자 기준이며 조력자는 조력자일 뿐" — 현재 구현은 `preliminary_survey.measurer` 문자열의 **첫 번째 이름**을 기준으로 하므로, "메인 측정자"가 첫 측정자로 정의되는 한 일치한다. 단, 이름 문자열 기준이므로 user_id 기반으로 견고화 여부는 후속 검토 항목이다.

---

## 8. 다일 측정 구조

### 8-1. H0508 사례 (정상 모델)

**[사실]**
- target: `measurement_date=08-03`, `measurement_end_date=08-25`, `daily_staff=[{08-03,강종구},{08-25,강종구}]`, `collaborators=강종구`
- legacy: 08-03 1행 + 08-25 1행 (측정일별 1행) — 중복 id 699 정리 후
- V2 plan: target당 1개 (UNIQUE + upsert) — 이틀이어도 1회
- measurement_journal: 1행, `measurement_start_date=08-03 ~ measurement_end_date=08-03` (현재는 1일만 등록), sequence_number=2

### 8-2. 구조 검증

| 구조 | 정상 모델 | 근거 |
|---|---|---|
| legacy | **측정일별 1행** (08-03 1행, 08-25 1행) | Integrated Sync가 date별 행 유지, `route.ts:845-874` |
| V2 | **target당 1 plan** (측정일이 여러 날이어도 1회) | `20260808_add_preliminary_survey_v2.sql:32` UNIQUE |
| journal | 측정기간을 1행의 start/end로 표현 | `001_initial_schema.sql:61-62` |

**[제안/위험]**
- legacy 중복 위험: DB에 UNIQUE 제약이 없고 응용 계층(measurement_date 기반 find)만으로 1행을 유지한다. H0508처럼 동시 요청/중간 상태에서 같은 측정일 2행이 생길 수 있다. **[제안]** 향후 migration에서 `(code,year,period,measurement_date)` UNIQUE(또는 partial index) 검토.
- V2는 target당 1 plan이라 측정일별 중복 plan은 구조상 불가능 (이번 사고에서 legacy 중복만 발생).

---

## 9. 예·측 구조

**[사실]**
- `link_measurer_id` 의미: 예비조사자 중 실제 측정에도 참여하는 1명 (`예비조사자 ∩ 전체 측정 참여자`).
- 후보 계산: `suggestLinkMeasurerCandidates` — 보고서 담당자가 실측정자에 포함되면 후보 우선, V2 예비조사자∩실측정자 = 1명이면 후보 제안. **자동 확정 아님** (`link-measurer.ts:64-86`).
- 다일: `collectMeasurementStaffNames`가 `collaborators` + `daily_staff[].collaborators` **합집합**을 사용 → "전체 측정기간 중 최소 하루 참여" 원칙과 일치 (`link-measurer.ts:31-46`).
- 보고서 담당자(`measurer_id`)는 후보 계산에 사용하지 않음 (`link-measurer.ts:6`).

**[업무규칙]** "예·측 = 예비조사자 ∩ 전체 측정 참여자, 보고서 담당자는 후보 계산에 사용 금지" — 현재 구현과 일치.

---

## 10. 측정일지/sequence_number 확정 경계

**[사실]**
- 측정일지 등록 = `measurement_journal` 행 INSERT (`app/api/journal/route.ts:698-702`).
- `sequence_number`는 nullable VARCHAR(10). 자동 부여(지청+년도+주기 max+1)가 기본, 수동 값 우선, `is_skip_numbering`이면 null (`number-assignment.ts:152-207, 345-351`).
- **sequence_number 없는 journal 행 존재 가능** (`is_skip_numbering`, 엑셀 미부여).
- 기존 확정 경계: 코드 전반이 `measurement_journal` code/year/period + `sequence_number IS NOT NULL`을 "확정"으로 사용 (`service.ts:502-507, 851`, `confirm` RPC, businesses 가드 `route.ts:489-505`).

**[업무규칙]** "측정일지 등록 이후 찐확정" — 등록 시점의 정확한 정의가 필요.

**[제안] 찐확정 경계 후보 (순서)**
1. `measurement_journal` 행 존재 (code/year/period) — 측정일지 등록 자체
2. `sequence_number` 부여 — 기존 V2 보호 기준
3. `is_registered=확정` (target 역동기화) — 등록 직후 설정됨

현재 구현이 이미 사용 중인 **`sequence_number IS NOT NULL`**을 최소 변경으로 유지하되, "측정일지 등록 = journal 행 존재"를 보조 기준으로 추가하는 것을 제안한다. `is_skip_numbering`(기타매출) 사업장은 sequence_number가 없어도 확정 대상이어야 하므로, **단독 기준으로 sequence_number를 고집하면 안 된다**.

---

## 11. 현재 결합점과 문제점

| # | 결합점 | 근거 | 위험 |
|---|---|---|---|
| 1 | **businesses PATCH가 V2 plan 자동생성** | `route.ts:1047-1051` | 측정계획 저장이 예비조사까지 자동 생성 (정책 OFF 이전엔 오자동 발생 원인) |
| 2 | **측정대상 모달이 예비조사 plan을 동시 관리** | `MeasurementTargetBusinessManagement.tsx:3287-3356, 3554-3684` | 예비조사 기능이 측정대상 화면에 종속 |
| 3 | **저장 1회가 legacy/V2/Calendar 동시 수행** | `route.ts:749-910, 1031-1052` | 책임 경계 불명, 한 요청 오류 시 다중 부작용 |
| 4 | **recommendAndPersistV2가 manual plan 덮어쓸 수 있음** | `service.ts:337` (항상 automatic), reconcile 경로에 manual 보호 없음 | 사용자 수동 확정이 자동 재추천으로 소실 위험 (정책 OFF라 현재 비활성) |
| 5 | **정책 게이트 비대칭** | `ensureV2PlanForTarget`는 target 컨텍스트, reconcile/recommend/group은 전역만 | 적용 시작값 이후 대상과 이전 대상의 게이트 차이 |
| 6 | **legacy 중복 행 가능 (UNIQUE 없음)** | `001_initial_schema.sql` 제약 없음, 응용 레벨만 유지 | H0508 같은 중복 발생 |
| 7 | **repo 스키마 drift** | `is_registered` BOOLEAN 정의 vs 문자열 사용, `year/period` migration 누락 등 | 분석·구현 시 혼란 |

---

## 12. 재사용 가능한 V2 자산

| 분류 | 자산 | 코드 위치 | 이유 |
|---|---|---|---|
| 그대로 재사용 | 경력/인력 판정 `recommendBatch` | `engine.ts:222` | pure 계산, target 결합 없음 |
| 그대로 재사용 | 날짜 계산 `recommendationDates` | `calendar.ts` | pure 함수 |
| 그대로 재사용 | 예·측 후보 `suggestLinkMeasurerCandidates` | `link-measurer.ts:64` | target read + 제안 |
| 그대로 재사용 | 조사방식 매핑 `surveyMethodForKind` | `types.ts:2-6` | 결정적 매핑 |
| 그대로 재사용 | 감사구조 `preliminary_survey_exception_log` + admin_repair | migration 20260817 | 확정 후 정비 감사 |
| 수정 후 재사용 | 추천 계산 `calculateV2Recommendations` | `service.ts:174` | 날짜 단위 전체 조합으로 확장 |
| 수정 후 재사용 | 묶음 추천/확정 | `service.ts:665,803` | 예비조사 화면으로 이동, 저장 독립화 |
| 수정 후 재사용 | 수동 plan 저장 `[targetId]` PATCH | route | 가확정 저장 경로로 활용 |
| 수정 후 재사용 | 정책 게이트 `isPreliminarySurveyV2AutomationEnabled` | `policy.ts:98` | 예비조사 영역 게이트로 이관 |
| 폐기/비활성 | 측정대상 저장 직후 V2 자동생성 | `route.ts:1047-1051` | 목표 구조에서 제거 |
| 폐기/비활성 | reconcile 자동 재추천 결합 | `service.ts:364` | 이벤트 기반 재검토로 대체 |

---

## 13. 분리/폐기해야 할 기능

| 기능 | 현재 위치 | 처리 | 이유 |
|---|---|---|---|
| businesses PATCH 내 ensureV2PlanForTarget | `route.ts:1047-1051` | **제거(비활성)** | 측정대상 저장은 원천정보만 |
| businesses PATCH 내 reconcileV2AfterTargetChange | `route.ts:1034-1046` | **제거(비활성)** | 자동 재추천 금지, 변경 이벤트로 대체 |
| 측정대상 모달 내 V2 추천/묶음 UI | `MeasurementTargetBusinessManagement.tsx` | **예비조사 화면 이동** | 책임 분리 |
| swapBaeAndKim 하드코딩 | `MeasurementTargetBusinessManagement.tsx:1994-2033` | **제거 후보 (사용자 승인 필요)** | 일회성 인원 교체 규칙 |
| V2 자동화 경로의 정책 OFF 게이트 | 각 route/service | **유지(안전장치)** | Phase별 구현에서 계속 사용 |

---

## 14. 목표 책임 구조

| 영역 | 담당 |
|---|---|
| 측정대상사업장 | 보고서 담당·측정예정일·메인 측정자·조력자·다일 인력 등 **원천정보 입력/보존** (legacy 표시 동기화 유지) |
| 예비조사 영역 | 유형 판정·가능일·가용성·경력·동선·예비조사자 추천·예·측 후보·날짜별 일괄추천·사용자 조정·가확정 저장·변경 재검토·찐확정 보호 |

**[업무규칙]** 측정대상 저장 시 예비조사일 결정/예비조사자 추천/예·측 자동확정/묶음추천/plan 자동생성을 하지 않는다. 다만 legacy 목록·캘린더용 표시 동기화(measurement_date/actual_measurer/report_writer)는 기존 운영상 유지한다.

---

## 15. 목표 데이터 흐름

```
[1단계] 측정대상사업장 저장 (원천정보)
   보고서담당 · 측정예정일 · 메인측정자 · 조력자 · 다일인력
   → measurement_target_business
   → (유지) legacy 표시 동기화 + 캘린더
   → (제거) V2 plan 자동생성/재추천

[2단계] 예비조사 화면이 원천정보 조회

[3단계] 날짜별 추천 계산 (유형/날짜/직원/경력/동선/업무량)

[4단계] 사용자 결과 조정

[5단계] 사업장별 가확정 저장 (v2_plans, plan_origin)

[6단계] 측정계획 변경 → 영향 대상 재검토 표시

[7단계] 측정일지 등록 → 찐확정 보호
```

**[제안]** 현재 DB 구조(`measurement_target_business` 원천 + `preliminary_survey_v2_plans` 계획 저장)를 그대로 활용 가능. legacy sync는 유지하면서 V2 자동화만 예비조사 영역으로 이관하는 흐름이 최소 변경이다.

---

## 16. 테이블형 예비조사 메인 화면 방향

**[업무규칙]** 메인 화면은 테이블형 기본. 컬럼 예시: 상태 | 예비조사일 | 코드 | 사업장명 | 구분 | 측정예정일 | 예비조사자 | 방식 | 메인측정자 | 조력자 | 보고서담당 | 충돌. 상단: 예비조사일 조회·일괄추천·충돌만 보기·가확정 보기·최초실시 보기.

**[사실/제안]**
- 기존 `app/survey/page.tsx:890`의 legacy 목록이 이미 테이블형이라 테이블 UI 골격 재사용 가능.
- V2 계획 탭(카드형 `PreliminarySurveyV2Plans.tsx:90`)을 테이블로 확장하고, 측정대상 모달의 추천/확정 기능을 예비조사 화면으로 이관.
- 새 화면은 **구현하지 않음**(이번 작업 범위 밖).

---

## 17. 날짜 단위 일괄추천 방향

**[업무규칙]**
- 추천 기본 단위는 "사업장 1개 자동추천"이 아니라 **"예비조사일 단위 전체 조합 추천"**.
- 흐름: 예비조사일 선택 → 후보 사업장 전체 조회 → 최초실시 우선 → 타기관 신규 → 기존업체 유연 배치 → 인력 가용성 → 동선 → 경력 → 배정량 → 전체 조합 → 사용자 검토.
- 불가능 시 병목 원인·불가능 대상·대체 날짜·대체 인력조합 제시.
- **추천과 저장 분리**: 추천은 일시적 계산 결과, 저장은 사업장별 독립 plan. 영구 그룹 생성 금지.

**[사실]** 현재 `recommendBatch`는 target 단위 순차 계산이고 전체 조합 최적화는 아니다. `group-recommend`는 지역/날짜 그룹핑만 수행. 날짜 단위 전체 조합 엔진은 **신규 구현 필요**.

**[사실/규칙 구분]** 추천 우선순위: ① 법적/업무 hard constraint ② 동선/거리 ③ 경력·인력 ④ 업무량 균형(soft) ⑤ 사용자 조정. 업무량 균형은 hard가 아니며 동선이 나빠지며 억지 균등배분 금지. 고정 조사자 조합 전제 금지.

---

## 18. 가확정/찐확정 설계

**[업무규칙]**
- **추천**: 저장 전 계산 결과 (영구 저장 없음).
- **가확정**: 사용자가 예비조사 계획 저장. 측정일지 등록 전까지 재검토 가능하되, **자동 덮어쓰기 금지** — 새 추천 결과를 사용자에게 제시.
- **찐확정**: 측정일지 등록 이후. 자동 변경 금지, 관리자 예외 정비만 가능.

**[사실/제안]**
- 현재 `plan_origin`(automatic/manual)이 가확정의 실질 근사값. manual = 사용자 저장/확정.
- 찐확정 경계: `measurement_journal` 존재 + `sequence_number` 부여 (기존 코드 기준)를 유지하되, `is_skip_numbering` 사업장도 확정 취급 필요 → **[제안]** "journal 행 존재"를 주 기준, sequence_number를 보조로.
- 가확정 상태를 별도 컬럼으로 추가하기 전에 기존 `plan_origin`/`status` 재사용 우선.

---

## 19. 변경 영향 재검토 설계

**[제안] 변경 유형별 영향 (전체 초기화 금지)**

| 변경 | 재추천 필요 | 표시만 갱신 | 영향 없음 | 근거 |
|---|---|---|---|---|
| 측정예정일 | 가능성 높음(날짜 후보·동선·가용성) | - | - | 날짜 의존 |
| 메인측정자/조력자 | 예·측 교집합 영향 | - | - | 참여 조건 |
| 보고서 담당자 | **아니오** | - | 예 | docs §1.1 |
| 사업장명 | 아니오 | yes | - | 표시 동기화 |
| link_measurer_id | 예(재검토) | - | - | responsible 변경 |
| business_type/기간 | 예 | - | - | 유형/날짜 |

**[제안]** 변경 감지는 businesses API에서 하되, 자동 재추천 대신 "영향 대상 = 재검토 필요 상태"로 표시하고 예비조사 화면에서 사용자가 새 추천을 요청.

---

## 20. DB 변경 필요성

| 항목 | 판정 | 근거 |
|---|---|---|
| 기존 컬럼으로 충분? | 대부분 충분 | v2_plans + target 원천 + legacy 유지 |
| 상태 컬럼(가확정/찐확정 별도) | **필요 시 추가, 우선 기존 재사용** | `plan_origin`/`status` + journal 존재로 판정 가능 |
| 추천 run/session 영구 저장 | **불필요** | 추천은 일시 계산(§15) |
| 일괄추천 결과 영구 저장 | **불필요** | 사업장별 독립 저장 원칙 |
| legacy `(code,year,period,measurement_date)` UNIQUE | **권장(신규)** | H0508 중복 방지 |
| repo 스키마 drift 정리 | **권장(별도)** | is_registered 타입 등 |
| migration | **이번 작업에서 하지 않음** | 분석만 |

---

## 21. 구현 단계 제안

분석된 코드 의존관계를 반영한 안전 순서:

| Phase | 내용 | 비고 |
|---|---|---|
| **A** | 측정대상사업장 ↔ V2 자동생성 결합 제거 (ensureV2PlanForTarget/reconcile 호출 비활성) | policy OFF와 동일 효과를 코드로 고정. 기존 운영 무영향 |
| **B** | 예비조사 테이블형 조회 구조 (V2 계획 탭 테이블화 + 예비조사 화면으로 추천/확정 진입 이관) | legacy 목록 테이블 재사용 |
| **C** | 사업장 유형/날짜 후보 계산 분리 (최초실시 -3 역방향·타기관 신규 -30 정방향 탐색 확장) | 현재는 new 공통 -30부터 |
| **D** | 날짜 단위 전체 추천 엔진 (사업장 독립 계산 → 일자 조합) | 저장 분리 원칙 유지 |
| **E** | 가확정 저장 (plan_origin=manual 재사용, 사용자 조정 UI) | |
| **F** | 변경 영향 재검토 (이벤트/표시 기반, 자동 덮어쓰기 금지) | |
| **G** | 측정일지 등록 찐확정 경계 강화 (is_skip_numbering 고려) | |
| **H** | 운영 DB 과거자료 역산 검증 | |
| **I** | 정책 ON | 마지막 단계 |

**[제안]** Phase A를 최우선 추천. 현재 policy OFF가 이미 이 효과를 내고 있으므로, Phase A는 "OFF 상태를 코드로 고정(자동화 경로 제거)"하여 향후 ON 전환 시에도 결합점이 없도록 하는 안전장치다. 이후 B~D에서 추천 계산을 예비조사 영역으로 이관.

---

## 22. 위험요소

| # | 위험 | 완화 |
|---|---|---|
| 1 | Phase A로 V2 자동화 제거 후 policy ON 시 아무 것도 생성 안 됨 | Phase I(정책 ON) 전에 새 추천 경로 완비 |
| 2 | legacy sync를 잘못 제거하면 목록/캘린더 공백 | legacy sync 유지 원칙 고정 |
| 3 | manual plan 덮어쓰기 위험 | recommendAndPersistV2에 plan_origin 보호 추가 |
| 4 | `recommendAndPersistV2` 자동 automatic 덮어쓰기 | 가확정 저장 시 manual 보호 로직 필수 |
| 5 | repo 스키마 drift로 구현 혼란 | 별도 스키마 정리 작업 선행 권장 |
| 6 | 찐확정 경계가 sequence_number 단일 기준이면 기타매출 누락 | journal 존재 + sequence_number 복합 기준 |

---

## 23. 다음 작업 권장안

**[제안] 최우선: Phase A — 측정대상사업장 ↔ V2 자동생성 결합 제거**
- `app/api/businesses/route.ts:1034-1052`의 `ensureV2PlanForTarget`/`reconcileV2AfterTargetChange` 호출을 제거·비활성화.
- V2 자동화는 예비조사 영역(API/화면)에서만 수동·명시적으로만 실행.
- legacy Integrated Sync·캘린더·기존 목록은 유지 (기존 운영 무영향).
- 검증: 기존 테스트(`preliminary-survey-v2-automation-pause.test.ts` 등) + PATCH 저장 후 V2 plan 미생성 확인.

---

## 부록. 분석에 사용한 주요 파일

- `app/api/businesses/route.ts` (PATCH Integrated Sync + V2 트리거)
- `app/api/businesses/create/route.ts` (신규 등록)
- `app/api/survey/route.ts`, `app/api/survey/[id]/route.ts` (legacy 예비조사)
- `lib/preliminary-survey-v2/service.ts`, `engine.ts`, `calendar.ts`, `policy.ts`, `link-measurer.ts`, `manual-validation.ts`
- `lib/google/sync-service.ts`, `lib/utils/survey-sync.ts`, `lib/utils/survey-assignment.ts`, `lib/utils/survey-sequence.ts`, `lib/utils/number-assignment.ts`
- `app/api/journal/route.ts`, `[id]/route.ts`, `previous-data`, `upload`
- `app/api/preliminary-survey-v2/*` (recommend/group-recommend/group-confirm/admin-repair/plans/[targetId])
- `components/features/MeasurementTargetBusinessManagement.tsx`, `PreliminarySurveyV2Plans.tsx`, `SurveyForm.tsx`, `app/survey/page.tsx`
- `docs/business-rules/preliminary-survey.md`
- `supabase/migrations/*.sql`, `lib/db/migrations/*.sql`

민감정보(비밀값·운영 DB 접속정보·개인정보 원문)는 포함하지 않았다.
