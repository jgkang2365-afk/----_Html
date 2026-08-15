# 예비조사 V2 DB 계약 및 migration 계획

> 상태: 설계안, 미적용
>
> 조사 기준일: 2026-08-14
>
> 범위: DB 구조·저장소 코드 조사, 계약 확정안, migration/backfill/rollback 설계
>
> 제외: 운영 DB 변경, schema 적용, backfill 실행, UI·추천 로직 수정

## 1. 결론

| 항목 | 최종 권장 계약 |
| --- | --- |
| `measurement_target_business.business_type` | `text NULL`, 기본값 없음, `CHECK (business_type IN ('existing', 'first_measurement', 'external_new'))` |
| `measurement_target_business.process_changed` | `boolean NULL`, 기본값 없음 |
| 공업사/건설 기본값 | 신규 주기 행을 생성할 때 `trim(measurement_target_business.business_category)`가 정확히 `공업사` 또는 `건설`이면 `true`; 그 외는 `NULL` |
| 사용자 수정 | 자동 기본값 적용 뒤에도 `true`/`false`로 명시 수정 가능. 이후 업종 변경이 기존 사용자 선택을 자동 덮어쓰지 않음 |
| 정책 저장 | 지정한계 테이블 재사용 불가. 별도 최소 typed 테이블 `preliminary_survey_policy_settings` 권장 |
| 현재 정책 | `process_changed_preliminary_survey.enabled = false`; 데이터 입력과 무관하고 V2 추천 계산에서만 영향 차단 |
| 권위 원천 | `measurement_target_business.business_type/process_changed` |
| journal | 과거 token 입력은 읽되, 새 데이터의 분류 권위값으로 사용하지 않음. target에서 journal 표시/신규 생성으로 단방향 반영 |
| legacy | `preliminary_survey_rule_type`과 운영 DB의 `requires_field_preliminary_survey`를 당장 유지하고 삭제·일괄 보정하지 않음 |
| 2026 H2 | Excel manifest를 `(code, year, period)`로 검증한 뒤 `id`로 해소하여 `business_type` 330건만 transaction backfill |

`text + CHECK`를 PostgreSQL enum보다 권장한다. 현재 저장소가 문자열과 CHECK 제약을 주로 사용하고 있고, 단계적 배포·값 확장·rollback이 enum보다 단순하다. 두 신규 컬럼은 이행 기간에 `NULL`을 “미확정/미입력”으로 보존해야 하므로 기본값과 `NOT NULL`을 두지 않는다.

## 2. 조사 방법과 현재 schema

저장소의 schema/migration/API/type/문자열 사용처를 검색했고, 운영 Supabase에는 OpenAPI schema와 2026 H2 대상 행을 **GET/SELECT만** 수행해 교차 검증했다. 운영 DB UPDATE, DDL, RPC 호출은 수행하지 않았다.

### 2.1 `measurement_target_business`

- 최초 migration은 `id`, `code`, `year`, `period`, nullable `journal_id`를 만들고 `(code, year, period)` UNIQUE를 둔다 (`lib/db/migrations/009_create_measurement_target_business.sql:8-50`).
- 업종 snapshot은 뒤 migration에서 `business_category varchar(100)`으로 추가되며 사업장 관리 화면에서 직접 수정 가능한 값으로 설명된다 (`lib/db/migrations/031_add_business_category_to_target_business.sql:2-6`).
- 운영 schema에는 `preliminary_survey_rule_type text NOT NULL DEFAULT 'existing'`와 `requires_field_preliminary_survey boolean NOT NULL DEFAULT false`가 있다.
- 운영 schema에는 아직 `business_type`, `process_changed`가 없다.
- `requires_field_preliminary_survey`는 저장소의 코드·migration 검색 결과 사용처/정의가 없다. 운영 DB와 저장소 migration 이력 간 drift로 취급하고, 기원을 확인하기 전 변경하지 않는다.
- 사업장 GET은 `measurement_target_business.select('*')`라 신규 nullable 컬럼 추가 자체는 구버전 조회를 깨뜨리지 않는다 (`app/api/businesses/route.ts:59-65`).
- 사업장 PATCH는 allowlist 방식이며 현재 분류 두 필드는 허용하지 않는다 (`app/api/businesses/route.ts:441-453`). POST도 두 필드를 저장하지 않는다 (`app/api/businesses/route.ts:933-969`). 따라서 Phase A의 additive DDL과 구버전 앱은 공존 가능하다.

운영 schema가 저장소의 오래된 migration과 다른 타입·컬럼을 포함하므로, 2단계 migration 직전에도 `information_schema` 또는 OpenAPI schema를 다시 확인해야 한다. 저장소 파일만 기준으로 DDL을 작성하면 안 된다.

### 2.2 현재 V2와 legacy 분류

- `supabase/migrations/20260808_add_preliminary_survey_v2.sql:7-14`는 `preliminary_survey_rule_type`을 추가하고 `existing`, `general_new`, `other_org_new`, `unconfirmed_new`를 허용한다.
- 그러나 현재 TypeScript의 `BusinessKind`는 `new | existing` 두 값뿐이다 (`lib/preliminary-survey-v2/types.ts:1-5`).
- 현재 V2 계산은 target에서 분류 컬럼을 읽지 않고 같은 `code/year/period`의 최신 journal `note`를 읽는다 (`lib/preliminary-survey-v2/service.ts:127-171`).
- token 판정은 쉼표 분리 후 `신규`, `최초실시`, `타기관 신규` 중 하나가 있으면 `new`, 없으면 `existing`이다 (`lib/preliminary-survey-v2/classification.ts:25-60`).
- V2 저장 RPC도 최신 journal을 다시 읽어 `new/existing`을 재계산하고 전달값과 다르면 거부한다 (`supabase/migrations/20260808_add_preliminary_survey_v2.sql:77-123`).
- 테스트는 서비스와 수동 경로가 `preliminary_survey_rule_type`을 사용하지 않는 것을 확인한다 (`tests/preliminary-survey-v2-engine.test.ts:608-609`). 이 컬럼은 dry-run의 이전값 비교에서만 읽힌다 (`scripts/preliminary-survey-v2-dry-run.ts:36-97`).

운영 2026 H2의 legacy 분포는 `existing 324`, `general_new 5`, `other_org_new 1`이며, 확정 Excel의 `existing 302`, `first_measurement 21`, `external_new 7`과 일치하지 않는다. 따라서 legacy 값을 새 권위값으로 복사하면 안 된다.

### 2.3 `measurement_journal`

- 운영 schema의 `note`는 nullable 문자열이다.
- journal 편집 UI는 `최초실시`, `타기관 신규`, `공정 변경` 등을 쉼표 문자열로 저장하고, 과거 `공정 수시변경`을 `공정 변경`으로 읽는 일부 호환 처리를 갖는다 (`components/features/JournalEditForm.tsx:99-123`, `198-206`, `1136-1151`).
- 다만 entry 재초기화 경로는 현재 옵션과 정확히 일치하는 token만 남기므로 `공정 수시변경` 호환이 모든 경로에서 동일하지 않다 (`components/features/JournalEditForm.tsx:860-882`).
- 현재 journal 생성/수정 API는 journal의 사업장·업종·측정정보를 target에 다시 동기화한다 (`app/api/journal/route.ts:746-780`, `app/api/journal/[id]/route.ts:596-625`). 분류 필드는 아직 없지만, 향후 그대로 양방향 동기화를 추가하면 충돌 위험이 있다.
- 현재 UI 자동화는 `designated_office`가 `대전`/`천안`이고 `business_category === '공업사'`일 때만 journal note에 `공정 변경`을 자동 추가한다 (`components/features/JournalEditForm.tsx:1046-1068`). 이는 새 전사 DB 계약보다 좁고 journal UI에 결합된 legacy 동작이다.

## 3. `business_type` 최종 계약

### 3.1 값과 표시

| DB 값 | 사용자 표시 | V2의 기존 coarse 분류 |
| --- | --- | --- |
| `existing` | 기존업체 | `existing` |
| `first_measurement` | 최초실시 | `new` |
| `external_new` | 타기관 신규 | `new` |

과거 journal token `신규`는 호환 입력으로만 `first_measurement`에 대응한다. 새 UI·DB 출력값으로 `신규`를 생성하지 않는다.

### 3.2 타입과 nullable

권장 DDL 형태는 다음과 같다. 아래 SQL은 설명용이며 **운영 DB에 적용하지 않았다**.

```sql
ALTER TABLE public.measurement_target_business
  ADD COLUMN IF NOT EXISTS business_type text;

ALTER TABLE public.measurement_target_business
  ADD CONSTRAINT measurement_target_business_business_type_check
  CHECK (business_type IN ('existing', 'first_measurement', 'external_new'))
  NOT VALID;
```

- 기본값을 두지 않는다. `DEFAULT 'existing'`은 미입력을 기존업체로 오인하게 한다.
- 처음에는 nullable이다. 과거 전체 데이터에 대한 확인 근거가 없기 때문이다.
- `CHECK ... NOT VALID`로 기존 행을 즉시 전수검사하지 않고 새/변경 행부터 보호한 뒤, backfill 검증 후 `VALIDATE CONSTRAINT`한다.
- 최종 `NOT NULL`은 모든 활성 범위의 과거 행 분류가 확정되고 모든 writer가 값을 제공한다는 지표가 확보된 뒤 별도 migration으로만 검토한다. 2026 H2 330건 완료만으로 전체 테이블을 `NOT NULL`로 바꾸지 않는다.
- enum은 값 변경·삭제와 rollback 비용이 크고 현재 단계적 전환에 이점이 없어 권장하지 않는다.

측정예정일과 독립된 target 속성이므로 `measurement_date IS NULL`이어도 저장 가능하다. H0497 같은 `최초실시 + 측정예정일 미정`은 정상 상태다.

## 4. `process_changed` 최종 계약

후보 A인 nullable boolean을 권장한다.

| 값 | 의미 |
| --- | --- |
| `true` | 공정변경으로 명시 지정 |
| `false` | 사용자가 비공정변경으로 명시 확정 |
| `NULL` | 미입력·미확정 |

설명용 DDL:

```sql
ALTER TABLE public.measurement_target_business
  ADD COLUMN IF NOT EXISTS process_changed boolean;
```

기본값은 두지 않는다. non-null boolean 또는 `DEFAULT false`는 journal에 token이 없거나 아직 입력하지 않은 대상을 “명시적 비공정변경”으로 바꾸므로 요구사항을 위반한다.

### 4.1 신규 주기 기본값 규칙

신규 반기 업로드/수동 등록에서만 다음 initializer를 한 번 적용한다.

```text
사용자 입력이 있으면 그 값을 유지
else if trim(target.business_category) in ('공업사', '건설') then true
else null
```

- DB trigger로 업종 변경 때마다 재계산하지 않는다. trigger는 사용자가 해제한 `false`를 다시 `true`로 덮어쓸 수 있다.
- 생성 후 업종이 바뀌면 UI에서 재검토를 요청할 수 있지만 기존 `true/false`를 자동 변경하지 않는다.
- 정책 ON/OFF는 이 필드의 입력·표시·수정과 무관하다.
- 기존 사용자 확정값에는 신규 기본값을 소급 적용하지 않는다.

## 5. 공업사/건설 판정 근거

### 5.1 조사 결과

- 운영 `business_info`에는 `business_type`(업태), `business_category_code`, `business_category`, `main_product`가 있다. 저장소 정의도 동일하다 (`lib/db/migrations/004_add_missing_business_info_fields.sql:4-11`).
- 운영 `business_category` master는 `id`, `name`, `display_order`만 있고 업종코드 mapping 컬럼은 없다. seed에는 정확한 `건설`, `공업사` 이름이 있다 (`lib/db/migrations/018_create_business_category_table.sql:6-17`).
- target에는 반기별 수정 가능한 `business_category` snapshot이 있다.
- 사업장 GET 응답은 target 업종이 비었거나 `공업사` 또는 `선택`이면 과거 business/journal 값으로 보완한다 (`app/api/businesses/route.ts:324-329`). 즉, 현행 코드가 `공업사`를 실제 값과 placeholder처럼 동시에 취급하는 모순이 있다.
- `business_category_code`와 master category 사이의 코드 mapping은 저장소와 운영 schema에서 확인되지 않았다. `main_product`는 자유서술값이라 정책 판정 키로 부적합하다.

### 5.2 권장 기준

- 권위 필드: `measurement_target_business.business_category`
- 공업사: `trim(business_category) = '공업사'`
- 건설: `trim(business_category) = '건설'`
- `contains`, 사업장명, `main_product`, `business_info.business_type`, 미정의 `business_category_code` mapping은 사용하지 않는다.
- `제조업 및 유사 산업용 건물 건설업` 같은 비표준 값은 exact `건설` 자동 대상에 포함하지 않는다. 사용자가 직접 `process_changed=true`로 확정할 수 있다.
- 업로드 시 `business_info.business_category`를 target snapshot으로 정규화할 수는 있지만, 저장된 target 값이 이후 권위값이다.

2단계에서는 자동 기본값보다 먼저 `app/api/businesses/route.ts:324-329`의 `공업사` fallback 모순을 제거하거나 명시적 source field로 분리해야 한다.

운영 2026 H2의 exact `공업사`/`건설`은 220건이지만 Excel의 공정변경 Y는 83건이다. exact category 대상 중 137건이 Y가 아니고, 반대로 exact category 밖의 Y가 1건 있다. 이는 **신규 생성 기본값을 기존 확정행에 소급 계산하면 안 됨**을 보여준다.

## 6. 정책 저장 구조

### 6.1 기존 구조의 재사용 가능성

운영 및 코드 조사 결과:

- `designated_office_quotas`: `year`, `period`, `office_name`, 정수 `quota`
- `designated_office_quota_history`: 이전/새 quota와 사유
- `quota_memos`: 사용자 메모
- `policy_settings`, `system_settings` 같은 범용 설정 테이블은 없음
- 지정한계 API의 관리자 권한 검사는 현재 주석 처리돼 있다 (`app/api/admin/quotas/route.ts:15-18`, `55-58`).
- quota 테이블 정의 migration은 저장소에서 찾지 못했고 운영 schema에만 확인된다. 이 역시 schema drift 점검 대상이다.

quota 테이블은 지청별 정수 한계와 `(year, period, office_name)` 키에 특화되어 있다. boolean 정책, 적용일, 전역 scope를 억지로 넣으면 nullable 컬럼과 의미가 섞이므로 재사용하지 않는다. 상단 메뉴/화면 shell은 재사용할 수 있지만 저장 테이블과 API 계약은 분리한다.

### 6.2 최소 권장 구조

```sql
CREATE TABLE public.preliminary_survey_policy_settings (
  policy_key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  effective_start_year integer,
  effective_start_period text,
  effective_start_measurement_date date,
  updated_by integer REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT preliminary_survey_policy_key_check
    CHECK (policy_key IN ('process_changed_preliminary_survey')),
  CONSTRAINT preliminary_survey_policy_period_check
    CHECK (effective_start_period IS NULL OR effective_start_period IN ('상반기', '하반기')),
  CONSTRAINT preliminary_survey_policy_effective_fields_check
    CHECK (
      NOT enabled OR (
        effective_start_year IS NOT NULL
        AND effective_start_period IS NOT NULL
        AND effective_start_measurement_date IS NOT NULL
      )
    )
);
```

초기 row는 `process_changed_preliminary_survey`, `enabled=false`, 시작값 NULL이다. 시작값은 ON 전환 transaction에서 함께 채운다. 범용 JSON 설정 테이블은 첫 정책에 비해 과도하고 타입 검증이 약해 권장하지 않는다.

정책 적용 조건은 모두 충족할 때만 참이다.

1. `enabled = true`
2. target의 `(year, period)`가 적용 시작 반기 이상
3. V2가 사용하는 정규화된 측정일이 `effective_start_measurement_date` 이상
4. `process_changed = true`

측정예정일이 없으면 분류 데이터는 저장되지만 추천 계산은 아직 실행하지 않는다. 운영 `measurement_date`는 쉼표 다중 날짜를 포함하는 text이므로, 정책 적용일 비교는 기존 V2 날짜 정규화 경로를 사용하고 DB에서 text를 직접 date cast하지 않는다.

정책 API는 quota API의 주석 처리된 권한 방식을 복사하지 말고 실제 관리자 permission을 강제해야 한다. 정책 변경 이력이 필수라면 2단계 범위에서 quota history를 재사용하지 않고 정책 전용 audit 행을 같은 transaction에 기록하는 추가안을 검토한다.

## 7. `measurement_journal` 연동 계약

### 7.1 권위 방향

```text
measurement_target_business (권위)
  business_type ───────┐
  process_changed ─────┴─> journal 표시 / 신규 journal 호환 token snapshot
```

양방향 자동 동기화를 금지한다.

### 7.2 신규 journal 생성

같은 `(code, measurement_year, measurement_period)`의 target을 읽는다.

- `business_type=first_measurement` → 호환 token `최초실시`
- `business_type=external_new` → 호환 token `타기관 신규`
- `business_type=existing` → 신규 관련 token 없음
- `process_changed=true` → `공정 변경`
- `process_changed=false` → `공정 변경`, `공정 수시변경` 없음
- target 값이 NULL이면 legacy token을 이용해 target을 몰래 채우지 않는다. 기존 입력을 보존하고 사용자 확인 상태로 둔다.

서버가 분류 token을 정규화하고, 고시물질·소음 등 비분류 note token은 보존한다. 새 출력에 `신규`, `공정 수시변경`을 만들지 않는다.

### 7.3 journal 수정

- journal 수정으로 target 분류를 자동 갱신하지 않는다.
- target 값이 있으면 journal 화면은 target 값을 overlay해 보여주고, 저장 시 분류 token은 target에서 재구성한다.
- target 값이 NULL인 legacy 행에 한해 과거 token을 읽어 임시 표시할 수 있으나, target 확정은 별도의 명시적 사용자 동작이어야 한다.
- 현행 journal API가 다른 사업장 snapshot을 target으로 올리는 동작은 유지할 수 있지만 새 분류 두 필드는 그 update payload에 포함하지 않는다.

### 7.4 target 수정

- 기존 journal을 일괄 rewrite하지 않는다. journal은 작성 당시 snapshot/호환 표현으로 남긴다.
- 같은 화면에서 현재 분류를 보여줄 때 target을 overlay한다.
- 이후 생성되는 journal에는 변경된 target 값을 반영한다.

이 방식은 무한루프와 마지막 저장자 승리 문제를 제거한다. journal이 아직 없거나 측정예정일이 없어도 target 분류는 독립적으로 저장할 수 있다.

## 8. legacy 필드 이행 전략

### 8.1 `preliminary_survey_rule_type`

- 삭제하지 않는다.
- 새 코드의 권위 read/write에서 제외한다.
- `business_type IS NOT NULL`이면 반드시 business_type을 사용한다.
- `business_type IS NULL`인 호환 기간에는 `general_new → first_measurement`, `other_org_new → external_new`만 보조 힌트로 사용할 수 있다.
- legacy `existing`은 DEFAULT로 자동 생성된 값인지 사용자 확정값인지 구분할 수 없으므로 일반 행을 자동 `existing`으로 확정하는 근거로 사용하지 않는다.
- `unconfirmed_new`는 세 값 중 하나로 자동 변환하지 않고 사용자 확인 대상으로 둔다.

새 값을 legacy에 shadow-write하는 것도 1단계에서는 권장하지 않는다. 현행 V2가 legacy 필드를 읽지 않고, 운영에 출처 불명의 `requires_field_preliminary_survey`가 함께 있어 일부만 갱신하면 오히려 불일치가 커질 수 있다.

### 8.2 `requires_field_preliminary_survey`

운영에는 존재하지만 저장소 사용처가 없다. 2026 H2 분포는 `true 6`, `false 324`로 legacy 신규 분포와 일치한다. 기원·trigger·외부 consumer를 확인하기 전 읽기·쓰기·삭제하지 않는다.

### 8.3 V2 plan snapshot

현재 `preliminary_survey_v2_plans.source_rule_type`은 coarse `new/existing` snapshot이다. Phase 2에서는 기존 컬럼을 즉시 재해석하지 말고 다음 중 안전한 방식을 구현 전 결정한다.

- 권장: nullable `source_business_type`을 additive로 추가해 canonical 세 값을 snapshot하고, 기존 `source_rule_type`은 일정 규칙용 `new/existing`으로 유지
- 또는 모든 writer/RPC를 동시에 바꿀 수 있을 때 `source_rule_type` 의미를 세 값으로 전환

첫 방식이 구버전 공존과 rollback에 유리하다. 저장 RPC의 journal 재검증은 target `business_type` 재검증으로 바꿔야 한다.

## 9. 2026 H2 backfill 설계

### 9.1 검증 결과

`docs/measurement-target-classification-review-2026-h2.xlsx`의 `전체 검토`는 330행이다.

- 기존업체 302 → `existing`
- 최초실시 21 → `first_measurement`
- 타기관 신규 7 → `external_new`
- `(사업장 코드, 연도, 주기)` 중복 0
- 모든 행은 `year=2026`, `period=하반기`
- 운영 2026 H2 target도 330행이며 Excel과 누락/초과 0, composite key 중복 0

Excel에는 target `id`가 없으므로 source manifest는 composite key를 사용한다. 실제 UPDATE는 transaction 안에서 UNIQUE key로 `id`를 먼저 해소하고 `id`로 수행한다. 코드만으로는 다른 반기/연도 행을 잘못 갱신할 수 있으므로 절대 사용하지 않는다.

### 9.2 실행 전 검증

1. Excel을 정규화된 immutable manifest(`code`, `year`, `period`, `business_type`)로 변환하고 repo 검토 대상에 포함한다.
2. manifest row count 330, key 중복 0, 값 분포 302/21/7을 assertion한다.
3. 운영 target과 join하여 matched 330, missing 0, duplicate 0, extra-in-scope 0을 assertion한다.
4. 이미 non-null인 `business_type`이 manifest와 다른 행이 하나라도 있으면 자동 overwrite하지 않고 transaction을 중단한다.
5. 변경 전 `id`, 기존값, `updated_at` preimage를 보관한다.

### 9.3 UPDATE와 사후 검증

```text
BEGIN
  staging manifest 적재
  모든 assertion 수행
  composite key -> target.id 해소
  UPDATE ... WHERE target.id = resolved.id
  affected rows = 330 assertion
  결과 분포 existing 302 / first_measurement 21 / external_new 7 assertion
  NULL 0, 다른 값 0 assertion
COMMIT
```

어느 assertion이든 다르면 `ROLLBACK`한다. SQL은 고정 330을 기대값으로 갖고, `UPDATE ... WHERE year=2026 AND period='하반기'`만으로 값을 추론하지 않는다.

### 9.4 `process_changed` 별도 gate

Excel에는 Y 83, N 247이 있지만 이번 작업지시에서 최종 확정 집계로 명시된 값은 business_type 세 분류다. 따라서 기본 Phase B에는 `process_changed` UPDATE를 포함하지 않는다.

- 83건은 journal의 명시적 `공정 변경`/사용자 검토 근거를 별도 manifest로 대조할 수 있다.
- 247건을 “journal token 없음” 또는 “공업사/건설 아님”으로 일괄 `false` 처리하지 않는다.
- 사용자가 Excel의 Y/N 전체를 명시적 확정값으로 별도 승인하면, 83/247 각각의 keyed manifest로만 backfill하고 `NOT IN (...) => false` SQL은 사용하지 않는다.
- 운영 exact 공업사/건설 220건은 신규 기본값 대상 규모 참고치일 뿐 과거 UPDATE 대상 수가 아니다.

## 10. migration 및 배포 단계

### Phase 0 — 재확인/백업

- 운영 OpenAPI/information_schema, constraint, trigger, function, RLS, grant를 재조회한다.
- 저장소에 없는 `requires_field_preliminary_survey`와 quota table 생성 이력을 확인한다.
- 2026 H2 manifest와 운영 행 일치 검증을 다시 실행한다.
- 대상 preimage와 집계를 보관한다.

### Phase A — additive schema

- nullable `business_type text`, `process_changed boolean` 추가
- `business_type` CHECK를 `NOT VALID`로 추가
- `preliminary_survey_policy_settings` 추가, 정책 OFF seed
- 필요한 RLS/grant를 최소 권한으로 설정
- legacy 컬럼, journal, 기존 V2 plan은 변경하지 않음

구버전 앱은 신규 컬럼을 쓰지 않으므로 Vercel rolling deployment 중에도 동작한다.

### Phase B — 2026 H2 `business_type` backfill

- 검토된 330행 manifest만 transaction 적용
- row count와 분포가 다르면 rollback
- `process_changed`는 별도 승인 전 미적용

### Phase C — 새 앱 배포

- API GET/POST/PATCH type·allowlist에 신규 필드 반영
- 생성 경로에 공업사/건설 initializer 적용
- journal 표시/신규 생성의 단방향 호환 처리
- V2 계산과 persist RPC의 분류 원천을 target으로 전환
- 정책은 OFF이므로 `process_changed`가 추천 결과에 영향 없음
- legacy fallback과 경고/관측 지표 유지

### Phase D — 검증·제약 강화

- CHECK validation
- 신규 writer 누락/NULL/legacy fallback 사용량 관측
- 전체 활성 데이터가 확정된 뒤에만 `business_type NOT NULL` 별도 검토
- legacy 컬럼 삭제는 별도 프로젝트로 미룸

## 11. rollback 계획

- **Phase A 직후 앱 rollback:** additive nullable 컬럼과 OFF 정책 row는 그대로 둬도 구버전 앱이 무시한다. 즉시 DROP하지 않는 것이 가장 안전하다.
- **Phase B transaction 내부:** row count/분포/충돌 assertion 실패 시 전체 ROLLBACK한다.
- **Phase B commit 이후:** 앱을 먼저 rollback하고 신규 컬럼은 유지한다. 데이터 복원이 꼭 필요할 때만 preimage와 `updated_at` guard로 해당 330 id의 이전값을 복원한다. 이후 사용자 수정이 있는 행은 자동 복원하지 않는다.
- **정책 rollback:** `enabled=false`로 전환하면 추천 영향만 즉시 제거되고 입력 데이터는 보존된다.
- **DDL 제거:** 모든 신버전 consumer와 dependency가 제거됐음을 확인한 뒤 별도 승인으로 수행한다. 자동 rollback script에서 컬럼/테이블 DROP을 실행하지 않는다.

## 12. 위험요소

1. 운영 schema와 저장소 migration 이력이 완전히 일치하지 않는다. 특히 `requires_field_preliminary_survey`는 출처가 확인되지 않았다.
2. legacy `preliminary_survey_rule_type DEFAULT 'existing'` 때문에 `existing`이 확정값인지 기본값인지 구분할 수 없다.
3. 현재 V2 계산과 RPC가 journal note를 권위 원천으로 재검증하므로 앱 코드만 바꾸면 저장 시 mismatch가 발생한다.
4. target `business_category='공업사'`를 fallback 대상으로 취급하는 현행 GET 로직이 exact 업종 권위 계약과 충돌한다.
5. 현행 journal 자동 `공정 변경`은 대전/천안 공업사에만 적용돼 새 전사 규칙과 범위가 다르다.
6. 운영 `measurement_date`가 date가 아니라 다중 값을 담을 수 있는 text라 정책 적용 시작일 비교를 단순 SQL cast하면 실패하거나 오판할 수 있다.
7. quota API의 관리자 권한 검사가 주석 처리되어 있어 정책 API에 복사하면 권한 문제가 생긴다.
8. journal 양방향 동기화는 역사값 훼손, 마지막 저장자 승리, 무한 갱신 위험이 있다.
9. category 기반 신규 기본값 220건을 기존 330건에 소급하면 사용자 검토 공정변경 83건을 덮어쓴다.
10. 전역 `NOT NULL` 강화는 2026 H2 외 과거/수시 행을 확인하기 전 실행하면 migration이 실패하거나 임의값 backfill을 유도한다.

## 13. 2단계 실제 DB 반영 작업 목록

1. 운영 constraint/trigger/function/RLS/grant와 schema drift를 재조사한다.
2. 적용 전 backup 및 2026 H2 preflight 결과를 사용자에게 제시하고 승인을 받는다.
3. Phase A additive migration과 명시적 rollback 절차를 작성·검토한다.
4. `business_type` CHECK 이름 충돌과 기존 컬럼 존재 여부를 방어한다.
5. 정책 table/RLS/admin permission과 OFF seed를 구현한다.
6. Excel에서 330행 immutable manifest를 생성하고 checksum·분포·key assertion을 둔다.
7. composite key로 id를 해소한 뒤 `business_type`만 transaction backfill한다.
8. `process_changed`는 Y/N 확정 범위를 사용자에게 다시 확인한 뒤 별도 manifest/migration으로 처리한다.
9. 사업장 API type, POST, PATCH allowlist와 업로드/반기 생성 경로를 수정한다.
10. `공업사` fallback 모순을 제거하고 target category를 권위 snapshot으로 만든다.
11. journal 호환 token 정규화와 target→journal 단방향 표시/생성 계약을 구현한다.
12. V2 service와 persist RPC를 target business_type 기준으로 함께 전환한다.
13. plan에 canonical business type snapshot을 additive로 둘지 최종 결정한다.
14. 정책 OFF 상태에서 추천 결과가 변하지 않는 회귀 테스트를 추가한다.
15. 330건 집계, NULL, legacy fallback, 사용자 override 보존, journal 없는 행, 측정일 미정 행을 검증한다.
16. 관측 기간 뒤 CHECK validation을 수행하고, 전체 corpus 확인 전 `NOT NULL`과 legacy 삭제는 보류한다.

---

이 문서는 계약과 적용 순서를 확정하기 위한 1단계 산출물이다. 어떤 SQL도 운영 DB에 실행하지 않았으며, 실제 migration과 backfill은 사용자 검토·승인 후 별도 2단계로 수행한다.
