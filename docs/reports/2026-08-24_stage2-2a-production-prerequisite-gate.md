# Stage 2-2A 운영 prerequisite 적용 및 최종 실행 게이트

## 판정

**PASS**

- Stage 2-2 historical replay/backfill 실행: **0건**
- 운영 업무 데이터 write: **0건**
- prerequisite schema/function/trigger/permission migration만 적용했다.
- PR #42는 Draft/Open 상태를 유지했고 merge하지 않았다.

## 실행 기준

- Repository: `jgkang2365-afk/----_Html`
- Branch: `feature/preliminary-survey-phase-b`
- PR: `#42` (Draft, Open)
- 시작 HEAD: `26b14c3ad1b96067a2aa417fdbc4a8daef396346`
- 검증 종료 기준 HEAD: `26b14c3ad1b96067a2aa417fdbc4a8daef396346`
- 운영 project ref: `xjxqbwvcgffunqnkmoqw`
- 운영 PostgreSQL: `17.6`
- Local replay: `C:\Users\USER\supabase-pr42-validation`

## 시작 상태와 적용 방식

운영 READ-ONLY 조사에서 다음 prerequisite object가 모두 없었다.

- `users.is_preliminary_survey_manager`
- `preliminary_survey_v2_measurement_assignments`
- core/wrapper assignment RPC
- plan/assignment true-confirmed guard
- assignment `survey_code` validation

기존 기반 함수 3개(`persist_preliminary_survey_v2_plan`, batch 함수, admin repair 함수)는 존재했다. 운영에는 `supabase_migrations.schema_migrations` relation이 없어서 표준 `supabase db push`는 기존 53개 migration까지 다시 적용하려 했다. 따라서 `db push`와 추측성 `migration repair`는 사용하지 않았다.

8개 파일을 committed SHA-256과 HEAD diff로 재검증한 뒤, 한 `psql` 세션의 `--single-transaction`, `ON_ERROR_STOP=1`, `SET ROLE postgres`로 원자 적용했다. 파일 사이 object assertion과 최종 권한 assertion을 같은 transaction 안에서 실행했다. 5번 migration의 top-level 보정은 신규 assignment table이 외부에 노출되기 전 실행되어 `UPDATE 0`이었다.

## 적용 migration

이미 적용되어 건너뛴 후보 migration은 0개였다. 다음 8개를 사용자 지정 의존 순서로 적용했다.

1. `20260822_add_preliminary_survey_manager.sql`
2. `20260822_lock_true_confirmed_v2_plans.sql`
3. `20260822_enforce_true_confirmed_trigger.sql`
4. `20260822153000_add_preliminary_survey_v2_measurement_assignments.sql`
5. `20260823120000_finalize_preliminary_survey_assignment_approval_groups.sql`
6. `20260823123000_limit_assignment_approval_groups_to_affected_dates.sql`
7. `20260823130000_fix_preliminary_survey_assignment_persistence.sql`
8. `20260823133000_fix_preliminary_survey_affected_assignment_groups.sql`

Transaction 최종 marker: `PR42_PREREQUISITE_ATOMIC_APPLY_OK`

## 운영 schema / trigger / 권한 검증

### Assignment table

`public.preliminary_survey_v2_measurement_assignments`가 생성됐고 다음을 확인했다.

- 필수 컬럼 13개 존재: plan/date/assignee/survey code/source/reason/approval/fingerprint/audit 컬럼
- `plan_id` FK 및 `plan_id + measurement_date` UNIQUE
- `survey_code IN (A,B,C,D,F,G)` CHECK
- `survey_code_source = users.survey_code` CHECK
- RLS enabled
- table ACL: `service_role=SELECT`, anon/authenticated 직접 권한 없음
- migration 직후 row count: **0**

### True-confirmed / validation trigger

- plan trigger: INSERT/UPDATE/DELETE guard
- assignment trigger: INSERT/UPDATE/DELETE guard
- assignment validation trigger: INSERT/UPDATE
- Local verification SQL에서 `measurement_journal` row 기준 guard 동작 확인
- `sequence_number`를 true-confirmed 기준으로 사용하지 않음

### RPC 경계

두 RPC 모두 owner `postgres`, `SECURITY DEFINER`, `search_path=public`을 확인했다.

- wrapper `persist_preliminary_survey_v2_plan_and_assignment_groups(...)`
  - service_role EXECUTE: **true**
  - anon/authenticated EXECUTE: **false**
- core `persist_preliminary_survey_v2_plan_and_measurement_assignments(...)`
  - service_role EXECUTE: **false**
  - anon/authenticated EXECUTE: **false**

### Survey code

- 이태환 A
- 한기문 B
- 강종구 C
- 이주형 D
- 고유빈 F
- 김민영 G

모두 active이며 `users.survey_code`를 authoritative source로 유지했다. C/CC/CCC 변형 생성은 0건이다.

## 운영 업무 데이터 write 0 증명

적용 전/후 전체 row canonical digest가 모두 동일했다.

| 원천 | before/after digest |
| --- | --- |
| `measurement_target_business` | `6b75e5ec6ef3c0be8333cd1b941662f3` |
| `measurement_journal` | `68dbb066c444d7be35861f82b5583ffc` |
| `preliminary_survey_plans` | `8682b9e5f4198bf5bcf816c471010711` |
| `preliminary_survey_v2_plans` | `af1763b038035d1bfd08488c391112d3` |
| `user_schedule_blocks` | `0806bd8e7017b9f936cd97e9ca74585a` |
| 보호 10개 target 전체 row | `8b10fccd580e0948b47e9ce32579975a` |
| `users` (신규 schema 컬럼 제외) | `2d6b9d1dfee40b06aca218d9c31e8323` |

- V2 plan: 43 → 43
- assignment: table 없음 → table 존재, row 0
- 2026-08-01 이후 target: 105 → 105
- measurement journal: 1004 → 1004
- 보호 target: 10 → 10, 업무값 변경 0
- `process_changed_preliminary_survey.enabled=false` 유지
- Stage 2-2 replay/backfill write: 0

운영 public schema 증거:

- before: `C:\Users\USER\Downloads\2026-08-24_stage2-2a-production-public-schema-before.sql`
  - SHA-256 `858BCCD65272249F0F268F36BFC58BE804F708410FDF1B033C4E2D609C96F9B6`
- after: `C:\Users\USER\Downloads\2026-08-24_stage2-2a-production-public-schema-after.sql`
  - SHA-256 `C452A0D61F57BD56F1BC5852434B0F7D9643E2F18F024074F0934B7D1847BB52`

## Production inventory / stale gate

최신 hardened inventory:

- 전체 target: 105
- true-confirmed: 70
- 보호 대상: 10 (true-confirmed 중복 3, 별도 보호 제외 7)
- replay eligible: 28
- V2 plan 존재/미존재: 43 / 62
- manual/automatic V2: 17 / 26
- 적용 가능 변경: 22
- hard-block: 6
- approval-required: 2
- source incomplete: 0
- multi-day: 3
- measurement schedule block 영향 target: 0

이전 hardened inventory 105개와 target ID별 `source_fingerprint`를 비교했다.

- `STALE_SOURCE_REVIEW_REQUIRED`: **0건**
- 추가/삭제 target: 0/0
- fingerprint 변경 target: 없음

Raw inventory는 Git에 추가하지 않았다.

- 경로: `C:\Users\USER\Downloads\2026-08-24_stage2-2a-production-inventory.json`
- SHA-256: `183D3160749197250298166A0886DC53D50C5E272DAB67BA80F7E33B189E5F69`

## Docker Local historical replay

Local Supabase에 최신 inventory 최소 source를 seed하고 1차 replay, 독립 replay, Local apply, 2차 replay, V1 영향 probe 후 cleanup했다.

- replay 대상: 28
- 적용 가능 변경: 22
  - date + surveyor 변경: 21
  - date만 변경: 1
- hard-block: 6
- approval-required: 2
- deterministic: true
- 2회차 추가 변경: 0
- V1 influence: 0
- true-confirmed proposal: 0
- protected proposal: 0
- source incomplete: 0
- canonical replay digest: `ce21b23a197bbf8939328b67ecf3a5794bb8f8178e39f358d0664f9976cc20b6`

이전 hardened replay와 canonical digest 및 105개 manifest 결과가 동일했다.

Hard-block:

- 2026-08-24: H0100, H0200, H0290
- 2026-08-26: H0257, H0099, H0521

Approval-required:

- H0101 (2026-08-24)
- H0182 (2026-08-26)

실행 후보 raw manifest는 Git에 추가하지 않았다.

- 경로: `C:\Users\USER\Downloads\2026-08-24_stage2-2a-execution-candidate-manifest.json`
- SHA-256: `85C38327BD78884A2978C5AB0747B2B2240AA784B30D0D83354C5872BB0B99D8`

Cleanup 후 Local의 target/users/V2 plan/V2 assignment/V1 plan/journal/schedule block/business info/policy settings는 모두 0건이다.

## 검증

- Local persistence verification: `PR42_ASSIGNMENT_PERSISTENCE_VERIFICATION_OK`, transaction rollback 완료
- focused tests: 144/144 PASS
- `npx tsc --noEmit --pretty false`: PASS
- `npm test`: 425/425 PASS
- `npm run build`: PASS
- `git diff --check`: PASS

## 독립 worker 검산

- migration/권한 검토: Terra high 요청, 파일/DB write 0
  - 8개 단일 transaction 필요성, dependency, 최종 GRANT/REVOKE 경계 확인
- inventory/fingerprint 검산: Terra medium 요청, source fingerprint 변경 0 확인
- Local replay 검산: Terra medium 요청, digest/determinism/idempotency/cleanup 독립 확인
- 일반 독립 agent: created 3, completed 3, failed 0, active 0. 요청 모델/추론은 각각 Terra high, Terra medium, Terra medium이며 실제 runtime 모델 metadata는 검증 불가다.
- Orca supervised dispatch: created 1, failed 1, active 0. 요청/effective metadata는 `gpt-5.6-terra/high`였으나 입력이 실행되지 않아 결과에 사용하지 않았고, 독립 agent 검토로 대체했다.
- Orca terminal은 operator close 후 disconnected이며 resource release는 `identity_unproven`으로 retained 상태다. 이는 active worker가 아니고 코드/DB 검증 판정과 분리한다.
- 작업 종료: active task 0, active worker 0.

## 잔여 위험 / Stage 2-2B 전 주의

1. 운영에 `supabase_migrations.schema_migrations`가 없다. 이번에 직접 적용한 8개는 객체로 검증됐지만 공식 migration history에는 기록되지 않는다. 향후 표준 `supabase db push`는 기존 migration 재적용 위험이 있으므로 사용 전에 별도 history 복구 절차가 필요하다.
2. `20260822` version prefix 파일이 3개라 migration history 복구 시 충돌 정책을 별도로 확정해야 한다.
3. DB security advisor는 기존 `preliminary_survey_v2_plans`의 RLS 비활성을 표시했다. 현재 table ACL은 postgres와 service_role SELECT만 있고 anon/authenticated 직접 권한은 없으며, 이번 migration 범위에서 RLS/기존 정책을 임의 변경하지 않았다.
4. advisor가 표시한 기존 security-definer view/RPC 및 leaked-password-protection 경고는 이번 8개 RPC 변경과 무관하며 별도 보안 작업 후보로 분리한다. 신규 core/wrapper RPC의 anon/authenticated EXECUTE는 모두 차단됐다.
5. Stage 2-2B는 이 보고서에서 실행하지 않았다. 최신 manifest와 fingerprint를 다시 검증하고 별도 사용자 승인 후에만 진행해야 한다.
