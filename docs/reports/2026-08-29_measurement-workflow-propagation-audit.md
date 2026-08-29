# 측정 업무 전 구간 데이터·상태 연동 정합성 감사 보고서

## 1. 감사 개요

- 감사일: 2026-08-29 (Asia/Seoul)
- 저장소: `jgkang2365-afk/----_Html`
- branch: `audit/measurement-workflow-propagation`
- 기준 SHA: `badd96d5ae9558ce6dd137e25ab99a422ca05d4f`
- 감사 범위: 측정대상 → 예비조사 V2 → 측정일지 → 측정정보 요약 → 출력·보고서·후속 처리
- 수행 원칙: READ-ONLY 감사, 불일치 발견 후 자동 수정 금지
- 최종 판정: **FAIL / 사용자 승인 후 보완 필요**
- 코드·DB·migration 변경: **0**

이번 감사는 개별 화면이 아니라 동일한 측정 업무 데이터가 upstream에서 downstream까지 일관되게 전달되는지를 검증했다. 코드 경로, Staging synthetic fixture, 2026-08-26 Production READ-ONLY artifact, 기존 Local E2E 기록을 함께 대조했다.

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
| 측정 실시 여부 | `measurement_journal` 존재 | true-confirmed 판정 | 등록현황은 journal만 표시 | journal만 표시 | 보고서 처리만 예외 | 불일치 |
| 예비조사일 | V2 `recommended_date` | 정상 | 사용 안 함 | 사용 안 함 | legacy Excel에 현행 V2 날짜 없음 | 불일치 |
| 예비조사 책임자·참여자·방식 | V2 plan | 정상 | legacy 조사자만 참고, 참여자·방식 없음 | legacy 조사자 | legacy Excel/문서 | 불일치 |
| 측정자(공시료) | V2 assignment | 정상 | body 또는 `measurement_business.measurer` | journal measurer + legacy code | journal/legacy Excel | 불일치 |
| 실제 측정 참여자 | target collaborators/daily_staff | 추천 preference 정상 | legacy 문자열로 합산 | legacy 문자열 | Custom Query | 날짜별 정보 소실 |
| 보고서 담당자 | target `measurer_id`/daily_staff | 정상 | legacy 마지막 담당자를 K2B sender로 사용 | legacy 대표행 | Dashboard도 legacy | 불일치 |
| code/year/period | target, journal snapshot | exact | exact 저장 | loose/정규화 혼용 | exact/prefix 혼용 | 불일치 위험 |
| plan 상태 | V2 + journal 존재 | 정상 | 소비하지 않음 | 소비하지 않음 | 소비하지 않음 | 관찰 |
| 일지 등록 여부 | journal 존재 | true-confirmed | 정상 | 정상 | 보고서 처리만 오진입 | 불일치 |

### Staging 직접 확인

- `SYN010`: V2 plan 존재, journal 없음 → Summary 제외. 정상이다.
- `SYN011`: V2 plan과 journal 존재, legacy 없음 → Summary row는 생기지만 예비조사 관련 값은 `null`이다.
- `SYN005`: 다일 `daily_staff`가 날짜마다 다르지만 journal에는 날짜별 역할을 보존할 구조가 없다.

## 4. STATE PROPAGATION MATRIX

| 상태 | downstream 기대 | 실제 동작 | 판정 |
| --- | --- | --- | --- |
| target·V2 plan 존재 / journal 없음 | 등록 후보로만 표시 | 검색에서는 `id:null` 후보, 등록현황·요약에서는 제외 | PASS |
| journal 없음 / 보고서 처리 | 출력·K2B 대상 제외 | `measurement_business`만 있으면 선택·큐 등록 가능 | BLOCKER |
| journal 생성 | true-confirmed 및 후단 표시 | true-confirmed는 정상, V2 역할은 후단에 전달되지 않음 | HIGH |
| journal 삭제 | 통제된 잠금 해제와 후단 정리 | journal만 삭제, V2 잠금 해제, 보고서 목록 잔존 | BLOCKER |
| target 삭제 | dependency에 따른 차단 또는 명시 처리 | target만 삭제, V2 cascade·legacy/journal 잔존 | BLOCKER |
| true-confirmed 역할 변경 | 일반 사용자 차단 | 참여자 변경 및 ID-only API 우회 가능 | BLOCKER |
| 추천 → Apply | 같은 원천·같은 결과 | 공통 builder와 fingerprint 재검증 | PASS |
| 다일 측정 | 날짜별 역할 보존 | Workbench만 날짜별, Summary는 첫 legacy row 대표 | HIGH |

`measurement_target_business.is_registered = "실시"`는 실제 journal 존재를 보장하지 않는다. 실제 측정 등록 여부의 권위 원천은 `measurement_journal`이다.

## 5. SOURCE OF TRUTH

| 업무 값 | 권위 원천 |
| --- | --- |
| 업무 식별·측정 일정 | `measurement_target_business` |
| 날짜별 보고서 담당·참여자 | `measurer_id`, `collaborators`, `daily_staff` |
| 예비조사일·책임자·참여자·방식 | `preliminary_survey_v2_plans` |
| 측정자(공시료) | `preliminary_survey_v2_measurement_assignments` |
| 실제 등록 측정 건 | `measurement_journal` |
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

- 대상: true-confirmed 측정대상 전반
- 업무 항목: 측정일, 보고서 담당자, 측정 참여자, V2 source context
- Authoritative Source: target + `measurement_journal`
- Upstream 실제값: target의 일정과 날짜별 역할
- Downstream 실제값: target·legacy·Summary에서 서로 달라질 수 있음
- 기대값: true-confirmed 핵심값은 일반 사용자가 변경할 수 없어야 하며 저장은 원자적이어야 함
- 발생 경로: `app/api/businesses/route.ts:477-1022`
- 원인:
  - PATCH가 ID-only 식별을 허용하지만 journal 검사는 요청의 `code/year/period`가 모두 있을 때만 실행한다.
  - `collaborators`, `daily_staff`가 `planCriticalActuallyChanged`에서 누락됐다.
  - target을 먼저 저장하고 legacy/calendar 동기화 오류는 로그만 남긴 뒤 성공 응답한다.
- 영향: 일반 사용자가 확정 후 측정 참여자를 바꾸면 legacy와 Summary의 과거 표시값도 변경될 수 있다.
- 기존 데이터 영향: 현재 Production live 상태는 미확인
- 권장 수정안: 서버가 target identity를 재조회하여 journal guard를 적용하고, 동결 필드를 확정한 뒤 target·legacy DB 변경을 원자화한다.
- 수정 위험: historical snapshot/live-reference 정책을 먼저 확정해야 한다.
- 자동 수정: **NO**

### [연동 불일치 #2 — BLOCKER] 측정대상 삭제가 downstream과 감사 이력을 분리

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
- 권장 수정안: dependency 존재 시 target hard delete를 차단하고, 상태 취소 또는 별도 관리자 정리 흐름을 사용한다.
- 수정 위험: 과거 journal과 legacy를 삭제할지 보존할지 정책 결정이 필요하다.
- 자동 수정: **NO**

### [연동 불일치 #3 — BLOCKER] 측정일지 삭제가 true-confirmed 잠금을 해제

- 대상: `DELETE /api/journal/[id]`
- 업무 항목: 실제 측정 등록, V2 lock, Summary, 보고서 처리
- Authoritative Source: `measurement_journal`
- 실제 동작: journal row만 삭제한다.
- 영향:
  - Summary에서는 즉시 사라진다.
  - `measurement_business` 기반 보고서 처리 목록에는 계속 남는다.
  - V2 plan과 legacy는 남는다.
  - journal 존재가 유일한 true-confirmed 기준이므로 V2 잠금이 해제된다.
- 권한 문제: route 설명은 관리자 전용이지만 일반 사용자 역할에도 `journal:delete`가 부여돼 있다.
- 발생 경로: `app/api/journal/[id]/route.ts:735-799`, `lib/permissions.ts`
- 권장 수정안: 관리자 전용, 삭제 사유·감사, dependency 검증, 원자 상태전이를 포함한 전용 경로로 변경한다.
- 수정 위험: journal 삭제를 취소·repair와 구분하는 업무 정책이 필요하다.
- 자동 수정: **NO**

### [연동 불일치 #4 — BLOCKER] journal 없는 대상이 보고서·K2B 큐에 진입

- 대상: 보고서 처리 목록·메일·K2B
- 업무 항목: 실제 측정 실시/미실시
- Authoritative Source: journal 존재 여부
- Upstream 실제값: journal 없음
- Downstream 실제값: `measurement_business`만 있으면 목록에 표시되고 선택·queue 등록 가능
- 기대값: 실제 journal이 없으면 출력·메일·K2B 대상이 아니어야 함
- 발생 경로:
  - `app/api/report-processing/route.ts:23-85`
  - `app/(dashboard)/report-processing/page.tsx:200-309`
  - `app/api/report-processing/queue/route.ts:16-52`
- 영향: 미측정 대상에 기존 파일을 발송하거나 K2B 자동화를 실행할 수 있다.
- 권장 수정안: 목록·queue·worker 세 경계에서 exact journal identity를 재검증한다.
- 수정 위험: 낮음. 다만 실제 journal identity의 정규/수시 semantics를 함께 통일해야 한다.
- 자동 수정: **NO**

### [연동 불일치 #5 — HIGH] V2 역할·공시료가 일지·요약·출력에 전달되지 않음

- 업무 항목: 예비조사일, 조사자, 방식, 공시료 측정자
- Authoritative Source: V2 plan/assignment
- Downstream 실제값: legacy 또는 사용자 입력 문자열
- 실제 증거: Staging `SYN011`은 V2 plan과 journal이 있지만 legacy가 없어 Summary 예비조사 값이 비어 있다.
- 원인: journal POST와 Summary가 V2를 조회하지 않는다.
- 영향: V2와 legacy가 다르거나 legacy가 없는 경우 다른 사람·코드 또는 `-`가 표시된다.
- 권장 수정안: snapshot/live-reference 정책 확정 후 공통 resolver 또는 journal role snapshot을 도입한다.
- 수정 위험: schema/migration 및 기존 journal backfill 정책 결정이 필요하다.
- 자동 수정: **NO**

### [연동 불일치 #6 — HIGH] 다일 날짜별 역할 소실

- 업무 항목: 보고서 담당자, 측정 참여자, 공시료 측정자
- Authoritative Source: 날짜별 `daily_staff`, 날짜별 V2 assignment
- Downstream 실제값: journal 단일 `measurer` 문자열, Summary 첫 legacy row 대표값
- 기대값: 각 날짜의 역할을 복원할 수 있어야 함
- 영향: 어느 날짜에 누가 참여·보고·공시료를 담당했는지 후단에서 확인할 수 없다.
- 권장 수정안: 날짜별 role snapshot과 집계 표시를 분리한다.
- 수정 위험: 다일 표시 형식 및 과거 데이터 보완 정책 필요
- 자동 수정: **NO**

### [연동 불일치 #7 — MEDIUM] 정규/수시 identity 방식 불일치

- Summary: `ilike`, `(수시)` 제거, 양방향 `includes`
- Journal search: 일반 exact, `(전체)`만 prefix
- Journal Excel: prefix match
- Report/K2B: exact match
- 영향: `상반기`와 `상반기(수시)`의 target·legacy·Summary가 잘못 연결될 가능성이 있다.
- 권장 수정안: canonical identity helper를 만들고 “전체” 조회와 exact 업무 identity를 분리한다.
- 자동 수정: **NO**

## 8. 종성모터스 / 우송 결과

현재 Production live 연결은 사용할 수 없어 다음 두 저장 artifact를 사용했다.

- `C:\Users\USER\Downloads\2026-08-26_pr59-production-after.json`
- `C:\Users\USER\Downloads\2026-08-26_preliminary-survey-v2-legacy-inventory.json`

| 대상 | target | V2 plan | 공시료 | 보고서 담당 | 측정 참여자 | journal |
| --- | --- | --- | --- | --- | --- | --- |
| 종성모터스 H0034 | 541, 8/28 | 8/25, 한기문, phone | 한기문(B) | 김민영 | 강종구 | 없음 |
| 우송 H0527 | 722, 8/28 | 8/25, 강종구+이주형, field | 강종구(C) | 이주형 | 이주형 | 없음 |

두 건은 artifact 기준으로 `target + V2 + legacy manifest`는 있었지만 실제 journal은 없었다.

- 일반 측정일지 검색에 나타나는 이유: 등록 후보
- “등록 현황”과 Summary: 나타나면 안 됨
- 보고서 처리: `measurement_business`가 있으면 잘못 나타날 수 있음

이 결과는 2026-08-26 snapshot 기준이며 현재 live 상태는 Production READ-ONLY 연결 복구 후 다시 확인해야 한다.

## 9. 추천 → Apply 잔여 감사

판정: **PASS / NO CHANGE**

- Recommend와 Apply는 동일 `buildMeasurementAssignmentTargets`를 사용한다.
- Apply는 target 원천을 다시 읽는다.
- assignee, survey code, fingerprint를 canonical 재계산한다.
- 다일 `daily_staff` 불완전은 409로 차단한다.
- plan/assignment는 단일 persistence RPC로 저장한다.

기존 6개 업체 Local E2E는 Recommend → Apply → V2 plan/assignment까지 검증했다. 다만 journal → Summary → 출력은 검증하지 않았다.

근거: `docs/reports/2026-08-23_pr42-final-local-apply-e2e.md`

## 10. MAIN ↔ DB MIGRATION / RPC DRIFT

| DB Object | Local | Staging | Production | 판정 |
| --- | --- | --- | --- | --- |
| V2 plan/assignment tables | 미확인 | 존재 | 미확인 | Staging PASS |
| persistence wrapper RPC | 미확인 | 존재 | 미확인 | Staging PASS |
| safe delete RPC | 미확인 | 존재 | 미확인 | Staging PASS |
| true-confirmed repair RPC/audit | 미확인 | 존재 | 미확인 | Staging PASS |
| true-confirmed/assignment triggers | 미확인 | 존재 | 미확인 | Staging PASS |
| `designated_office_quotas` | 미확인 | 없음 | 미확인 | 실제 drift |
| `designated_office_quota_history` | 미확인 | 없음 | 미확인 | 실제 drift |
| `exec_sql`, debug table/RPC | 미확인 | 없음 | 미확인 | 유지보수·debug 경로 실패 |

추가 확인:

- Staging migration history: 119건
- Staging 핵심 테이블의 anon/auth 직접 privilege: 모두 false
- V2 plan/assignment의 service role 권한: SELECT-only
- 다수 테이블에 RLS-disabled advisory가 있으나 확인한 핵심 테이블은 anon/auth privilege가 없어 즉시 공개 노출로 판정하지 않았다.
- Local: Docker Desktop Linux Engine 미기동으로 비교 불가
- Production: 기존 연결 키 요청이 401이고 연결된 Supabase 프로젝트 목록에 Production이 없어 현재 schema 비교 불가

## 11. 권장 보완 순서

1. true-confirmed PATCH guard와 target/journal DELETE를 먼저 보완한다.
2. 보고서 처리 목록·queue·worker에 journal gate를 추가한다.
3. V2 역할을 journal·Summary·출력으로 전달하는 공통 resolver를 설계한다.
4. 다일 역할 저장·표시 정책을 확정한다.
5. 정규/수시 identity를 통일한다.
6. Staging quota table drift를 별도 migration으로 보완한다.
7. Staging E2E 후 Production migration은 별도 승인으로 진행한다.

## 12. 사용자 승인 필요 항목

- true-confirmed에서 동결할 target 필드 범위
- V2 역할을 최신값으로 조회할지 journal 등록 시 snapshot으로 고정할지
  - 권장: journal 등록 시 날짜별 user ID·survey code snapshot 고정
- 다일 역할을 날짜별로 출력할지, 집계값도 함께 제공할지
- target 삭제를 금지하고 취소 상태로 전환할지
- journal 삭제를 관리자 감사형 기능으로 유지할지
- 기존 journal의 backfill 여부
- `상반기`와 `상반기(수시)`를 항상 독립 identity로 볼지
- Staging quota migration 추가 여부

## 13. 검증 결과와 변경 상태

| 검증 | 결과 |
| --- | --- |
| focused tests | PASS, 83/83 |
| full `npm test` | PASS, 536/536 |
| `git diff --check` | PASS |
| Fresh Verifier | FAIL, blocker 확인 |
| 내부 Browser Runtime | `Browser is not available: iab`, browser 목록 `[]` |
| 코드·문서 수정 | 감사 단계 0 |
| Production DB write | 0 |
| Production migration | 0 |

Fresh Verifier는 별도 READ-ONLY 관점에서 다음을 재확인했다.

1. true-confirmed 수정 guard 우회와 partial save
2. V2 역할·공시료 downstream 단절
3. journal 없는 대상의 보고서 queue 진입
4. 다일 날짜별 역할 소실
5. target/journal DELETE의 권한·감사·dependency 문제

## 14. 결론

Recommend → Apply와 V2 persistence 내부는 canonical하게 동작한다. 그러나 V2 이후의 journal·Summary·출력·보고서 처리에는 legacy 원천과 별도 상태가 계속 사용되고 있으며, true-confirmed 수정 및 삭제 경로에는 출시 차단 수준의 정합성 문제가 있다.

이번 감사에서는 어떠한 자동 수정도 수행하지 않았다. 사용자 승인 후 root cause 단위로 보완하고 Local → Staging Preview → 사용자 승인 → Production 순으로 검증해야 한다.
