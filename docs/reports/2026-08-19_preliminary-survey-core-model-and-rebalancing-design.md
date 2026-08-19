# 예비조사 핵심 데이터 모델 및 재조정 설계

- 실행일: 2026-08-19
- 브랜치: `feature/preliminary-survey-v2-automation-pause` (작업 시작 기준 HEAD: 3ec7ac1)
- 작업 유형: **READ-ONLY 분석 + 설계 문서 작성 전용** (코드 수정·DB 변경·migration·UI 구현 없음)
- 기준 자료: `docs/reports/2026-08-18_preliminary-survey-responsibility-dataflow-analysis.md` (2차 분석 보고서)

> **정정 이력 (2026-08-19)**
> - 정정 1: 예비조사 3건/day cap 기준을 "보고서 담당" → **예비조사자/책임 조사자(responsible)** 로 수정 (§7).
> - 정정 2: 기존 데이터 migration의 메인 측정자 추정 규칙(보고서 담당자/link_measurer_id 기반) **제거** → 자동 추정 금지 + A/B/C 분류 (§31).
> - 정정 3: 공시료 C/CC/CCC 순번 기준을 **실제 측정 당일 방문순서**로 명확화. 예비조사 route evidence 사용 금지 (§4, §8, §30).
> - 보강: 초기 legacy 중복 전수검사 실행계획 구체화 (§16), `measurement_visit_order` 데이터 모델 반영 (§4).
> - 정정 4: 공시료 순번 필드를 `measurement_visit_order`/`measurement_route_order`로 완전 통일, 예비조사 route와 혼동될 표현 제거 (§4, §6, §8, §30).

> 결론 구분 표기
> - **[사실]** : 현재 코드/DB/schema에서 확인된 내용
> - **[업무규칙]** : 사용자 확정 업무 방향
> - **[제안]** : 분석을 바탕으로 한 기술 제안

---

## 1. 현재 기준선

| 항목 | 값 | 근거 |
|---|---|---|
| V2 plan 총 | 43건 | READ-ONLY 조회 |
| automatic / manual | 26 / 17 | 동일 |
| link set / null | 18 / 25 | 동일 |
| audit | 15건 | 동일 |
| 정책 `process_changed_preliminary_survey.enabled` | `false` | `preliminary_survey_policy_settings` |
| H0508 legacy | 08-03 1건 + 08-25 1건 | 정리 완료 |
| legacy `preliminary_survey` | 496건 | READ-ONLY 조회 |

---

## 2. 확정 업무규칙

이 설계의 최상위 업무 원칙 (2차 분석에서 사용자 확정):

1. **보고서 담당자(`measurer_id`) ≠ 실제 측정자.** 보고서 담당자는 메인 측정자 용도로 재사용하지 않는다.
2. **실제 측정인력은 날짜별 구조가 기준.** 날짜별 `메인 측정자 1명 + 조력자 0명 이상`. 단일일·다일을 통일 모델로.
3. **메인 측정자 = 해당 날짜 공시료 담당자.** 실제 현장에 가지 않은 사람이 공시료를 가질 수 없다.
4. **같은 날 같은 메인 측정자가 여러 사업장을 맡으면 공시료 누적** (기본 코드 C → 2번째 CC → 예외 3번째 CCC).
5. **동일일 메인 측정자 기본 cap 2건, 예외 cap 3건.** 3건 예외는 자동 남발 금지, 사용자에게 명시.
6. **가확정(추천 저장) / 찐확정(측정일지 등록)**. 찐확정 이후 자동 변경 금지.
7. **추천은 계산, 저장은 사업장별 독립.** 영구 그룹 생성 금지.
8. **변경 발생 시 기존 가확정 최대 유지, 최소 사업장만 변경.** 자동 덮어쓰기 금지.

---

## 3. 보고서 담당자 / 메인 측정자 / 조력자 정의

| 역할 | 현재 저장 위치 | 의미 | 근거 |
|---|---|---|---|
| 보고서 담당자 | `measurement_target_business.measurer_id` | 보고서 작성·관리 책임. 실제 측정·예비조사와 무관 | `MeasurementTargetBusinessManagement.tsx:91`, docs 규칙 §1.1 |
| 메인 측정자 | **(별도 필드 없음)** 현재는 실질적으로 `daily_staff[].measurer_id`(보고서 담당 코드)와 `collaborators` 첫 이름에 기대 | 해당 날짜 실제 측정을 주도하고 공시료를 담당하는 1명 | 2차 분석 §7 |
| 조력자 | `collaborators` 문자열 / `daily_staff[].collaborators[]` | 메인 측정자를 보조하는 추가 측정 인력 | docs 규칙 §1.3 |

**[사실]**
- `measurer_id`는 보고서 담당자로 전수 사용되고, 측정자로 취급하는 코드는 없음 (역할 분리는 이미 완료).
- 다일 `daily_staff[].measurer_id`는 Integrated Sync에서 `report_writer`(보고서 담당)로 변환됨 (`app/api/businesses/route.ts:848-850`). 즉 **메인 측정자가 아니라 보고서 담당 코드**다.
- 단일일은 `collaborators` 문자열, 다일은 `daily_staff`라는 이중 구조. 메인/조력자 구분 필드가 없다.

**[제안]** 신규 소스오브트루스는 `daily_staff`를 id 기반 날짜별 인력 구조로 통일하고, 메인 측정자를 명시적으로 분리한다. 보고서 담당자 필드(`measurer_id`)는 유지하되 메인 측정자와 무관함을 코드 주석과 검증으로 고정한다.

---

## 4. 실제 측정인력 목표 데이터 모델

**[업무규칙]** 날짜별 `메인 측정자 1명 + 조력자 0명 이상`, user id 기반.

**[제안]** 최우선 후보 구조:

```ts
daily_staff = [
  {
    date: "2026-08-03",
    main_measurer_id: 1,      // 해당 날짜 메인 측정자 (= 공시료 담당자)
    helper_ids: [2]           // 해당 날짜 조력자 0명 이상
  },
  {
    date: "2026-08-25",
    main_measurer_id: 3,
    helper_ids: [1]
  }
]
```

- user id 기반. 이름 문자열은 표시용 파생값.
- 공시료 담당자는 별도 저장하지 않고 `main_measurer_id`에서 파생.
- **[업무규칙]** 공시료 순번(C/CC/CCC)은 실제 측정 당일 방문순서 기준이므로, 날짜별 `measurement_visit_order`(실제 측정 방문/측정 순서)를 표현할 수 있어야 한다.

**[제안] 실제 측정 방문순서 데이터 (공시료 순번의 기준):**
```ts
daily_staff = [
  {
    date: "2026-08-31",
    main_measurer_id: 1,
    helper_ids: [2],
    measurement_visit_order: 1   // 해당 날짜 실제 방문/측정 순서 (공시료 C/CC/CCC 결정 기준)
  }
]
```
- `measurement_visit_order`(또는 `measurement_route_order`)는 같은 날짜 + 같은 메인 측정자가 담당한 사업장 간의 실제 방문 순서.
- 공시료 = `users.survey_code`(기본) + 해당 날짜 동일 메인 측정자 사업장의 `measurement_visit_order` 순번으로 C/CC/CCC 파생.
- **예비조사 추천의 route evidence는 공시료 순번에 사용하지 않는다.** (정정 3)

**[사실 — 현행 구조와의 차이]**
- 현재 `daily_staff` = `[{date, measurer_id(=보고서 담당 코드), collaborators[]}]`.
- `daily_staff[].measurer_id`는 보고서 담당 코드이므로 메인 측정자를 표현하지 못한다. 메인 측정자를 명시하기 위해 신규 키가 필요하다.

**[제안] 키 설계:**
- `main_measurer_id`: 해당 날짜 메인 측정자 (신규 추가)
- `helper_ids`: 조력자 (신규 추가)
- `measurer_id`: 보고서 담당 (기존 유지, 의미 불변)
- `measurement_visit_order`(또는 `measurement_route_order`): 해당 날짜 실제 방문/측정 순서 (신규 추가, 공시료 순번 기준)
- 단일일도 `daily_staff = [{date: measurement_date, main_measurer_id, helper_ids, measurement_visit_order}]`로 통일.

이 방식은 기존 `measurer_id`/`collaborators` 키를 보존하면서 메인 측정자를 명시적으로 추가하므로 기존 코드 충격을 줄인다.

---

## 5. 단일일 / 다일 통합 구조

**[제안]**
- 단일일: `daily_staff = [{ date: measurement_date, main_measurer_id, helper_ids }]`
- 다일: `daily_staff = [{...}, {...}]`
- 두 경우 동일한 날짜별 인력 배열로 처리. legacy `collaborators`는 통합 구조에서 파생.

**[사실 — 현행과 차이]**
- 현재 단일일은 `collaborators` 문자열만, 다일은 `daily_staff`만 사용 (`docs/business-rules/preliminary-survey.md:29-30`).
- `collaborators`를 전반적으로 읽는 코드가 많아(`link-measurer.ts:31-46`, `survey-sync.ts:34-54`, businesses PATCH 검증) 즉시 제거는 위험.

**[제안] 단계적 전환 (이번에는 구현 안 함):**
1. **Phase 0**: `daily_staff`에 `main_measurer_id`/`helper_ids` 추가 (기존 키 유지). 단일일 저장 시에도 `daily_staff` 1건을 함께 유지하도록 UI/API 보강.
2. **Phase B**: 읽기 로직(`link-measurer` 등)을 id 기반으로 전환. `collaborators`는 파생값으로 유지.
3. **Phase I**: 역산 검증 후 `collaborators`를 완전히 제거하거나 최소 사용.
- 마이그레이션 전략: 기존 `collaborators` 첫 이름을 무조건 메인으로 가정하지 않는다 (아래 §31).

---

## 6. 공시료 계산 구조

**[업무규칙]**
- 메인 측정자 = 해당 날짜 공시료 담당자.
- 같은 날 같은 메인 측정자가 여러 사업장: C → CC → (예외) CCC.
- 실제 현장에 가지 않은 사람은 공시료를 가질 수 없다.

**[사실 — 현행]**
- 공시료는 `preliminary_survey.survey_code`가 실질 원천. `users.survey_code`를 기본, 없으면 `getSurveyCode(첫 측정자, 측정일)` (`lib/utils/survey-assignment.ts:24-49`).
- **"첫 측정자"는 `measurer` 문자열의 첫 이름** (`survey-code.ts:53-59`). `measurer_id`(보고서 담당)와 무관.
- 누적: `resolveSurveyAssignment`가 같은 날짜 행을 `created_at` 정렬로 순번 매겨 2건째 `CC` (`survey-assignment.ts:64-93`). **순번 = 저장(created_at) 순서**이지 동선/측정순서 아님.
- `measurement_journal`에는 `survey_code` 컬럼이 없음.

**[제안] 목표 계산 구조:**
```
공시료 담당자 = 해당 날짜 main_measurer_id
  → users.survey_code (기본) → getSurveyCode (fallback)
순번 = 같은 날짜 + 같은 main_measurer_id 사업장의 실제 측정 방문순서
  → 1번째: C, 2번째: CC, 3번째(예외): CCC
표시: preliminary_survey.survey_code (기존 컬럼 재사용) 또는 V2 plan의 파생 필드
```
- **순번 결정 규칙** (실제 측정 방문순서 기준): 1) 실제 측정 당일 방문/측정 순서(`measurement_visit_order` 또는 `measurement_route_order`) 2) 사용자가 확정한 방문 순서 3) 임시 안정 정렬(사업장 코드).
- **[업무규칙]** 공시료 순번은 **실제 측정 당일의 방문/측정 순서**만 기준으로 한다. 예비조사 추천 route/order(예비조사 route evidence, group recommendation route, 예비조사자 이동순서)는 공시료 순번에 사용하지 않는다.
- **[제안]** 추천 단계에서는 임시 안정 정렬(사업장 코드)로 계산하고, 실제 측정 방문순서 확정 시 `measurement_visit_order`(또는 `measurement_route_order`)를 저장하며, 방문순서가 바뀌면 재계산한다.

---

## 7. 동일일 2건 / 예외 3건 규칙

**[업무규칙]**
- 기본 cap: 메인 측정자 1인 최대 **2개 사업장/day**.
- 예외 cap: **3개 사업장/day** (동일 주소/동일 현장 복수 법인/이동거리 극히 짧음 등 불가피한 경우).
- 3건 예외는 자동 남발 금지. 우선 ① 다른 메인 측정자 ② 다른 날짜 ③ 동선 조정으로 2건 안에서 해결을 시도.

**[사실 — 현행]**
- V2 엔진에 기존 담당 3건/day 제한이 이미 있음 (`engine.ts:236` `existingResponsibleCount >= 3`), 신규 2건/day 제한(`engine.ts:240` `dailyNew >= 2`).
- 단, 이는 **V2 예비조사자(responsible)** 기준이지 메인 측정자 기준이 아니다. 메인 측정자 기준 cap은 신규 설계 항목.

**[업무규칙] 실제 측정 cap과 예비조사 cap은 별개 규칙이다.**
- 실제 측정 cap 기준: **메인 측정자**. 기본 1인 2개 사업장/day, 예외 최대 3개 사업장/day (동일 주소/동일 현장/불가피한 운영 상황).
- 예비조사 cap 기준: **예비조사자 / 책임 조사자(responsible)**. 기존업체 paper 배정 한도 1인 하루 최대 3건.
- **보고서 담당자(`measurer_id`) 기준으로 어느 cap도 계산하지 않는다.**

**[제안]**
- 실제 측정과 예비조사의 cap을 별도 규칙으로 분리해 설계한다.
  - 실제 측정: 같은 날 같은 메인 측정자 기본 2건/예외 3건.
  - 예비조사: 기존 3건/day 규칙을 **예비조사자/책임 조사자 기준**으로 유지 (보고서 담당과 무관, `engine.ts`는 responsible 기준임).
- 3건 예외 조건은 "동일 주소(또는 사실상 동일 현장)"로 제한하고, 추천 결과에 `3건 예외 · 동일 주소 사업장` 라벨로 명시.

---

## 8. 공시료 C/CC/CCC 순번 결정

**[업무규칙] 공시료 순번 기준은 "실제 측정 당일의 사업장 방문/측정 순서"다.**
- C/CC/CCC는 **실제 측정 당일의 사업장 방문/측정 순서**를 기준으로 결정한다.
- **예비조사 동선은 공시료 계산과 무관하다.**
- 예비조사 추천용 데이터(예비조사 route, group recommendation route, 예비조사자 이동순서)를 공시료 순번 결정에 사용하지 않는다.

**[제안] 순번 결정 우선순위:**
1. 실제 측정 당일의 방문/측정 순서 (`daily_staff.measurement_visit_order` 또는 `measurement_route_order`)
2. 사용자가 확정한 방문 순서
3. 임시 안정 정렬: 사업장 코드

- **[사실]** 현재는 `created_at`(저장 순서)만 사용 (`survey-assignment.ts:64-93`). 측정 방문 순서 기준이 아니므로, 방문 순서가 바뀌면 공시료가 어긋날 수 있다.
- **[제안]** 실제 측정 방문 순서가 확정된 사업장은 `measurement_visit_order` 기준으로 C/CC/CCC를 재계산하고, 미확정 사업장은 임시 안정 정렬을 사용한다. 재계산 결과를 `survey_code`에 반영한다.
- **금지**: 예비조사 추천의 route evidence를 공시료 순번에 사용한다.

---

## 9. 기존 collaborators 호환 전략

**[사실]**
- `collaborators` 문자열이 실제 측정인력 목록으로 널리 사용됨: `link-measurer.ts:31-46`(합집합), `survey-sync.ts:34-54`(역산), businesses PATCH 검증(`route.ts:593-603`), UI 조력자 체크박스(`:3149-3190`).
- `measurement_journal.measurer`도 이름 문자열로 저장됨.

**[제안]**
- 신규 기준: `daily_staff`의 id 기반 구조(source of truth).
- legacy 호환: `collaborators`는 `main_measurer_id + helper_ids`에서 파생해 동기화 유지.
- 표시: 화면은 id 기준으로 표시하되 응답에 이름 포함.
- **즉시 삭제 금지.** Phase B 이후 단계적 폐기.

---

## 10. 예·측 계산 영향

**[업무규칙]** 예·측 = 예비조사 참여자 중 실제 측정에도 참여하는 1명 = `예비조사자 ∩ 전체 측정기간 실제 참여자`.

**[사실]**
- 실제 참여자 수집: `collectMeasurementStaffNames`가 `collaborators` + `daily_staff[].collaborators` **합집합** 사용 (`link-measurer.ts:31-46`). 보고서 담당(`measurer_id`)은 제외.
- 다일: 어느 하루라도 참여하면 후보 (`docs/business-rules/preliminary-survey.md:63`).

**[제안]**
- 새 구조에서 실제 참여자 = 모든 날짜 `main_measurer_id` ∪ 모든 날짜 `helper_ids`.
- `collectMeasurementStaffNames`를 id 기반으로 전환하되 반환은 이름 목록으로 유지해 호출처 호환.
- 보고서 담당자(`measurer_id`)는 계속 후보 계산에서 제외.

---

## 11. 가확정 / 찐확정 정의

**[업무규칙]**
- **추천**: DB 저장 전 계산 결과.
- **가확정**: 사용자가 예비조사 추천안을 저장한 상태. 측정일지 등록 전까지 변경 가능.
- **찐확정**: 측정일지가 실제 등록된 상태. 이후 자동 변경 금지.

**[제안]**
- 가확정 저장 = `preliminary_survey_v2_plans`에 사용자 승인 값 저장 (plan_origin=manual 재사용).
- 추천 = 계산만 수행, 저장 없음.
- 찐확정 = 아래 §12 판정.

---

## 12. measurement_journal 기반 찐확정 판정

**[업무규칙]** 찐확정 = **해당 사업장 + 년도 + 주기에 대해 유효한 `measurement_journal` 행 존재**.

**[사실 — 현행]**
- 확정 보호 기준은 코드 전반이 `code/year/period` 일치 + `sequence_number IS NOT NULL` (`service.ts:502-507`, `confirm` RPC, businesses 가드 `route.ts:489-505`).
- `sequence_number`는 nullable. `is_skip_numbering`(기타매출)이면 null 저장 (`number-assignment.ts:345-351`).
- 일지 삭제는 **물리 DELETE** (`app/api/journal/[id]/route.ts:768-773`). soft-delete/취소 컬럼 없음. 삭제 시 target `is_registered`를 리셋하지 않음.
- `measurement_target_business.journal_id`는 FK `ON DELETE SET NULL` (`009:49-50`)이라 일지 삭제 시 자동 NULL.

**[제안] 찐확정 판정:**
```
찐확정 = measurement_journal 행 존재 (code + year + period)
       AND not soft-deleted  // 현재는 물리 DELETE라 행 존재 = 유효
sequence_number = 보조 정보 (표시/기존 호환용)
```
- `journal_id`(target FK)가 NULL이 아니면 일지 등록됨으로 판정하는 보조 기준도 사용 가능. 단, 일지가 있어도 target.journal_id가 SET NULL인 과거 데이터는 `code/year/period`로 재확인.
- `is_skip_numbering` 사업장도 journal 행이 있으면 찐확정 취급.

---

## 13. sequence_number 기존 의존 제거 범위

**[업무규칙]** `sequence_number` 존재 여부만으로 찐확정을 판단하지 않는다.

**[사실 — sequence_number 사용처]**
- V2 자동 생성/묶음 추천/측정대상 가드에서 `sequence_number IS NOT NULL`을 확정 기준으로 사용 (`service.ts:502-507, 851`, `confirm` RPC, `businesses/route.ts:489-505`).

**[제안]**
- 찐확정 판정을 **공통 함수**로 추출: `isJournalConfirmed(supabase, code, year, period)` = 유효 journal 행 존재.
- 기존 `sequence_number IS NOT NULL` 사용처를 공통 함수로 교체 (Phase D).
- `sequence_number` 자체는 삭제하지 않고 기존 표시/관리 기능 유지.

---

## 14. 재검토 필요 상태 설계

**[업무규칙]** 가확정 후 측정대상 정보가 바뀌면: 기존 plan 유지 + `재검토 필요` 표시 + 새 추천안 계산 + 사용자 승인 시에만 새 가확정 저장.

**[제안] 상태 표현 후보 (신규 컬럼 최소화):**
| 방식 | 장단점 | 판정 |
|---|---|---|
| 동적 비교 판정 | plan의 `source_measurement_date`/`source_responsible_user_id`와 target 현재값 비교. 상태 컬럼 불필요 | **[제안] 우선 채택** |
| `status` enum 확장 (recommended/manual_required/needs_review) | 상태가 명시적 | 필요 시 Phase H에서 추가 |
| source hash/version 컬럼 | 변경 감지에 정확 | 과설계 우려 |

- **[사실]** plan에 이미 `source_measurement_date`, `source_responsible_user_id`, `source_rule_type` 스냅샷이 존재 (`20260808_add_preliminary_survey_v2.sql:41-43`). 이를 이용한 동적 비교 판정이 가능.
- **[제안]** 기본은 동적 비교(소스 스냅샷 vs target 현재값)로 `needs_review`를 계산하고, 성능이 필요한 경우에만 스냅샷 갱신 전략을 검토.

---

## 15. legacy 중복 원인

**[사실 — H0508 사례]**
- 정상: 08-03 1행 + 08-25 1행. 오류: 08-03 2행.
- 원인: `preliminary_survey`에 UNIQUE 제약이 없고, 응용 계층(`measurement_date` 기반 find → update/insert, `businesses/route.ts:866-873`)만으로 1행을 유지. 동시 요청/중간 상태에서 같은 측정일 중복 행 생성 가능.
- `survey/route.ts` POST는 중복 체크 없이 무조건 insert (`route.ts:714-732`).

---

## 16. 1회 전수조사 계획

**[업무규칙]** 운영 중 매번 전수조회 금지. 초기 migration 전 1회만 전수조사.

**[제안] 초기 legacy 중복 전수검사 실행계획 (설계):**

| 단계 | 작업 | 방법 |
|---|---|---|
| 1. 대상 정의 | `preliminary_survey` 전체 행 기준 | READ-ONLY SELECT |
| 2. 중복 후보 추출 | `(code, year, period, measurement_date)` 그룹핑 → 2건 이상 그룹 | GROUP BY + HAVING COUNT > 1 |
| 3. NULL 처리 확인 | `measurement_date`, `year`, `period` NULL 행은 별도 그룹으로 분리 | NULL 별도 집계 |
| 4. 중복 판정 | 각 중복 그룹에서: 실제 같은 의미인지(오류 중복) vs 합법 다중(예: 과거 데이터 변종) | code/측정일/실측정자/생성시각/캘린더 이벤트 비교 |
| 5. 정상 식별키 확정 | `code+year+period+measurement_date`가 정상 키인지 전수 검증, 예외 사례 기록 | 검증 결과 문서화 |
| 6. 정리 대상 결정 | 오류 중복은 사용자 확인 후 id 유지/삭제 결정. 합법 다중은 유지 | 사용자 승인 필요 |
| 7. UNIQUE 적용 전 점검 | NULL 처리, 과거 캘린더/summary/document 참조 영향, upsert conflict key 가능성 | READ-ONLY 분석 |
| 8. UNIQUE 적용 | `(code, year, period, measurement_date)` UNIQUE index 생성 | migration (별도 작업) |

- **초기 1회만 수행.** 이후 운영 중에는 전체 조회 대신 UPSERT + UNIQUE로 방어.
- 이번 작업에서는 실행하지 않고 절차만 확정.

---

## 17. legacy 정상 유일키

**[제안] 키 후보:**
| 키 | 장점 | 단점 | 판정 |
|---|---|---|---|
| `code + year + period + measurement_date` | 현재 조회 패턴과 일치, 최소 변경 | 코드 문자열 의존, target FK 없음 | **[제안] 1차 방어로 채택** |
| `measurement_target_business.id + measurement_date` | target 식별자 기반 강함 | **legacy에 target_id 컬럼 없음** (FK 없음), migration 필요 | 장기 우선, 단 현재는 미적용 |

- **[사실]** legacy `preliminary_survey`에는 `measurement_target_business_id` 컬럼이 없다 (2차 분석 §23). `year`/`period` 컬럼도 repo migration에 정의 이력이 없어 drift 상태.
- **[제안]** 1단계는 `code+year+period+measurement_date` UNIQUE, 장기적으로 `target_id` FK 추가 후 `(target_id, measurement_date)` UNIQUE로 강화. `year`/`period` 컬럼 migration(정의 추가)을 함께 진행.

---

## 18. UPSERT 설계

**[제안]**
- 저장은 idempotent UPSERT 1회. `ON CONFLICT (유일키) DO UPDATE`.
- 응용 계층에서 "전체 조회 → 중복 검사 → 저장" 패턴 금지.
- Integrated Sync(`businesses/route.ts:866-873`)와 `survey` POST를 UPSERT로 전환.
- UPSERT 시 `updated_at` 갱신, 기존 캘린더 `google_event_id` 보존.

---

## 19. UNIQUE 설계

**[제안]**
- `preliminary_survey`에 UNIQUE index: `(code, year, period, measurement_date)` (1차).
- 장기: `(measurement_target_business_id, measurement_date)` UNIQUE (target FK 추가 후).
- **DB가 최종 중복 방어**: 동시 요청이 와도 UNIQUE가 중복을 거부.
- 이번 작업에서는 적용하지 않고 설계만.

---

## 20. 날짜 단위 과부하 시나리오

**[업무규칙/시나리오]**
- 8/31에 기존 6개 사업장 배정. 8/25의 4개가 측정일 변경으로 8/31 이동 → 8/31 총 10개.
- 충돌: 메인 측정자 2건 cap, 3건 예외, 공시료 C/CC/CCC, 조사자 가용성, 동선, 기존 가확정.

**[제안]**
- 8/31 관련 10개 **전체**를 재검토 대상으로 본다. 변경된 4개만 추천하지 않는다.

---

## 21. 날짜 전체 재최적화

**[제안] 목적함수 우선순위:**
1. hard constraint 충족 (법적/업무)
2. 기존 가확정 최대 유지
3. 동선/거리
4. 경력·인력 조건
5. 메인 측정자 기본 2건 cap
6. 예외 3건 최소 사용
7. 공시료 중복/누적 정상화
8. 업무량 균형 (soft)
9. 사용자 최종 조정

- 조회 범위: 대상 날짜 관련 사업장 + 관련 직원 가용 일정 + 인접 대체 날짜 + 현재 가확정 plan만 조회. 전체 연도/전체 사업장 조회 금지.

---

## 22. 최소 변경 원칙

**[업무규칙]** 기존 가확정을 최대한 유지하면서 필요한 최소 사업장만 변경.

**[제안] 변경 비용(cost) 설계:**
| 변경 | cost |
|---|---|
| 기존 plan 유지 | 0 |
| 조사자 변경 | 낮음~중간 |
| 날짜 변경 | 중간 |
| 예·측 변경 | 중간 |
| 메인 측정자 변경 | 중간 |
| 예외 3건 사용 | 높음(최소화) |

- 목표: 전체적으로 유효한 조합 중 **변경 건수가 가장 적은 안** 우선 제시.

---

## 23. 기존 가확정 보존 전략

- 기존 가확정 6개를 초기화하지 않는다.
- 10개 중 7개 유지 + 3개 조정이 가능하면 3개만 변경 저장.
- 유지 사업장은 DB 갱신 불필요. 변경 사업장만 write.
- 새 추천안 저장 시 기존 unrelated plan 초기화 금지.

---

## 24. 3건 예외 처리

- 기본 cap 2건을 먼저 시도. 그 후 불가피 + 예외조건(동일 주소/동일 현장) 성립 시 3건 예외를 후보로 제시.
- UI에 `3건 예외` 배지 + 클릭 시 `동일 주소 사업장` 같은 짧은 이유.

---

## 25. 날짜 변경 대안

- 우선 메인 측정자 재배치/조사자 변경/동선 조정/3건 예외 가능성 검토.
- 그 후에도 불가능하면 다른 날짜 이동 제안 (예: 8/31 → 8/30).
- **사용자 승인 없이 자동 이동 금지.**

---

## 26. UI 최소화 원칙

**[업무규칙]**
- 메인 테이블 하나만 유지. 기존안/추천안 별도 2개 테이블 금지.
- 상단 요약: `8/31 · 10개 업체 · 7개 유지 · 3개 조정 필요`.
- 버튼: `추천안 적용` (주요), 필요 시 `새로 추천` / `대안 보기`.
- 변경값만 인라인 표시: `강종구 → 김민영`, `8/31 → 8/30`.

---

## 27. 메인 테이블 상태 표시

- 정상 유지 행: 평범하게.
- 변경 대상만 짧은 배지: `변경` / `날짜 변경` / `3건 예외` / `충돌`.
- 상세 이유는 행/상태 클릭 시에만: `강종구 8/31 기본 한도 2건 초과`, `동일 주소 사업장으로 3건 예외 가능`.

---

## 28. 추천안 적용 흐름

1. 시스템 재계산 (변경 감지 시 자동 계산 가능)
2. 변경 건수 표시 (상단 요약)
3. 사용자가 변경 대상 확인 (배지/인라인)
4. `추천안 적용` 클릭
5. **변경된 사업장만** 가확정 갱신 (사업장별 독립 저장, 영구 그룹 없음)

- 업체마다 개별 승인 버튼을 두지 않는다. 필요한 개별 행만 사용자가 직접 수정 가능.

---

## 29. 성능/API/Supabase 부하 고려

**[제안]**
- 날짜 단위 필요한 데이터 한 번 조회.
- users 등 reference 데이터 batch 조회 (`in(id)`).
- indexed UPSERT + UNIQUE index.
- 계산은 가능하면 메모리에서.
- 변경 사업장만 write.
- N+1 user 조회 방지: users를 한 번 로드해 Map으로 사용.
- 전체 연도/전체 사업장 반복 조회 금지.

---

## 30. 필요한 migration

이번 작업에서는 적용하지 않는다. 후보만 명확히 구분:

| 구분 | migration | 설명 |
|---|---|---|
| **필수** | `daily_staff` 구조 확장 | `main_measurer_id`, `helper_ids` 추가 (기존 `measurer_id`/`collaborators` 유지) |
| **필수** | `daily_staff` 방문순서 | `measurement_visit_order`(또는 `measurement_route_order`) 추가 — 실제 측정 방문순서, 공시료 순번 기준 |
| **필수** | legacy `preliminary_survey` UNIQUE | `(code, year, period, measurement_date)` |
| **필수** | legacy `year`/`period` 컬럼 정의 migration | repo drift 해소 |
| **권장** | 찐확정 공통 함수화 (코드) | migration 아님, 로직 |
| **권장** | legacy `measurement_target_business_id` FK 추가 | 장기 target 기반 UNIQUE로 전환 |
| **선택** | 가확정/재검토 상태 컬럼 | 동적 판정 우선이라 필요 시만 |
| **선택** | `collaborators` 폐기 | Phase I 이후 |

---

## 31. 기존 데이터 migration 전략

**[업무규칙] 기존 데이터에서 메인 측정자를 확실히 알 수 없으면 자동 추정하지 않는다.**
- 보고서 담당자(`measurer_id`)가 실제 참여자라는 이유만으로 메인 측정자로 지정하지 않는다. 보고서 담당자는 실제 현장에 참여하지 않을 수 있다.
- `link_measurer_id`는 "예비조사 참여자 ∩ 실제 측정 참여자" 1명일 뿐이다. 메인 측정자·공시료 담당자·대표 측정자·첫 방문자를 의미하지 않으므로 메인 측정자 후보 우선값으로 사용하지 않는다.
- `collaborators.split(',')[0]` 같은 문자열 순서 기준으로 첫 이름을 무조건 메인으로 지정하지 않는다. 문자열 순서는 표시/저장 우연에 따른 값일 수 있다.

**[제안] migration 결과 3분류 (자동 반영 금지 원칙):**

| 그룹 | 기준 | 처리 |
|---|---|---|
| **A. 자동 확정 가능** | 해당 날짜 actual_measurer가 정확히 1명이고, 현행 UI/DB 구조상 그 사람이 유일한 실제 측정 참여자이며, 다른 모순 데이터 없음 | main_measurer_id 전환 가능 |
| **B. 자동 후보 가능** | 근거는 있으나 100% 확실하지 않음 | **자동 DB 반영 금지.** 사용자 검토 필요 |
| **C. 수동 판정 필요** | 메인 측정자 판단 불가 (참여자 2명+ 구분 정보 없음, 보고서 담당이 참여자 중 한 명일 뿐, link 존재하나 메인 여부 불명확, 문자열 순서만으로 판단, 다일 날짜별 메인 구분 불명확, 과거 값 상호 충돌 등) | 자동 변환 금지, 수동 판정 목록으로 분리 |

- 애매한 데이터는 **자동 migration 금지**, 수동 검토 목록으로 분리한다.

---

## 32. 기존 V2 재사용 자산

| 자산 | 재사용 방식 |
|---|---|
| `recommendBatch` (engine.ts) | 날짜 단위 전체 조합 엔진의 핵심 판정 로직으로 확장 |
| `recommendationDates` (calendar.ts) | 날짜 후보 계산 (유형별 -3/-30 탐색 확장) |
| `suggestLinkMeasurerCandidates` (link-measurer.ts) | id 기반 참여자 집합으로 입력 전환 |
| group recommendation (service.ts) | 날짜 단위 그룹핑 후보로 재사용 |
| manual validation | cap/경력/동선 하드룰 재사용 |
| audit (exception_log) | 찐확정 후 관리자 정비 감사 재사용 |
| policy gate | 예비조사 영역 게이트로 이관 |

---

## 33. 구현 Phase 순서

2차 분석의 Phase에 이번 설계 항목을 반영해 재정리:

| Phase | 내용 | 핵심 설계 연결 |
|---|---|---|
| **Phase 0** | 핵심 데이터 모델/migration 준비 | §4~5 (main_measurer_id/helper_ids), §30 |
| **Phase A** | 측정대상 ↔ V2 자동생성 결합 제거 | 2차 분석 §21 |
| **Phase B** | 메인 측정자/조력자 구조 적용 | §4~5 |
| **Phase C** | legacy UPSERT + UNIQUE 방어 | §18~19 |
| **Phase D** | 찐확정 판정 공통 함수 | §12~13 |
| **Phase E** | 예비조사 메인 테이블 UI | §26~28 |
| **Phase F** | 날짜 단위 일괄 추천 엔진 | §21 |
| **Phase G** | 날짜 과부하 최소변경 재조정 | §22~25 |
| **Phase H** | 가확정/재검토 필요 | §11, §14 |
| **Phase I** | 운영 데이터 역산 검증 | §16, §31 |
| **Phase J** | 정책 ON | 마지막 |

**[제안]** 기존 Phase A(결합 제거)를 최우선 유지하고, 데이터 모델(Phase 0/B)과 UNIQUE(Phase C)를 조기 반영하는 순서가 안전하다.

---

## 34. 위험요소

| # | 위험 | 완화 |
|---|---|---|
| 1 | `daily_staff.measurer_id` 의미 변경(보고서 담당→메인) 시 혼란 | 새 키(`main_measurer_id`) 추가, 기존 키 의미 유지 |
| 2 | collaborators 첫 이름 메인 가정으로 잘못된 migration | 수동 검토 분리 (§31) |
| 3 | UNIQUE 적용 시 과거 중복 행 충돌 | 초기 1회 전수조사 후 정리 (§16) |
| 4 | 공시료 순번이 저장 순서라 방문순서 변경 시 어긋남 | `measurement_visit_order` 기준 재계산 (§8) |
| 5 | sequence_number 단독 기준 유지 시 기타매출 누락 | journal 존재 기준으로 전환 (§13) |
| 6 | 날짜 재조정 시 기존 가확정 초기화 | 최소 변경 원칙 + 변경 사업장만 저장 (§22~23) |

---

## 35. 다음 작업 권장안

**[제안] 최우선: Phase 0/Phase A 병행 착수**

1. **Phase 0 (데이터 모델 준비)**: `daily_staff`에 `main_measurer_id`/`helper_ids` 추가 마이그레이션 설계 확정, legacy `(code,year,period,measurement_date)` UNIQUE + `year`/`period` 정의 migration 설계.
2. **Phase A (결합 제거)**: `app/api/businesses/route.ts:1034-1052`의 `ensureV2PlanForTarget`/`reconcileV2AfterTargetChange` 호출 비활성화.

두 작업은 코드 결합이 없어 독립 진행 가능하며, 데이터 모델 선확정이 이후 Phase C(UNIQUE)·D(찐확정)·G(재조정)의 기반이 된다.

---

## 부록. 설계에서 확인한 주요 사실 근거 파일

- `supabase/migrations/20260411_multi_date_support.sql` (daily_staff/measurement_date/end_date)
- `supabase/migrations/20260808_add_preliminary_survey_v2.sql` (V2 table UNIQUE, source_* 스냅샷)
- `supabase/migrations/20260816_add_link_measurer_id.sql`
- `lib/db/migrations/001_initial_schema.sql`, `002_fix_measurement_business_pk.sql`, `009_create_measurement_target_business.sql`
- `app/api/businesses/route.ts` (Integrated Sync, V2 트리거)
- `app/api/journal/route.ts`, `app/api/journal/[id]/route.ts` (일지 등록/삭제, sequence_number)
- `lib/utils/survey-assignment.ts`, `lib/utils/survey-code.ts`, `lib/utils/number-assignment.ts`
- `lib/business/link-measurer.ts`, `lib/preliminary-survey-v2/engine.ts`
- `docs/business-rules/preliminary-survey.md`
- `docs/reports/2026-08-18_preliminary-survey-responsibility-dataflow-analysis.md` (2차 분석)

민감정보(비밀값·운영 DB 접속정보·개인정보 원문)는 포함하지 않았다.
