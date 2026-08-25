# Stage 2-1 일정·fingerprint 보완 검증 보고서

## 1. 결론과 실행 경계

**Stage 2-1 보완 검증: PASS**

- Branch: `feature/preliminary-survey-phase-b`
- 시작 HEAD: `03889ec3cf64dbbac85da01fa28c9143b1e7b249`
- 종료 기준: 이 보고서와 보완 코드가 포함된 현재 branch commit
- PR #42: Draft/Open 유지, merge 미실행
- 운영 Supabase: SELECT only. 운영 write/migration/RPC/Stage 2-2 실행 0건
- Local: `C:\Users\USER\supabase-pr42-validation`, Docker 29.7.2, Supabase API/DB `127.0.0.1:54321/54322`

## 2. 수정 원인과 범위

보완한 취약점은 두 가지뿐이다.

1. 예비조사 후보일 조회에서 생성된 `output.blockedKeys`만으로 측정자를 판정하면 실제 측정일 당일의 `user_schedule_blocks`가 빠질 수 있었다.
2. target fingerprint가 현재 역할자 일정 위주여서 향후 후보 직원의 일정·상태 변경을 놓칠 수 있었다.

수정 파일:

- `lib/preliminary-survey-v2/historical-replay.ts`
- `scripts/preliminary-survey-v2-stage2-inventory.ts`
- `scripts/preliminary-survey-v2-stage2-local-replay.ts`
- `tests/preliminary-survey-v2-historical-replay.test.ts`

실시간 API/UI, 날짜·경력·reviewer·6명 첫 순환·균형·승인/hard max 정책은 변경하지 않았다.

## 3. 측정일 block 보완

Replay 대상의 모든 `measurementAssignmentDates`를 모은 뒤 Local `user_schedule_blocks`를 별도 SELECT한다. 조회 row를 실제 측정일로만 확장한 `measurementScheduleBlockedKeys`(`userId:date`)를 만들고, 기존 `output.blockedKeys`와 합쳐 측정자 availability hard constraint로 사용한다.

이 합집합은 기존 actual-measurement 충돌 guard를 보존하면서, 예비조사 후보 마지막 날 뒤에 있는 측정일 schedule block도 추가로 차단한다. 보고서 담당자/측정 참여자가 원천에서 이미 지정된 상태로 block이면 자동 교체하지 않고 `MEASUREMENT_SOURCE_SCHEDULE_CONFLICT_REVIEW_REQUIRED` anomaly를 기록한다.

회귀 테스트에서 다음을 확인했다.

- 2026-08-24 block인 최우선 A는 8/24 측정자로 배정되지 않음
- 2026-08-20 block은 8/24 측정자 판정에 전파되지 않음
- 다일 8/24 block, 8/25 available을 날짜별로 독립 적용

현재 운영 source에는 replay 측정일과 겹치는 후보 직원 schedule block이 없어 실제 영향 target과 원천 역할 conflict는 각각 0건이었다. 따라서 기존 replay 배정 결과도 변경되지 않았다.

## 4. Source fingerprint 보완

각 target fingerprint에 다음을 canonical 입력으로 추가했다.

- 모든 측정직 후보의 `id`, active, `survey_code`, 예비조사 경력, 예비조사 지원 배정 가능 상태
- 활성 측정직 후보 × 해당 business type의 historical 예비조사 후보일
- 활성 측정직 후보 × `measurementAssignmentDates`
- 위 날짜와 실제 겹치는 `user_schedule_blocks`만 선별

일정은 `user_id`, `start_date`, `end_date`, `block_type`, `id` 순으로 정렬한다. V1 `preliminary_survey_plans.recommended_date`는 fingerprint authoritative 입력에 추가하지 않았다.

테스트 결과:

- 현재 역할자가 아닌 후보 예비조사자의 후보일 block 추가: fingerprint 변경
- 현재 역할자가 아닌 후보 측정자의 측정일 block 추가: fingerprint 변경
- 관련 없는 직원/날짜 밖 block: fingerprint 유지
- 후보 `survey_code` 변경: fingerprint 변경
- 후보 active 변경: fingerprint 변경
- 동일 source 반복 계산: 동일 fingerprint

## 5. 운영 READ-ONLY inventory

기준은 `measurement_target_business.measurement_date >= 2026-08-01`이다.

| 항목 | 기존 | 보완 후 |
|---|---:|---:|
| 전체 target | 105 | 105 |
| 찐확정 | 70 | 70 |
| 보호 대상 | 10 | 10 |
| replay 대상 | 28 | 28 |
| source incomplete | 0 | 0 |

운영 SELECT 시작/종료 snapshot은 동일했다.

| 원천 | 건수 | 전/후 SHA-256 digest |
|---|---:|---|
| `measurement_target_business` | 658 | `e4997679ef90fe6db3e5e45d0e3eb9533bbdfe8e1d02bc8c4936389d0581eb08` |
| `preliminary_survey_v2_plans` | 43 | `43d7bc9a2c6267dd5baa2d8a683497af31c4b3376635d5dce9106cb16c3ce3e8` |
| `preliminary_survey_plans` | 8 | `3092dcaf899d110c8b3661632ad032939835334d6086efd716dc505c52825a89` |
| `measurement_journal` | 1,000 | `f138563e005332408cd5ee6a80d9f7ccd91b1829ff3bcd372d713b079c25b526` |
| `user_schedule_blocks` | 13 | `d27a50470f7ef2585d5d5250d9d669fd3e9d15bca71c30325daaf5d3cca4c255` |

## 6. Docker + Local replay 결과

| 결과 | 기존 | 보완 후 |
|---|---:|---:|
| replay 대상 | 28 | 28 |
| 적용 가능 변경 | 22 | 22 |
| hard-block | 6 | 6 |
| approval-required | 2 | 2 |
| source incomplete | 0 | 0 |
| 측정일 schedule block 영향 target | - | 0 |
| 2회차 추가 변경 | 0 | 0 |

기존 raw manifest와 보완 후 canonical replay 결과의 target별 차이는 0건이며 replay digest도 기존과 같은 `ce21b23a197bbf8939328b67ecf3a5794bb8f8178e39f358d0664f9976cc20b6`이다.

Hard-block은 기존 6건이 모두 유지됐다.

- 2026-08-24: H0100, H0200, H0290
- 2026-08-26: H0257, H0099, H0521

Approval-required도 H0101, H0182 2건으로 유지됐다. hard-block 우회나 approval write는 수행하지 않았다.

재현성/보호 검증:

- 동일 source 독립 replay: 완전 동일
- Local 1차 적용 후 2차 추가 변경: 0
- V1 날짜 원래값/임의값/NULL 영향: 0
- 찐확정 proposal: 0
- 보호 대상 proposal: 0
- Local cleanup 후 target/user/plan/assignment/V1/journal/block/business/policy fixture: 모두 0

## 7. Raw evidence

Raw 운영 manifest는 Git에 포함하지 않았다.

- `C:\Users\USER\Downloads\2026-08-24_stage2-1-production-inventory-hardened.json`
  - SHA-256: `DE757C28664B6585D0AFD33626BE609A49F3E9D11864658C6CC4CC4C39230705`
- `C:\Users\USER\Downloads\2026-08-24_stage2-1-replay-manifest-hardened.json`
  - SHA-256: `2BE3C6DB2E7D57B33F9DD3D98AAC8C920CC5321403FCDC11260F791395405A45`

## 8. 테스트와 품질 검증

- Historical/assignment/persistence/engine/role/schedule focused suite: 144/144 PASS
- `npx tsc --noEmit --pretty false`: PASS
- `npm test`: 425/425 PASS
- clean `npm run build`: PASS
- `git diff --check`: PASS

초기 병렬 build/typecheck에서는 `.next/types` 생성 경쟁으로 TS6053가 발생했고, 이어진 build는 그 중간 cache의 `500.html` rename ENOENT가 발생했다. 저장소 내부 생성 cache를 격리한 뒤 clean build와 typecheck를 순차 실행해 모두 통과했다. 소스 변경으로 우회하지 않았다.

## 9. 운영 schema와 후속 금지

- 운영 `preliminary_survey_v2_measurement_assignments`: 없음
- Stage 2-2 prerequisite: PR #42 assignment schema, true-confirmed guard, survey_code 검증, atomic persistence RPC 및 후속 approval-group migration의 별도 운영 적용
- 이번 작업의 운영 V1/V2 plan/assignment/target/schedule/journal write: 모두 0
- 운영 migration/schema/RLS/function/trigger 변경: 0
- Stage 2-2 실행: 0

## 10. 독립 Worker

- 요청 모델: `gpt-5.6-terra`, reasoning `medium`
- Orca launch receipt의 effective 요청값: `gpt-5.6-terra`, `medium`
- Worker 내부 실제 모델 metadata: 검증 불가
- 담당: diff, schedule hard constraint, fingerprint 범위, raw SHA/digest와 105/70/10/28·22/6/2/0, determinism/idempotency/V1 영향 0 독립 검토
- 결과: PASS, 파일 수정/DB write 없음
- Task: created 1, completed 1, failed 최종 0, active task 0
- Dispatch: 첫 시작 `agent_prompt_stalled` 1회, retry 성공 1회
- Worker: active worker 0
- Release: 두 terminal 모두 `connected=false`, `exited`; transcript/terminal archive는 확보됐으나 runtime 종료 확인이 `release_unknown` 2건으로 남았다. 실제 active worker와 구분한다.
