# 예비조사 V2 선행 2단계 DB 적용 결과 (2026-08-14)

## 판정

2단계 범위의 additive schema, 2026년 하반기 확정 기본유형, 공정변경 초기값 적용을 완료했다. 예비조사 V2 계획은 저장하지 않았고, legacy 예비조사 데이터 및 기존 분류 보조 컬럼은 변경하지 않았다. 다음 3-A/3-B/3-C 작업은 사용자 검토 전 진행하지 않는다.

## 적용 전 점검

- 운영 `measurement_target_business`에는 `business_type`, `process_changed`가 없었다.
- `preliminary_survey_policy_settings`는 없었다.
- `preliminary_survey_v2_plans`는 존재했고 적용 전 0건이었다.
- `preliminary_survey_rule_type`, `requires_field_preliminary_survey`와 관련 CHECK 제약은 존재했다.
- `measurement_target_business`는 RLS가 활성화되어 있으나 직접 policy는 없고, 서버는 service role을 사용한다.
- 운영 DB에는 `supabase_migrations.schema_migrations` 관계가 없어 저장소 migration과 자동 대조할 migration history가 없다. 이번 SQL은 SQL Editor에서 파일 순서대로 직접 실행하고, 각 파일의 assertion 및 사후 schema/데이터 SELECT로 적용 여부를 검증했다.

## 실행 migration

1. `20260814090000_add_preliminary_survey_classification_schema.sql`
2. `20260814090100_backfill_2026_h2_business_type.sql`
3. `20260814090200_initialize_2026_h2_process_changed.sql`

각 backfill은 별도 transaction이며, 대상 수·분포·누락·초과·업종 count가 예상과 다르면 exception으로 rollback하도록 구성했다.

## additive schema 결과

- `measurement_target_business.business_type`: `text`, nullable, DEFAULT 없음
- 허용값 CHECK: `existing`, `first_measurement`, `external_new`
- `measurement_target_business.process_changed`: `boolean`, nullable, DEFAULT 없음
- legacy `preliminary_survey_rule_type`, `requires_field_preliminary_survey`: 유지
- 정책 테이블 `preliminary_survey_policy_settings`: 생성
- 정책 row `process_changed_preliminary_survey`: `enabled=false`, 적용 시작값 모두 NULL
- 정책 테이블: RLS 활성화, `anon`/`authenticated` 직접 권한 제거, `service_role`만 CRUD 허용
- 정책 API: `system:settings` permission을 GET/PATCH 모두 강제

## 2026 H2 business_type backfill

권위 manifest는 `docs/measurement-target-classification-review-2026-h2.xlsx`의 사용자 확정값이다.

| 검증 | 결과 |
|---|---:|
| Excel 행 | 330 |
| composite key 중복 | 0 |
| 운영 missing / extra | 0 / 0 |
| affected rows | 330 |
| existing | 302 |
| first_measurement | 21 |
| external_new | 7 |
| NULL / 기타 값 | 0 / 0 |

manifest SHA-256는 `ec6f226e5073ad8fede09e087e0ed29064c8849de9e191148d99820224dccb6b`이다.

## process_changed 초기 반영

공정변경 자동판정에는 `measurement_target_business.business_category`만 사용했다.

| 구분 | 건수 |
|---|---:|
| `trim(business_category) = '공업사'` | 155 |
| `trim(business_category) = '건설'` | 65 |
| exact 업종 기본 true | 220 |
| exact 외 명시적 `공정 변경` journal 근거 | 1 |
| 최종 `process_changed=true` | 221 |
| 기타 업종 `false` 일괄 반영 | 0 |
| 기타 업종 NULL 보존 | 109 |

exact 외 1건은 H0511이며, 같은 code/year/period의 journal id 1814에 독립 token `공정 변경`이 명시돼 있어 true로 반영했다. `제조업 및 유사 산업용 건물 건설업`이라는 업종 문자열 자체를 contains 추론에 사용하지 않았다.

## 업종 권위와 journal 정합성

- 권위 원천은 `measurement_target_business.business_category`로 고정했다.
- 정상 target 값인 `공업사`, `건설`, 기타 정상 업종은 fallback으로 덮어쓰지 않는다.
- fallback은 NULL, 공란, `선택`만 허용한다.
- 2026 H2 연결 journal 92건의 업종 불일치: 0건
- 따라서 기존 journal 데이터 수정: 0건
- 신규 journal 생성/수정 시 target 업종을 우선 사용하도록 변경했다.
- 신규 journal 생성/수정 시 target 확정 분류를 `최초실시`, `타기관 신규`, `공정 변경` 호환 token으로 정규화하고 기타 note token은 보존한다. target 분류가 NULL인 legacy 행은 기존 token을 보존한다.
- journal 저장값을 target 업종으로 역동기화하던 경로에서는 `business_category` update를 제거했다.
- target 화면에서 명시적으로 업종을 수정할 때의 target→journal 호환 동기화는 유지했다.

## 실제 수정된 운영 테이블

- `measurement_target_business`: 신규 컬럼 추가, 2026 H2 `business_type` 330건, `process_changed=true` 221건
- `preliminary_survey_policy_settings`: 신규 테이블 및 OFF 정책 row 1건

그 밖의 운영 테이블은 수정하지 않았다.

## 보호 확인

- `preliminary_survey_rule_type`/`requires_field_preliminary_survey` preimage hash: 적용 전후 동일 (`06e1b4729cc31f0e088dcf695c4405e5d144340c0b9a1fd6125d5d611af40971`)
- `preliminary_survey`: 적용 전후 490건, 최신 `updated_at` 동일 (`2026-08-14T00:01:13.141861+00:00`)
- `preliminary_survey_v2_plans`: 적용 전후 0건, 최신 `updated_at` NULL
- V2 40건 실제 저장: 0건
- journal 기존 행 수정: 0건
- `requires_field_preliminary_survey` 변경: 0건
- `preliminary_survey_rule_type` 변경: 0건

## rollback 상태

- business_type/process_changed 데이터 변경은 각각 독립 transaction과 assertion으로 실행됐다.
- 실행 중 count/scope mismatch는 발생하지 않았다.
- additive nullable 컬럼 및 정책 테이블은 유지한다.
- 앱 변경은 일반 Git revert로 복구 가능하다.
- 신규 컬럼을 DROP하는 자동 rollback은 제공하지 않는다.

## 다음 단계 가능 여부

schema/API/data 기반은 준비됐다. 다만 이번 단계에서는 V2 추천 분류 원천 전환, 40건 계획 저장, 정책 UI, 대규모 UI 변경을 수행하지 않았다. 사용자 검토 후 별도 지시가 있을 때만 3-A/3-B/3-C를 진행한다.
