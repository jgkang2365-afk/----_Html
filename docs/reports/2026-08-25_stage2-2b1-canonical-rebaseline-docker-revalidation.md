# Stage 2-2B-1 Canonical Replay 재기준화 및 Docker 재검증

## 판정

**PASS — Docker Local rehearsal만 수행했으며 운영 업무 write와 Stage 2-2B-2 실행은 0건이다.**

- Branch: `feature/preliminary-survey-phase-b`
- PR: `#42`, Draft/Open
- 시작 HEAD: `79dfb3f71d094137c512530a575b8e458e4baf8f`
- 검증 종료 기준 HEAD(커밋 전): `79dfb3f71d094137c512530a575b8e458e4baf8f`
- Production write: **0**
- PR merge: **0**
- Stage 2-2B-2: **미실행**

## 환경 및 안전 경계

- Docker DB: `supabase_db_supabase-pr42-validation`
- PostgreSQL: `127.0.0.1:54322`
- Local API: `127.0.0.1:54321`
- mode: `LOCAL_DOCKER_REHEARSAL`
- 운영 project ref `xjxqbwvcgffunqnkmoqw`, 운영 URL 및 remote DB host를 runner가 명시적으로 거부한다.
- actual apply는 wrapper `persist_preliminary_survey_v2_plan_and_assignment_groups(...)`만 사용했다.
- core RPC의 service_role 직접 실행 권한은 `false`였고 직접 호출하지 않았다.
- Docker 시작/종료 fixture count는 target/users/V1/V2 plan/assignment/journal/block/business/policy 전부 0이었다.

Docker prerequisite:

- V2 plan/assignment table: 존재
- `users.survey_code`: 존재
- wrapper/core RPC: 존재
- wrapper service_role EXECUTE: true
- core service_role EXECUTE: false
- true-confirmed plan/assignment guard: 존재
- assignment validation trigger: 존재

## 최신 production READ-ONLY inventory

지정 파일의 SHA-256을 먼저 확인했다.

- 지정 inventory: `C:\Users\USER\Downloads\2026-08-25_stage2-2b1-production-inventory.json`
- SHA-256: `3A41591638CA6779D0904D27AB6B085A099B2B0DE7C07F9D6F4C3513B5FFEB24`

실행 직전 production READ-ONLY inventory를 다시 생성했다. 첫 rehearsal 직후 최종 stale gate에서 H0098/H0099의 collaborators 교체가 감지되어 그 결과를 폐기하고, 아래 최신 source로 canonical과 Docker actual apply를 처음부터 다시 실행했다.

- canonical 기준 파일: `C:\Users\USER\Downloads\2026-08-25_stage2-2b1-production-inventory-final-check.json`
- 파일 SHA-256: `F87B0EC2F3D24F9AB90D13D22D458B497A1F82C814BCDACBCC0F568EB297B8B2`
- actual 직전 확인: `C:\Users\USER\Downloads\2026-08-25_stage2-2b1-production-inventory-preapply.json`
- actual 직후 확인: `C:\Users\USER\Downloads\2026-08-25_stage2-2b1-production-inventory-postapply.json`
- actual 직전/직후 target fingerprint stale: 0
- 각 실행의 production before/after snapshot: 동일
- 최신 변경: H0098 collaborators `강종구→이태환`, H0099 collaborators `이태환→강종구`
- 이 변경을 반영한 뒤 replay/actual 결과를 재승인했으며 이전 canonical을 우회하거나 재사용하지 않았다.

최신 분류:

| 항목 | 건수 |
| --- | ---: |
| 전체 target | 106 |
| true-confirmed | 82 |
| protected | 10 |
| replay eligible | 18 |
| source incomplete | 0 |
| V1 non-null 잔재 | 2 |

H0521은 최신 collaborators `강종구` 원천으로 재계산했다. H0527은 신규 replay 후보로 포함했고 H0101 및 기존 replay에서 true-confirmed로 전환된 대상은 제외했다.

## 새 canonical replay / manifest

- 파일: `C:\Users\USER\Downloads\2026-08-25_stage2-2b1-canonical-replay.json`
- SHA-256: `0C7872624FEF6F4AFCF3F81E05DF61C0B09E5E4C7BCB22E5A7C42A60646FA7B7`
- canonical replay digest: `319eb1022da133db494eba5e92d7c9bb889009bb03f575f3ae842bdf3e683f5d`
- 전체 manifest 행: 106
- replay 행: 18
- duplicate target: 0
- stale target: 0
- source incomplete: 0
- true-confirmed proposal: 0
- protected proposal: 0
- deterministic: true
- V1 influence: 0

변경 분류:

- apply candidate / `date_and_surveyor_changed`: 15
- hard-block: 3
- true-confirmed excluded: 82
- protected-only excluded: 6 (true-confirmed/protected 중복은 true-confirmed로 우선 분류)

## Docker actual apply

Raw evidence:

- 파일: `C:\Users\USER\Downloads\2026-08-25_stage2-2b1-docker-apply-manifest.json`
- SHA-256: `6B9C3983F5B5185DB25B234C3829B38FE33F252A90BD25905CE79125468C5522`

결과:

| 항목 | 결과 |
| --- | ---: |
| actual apply target | 15 |
| plan 신규 | 14 |
| plan 갱신 | 1 |
| assignment row | 17 |
| expected/actual plan mismatch | 0 |
| expected/actual source context mismatch | 0 |
| expected/actual assignment mismatch | 0 |
| schedule block 충돌 | 0 |
| 4건 이상 group | 0 |
| multi-day partial assignment | 0 |

다일 target H0102는 2026-09-14/15/16 세 날짜 assignment가 모두 저장되어 일부 날짜만 저장된 행이 없었다. `survey_code`와 `survey_code_source=users.survey_code`도 전 행에서 일치했다.

## 승인 방어와 기술 승인

승인 없이 동일한 15-target payload를 wrapper에 적용했을 때:

- 오류: `MEASUREMENT_ASSIGNMENT_APPROVAL_REQUIRED`
- V2 plan 변경: 0
- assignment 변경: 0
- approval metadata 변경: 0
- transaction rollback: 정상

그 다음 Docker에 seed된 실제 관리자 role 사용자 ID 2를 Local 기술 approver로 사용했다. 이는 운영 승인이 아니다.

- 승인 대상: H0182 / 2026-08-26 / 고유빈(F, user 16)
- 동일 승인 group target: H0098(455), H0038(487), H0182(491)
- approval group fingerprint: `771e6d940731afbef24533eaed62d49c`
- 승인 포함 wrapper apply: 성공
- approval metadata: 세 번째 canonical row에만 정상 저장

## Hard-block

| code | target | 측정일 | 자동 배정 가능 수 | blocker | 필요한 별도 결정 |
| --- | ---: | --- | ---: | --- | --- |
| H0257 | 513 | 2026-08-26 | 3 | `MEASUREMENT_ASSIGNMENT_HARD_MAX_EXCEEDED` 이후 overflow | 측정일/인력 원천 또는 수동 운영 계획 별도 검토 |
| H0099 | 529 | 2026-08-26 | 3 | 동일 | 동일 |
| H0521 | 714 | 2026-08-26 | 3 | 동일, 최신 collaborators 반영 | 동일 |

세 target은 plan과 assignment 모두 before/after digest가 같아 write 0이다. hard max, 불가 일정 또는 특정 직원을 임의 우회하지 않았다.

## 보호·찐확정·원천 table

- protected 또는 true-confirmed plan/assignment 변경: 0
- hard-block target 변경: 0
- `measurement_target_business`: 변경 0
- `measurement_journal`: 변경 0
- `preliminary_survey_plans` V1: 변경 0
- `user_schedule_blocks`: 변경 0
- `users`: 변경 0
- `business_info`: 변경 0
- policy settings: 변경 0
- `process_changed_preliminary_survey.enabled=false`: 유지
- 운영 DB write: 0

V1 probe는 Docker에서만 원래값/임의값/NULL 세 상태를 검사했고 replay 결과 영향은 0이었다. probe를 삭제한 뒤 V1 source digest는 before와 일치했다.

## Determinism / idempotency

- 동일 source 독립 replay: 동일
- 성공 apply 후 2회차 additional changes: 0
- 1차/2차 전체 RPC payload(source context/reason/evidence/route 포함) 변화: 0
- 2회차 전체 persisted plan/assignment/source context change set: 0
- 두 번째 RPC apply: change set이 비어 있어 실행하지 않음
- 2회차 전/후 V2 plan digest: 동일
- 2회차 전/후 assignment/approval digest: 동일
- 불필요한 `updated_at` write: 0

## 코드 변경

- `scripts/preliminary-survey-v2-stage2-docker-rehearsal.ts`: Local-only guard, wrapper RPC approval rollback/actual apply, expected/actual·idempotency·cleanup 검증 runner
- `scripts/preliminary-survey-v2-stage2-local-replay.ts`: canonical-only 재생성, source fingerprint manifest, V1 source seed, 다일 hard-block all-or-nothing, runner 재사용 export
- `lib/preliminary-survey-v2/stage2-rehearsal.ts`: 환경 guard, 다일 all-or-nothing, approval fingerprint 공통 helper
- `tests/preliminary-survey-v2-stage2-rehearsal.test.ts`: 운영 ref 차단, explicit mode, 다일 all-or-nothing, fingerprint 정렬 테스트
- `package.json`: 새 regression test를 전체 test에 포함

정책, UI, migration, 운영 schema 및 일반 추천 알고리즘은 변경하지 않았다.

## 품질 검증

- Stage 2/measurement assignment/persistence/role/multi-day focused tests: PASS
- `npx tsc --noEmit --pretty false`: PASS
- `npm test`: PASS
- `npm run build`: PASS
- `git diff --check`: PASS

## Worker

- independent verifier 요청: `gpt-5.6-sol / high`
- 담당: runner/RPC 권한 경계 및 raw evidence 독립 read-only 검토
- 실제 모델 metadata: 요청값 적용, 실제값 검증 불가
- 독립 최종 판정: PASS, 추가 blocker 없음
- created: 1 / completed: 1 / failed: 0 / remaining active worker: 0

## 최종 게이트

Stage 2-2B-1 Docker Backfill Rehearsal은 PASS다. 이 판정은 Docker Local 기술 리허설에 한정한다. H0182의 운영 승인은 별도로 필요하고 hard-block 3건은 해결되지 않았다. **Stage 2-2B-2 운영 반영과 PR merge는 실행하지 않는다.**
