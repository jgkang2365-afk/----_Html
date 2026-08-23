# Stage 2-0 운영 DB V1 예비조사일 초기화 보고서

## 1. 최종 판정

**BLOCKED — Stage 2-0A READ-ONLY 조사 완료, Stage 2-0B UPDATE 미실행**

운영 DB에서 실제 V1 plan 날짜 원천은 `public.preliminary_survey_plans.recommended_date`로 확인됐다. 다만 유일한 비보호·미확정 후보가 `needs_review` 상태여서 CHECK constraint가 `recommended_date IS NOT NULL`을 강제하고, UPDATE trigger도 `row_version`과 `updated_at`을 함께 변경한다. 지시된 “V1 날짜 한 컬럼만 NULL, 다른 컬럼 변경 0”을 만족하는 UPDATE가 불가능하므로 운영 write를 실행하지 않았다.

## 2. 실행환경

- 실행일: 2026-08-23 (Asia/Seoul)
- 저장소: `jgkang2365-afk/----_Html`
- 브랜치: `feature/preliminary-survey-phase-b`
- 조사 시작 HEAD: `25991bc180d8e5492465af085eb60eed329957db`
- 운영 Supabase project: `측정일지 관리 시스템`, PostgreSQL 17.6, Seoul region
- DB 접근: Supabase CLI one-shot `db query`의 임시 PostgreSQL login role
- Next.js 개발서버/API/브라우저/Vercel 경유: 사용하지 않음
- Local DB write: 0
- 운영 DB write: 0

## 3. 실제 V1/V2 저장 원천

| 구분 | table / column | 연결 방식 | 판정 |
| --- | --- | --- | --- |
| V1 plan 날짜 | `preliminary_survey_plans.recommended_date` | `measurement_target_business_id` 명시적 FK | 초기화 의도에 해당하는 실제 V1 plan 원천 |
| V2 plan 날짜 | `preliminary_survey_v2_plans.recommended_date` | `measurement_target_business_id` 명시적 FK | 수정 금지, write 0 |
| legacy 측정일 사본 | `preliminary_survey.measurement_date` | `(code, year, period, measurement_date)` | 예비조사일이 아니라 실제 측정일 사본이며 NOT NULL; 수정 대상 아님 |

`preliminary_survey.measurement_date`는 범위 내 109개 legacy row 중 105개가 target 첫 측정일과 같고, 나머지 4개는 다일 측정의 추가 실제 측정일이었다. 따라서 이 컬럼을 V1 예비조사일로 간주해 NULL 처리하면 실제 측정 일정 원천을 훼손한다.

## 4. 현재 표시 우선순위

현재 `/api/survey`는 V2 plan이 있으면 응답의 `preliminary_survey_date`에 V2 `recommended_date`를 넣고 `participant_names`를 우선 표시한다. V2 plan이 없을 때는 legacy `preliminary_survey` 조사자 값을 유지하지만, 현재 코드와 회귀 테스트는 `preliminary_survey_plans`를 읽지 않는다.

따라서 “V1 plan 날짜를 현재 API가 fallback 표시한다”는 전제는 현재 코드와 일치하지 않는다. V1 plan 날짜 2건은 운영 DB에 존재하지만 현재 화면 날짜 fallback 원천은 아니다.

## 5. Stage 2-0A inventory

측정 예정일은 `measurement_target_business.measurement_date`에서 첫 유효 날짜를 파싱하고 `>= 2026-08-01` 조건을 적용했다. V1 plan은 명시적 FK로 연결했으며 찐확정은 `(code, year, normalized period)`에 해당하는 `measurement_journal` row 존재로 판정했다.

| 항목 | 건수 |
| --- | ---: |
| 측정일 2026-08-01 이후 전체 target | 105 |
| 실제 V1 `recommended_date IS NOT NULL` | 2 |
| 찐확정 제외 | 1 |
| 보호 대상 제외(찐확정 제외 후) | 0 |
| 기타 제외 — status CHECK가 non-null 강제 | 1 |
| 최종 안전한 NULL 예정 | 0 |

대상별 manifest 요약:

| code | target ID | 측정 예정일 | V1 현재 날짜 | status | 제외 사유 |
| --- | ---: | --- | --- | --- | --- |
| H0011 | 548 | 2026-08-21 | 2026-08-24 | cancelled | `measurement_journal` row 존재(찐확정) |
| H0098 | 455 | 2026-08-26 | 2026-07-07 | needs_review | `preliminary_survey_plans_status_payload`가 날짜 non-null 강제 |

보호 대상 10개는 범위 target inventory에 포함해 확인했지만 V1 non-null 후보 중 찐확정 제외 후 보호 대상은 0건이었다.

## 6. before-image / raw evidence

- 로컬 비커밋 manifest: `C:\Users\USER\Downloads\2026-08-23_stage2-0A-v1-plan-candidate-manifest.json`
- SHA-256: `4BB6F9B5F137E2896611FE5486422A593CC067138B3DF21E062C8DF577CD00D9`
- Git 및 `docs/reports/`에는 raw manifest를 포함하지 않았다.
- 안전한 최종 UPDATE 대상이 0건이므로 Stage 2-0B용 `EXPECTED_COUNT`와 실행 직전 before-image는 고정하지 않았다.

## 7. Stage 2-0B 차단 근거

운영 constraint `preliminary_survey_plans_status_payload`는 다음을 강제한다.

- `pending`: `recommended_date IS NULL`, `confirmed_date IS NULL`, `visit_mode IS NULL`
- `recommended` / `needs_review`: `recommended_date IS NOT NULL`, `visit_mode IS NOT NULL`
- `confirmed`: `recommended_date`, `confirmed_date`, `visit_mode`, `confirmed_at` 모두 필요
- `cancelled`: payload 제한 없음

남은 후보 H0098은 `needs_review`이므로 날짜만 NULL로 바꾸는 UPDATE는 CHECK violation이다. 상태를 함께 바꾸면 “다른 컬럼 write 0”을 위반한다.

또한 `trg_touch_preliminary_survey_plans`는 모든 UPDATE에서 `updated_at = CURRENT_TIMESTAMP`, `row_version = OLD.row_version + 1`을 수행한다. 날짜 한 컬럼만 UPDATE하더라도 실제 변경 컬럼이 3개가 되어 지시 범위를 위반한다. constraint/trigger/schema 변경과 migration은 모두 금지되어 있으므로 우회하지 않았다.

## 8. 실행 및 post-check

| 항목 | 결과 |
| --- | --- |
| EXPECTED_COUNT | write용 값 미고정; 안전 후보 0 |
| 실제 UPDATE | 0 |
| transaction | UPDATE transaction 미시작 |
| rollback | 불필요 |
| 초기화 후 non-null 잔여 | V1 2건 유지 |
| 찐확정 변경 | 0 |
| 보호 대상 변경 | 0 |
| V2 plan 변경 | 0 (`preliminary_survey_v2_plans` 현재 43건 유지) |
| V2 assignment 변경 | 0 (운영에는 해당 table이 아직 없음) |
| 조사자/측정자/공시료/target 변경 | 0 |
| 다른 컬럼 변경 | 0 |
| migration/schema/trigger/RLS/RPC 변경 | 0 |

## 9. Stage 2 후속 단계

- Stage 2-1 historical replay: 미실행
- Stage 2-1 Docker dry-run: 미실행
- Stage 2-2 운영 보정: 미실행
- V2 plan 생성/Apply: 미실행
- 날짜/조사자/측정자 재추천·재배정: 미실행

## 10. 남은 blocker / 결정 필요 사항

1. H0098 V1 plan을 제거하려면 현 스키마에서는 최소한 status/payload와 trigger metadata 변경을 함께 다뤄야 하므로 “날짜 한 컬럼만 변경” 범위로는 실행할 수 없다.
2. 현 API가 V1 `preliminary_survey_plans.recommended_date`를 fallback 표시하지 않는 것이 의도인지 별도 확인이 필요하다. 이번 작업에서는 제품 코드를 수정하지 않았다.
3. 운영 DB에는 `preliminary_survey_v2_measurement_assignments`가 아직 없으므로 PR #42 migration 적용 전 상태다. 이번 작업에서는 migration을 적용하지 않았다.

## 11. Worker 상태

- 독립 검증 worker: 1개 (`gpt-5.6-terra`, reasoning `medium`, 요청/effective 확인)
- 담당: V1/V2 원천·연결키·제외 조건·건수의 읽기 전용 독립 검증
- created: 1
- completed: 1
- failed: 0
- active task: 0
- active worker: 0
- 독립 판정: 운영 V1 plan 총 8건, 범위 내 날짜 non-null 2건, 미확정·비보호 교집합 1건을 재확인했다. 해당 1건은 `needs_review` CHECK와 UPDATE trigger 때문에 날짜 한 컬럼만 변경할 수 없고 현재 화면/API도 V1 plan을 읽지 않으므로 Stage 2-0B 실행 불가로 판정했다.
- closed: exact worker terminal은 `observation.status=exited`, disconnected 상태
- remaining active worker: 0
- Orca resource accounting: 종료된 exact terminal의 process stop을 재확인하지 못해 `release_unknown` 1건. transcript는 보존됐으며 실제 active worker와 무관하다.

## 12. 결론

Stage 2-0A는 완료했으나, 안전하게 NULL 처리할 수 있는 V1 날짜 row가 없다. 요구 범위를 지키면서 Stage 2-0B를 실행할 수 없으므로 Stage 2-0은 BLOCKED이며 운영 DB write는 0건이다.
