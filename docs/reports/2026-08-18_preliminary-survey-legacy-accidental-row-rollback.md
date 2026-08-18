# 예비조사 legacy 행 판정 보고서 (2026-08-18)

## 작업 목적

2026-08-18 정책 OFF 이후 구버전 서버가 오자동 생성한 예비조사 V2 plan 5건(1차 원복 완료)과
같은 저장 시점에 함께 생성된 것으로 확인된 legacy `preliminary_survey` 행 5건이
**정상 운영 데이터인지, V2 자동생성의 오자동 부산물인지**를 READ-ONLY로 판정한다.

이번 작업은 DB 진단/판정 중심이며 코드 수정은 수행하지 않았다.

## 대상 5건

| legacy id | 코드 | 사업장 | 측정일 |
|---|---:|---|---|
| 690 | H0016 | 중문공업사 | 2026-08-28 |
| 691 | H0034 | 종성모터스 | 2026-08-28 |
| 692 | H0035 | 금빛종합모터스 | 2026-08-28 |
| 693 | H0048 | (주) 운성모터스 | 2026-08-28 |
| 695 | H0526 | 씨메스로보틱스 YAN5 FC Robot Arm | 2026-08-25 |

## 생성시각 및 V2 오자동 생성과의 연계

| legacy id | 코드 | legacy created_at(UTC) | V2 plan 생성시각(UTC) | 연계 |
|---|---:|---|---|---|
| 690 | H0016 | 2026-08-18 07:15:40 | 07:15:43 | 동일 저장 요청(3초 내) |
| 691 | H0034 | 2026-08-18 07:18:55 | 07:18:58 | 동일 |
| 692 | H0035 | 2026-08-18 07:19:57 | 07:20:00 | 동일 |
| 693 | H0048 | 2026-08-18 07:21:10 | 07:21:13 | 동일 |
| 695 | H0526 | 2026-08-18 07:26:18 | 07:28:14 | 근접 |

- 정책 OFF 시각: 2026-08-18 05:44:29 UTC — 5건 모두 OFF 이후 생성.
- V2 plan과 legacy 행은 **동일한 측정대상사업장 저장 요청(PATCH /api/businesses)의 결과물**이다.

## 생성 경로 코드 분석 (READ-ONLY, 수정 없음)

- legacy `preliminary_survey` INSERT: `app/api/businesses/route.ts:872` **Integrated Sync**
  - `PATCH /api/businesses`에서 `measurement_date / measurer_id / collaborators / daily_staff / business_name` 중 하나라도 변경되면(`isMeasurementUpdate`) 측정일별로 legacy 예비조사를 INSERT/UPDATE.
  - V2와 무관한 **기존 정상 동기화 경로**.
- V2 plan 생성: 같은 PATCH 요청에서 `steadyStateTriggered` 시 `ensureV2PlanForTarget`(`route.ts:1049`).
- **결론**: V2 plan은 정책 OFF를 무시한 오자동이었고, legacy 행은 동일 저장 요청에서 정상 동기화된 데이터이다.

## 기존 baseline 여부

- 2026-08-18 이전 baseline(정책 OFF 직후 43건 기준)에는 이 5개 legacy 행이 없었다.
- 5건 모두 08-18 정책 OFF 이후 생성된 신규 행이지만, 아래 판정에 따라 **오자동이 아닌 정상 동기화 결과**로 판단.

## 사용자 수동 개입 여부

- `created_by = NULL` (시스템 기록).
- 다만 5개 target 모두 `is_registered = 실시`(실측정자 확정) 상태이고, H0016·H0034 target notes에 담당자 업무 메모가 존재 — 사용자가 실측정자/보고서 담당자를 확정 저장한 정상 업무 흐름이다.
- V2 plan과 달리 legacy 행은 `created_at == updated_at`이 아니며 생성 후 정상 갱신 이력이 있다.

## 측정일지 등록 여부

- 2026 하반기 `measurement_journal` **미등록**, `sequence_number` **미부여** (정상 — 아직 측정 전).

## 후속 참조 여부

- `measurement_summary.survey_id` 참조 없음.
- `preliminary_survey_v2_plans`를 FK로 참조하는 테이블 없음.
- 후속 참조 없음.

## 기존 방식에서 필요한 데이터인지 판정

| 코드 | target is_registered | 실측정자 | 보고서담당 | legacy 값과 target 일치 |
|---|---|---|---|---|
| H0016 | 실시 | 강종구 | 김민영 | 일치 |
| H0034 | 실시 | 강종구 | 김민영 | 일치 |
| H0035 | 실시 | 강종구 | 김민영 | 일치 |
| H0048 | 실시 | 강종구 | 김민영 | 일치 |
| H0526 | 실시 | 강종구 | 강종구 | 일치 |

- legacy 값은 target의 **실측정자 확정값을 그대로 반영** (V2 추천값과 다름).
- `google_event_id` 할당 → 캘린더 일정으로 사용됨.
- 예비조사 목록(`/api/survey` GET)은 `preliminary_survey`를 직접 조회 → 5건이 목록에 노출됨.
- **판정: 기존 방식 운영에 필요한 정상 데이터.**

## 실제 원복 대상

- **없음.** 5건 모두 정상 운영 데이터로 판정되어 유지.

## 삭제 전/후 검증 결과

- DELETE 미수행(사용자 승인 결과: 유지).
- 원복(삭제)을 하지 않았으므로 데이터 변경 없음.

## 기준선 유지 여부

| 항목 | 상태 |
|---|---|
| V2 plan 총 43건 | 유지 (auto 26 / manual 17) |
| link set 18 / null 25 | 유지 |
| audit 15 | 유지 |
| measurement_target_business | 무변경 |
| manual plan 17건 | 무변경 |
| H0525 baseline | 무변경 |
| legacy preliminary_survey 총 496건 | 유지 (5건 포함) |
| 정책 `process_changed_preliminary_survey.enabled` | `false` 유지 |

## 브라우저 검증 결과

- 로컬 서버 미기동으로 브라우저 직접 확인은 미수행.
- 코드 경로 조회(`/api/survey` GET, `lib/google/sync-service.ts`)로 예비조사 목록·캘린더가
  `preliminary_survey` 행을 직접 사용함을 확인. 행 유지 시 기존 목록·일정은 영향 없음.

## 발견된 후속 문제/주의사항

- 2026-08-18에 이번 5건 외 legacy 행이 함께 생성됨:
  - H0523(id 688), H0524(id 689): 05:39~05:40 UTC (정책 OFF 직전).
  - **H0508(id 697/699/701)**: 동일 target에 08-03 측정일 2건 + 08-25 1건이 같은 저장 흐름에서 생성.
    정상 다중일정 가능성 또는 중복 생성 여부를 별도 확인할 필요가 있다.
- 자동추천 정책 OFF는 유지되며, 구버전 서버에 의한 추가 오자동 생성을 막으려면
  최신 main 배포 유지가 필요하다.
