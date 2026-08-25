# Stage 2-1 Historical Replay Dry-run 검증 보고서

## 1. 결론

**Stage 2-1 Historical Replay Dry-run: PASS**

운영 DB는 READ-ONLY로 조사했고, 최소 source를 Docker + Local Supabase에 복제해 historical replay를 수행했다. 운영 DB write, 운영 migration, Stage 2-2 실행은 모두 0건이다.

## 2. 환경과 경계

- Branch: `feature/preliminary-survey-phase-b`
- 시작 HEAD: `881a083f9778985859548244c6d7ef367f171f00`
- 운영 Supabase: `xjxqbwvcgffunqnkmoqw.supabase.co`, PostgreSQL 17.6
- 운영 조회: Supabase CLI linked PostgreSQL SELECT 및 read-only Supabase client SELECT
- Local: `C:\Users\USER\supabase-pr42-validation`, Docker 29.7.2, Supabase CLI 2.114.0
- Local DB/API: `127.0.0.1:54322` / `127.0.0.1:54321`
- 외부 route provider 호출: 0건. 동일주소 외에는 provider evidence 없는 근거리 묶음을 만들지 않았다.
- `preliminary_survey_policy_settings.process_changed_preliminary_survey.enabled=false` 유지 확인

운영 조회 전후 전체 row digest는 다음과 같이 동일했다.

| 원천 | 건수 | 전/후 digest |
|---|---:|---|
| `measurement_target_business` (2026-08-01 이후) | 105 | `e1fd8203b2c0f8f8b52d57e03b94f546` |
| `measurement_journal` | 1,004 | `2d5339ae37f9813948f436f655682443` |
| `preliminary_survey_plans` | 8 | `5cde14a0486ae23462d3875ffd7c3836` |
| `preliminary_survey_v2_plans` | 43 | `e4a9f6755468c4fdcf91493fcd85470e` |
| `user_schedule_blocks` | 13 | `3641d2df85e5be320dd29587d252dfab` |

## 3. 운영 schema 현황과 prerequisite

- 운영 `preliminary_survey_v2_measurement_assignments`: **없음**
- 운영 V2 plan: 43건
- Stage 2-2 prerequisite: PR #42의 날짜별 assignment table, true-confirmed guard, users.survey_code 검증 trigger, atomic plan/assignment RPC와 후속 approval-group migration이 먼저 운영에 적용되어야 한다.
- 이번 작업에서는 migration/schema/trigger/function/RLS를 운영에 적용하거나 변경하지 않았다.
- Local 검증 schema에는 PR #42 migration이 적용되어 assignment table과 최종 RPC가 존재한다.
- Local advisor가 `preliminary_survey_v2_plans`의 RLS 비활성화를 보고했다. 이는 격리된 Local baseline의 상태이며 운영 RLS 상태로 추정하지 않았다. 이번 검증은 Local service-role/direct PostgreSQL로만 수행했고 RLS를 임의 변경하지 않았다.

## 4. Stage 2-1A 운영 Inventory

기준은 `measurement_target_business.measurement_date >= 2026-08-01`이며 created/updated/V1 날짜를 범위 조건으로 사용하지 않았다.

| 항목 | 건수 |
|---|---:|
| 전체 target | 105 |
| 찐확정(`measurement_journal` 존재) | 70 |
| 보호 대상 | 10 |
| 찐확정과 보호 중복 | 3 |
| V2 plan 존재 / 미존재 | 43 / 62 |
| manual / automatic V2 | 17 / 26 |
| 기존 예비조사자 source 존재 | 43 |
| schedule block 영향 | 0 |
| 다일 측정 | 3 |
| source incomplete | 0 |
| 최종 replay 대상 | 28 |

찐확정을 우선 exclusion reason으로 표시했기 때문에 결과 manifest의 `true_confirmed_excluded`는 70건, `protected_excluded`는 나머지 7건이다. 보호 10건 모두 replay 대상에서는 제외됐다.

Source fingerprint에는 target ID, code/year/period, 측정 시작·종료일, `daily_staff`, `measurer_id`, `collaborators`, business type/rule, `process_changed`, 관련 schedule block, manual V2 plan source, 찐확정 여부를 포함했다.

V1 `preliminary_survey_plans.recommended_date`는 `ignored_v1_preliminary_date`로만 기록했고 replay 입력·비교·capacity에 사용하지 않았다.

## 5. Stage 2-1B Docker + Local Historical Replay

운영 source에서 업무 계산에 필요한 필드만 Local로 복제했다. 연락처, 이메일, 인증정보, 비밀번호 등 불필요한 PII/secret은 복제하지 않았다.

- 처리 순서: 측정일 오름차순 → target ID 오름차순
- historical planning date: `1900-01-01` 주입으로 실시간 KST 오늘 cutoff 미적용
- 앞선 target의 예비조사 용량을 뒤 target 계산에 누적
- 측정자 배정: 측정일 오름차순 → target ID, 6명 첫 순환 → 균형 → 역할 일치 → 동일주소 → 검증된 vehicle evidence → ID
- 공시료 code: `users.survey_code`의 A/B/C/D/F/G만 사용
- Local 1차 결과를 plan/날짜별 assignment table에 적용한 후 동일 replay 재실행
- 종료 시 Local target/user/plan/assignment/journal/block/policy/V1 probe fixture를 모두 삭제하고 초기 count 0으로 복귀

### Replay 요약

| 결과 | 건수 |
|---|---:|
| replay 대상 | 28 |
| 변경 예정(적용 가능) | 22 |
| 완전 unchanged | 0 |
| 날짜만 변경 | 1 |
| 조사자만 변경 | 0 |
| 날짜+조사자 변경 | 21 |
| manual plan 보존 | 0 |
| manual_required | 0 |
| hard_blocked | 6 |
| approval_required | 2 |
| source incomplete | 0 |
| 찐확정 제외 | 70 |
| 보호 제외 | 10(찐확정 중복 3) |

동일 측정일의 가능한 측정자 6명 × 1인 최대 3건을 초과한 target 6건은 임의의 네 번째 배정으로 우회하지 않고 `hard_blocked`로 분리했다.

- 2026-08-24 hard block: H0100, H0200, H0290
- 2026-08-26 hard block: H0257, H0099, H0521
- approval required: H0101(2026-08-24), H0182(2026-08-26)

운영 assignment table이 없으므로 현재 측정자 배정의 authoritative 비교값은 존재하지 않는다. Replay assignment는 Stage 2-2 prerequisite schema가 갖춰진 뒤 적용 후보로만 기록했다.

기존 V2 plan이 있으면서 replay 가능한 target은 2건이었다. H0525는 날짜만 재계산되고 기존 책임 조사자가 보존됐다. 유일한 replay 가능 manual plan H0293은 현재 날짜가 확정 후보 범위를 통과하지 못해 minimum-change 보존 대상이 아니었으며 재계산됐다.

## 6. 다일·불가 일정·역할 원천

- 다일 target 3건 중 H0102가 replay 대상이었다.
- H0102는 2026-09-14, 09-15, 09-16 각 날짜의 `daily_staff`를 개별 source로 사용했다.
- report writer와 measurement participants를 날짜별로 구성했고 다른 날짜의 역할을 섞지 않았다.
- schedule block은 예비조사 책임자/참여자/reviewer와 측정자/보고서 담당자/측정 참여자 모두에 hard constraint로 전달했다.
- 이번 운영 source에서 schedule block 충돌 target은 0건이었다.

## 7. 재현성 검증

| 검증 | 결과 |
|---|---|
| 동일 source 독립 replay | 동일 |
| 대상/날짜/조사자/reviewer/측정자/approval/warning determinism | 동일 |
| 1차 Local 적용 후 2차 추가 변경 | 0건 |
| V1 날짜 원래값/임의값/NULL 결과 비교 | 영향 0 |
| 찐확정 replay 제안 | 0건 |
| 보호 대상 replay 제안 | 0건 |
| Replay canonical digest | `ce21b23a197bbf8939328b67ecf3a5794bb8f8178e39f358d0664f9976cc20b6` |

처음 Local 적용 검증에서 재계산된 invalid manual plan의 `plan_origin`을 계속 manual로 남기면 다음 실행에서 새로 minimum-change 보존되어 2차 결과가 달라지는 문제를 발견했다. Dry-run runner가 현재 hard constraint를 통과해 실제 보존된 plan만 manual을 유지하고, 재계산된 plan은 automatic 결과로 적용하도록 고쳐 2차 추가 변경 0을 확인했다. 제품 실시간 추천/API 정책은 변경하지 않았다.

## 8. Raw evidence

Raw production inventory와 replay manifest는 Git에 포함하지 않았다.

- `C:\Users\USER\Downloads\2026-08-23_stage2-1-production-inventory.json`
  - SHA-256: `C17E198FCC01CA672C9E19922505C423554C13DF4481AEB577E2BC4823D6C2F1`
- `C:\Users\USER\Downloads\2026-08-23_stage2-1-replay-manifest.json`
  - SHA-256: `CACE0B0B3631AAFB49BF38B6D822B08E79E3AABA372BBCC9C048D780E8E850B8`

## 9. 테스트와 품질 검증

- Historical replay focused test: 4/4 PASS
- V2 engine/measurement assignment/persistence/role separation/schedule block focused suite: 127/127 PASS
- `npx tsc --noEmit --pretty false`: PASS
- `npm test`: 425/425 PASS
- `npm run build`: PASS
- `git diff --check`: PASS

## 10. 운영 write와 후속 단계

- 운영 V1 write: 0
- 운영 V2 plan write: 0
- 운영 V2 assignment write: 0
- 운영 measurement target write: 0
- 운영 user schedule write: 0
- 운영 measurement journal write: 0
- 운영 migration/schema/trigger/function/RLS 변경: 0
- Stage 2-2: 미실행
- PR merge: 미실행

Stage 2-2는 운영 assignment schema prerequisite 적용, hard-block 6건에 대한 업무 결정, approval-required 2건 승인 주체 확인, manifest fingerprint 재검증 후 별도 승인으로만 진행해야 한다.

## 11. Worker

- 요청/확인 모델: `gpt-5.6-terra`, reasoning `medium`
- 담당: inventory 조건, schema prerequisite, manifest 집계, determinism/idempotency, V1 영향 0, 운영 write 0 독립 검증
- 결과: PASS. 두 raw 파일 SHA-256, 105/28건 집계, changeCounts, canonical digest와 보호 조건을 독립 재검산했다.
- Task: created 2, completed 2, failed 0, active task 0
- Worker: created 1, reused 1회, active worker 0
- Release: `release_unknown` 1. 실제 terminal은 `exited`, `connected=false`, transcript archive captured 상태이며 active worker와 구분한다.
