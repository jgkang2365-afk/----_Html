# 측정 업무 전 구간 데이터·상태 연동 정합성 감사 보고서

## 1. 감사 개요

- 감사일: 2026-08-29 (Asia/Seoul)
- 저장소: `jgkang2365-afk/----_Html`
- branch: `audit/measurement-workflow-propagation`
- 기준 SHA: `badd96d5ae9558ce6dd137e25ab99a422ca05d4f`
- 감사 범위: 측정대상 → 예비조사 V2 → 측정일지 → 측정정보 요약 → 출력·보고서·후속 처리
- 수행 원칙: **WIDE REVIEW / NARROW WRITE**
- 최종 판정: **FAIL / 저위험 자동수정 후보와 정책 승인 항목을 분리해 후속 처리 필요**
- 기능 코드·migration 변경: **0**
- Production DB write·migration: **0**

이번 감사는 개별 화면이 아니라 동일한 측정 업무 데이터가 upstream에서 downstream까지 일관되게 전달되는지를 검증했다. 코드 경로, Staging synthetic fixture, 2026-08-26 Production READ-ONLY artifact, 기존 Local E2E 기록을 함께 대조했다.

후속 구현은 관련 업무 흐름을 upstream부터 downstream까지 넓게 검토하되, 자동 수정은 기존 Source of Truth와 정답이 하나뿐인 동일 데이터·상태 흐름의 저위험 정합성 오류로 제한한다. UI·업무 흐름·Source of Truth·DB 구조·과거 데이터 의미를 바꾸거나 여러 해법 중 선택이 필요한 경우에는 사용자 승인을 먼저 받는다.

## 2. 전체 업무 FLOW

```text
measurement_target_business
  ├─ 예비조사 V2
  │    ├─ preliminary_survey_v2_plans
  │    └─ preliminary_survey_v2_measurement_assignments
  │
  ├─ target 저장 시 legacy 일부 동기화
  │    └─ preliminary_survey
  │         ├─ 보고서 담당자
  │         └─ 실제 측정 참여자
  │
  └─ 측정일지 등록
       ├─ legacy preliminary_survey 참고
       ├─ measurement_business fallback
       └─ measurement_journal
            ├─ 측정정보 요약
            ├─ Custom Query/Excel
            ├─ 보고서 처리
            └─ K2B/메일
```

핵심 단절은 `예비조사 V2 → 측정일지` 경계다. 예비조사 Workbench는 V2 plan과 assignment를 권위 원천으로 사용하지만 측정일지 이후 소비처는 legacy `preliminary_survey` 또는 `measurement_business`를 사용한다.

## 3. FIELD PROPAGATION MATRIX

| 항목 | Authoritative Source | 예비조사 UI | 측정일지 UI/저장 | 측정정보 요약 | 출력/후속 | 판정 |
| --- | --- | --- | --- | --- | --- | --- |
| 측정예정일·종료일 | target `measurement_date`, `daily_staff` | 정상 | legacy 경유 또는 body/fallback | journal snapshot | journal Excel | 부분 일치 |
| 실제 측정 실시 여부 | 이번 감사에서 권위 원천 미확정 | `is_registered`는 계획·관리 상태이며 실측 증명으로 단정 불가 | journal 미등록과 실제 미측정을 동일시할 수 없음 | 직접 표시하지 않음 | 직접 표시하지 않음 | 정책 확인 필요 |
| 측정일지 등록 여부 | `measurement_journal` 존재 | V2 true-confirmed 판정에 사용 | 등록현황은 journal만 표시 | journal만 표시 | journal Excel은 journal만 사용, 보고서 처리만 예외 | 불일치 |
| 예비조사일 | V2 `recommended_date` | 정상 | 사용 안 함 | 사용 안 함 | legacy Excel에 현행 V2 날짜 없음 | 불일치 |
| 예비조사 책임자·참여자·방식 | V2 plan | 정상 | legacy 조사자만 참고, 참여자·방식 없음 | legacy 조사자 | legacy Excel/문서 | 불일치 |
| 측정자(공시료) | V2 assignment | 정상 | body 또는 `measurement_business.measurer` | journal measurer + legacy code | journal/legacy Excel | 불일치 |
| 실제 측정 참여자 | target collaborators/daily_staff | 추천 preference 정상 | legacy 문자열로 합산 | legacy 문자열 | Custom Query | 날짜별 정보 소실 |
| 보고서 담당자 | target `measurer_id`/daily_staff | 정상 | legacy 마지막 담당자를 K2B sender로 사용 | legacy 대표행 | Dashboard도 legacy | 불일치 |
| code/year/period | target, journal snapshot | exact | exact 저장 | loose/정규화 혼용 | exact/prefix 혼용 | 불일치 위험 |
| plan 상태 | V2 + journal 존재 | 정상 | 소비하지 않음 | 소비하지 않음 | 소비하지 않음 | 관찰 |
| V2 true-confirmed | exact 업무 identity의 journal 존재 | 정상 | journal 등록 시 잠금 | 정상 | 직접 소비하지 않음 | 관찰 |

### Staging 직접 확인

- `SYN010`: V2 plan 존재, journal 없음 → Summary 제외. 정상이다.
- `SYN011`: V2 plan과 journal 존재, legacy 없음 → Summary row는 생기지만 예비조사 관련 값은 `null`이다.
- `SYN005`: 다일 `daily_staff`가 날짜마다 다르지만 journal에는 날짜별 역할을 보존할 구조가 없다.
- `SYN026` 임시 fixture: V2 assignment `Synthetic Surveyor B / userId 9102 / surveyCode B`, journal·Summary·journal Excel projection `Synthetic Business Fallback`, Summary `survey_code=null`을 재현했다. 증거 확보 후 fixture row는 모두 삭제했다.

## 4. STATE PROPAGATION MATRIX

| 상태 | downstream 기대 | 실제 동작 | 판정 |
| --- | --- | --- | --- |
| target·V2 plan 존재 / journal 없음 | 측정일지 등록 후보로만 표시 | 검색에서는 `id:null` 후보, 등록현황·journal 기반 요약에서는 제외 | PASS |
| journal 미등록 / 보고서 처리 | journal 기반 Summary·출력과 등록 후보를 구분 | `measurement_business`만 있으면 선택·큐 등록 가능 | BLOCKER |
| journal 등록 | true-confirmed 및 후단 표시 | true-confirmed는 정상, V2 역할은 후단에 전달되지 않음 | HIGH |
| journal 삭제 | 통제된 등록 취소·잠금 해제와 후단 정리 | journal만 삭제, V2 잠금 해제, 보고서 목록 잔존 | BLOCKER |
| target 삭제 | dependency에 따른 차단 또는 명시 처리 | target만 삭제, V2 cascade·legacy/journal 잔존 | BLOCKER |
| true-confirmed 역할 변경 | 일반 사용자 차단 | 참여자 변경 및 ID-only API 우회 가능 | BLOCKER |
| 추천 → Apply | 같은 원천·같은 결과 | 공통 builder와 fingerprint 재검증 | PASS |
| 다일 측정 | 날짜별 역할 보존 | Workbench만 날짜별, Summary는 첫 legacy row 대표 | HIGH |

`measurement_target_business.is_registered = "실시"`는 journal 존재를 보장하지 않는다. `measurement_journal`은 **측정일지 등록 여부**의 권위 원천이며, 현장에서의 실제 측정 실시 여부와 동일 개념으로 단정하지 않는다.

## 5. SOURCE OF TRUTH

| 업무 값 | 권위 원천 |
| --- | --- |
| 업무 식별·측정 일정 | `measurement_target_business` |
| 날짜별 보고서 담당·참여자 | `measurer_id`, `collaborators`, `daily_staff` |
| 예비조사일·책임자·참여자·방식 | `preliminary_survey_v2_plans` |
| 측정자(공시료) | `preliminary_survey_v2_measurement_assignments` |
| 측정일지 등록 레코드 | `measurement_journal` |
| 현장 실제 측정 실시 여부 | 이번 감사에서 별도 권위 원천 미확정 |
| 등록 후보·기초 정보 | `measurement_business` |
| 사업장 마스터 | `business_info` |
| 호환·역사 데이터 | legacy `preliminary_survey` |

## 6. LEGACY ↔ V2 소비 현황

| Consumer | 실제 읽는 원천 | 판정 |
| --- | --- | --- |
| 예비조사 Workbench | target, V2 plan, V2 assignment | V2 authoritative |
| 측정일지 등록 참고정보 | legacy `preliminary_survey` | V2 미소비 |
| 측정일지 저장 | body + `measurement_business` | V2 공시료 미소비 |
| 측정정보 요약 | journal base + legacy survey | V2 역할 미소비 |
| Custom Query export | `/api/summary` | legacy 결과 승계 |
| 예비조사 Excel | legacy survey | V2 미소비 |
| 측정일지 Excel | journal | V2 미소비 |
| 신규사업장 사전 문서 | target + legacy 조사자 | V2 조사자 미소비 |
| Dashboard 보고서 담당 | legacy survey | target 직접 미소비 |
| 보고서/K2B 처리 | `measurement_business` base | journal 존재 gate 없음 |

주요 코드 근거:

- `app/api/journal/previous-data/route.ts:210-229`
- `components/features/JournalEditForm.tsx:588-646, 2364-2420`
- `app/api/summary/route.ts:121-136, 259-337`
- `lib/document-generation/snapshot.ts:154-211`
- `app/api/export/survey/route.ts:17-45`
- `app/api/dashboard/route.ts:177-232`

## 7. 불일치 목록

### [연동 불일치 #1 — BLOCKER] true-confirmed 수정 가드 우회와 부분 저장

- 증거 수준: **CODE-LEVEL CONFIRMED** — Production 실제 발생 건수는 미확인
- 수정 분류: **POLICY / STRUCTURE CHANGE**
- 승인: **USER APPROVAL REQUIRED**
- 근거: ID-only 요청에서 기존 journal guard가 빠지는 부분만 떼면 단순 오류지만, 전체 해결에는 true-confirmed 동결 필드 범위와 target·legacy 저장 원자성 결정이 필요하다.
- 대상: true-confirmed 측정대상 전반
- 업무 항목: 측정일, 보고서 담당자, 측정 참여자, V2 source context
- Authoritative Source: target + `measurement_journal`
- Upstream 실제값: target의 일정과 날짜별 역할
- Downstream 실제값: target·legacy·Summary에서 서로 달라질 수 있음
- 기대값: true-confirmed 핵심값은 일반 사용자가 변경할 수 없어야 하며 저장은 원자적이어야 함
- 발생 경로: `app/api/businesses/route.ts:477-1022`
- 실제 조건문·저장 순서:
  - target은 `id`만으로 조회·수정할 수 있다 (`507-513`, `663-673`).
  - 비관리자 journal guard는 `code && year && period`가 모두 있을 때만 실행된다 (`546-561`).
  - `collaborators`, `daily_staff`는 허용 저장 필드이지만 `planCriticalActuallyChanged`에는 없다 (`538-545`, `564-573`).
  - target 저장 후 legacy/calendar 동기화 실패는 catch에서 로그만 남기고 성공 응답 흐름을 계속한다 (`673`, `739-943`).
- 원인:
  - PATCH가 ID-only 식별을 허용하지만 journal 검사는 요청의 `code/year/period`가 모두 있을 때만 실행한다.
  - `collaborators`, `daily_staff`가 `planCriticalActuallyChanged`에서 누락됐다.
  - target을 먼저 저장하고 legacy/calendar 동기화 오류는 로그만 남긴 뒤 성공 응답한다.
- 영향: 일반 사용자가 확정 후 측정 참여자를 바꾸면 legacy와 Summary의 과거 표시값도 변경될 수 있다.
- 기존 데이터 영향: 현재 Production live 상태는 미확인
- 권장 수정안: 서버가 target identity를 재조회하여 journal guard를 적용하고, 동결 필드를 확정한 뒤 target·legacy DB 변경을 원자화한다.
- 수정 위험: historical snapshot/live-reference 정책을 먼저 확정해야 한다.
- 추측 여부: 위 분기와 저장 순서는 확정이다. Production에서 실제 불일치 row가 생겼는지는 확인하지 않았다.

### [연동 불일치 #2 — BLOCKER] 측정대상 삭제가 downstream과 감사 이력을 분리

- 증거 수준: **CODE-LEVEL CONFIRMED** — Production 실행 이력은 미확인
- 수정 분류: **POLICY / STRUCTURE CHANGE**
- 승인: **USER APPROVAL REQUIRED**
- 근거: hard delete·취소 상태·legacy/journal/V2/audit 보존 범위를 결정해야 하므로 단순 매핑 수정이 아니다.
- 대상: `DELETE /api/businesses`
- 업무 항목: target, V2 plan/assignment, legacy, journal, 감사 이력
- Authoritative Source: target 및 각 history source
- 실제 동작: `measurement_target_business` 한 행만 직접 삭제한다.
- 결과:
  - V2 plan/assignment는 FK cascade로 삭제된다.
  - assignment 승인 그룹 재정규화 RPC를 우회한다.
  - legacy survey, `measurement_business`, journal은 남는다.
  - `document_generation_jobs`, `preliminary_survey_exception_log`는 cascade로 함께 삭제될 수 있다.
  - reconciliation/history/repair 보호 행은 명시적 업무 오류가 아니라 FK 500으로 실패한다.
- 기대값: dependency에 따라 차단하거나 명시적인 취소·보존 정책을 사용해야 한다.
- 발생 경로: `app/api/businesses/route.ts:1461-1491`
- 실제 조건문·현재 동작:
  - `journal:write` 권한과 `id`만 확인한 뒤 target 한 행을 직접 삭제한다 (`1463-1481`).
  - dependency 사전 조회, 안전 V2 delete RPC, 삭제 사유·감사 처리가 없다.
  - FK 오류는 업무 code가 아니라 DB message를 포함한 500으로 반환한다 (`1483-1487`).
- 권장 수정안: dependency 존재 시 target hard delete를 차단하고, 상태 취소 또는 별도 관리자 정리 흐름을 사용한다.
- 수정 위험: 과거 journal과 legacy를 삭제할지 보존할지 정책 결정이 필요하다.
- 추측 여부: API 분기와 FK 정의에 따른 cascade/restrict 효과는 코드·migration 수준에서 확인했다. 실제 Production 삭제 실행은 확인하지 않았다.

### [연동 불일치 #3 — BLOCKER] 측정일지 삭제가 true-confirmed 잠금을 해제

- 증거 수준: **CODE-LEVEL CONFIRMED** — Production 실행 이력은 미확인
- 수정 분류: **POLICY / STRUCTURE CHANGE**
- 승인: **USER APPROVAL REQUIRED**
- 근거: journal 삭제를 hard delete, 취소 또는 관리자 repair 중 무엇으로 볼지와 audit/dependency 정책을 정해야 한다.
- 대상: `DELETE /api/journal/[id]`
- 업무 항목: 측정일지 등록, V2 lock, Summary, 보고서 처리
- Authoritative Source: `measurement_journal`
- 실제 동작: journal row만 삭제한다.
- 영향:
  - Summary에서는 즉시 사라진다.
  - `measurement_business` 기반 보고서 처리 목록에는 계속 남는다.
  - V2 plan과 legacy는 남는다.
  - journal 존재가 유일한 true-confirmed 기준이므로 V2 잠금이 해제된다.
- 권한 문제: route 설명은 관리자 전용이지만 일반 사용자 역할에도 `journal:delete`가 부여돼 있다.
- 발생 경로: `app/api/journal/[id]/route.ts:735-799`, `lib/permissions.ts`
- 실제 조건문·현재 동작:
  - `canDeleteJournal()`은 `journal:delete`만 검사하고, 해당 권한은 관리자와 일반 사용자 모두에게 있다 (`lib/permissions.ts:23-45,108-109`).
  - API는 journal row 하나만 직접 삭제한다 (`769-774`).
  - V2의 true-confirmed 판정은 journal exact identity 존재를 사용하므로 journal 삭제 후 잠금 근거가 사라진다.
- 권장 수정안: 관리자 전용, 삭제 사유·감사, dependency 검증, 원자 상태전이를 포함한 전용 경로로 변경한다.
- 수정 위험: journal 삭제를 취소·repair와 구분하는 업무 정책이 필요하다.
- 추측 여부: 권한표·삭제 SQL·true-confirmed 판정 구조는 확정이다. 실제 Production 삭제와 후속 사용자 행동은 확인하지 않았다.

### [연동 불일치 #4 — BLOCKER] journal 미등록 대상이 보고서·K2B 큐에 진입

- 증거 수준: **CODE-LEVEL CONFIRMED**
- 수정 분류: **LOW-RISK CONSISTENCY FIX**
- 승인: **AUTO FIX ELIGIBLE**
- 근거: 기존 Source of Truth를 바꾸지 않고 목록·queue·worker에서 같은 exact journal identity의 존재만 재검증하는 단일 정답의 gate 누락이다. period identity 의미 변경은 이 수정에 포함하지 않는다.
- 대상: 보고서 처리 목록·메일·K2B
- 업무 항목: 측정일지 등록 여부와 journal 기반 후속 처리 진입
- Authoritative Source: 측정일지 등록 여부는 journal 존재
- Upstream 실제값: journal 없음
- Downstream 실제값: `measurement_business`만 있으면 목록에 표시되고 선택·queue 등록 가능
- 기대값: journal 기반 Summary·출력·메일·K2B에서는 journal 미등록 대상을 등록 완료 건처럼 처리하지 않아야 함
- 발생 경로:
  - `app/api/report-processing/route.ts:23-85`
  - `app/(dashboard)/report-processing/page.tsx:200-309`
  - `app/api/report-processing/queue/route.ts:16-52`
- 영향: journal 미등록 대상에 기존 파일을 발송하거나 K2B 자동화를 실행할 수 있다.
- 실제 조건문·현재 동작:
  - 목록 base는 `measurement_business`이고 journal은 상태 병합에만 사용한다 (`app/api/report-processing/route.ts:23-85`).
  - queue는 전달된 `targets` 배열을 journal 존재 재검증 없이 그대로 저장한다 (`app/api/report-processing/queue/route.ts:16-52`).
  - email/K2B worker도 payload `targets`를 그대로 순회하며 처리 전 journal 존재를 확인하지 않는다 (`lib/automation/worker-daemon.ts:250-345,403-483`).
  - 따라서 실제 측정 실시 여부는 알 수 없지만, **journal 미등록 대상의 queue 진입 가능성**은 코드상 확정이다.
- 권장 수정안: 목록·queue·worker 세 경계에서 exact journal identity를 재검증한다.
- 수정 위험: 낮음. 다만 실제 journal identity의 정규/수시 semantics를 함께 통일해야 한다.

### [연동 불일치 #5 — HIGH] V2 역할·공시료가 일지·요약·출력에 전달되지 않음

- 증거 수준: **STAGING DB E2E CONFIRMED + CODE-LEVEL CONFIRMED** — HTTP Preview API는 미검증
- 수정 분류: **POLICY / STRUCTURE CHANGE**
- 승인: **USER APPROVAL REQUIRED**
- 근거: V2 최신값을 live 조회할지 journal 등록 시 snapshot으로 저장할지, 기존 journal backfill과 다일 스키마를 어떻게 처리할지 결정해야 한다.
- 업무 항목: 예비조사일, 조사자, 방식, 공시료 측정자
- Authoritative Source: V2 plan/assignment
- Downstream 실제값: legacy 또는 사용자 입력 문자열
- 실제 증거: Staging `SYN026`에서 V2 assignment `Synthetic Surveyor B / 9102 / B`와 journal `Synthetic Business Fallback`을 동시에 구성했을 때 Summary·journal Excel projection은 journal 문자열을 유지했고 Summary `survey_code`는 `null`이었다.
- 원인: journal POST와 Summary가 V2를 조회하지 않는다.
- 영향: V2와 legacy가 다르거나 legacy가 없는 경우 다른 사람·코드 또는 `-`가 표시된다.
- 권장 수정안: snapshot/live-reference 정책 확정 후 공통 resolver 또는 journal role snapshot을 도입한다.
- 수정 위험: schema/migration 및 기존 journal backfill 정책 결정이 필요하다.

### [연동 불일치 #6 — HIGH] 다일 날짜별 역할 소실

- 증거 수준: **CODE-LEVEL CONFIRMED** — `SYN005` 구조 확인, 날짜별 downstream HTTP E2E는 미검증
- 수정 분류: **POLICY / STRUCTURE CHANGE**
- 승인: **USER APPROVAL REQUIRED**
- 근거: 날짜별 snapshot 구조와 화면·출력 집계 형식, 과거 데이터 보완 범위를 결정해야 한다.
- 업무 항목: 보고서 담당자, 측정 참여자, 공시료 측정자
- Authoritative Source: 날짜별 `daily_staff`, 날짜별 V2 assignment
- Downstream 실제값: journal 단일 `measurer` 문자열, Summary 첫 legacy row 대표값
- 기대값: 각 날짜의 역할을 복원할 수 있어야 함
- 영향: 어느 날짜에 누가 참여·보고·공시료를 담당했는지 후단에서 확인할 수 없다.
- 권장 수정안: 날짜별 role snapshot과 집계 표시를 분리한다.
- 수정 위험: 다일 표시 형식 및 과거 데이터 보완 정책 필요

### [연동 불일치 #7 — MEDIUM] 정규/수시 identity 방식 불일치

- 증거 수준: **CODE-LEVEL CONFIRMED / POLICY NOT YET VERIFIED**
- 수정 분류: **POLICY / STRUCTURE CHANGE**
- 승인: **USER APPROVAL REQUIRED**
- 근거: DB는 정규·수시를 별도 허용하고 국고지원·대시보드는 수시를 별도 취급하지만, V2 일부 호환 경로는 `(수시)`를 제거한다. consumer별 집계와 업무 identity 의미를 먼저 확정해야 한다.
- Summary: `ilike`, `(수시)` 제거, 양방향 `includes`
- Journal search: 일반 exact, `(전체)`만 prefix
- Journal Excel: prefix match
- Report/K2B: exact match
- 영향: `상반기`와 `상반기(수시)`의 target·legacy·Summary가 잘못 연결될 가능성이 있다.
- 권장 수정안: 정규/수시가 별도 identity인지와 의도적 집계 범위를 업무 규칙으로 확정한 뒤, exact identity와 “전체” 조회를 분리한다. 현재 단계에서 “무조건 통일”로 확정하지 않는다.

## 8. Staging E2E 증거

### 8.1 환경과 fixture

- Supabase 연결 도구에서 project name `measurement-journal-staging`, ref `ujwlvmkqjdlqblnbzmsw`, 상태 `ACTIVE_HEALTHY`를 확인한 뒤에만 실행했다.
- 운영 사업장·PII를 사용하지 않고 임시 `SYN026` target을 만들었다.
- 구성: target + V2 plan + V2 assignment + journal, legacy `preliminary_survey` 0건.
- 증거 조회 후 journal → assignment → plan → target → measurement/business master 순으로 정리했다.
- 정리 후 `SYN026` 관련 row는 전 테이블 0건이며 기존 건수는 `25 targets / 15 plans / 11 assignments / 3 journals`로 복원됐다.

### 8.2 공시료 downstream 비교

| 단계 | 실제값 | 증거 수준 | 판정 |
| --- | --- | --- | --- |
| V2 authoritative assignment | `Synthetic Surveyor B / userId 9102 / surveyCode B / 2026-09-26` | **STAGING DB E2E CONFIRMED** | 기준값 |
| Journal create source | `body.measurer` 또는 `measurement_business.measurer`; V2 assignment 조회 없음 | **CODE-LEVEL CONFIRMED** (`app/api/journal/route.ts:180,586-610`) | 단절 |
| Journal persisted row | `Synthetic Business Fallback`, 별도 survey code 컬럼 없음 | **STAGING DB E2E CONFIRMED** | V2 담당자·코드 불일치 |
| Summary | `measurer=Synthetic Business Fallback`, `survey_code=null` | **STAGING DB E2E CONFIRMED**에 route projection 적용 (`app/api/summary/route.ts:121-136,259-337`) | FAIL |
| Journal Excel | `측정자=Synthetic Business Fallback`; survey code 출력 없음 | **STAGING DB E2E CONFIRMED**에 export projection 적용 (`app/api/export/journal/route.ts:21-61`) | FAIL |
| Legacy Survey Excel | 해당 code row 0건 | **STAGING DB E2E CONFIRMED** (`app/api/export/survey/route.ts:17-45`) | V2 값 미출력 |

결론은 다음과 같다.

```text
V2 authoritative: Synthetic Surveyor B / userId 9102 / surveyCode B
Journal:          Synthetic Business Fallback / userId 없음 / surveyCode 없음
Summary:          Synthetic Business Fallback / surveyCode null
Output:           Journal Excel은 Synthetic Business Fallback, Legacy Survey Excel row 없음
```

이 결과는 실제 Staging 테이블 조합과 downstream route가 사용하는 projection을 함께 검증한 **Staging DB E2E**다. 다만 PR #66 Preview는 환경변수 fail-fast로 배포되지 않았고 현재 main에는 Staging 앱 연결이 없으므로, 브라우저/HTTP API 호출 자체는 **NOT YET VERIFIED**다. 이를 `STAGING E2E CONFIRMED`로 과장하지 않는다.

### 8.3 예비조사자 증거 수준

| 주장 | 증거 수준 | 결과 |
| --- | --- | --- |
| V2 plan responsible/participants/method 저장 | **STAGING DB E2E CONFIRMED** (`SYN011`, 임시 `SYN026`) | 존재 |
| Summary가 legacy 없는 V2 조사자를 표시 | **STAGING DB E2E CONFIRMED** (`SYN011`, `SYN026`) | `preliminary_surveyor=null` |
| Journal create가 V2 responsible/participants/method를 snapshot | **CODE-LEVEL CONFIRMED** | 해당 조회·저장 경로 없음 |
| 브라우저에서 journal 등록 후 재오픈·Summary·실제 Excel 다운로드 | **NOT YET VERIFIED** | Staging Preview 연결 후 필요 |

## 9. 종성모터스 / 우송 결과

현재 Production live 연결은 사용할 수 없어 다음 두 **2026-08-26 저장 Production READ-ONLY artifact**만 사용했다.

- `C:\Users\USER\Downloads\2026-08-26_pr59-production-after.json`
- `C:\Users\USER\Downloads\2026-08-26_preliminary-survey-v2-legacy-inventory.json`

| 대상 | target | V2 plan | 공시료 | 보고서 담당 | 측정 참여자 | journal |
| --- | --- | --- | --- | --- | --- | --- |
| 종성모터스 H0034 | 541, 8/28 | 8/25, 한기문, phone | 한기문(B) | 김민영 | 강종구 | 없음 |
| 우송 H0527 | 722, 8/28 | 8/25, 강종구+이주형, field | 강종구(C) | 이주형 | 이주형 | 없음 |

두 건은 저장 artifact 기준으로 `target + V2 + legacy manifest`는 있었지만 artifact 안의 journal은 없었다. 현재 Production 상태를 확인한 결과가 아니다.

- 일반 측정일지 검색에 나타나는 이유: 등록 후보
- “등록 현황”과 Summary: 나타나면 안 됨
- 보고서 처리: `measurement_business`가 있으면 잘못 나타날 수 있음

이 결과는 2026-08-26 snapshot 기준이며 현재 live 상태는 Production READ-ONLY 연결 복구 후 다시 확인해야 한다.

## 10. 추천 → Apply 잔여 감사

판정: **PASS / NO CHANGE**

- Recommend와 Apply는 동일 `buildMeasurementAssignmentTargets`를 사용한다.
- Apply는 target 원천을 다시 읽는다.
- assignee, survey code, fingerprint를 canonical 재계산한다.
- 다일 `daily_staff` 불완전은 409로 차단한다.
- plan/assignment는 단일 persistence RPC로 저장한다.

기존 6개 업체 Local E2E는 Recommend → Apply → V2 plan/assignment까지 검증했다. 다만 journal → Summary → 출력은 검증하지 않았다.

근거: `docs/reports/2026-08-23_pr42-final-local-apply-e2e.md`

## 11. MAIN ↔ DB MIGRATION / RPC DRIFT

| DB Object | Main 요구 | Local | Staging | Production | 판정 |
| --- | --- | --- | --- | --- | --- |
| V2 plan/assignment tables | YES | 미확인 | 확인 | 미확인 | Staging만 PASS |
| `persist_preliminary_survey_v2_plan_and_assignment_groups` | YES | 미확인 | 확인 | 미확인 | Staging만 PASS |
| `delete_preliminary_survey_v2_plan_and_rebalance_assignments` | YES | 미확인 | 확인 | 미확인 | Staging만 PASS |
| `repair_true_confirmed_preliminary_survey_v2_missing_info` | YES | 미확인 | 확인 | 미확인 | Staging만 PASS |
| `preliminary_survey_v2_document_repair_audit` | YES | 미확인 | 확인 | 미확인 | Staging만 PASS |
| true-confirmed plan/assignment guard trigger | YES | 미확인 | 확인 | 미확인 | Staging만 PASS |
| assignment validation trigger | YES | 미확인 | 확인 | 미확인 | Staging만 PASS |

추가 확인:

- Staging migration history: 119건
- Staging 핵심 테이블의 anon/auth 직접 privilege: 모두 false
- V2 plan/assignment의 service role 권한: SELECT-only
- 다수 테이블에 RLS-disabled advisory가 있으나 확인한 핵심 테이블은 anon/auth privilege가 없어 즉시 공개 노출로 판정하지 않았다.
- Local: Docker API 연결 실패로 schema/RPC를 실제 조회하지 못했다. **미확인**이다.
- Production: 연결된 Supabase 프로젝트 목록에 Production이 없어 schema/RPC를 실제 조회하지 못했다. **미확인**이다.

따라서 `MAIN ↔ Local/Staging/Production drift 감사 완료`라고 판정할 수 없다. 이번 PR에서 확인 완료한 범위는 Main 요구 object 목록과 Staging 존재 여부뿐이다.

### 환경 분리 / DB baseline 보완 과제로 이관

다음 Staging 부재는 측정 workflow 불일치 수정과 분리한다. Main 코드 요구 여부, baseline 포함 여부, Local·Production 상태를 환경 분리 PR에서 다시 산출해야 하며 이번 PR에서는 migration을 만들지 않는다.

- `designated_office_quotas`
- `designated_office_quota_history`
- `exec_sql` 및 debug/maintenance RPC

## 12. 후속 작업 분류

### 자동 수정 후보

- **#4 journal gate 누락**: 목록·queue·worker에서 exact `code/year/period` journal 존재를 재검증하는 범위만 LOW-RISK다. UI 구조, period 의미, 실제 측정 실시 여부 판정은 변경하지 않는다.

### 사용자 정책 승인 후 수정

- **#1 true-confirmed**: 동결 필드 범위와 target·legacy 저장 원자성
- **#2 target delete**: hard delete·취소·history 보존 정책
- **#3 journal delete**: 권한·삭제 사유·취소/repair·audit 정책
- **#5 V2 역할 전파**: snapshot vs live-reference 및 기존 journal 처리
- **#6 다일 역할**: 날짜별 저장 구조·표시·과거 데이터 정책
- **#7 정규/수시 identity**: 별도 업무 identity와 의도적 집계 범위

### 환경 분리 / DB baseline 과제

- Local·Production DB object 실제 비교
- Staging baseline의 quota/history/debug object 포함 여부
- Staging Preview 환경 연결 및 브라우저/HTTP CRUD E2E
- Production migration은 별도 명시 승인 전 0 유지

## 13. 사용자 승인 필요 항목

- true-confirmed에서 동결할 target 필드 범위
- V2 역할을 최신값으로 조회할지 journal 등록 시 snapshot으로 고정할지
  - 권장: journal 등록 시 날짜별 user ID·survey code snapshot 고정
- 다일 역할을 날짜별로 출력할지, 집계값도 함께 제공할지
- target 삭제를 금지하고 취소 상태로 전환할지
- journal 삭제를 관리자 감사형 기능으로 유지할지
- 기존 journal의 backfill 여부
- `상반기`와 `상반기(수시)`를 항상 독립 identity로 볼지
- Staging quota/history/debug object를 baseline에 포함할지

## 14. 검증 결과와 변경 상태

| 검증 | 결과 |
| --- | --- |
| 공시료/assignment·Summary focused tests | PASS, 39/39 |
| full `npm test` | 이전 감사 HEAD에서 PASS, 536/536; 기능 코드 변경이 없어 재실행하지 않음 |
| Staging `SYN026` DB E2E | FAIL 재현 후 fixture row 전부 정리 |
| Staging Preview HTTP/browser E2E | NOT YET VERIFIED — PR #66 Preview 배포 실패, current main에 Staging 앱 연결 없음 |
| `git diff --check` | PASS |
| Fresh Verifier | PASS, 7/7; blocker 0 |
| 기능 코드·migration 수정 | 0 |
| 보고서 문서 수정 | 이 PR의 유일한 repository 변경 |
| Staging DB write | 임시 synthetic fixture 생성·조회·삭제; 잔존 row 0 |
| Production DB write | 0 |
| Production migration | 0 |

최종 Fresh Verifier는 7개 검증 질문을 모두 PASS로 판정했다. 실제 측정 실시와 측정일지 등록의 구분, 공시료 downstream 단절의 Staging DB·코드 증거, 증거 수준 구분, Local/Production drift 미확인 표기, 수정 등급, 인접 환경 과제 분리, repository 변경 범위를 각각 독립 재확인했다. `SYN026` 정리 후 대상·일지·legacy·사업장·공시료 assignment 잔존 row와 고아 plan/assignment가 모두 0이고, 전체 건수도 원래의 `25/15/11/3`으로 복원됐음을 READ-ONLY 조회로 확인했다.

## 15. 결론

Recommend → Apply와 V2 persistence 내부는 canonical하게 동작한다. 그러나 V2 이후의 journal·Summary·출력·보고서 처리에는 legacy 원천과 별도 상태가 계속 사용되고 있으며, true-confirmed 수정 및 삭제 경로에는 출시 차단 수준의 정합성 문제가 있다.

이번 PR에서는 기능 코드를 수정하지 않았다. 후속 작업은 **넓게 보고, 좁게 고친다**는 원칙에 따라 #4의 명확한 journal gate 누락만 저위험 자동수정 후보로 분리하고, 나머지는 Source of Truth·삭제·snapshot·다일·identity 정책 승인 후 root cause 단위로 보완해야 한다.
