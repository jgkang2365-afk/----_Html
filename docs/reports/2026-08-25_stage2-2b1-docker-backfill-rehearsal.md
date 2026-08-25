# Stage 2-2B-1 Docker 복사 DB Backfill 리허설

## 판정

**BLOCKED — STALE_SOURCE_REVIEW_REQUIRED**

Stage 2-2A 승인 기준 이후 운영 source가 크게 변경됐다. 기존 execution candidate manifest를 자동 승인하거나 새 결과로 대체하지 않고, stale gate에서 Docker seed/apply를 중단했다.

- Production write: **0**
- Docker seed/write: **0**
- Stage 2-2B-2 운영 반영: **0**
- PR merge: **0**

## Git / PR 기준

- Branch: `feature/preliminary-survey-phase-b`
- PR: `#42`, Draft/Open
- 시작 HEAD: `169ad5a31a8f128c0e2ad8748a976d4488bd1d8a`
- 검증 종료 기준 HEAD: `169ad5a31a8f128c0e2ad8748a976d4488bd1d8a`

## Docker 환경 및 운영 분리

- Docker Desktop server: `29.7.2`
- Container: `supabase_db_supabase-pr42-validation`
- Local published port: `127.0.0.1:54322`
- 운영 project ref `xjxqbwvcgffunqnkmoqw` 또는 운영 URL/host를 Docker write 연결에 사용하지 않았다.
- Docker DB는 시작 시 모든 source/plan/assignment fixture가 0건인 빈 staging DB였다.
- prerequisite table, RPC, trigger는 이미 존재해 migration을 적용하지 않았다.

Docker prerequisite 확인:

- `preliminary_survey_v2_plans`: 존재
- `preliminary_survey_v2_measurement_assignments`: 존재
- wrapper RPC: `SECURITY DEFINER`, `search_path=public`, service_role EXECUTE=true
- core RPC: `SECURITY DEFINER`, `search_path=public`, service_role EXECUTE=false
- plan true-confirmed guard: 존재
- assignment true-confirmed guard: 존재
- assignment survey-code validation trigger: 존재

## Raw evidence 무결성

Stage 2-2A 파일은 존재했고 지시된 SHA-256과 일치했다.

- `C:\Users\USER\Downloads\2026-08-24_stage2-2a-production-inventory.json`
  - `183D3160749197250298166A0886DC53D50C5E272DAB67BA80F7E33B189E5F69`
- `C:\Users\USER\Downloads\2026-08-24_stage2-2a-execution-candidate-manifest.json`
  - `85C38327BD78884A2978C5AB0747B2B2240AA784B30D0D83354C5872BB0B99D8`

최신 production READ-ONLY inventory:

- 경로: `C:\Users\USER\Downloads\2026-08-25_stage2-2b1-production-inventory.json`
- 실제 파일 SHA-256: `3A41591638CA6779D0904D27AB6B085A099B2B0DE7C07F9D6F4C3513B5FFEB24`
- inventory 실행 중 before/after source snapshot 동일: true

## 최신 production inventory

| 항목 | Stage 2-2A | 최신 | 변화 |
| --- | ---: | ---: | ---: |
| 전체 target | 105 | 106 | +1 |
| true-confirmed | 70 | 82 | +12 |
| 보호 대상 | 10 | 10 | 0 |
| true-confirmed/보호 중복 | 3 | 4 | +1 |
| replay eligible | 28 | 18 | -10 |
| V2 plan 존재 | 43 | 43 | 0 |
| source incomplete | 0 | 0 | 0 |
| multi-day | 3 | 3 | 0 |

- V1 `preliminary_survey_plans.recommended_date` non-null 잔재(해당 범위): 2건
- V1 influence: 기존 canonical 기준 0이나, stale gate 이후 새로운 replay는 실행하지 않아 재측정하지 않았다.
- `process_changed_preliminary_survey.enabled=false` 유지
- candidate users와 `user_schedule_blocks` source는 이전 inventory와 동일

## Stale fingerprint 15건

| target | code | 원인 | 이전 fingerprint | 최신 fingerprint |
| ---: | --- | --- | --- | --- |
| 446 | H0226 | measurement_journal true-confirmed | `856ab74f8669cab91dbac911fa65408f7606fc44759cef866dbcca57e94467f4` | `010ea4011e6a4ba076ff12cf071d29d27501c247d934d4d9e43f1522298b6b95` |
| 459 | H0399 | measurement_journal true-confirmed, 보호 대상 | `0a76324e55cc0ac432c8841787d45c3a6f97948fdc2a909c67e5cfa72ab0d830` | `2bd4cc2308a0fad87bbb79637451c6ea40192fcff4e61fdbdad2ff44118d7e8e` |
| 463 | H0208 | measurement_journal true-confirmed | `62d8660c8b0ae108e0c92d57afba800cf4382d93f4e0a1b533ab4fbe521c1a0a` | `5639f9ec20190b793a41aeac9a704329d8dc055c3c7380434211d2b41d041ebf` |
| 506 | H0188 | measurement_journal true-confirmed | `260483f7bb899bc7c31946e21cfdcb1402a604d55f571f40f4993a09dff6be29` | `abd750d4fd03f97a582a27b6ef1cd00169c32b5e2250c1cb6744ed8f073a163f` |
| 524 | H0101 | measurement_journal true-confirmed | `260d1fa0db5a1fa5e319f251e92a4ca1a374aeeb083224fc3c07283bd7747c0c` | `6176d1c9d70fcb1dbb94951217e1b6df2a18acd91cea6eb0403d7af8aed12958` |
| 528 | H0083 | measurement_journal true-confirmed | `b9b88b455c9db0ca1c2d11e36a58061d41f4a78d8af22398d219f60807ba4645` | `91f4eea1a077fbb153d5ecd35d6c9b0814dd59d24aedd3d1b65012b2b62fe5be` |
| 539 | H0100 | measurement_journal true-confirmed | `53d3894beca76b40c20cb4ef8e07fb51f19a54c5c59c85558652c1dda3a4c76e` | `fa7e4d6300dd98b244f251b090e3c2c04546b46d7df60679a01eaf05ddbbc275` |
| 566 | H0092 | measurement_journal true-confirmed | `c1bc0252ad1a4ec2e98dee07bc724749209b9a72352b787ad0b6b8775d2d81d0` | `614a0b6fea4c23a52691ecddd33e1d38b3342028659fcd510133b28f3327a8a3` |
| 585 | H0200 | measurement_journal true-confirmed | `754e56c3a94fdb3669e8ca4c23bb4aaf59459093dbd5c0e481d3142dd2b0df26` | `a11cc58ec73dc7580c5d5815fa9a8c994d252390c3967309837a22a37d60c59c` |
| 647 | H0290 | measurement_journal true-confirmed | `66a66f031ee6c0ef466b9947357544f50b417460647c0472b57eb7e85e97c6c0` | `98bbbf79efdb4bcd2bb8de6a067528dff7599b8f1a4ec6bc3107da4b3a6ba026` |
| 714 | H0521 | collaborators `이태환→강종구`, updated_at 변경 | `1f37de4f94c3894366da90bcd20dab0e9a6d1dbb3130bd4deeb2146d7384674c` | `1272e37052db90eb63db88b17f126644f8c8d3039b1a2846fd5fafa43ba60b42` |
| 717 | H0524 | collaborators `null→강종구`, updated_at 변경, 보호 대상 | `25f14ca3b430446bee029bb60e8965f0df9cc3575e6401b2f52771f890247095` | `8f72dc85076a00313c62209c260fc602936cba2c49a2848d44f52729ab78cac2` |
| 718 | H0525 | measurement_journal true-confirmed, target 역할 원천 변경 | `a491a205fd4c7fe7736c91eb77631c422df7a3cc3ce2b679249f1e2f0b61fc90` | `3aa305d93eb4cecdafb7bbef787a9a8720d053e81c72685c9fcab24a8fe5e3e4` |
| 719 | H0526 | measurement_journal true-confirmed | `dae6c551228bc8c48846853878e77bf0498d6f8d8c2b3b7c46e4576ee760a1c9` | `2c5a7664c98d9db454405423e1460e45377472679a698146157a4855aa3b933e` |
| 722 | H0527 | 신규 target | 없음 | `39a69ba95e7ced0aabaa95c802ba5f8ba41da8e09346f81086c28f18bcdfcf95` |

기존 replay 28건 중 11건이 새 true-confirmed가 되어 replay 대상에서 제외됐고 H0527이 추가되어 최신 eligible은 18건이다.

## 기존 hard-block / approval 기준 무효화

기존 hard-block 6건 중:

- H0100, H0200, H0290: 새 true-confirmed
- H0521: collaborators 원천 변경
- H0257, H0099: 최신 eligible 유지

따라서 기존 hard-block 6건을 최신 결과로 재사용할 수 없다. 최신 hard-block과 apply candidate 수는 새 historical replay 검수 전 확정할 수 없다.

기존 approval-required 2건 중:

- H0101: 새 true-confirmed
- H0182: 최신 eligible 유지

따라서 기존 H0101/H0182 approval group을 Local technical approval payload로 재사용할 수 없다. 새 replay가 만든 날짜/assignee/sorted target IDs fingerprint를 별도 검수해야 한다.

## 실행하지 않은 항목

stale source를 자동 승인하지 않기 위해 다음을 실행하지 않았다.

- Docker source seed
- approval=false wrapper RPC rollback 시험
- Local authorized approver 기술 승인
- 18개 최신 eligible에 대한 historical replay
- actual plan/assignment apply
- expected/actual 비교
- second-run/idempotency
- rehearsal runner 구현 및 테스트

따라서 실제 Docker apply target, plan create/update, assignment row, 최신 hard-block, 최신 approval-required는 **미산출**이다. 이를 0건 성공으로 해석하면 안 된다.

## Write 0 증명

### Production

READ-ONLY inventory 자체 before/after snapshot은 동일했다. 추가 exact count 조회도 전/후 동일하다.

- measurement date >= 2026-08-01 target: 106
- measurement journal: 1016
- V1 plans: 8
- V2 plans: 43
- V2 assignments: 0
- schedule blocks: 13
- Production write: **0**

### Docker

stale gate 전/후 다음 fixture count가 모두 0이다.

- target/users/V2 plan/V2 assignment/V1 plan/journal/schedule block/business info/policy settings: 모두 0
- Docker write: **0**

## 검증 및 변경 범위

- 제품 코드 수정: 0
- migration 수정/적용: 0
- runner/test 수정: 0
- `git diff --check`: PASS
- focused test/typecheck/full test/build: stale gate에서 실행 중단했으며 미실행
- 기존 사용자 Local Supabase 미추적 파일은 보존하고 commit 대상에서 제외한다.

## 해제 조건

다음 단계 전에 새 Stage 2-1/2-2A 검수 또는 명시적 사용자 승인이 필요하다.

1. 최신 18개 eligible source로 canonical historical replay를 다시 생성한다.
2. 새 hard-block, approval-required, apply candidate를 검수한다.
3. 15개 stale target, 특히 H0521 역할 원천 변경과 H0527 신규 target을 승인/제외 결정한다.
4. 새 execution candidate manifest와 digest를 승인한 뒤 Stage 2-2B-1 Docker actual apply를 다시 실행한다.

## Worker 상태

- worker 사용: 0
- active task: 0
- active worker: 0
