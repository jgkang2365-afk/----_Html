# PR #42 canonical 측정자 target 단일화 완료 보고서

## 원인

- 추천 생성은 날짜별 `reportWriterUserId`, `measurementParticipantUserIds`, `preliminarySurveyorUserId`를 포함한 `MeasurementAssignmentTarget`을 만들었다.
- Apply의 `recomputeCanonicalMeasurementAssignments()`는 같은 대상에서 역할 preference 3종을 누락한 축약 target을 별도로 만들었다.
- 기존 6개 fixture는 세 역할을 예상 측정자와 동일하게 구성해 실제 H0200/H0226 충돌과 순차 greedy의 전역 역할 일치 손실을 드러내지 못했다.

## 수정 파일

- `lib/preliminary-survey-v2/measurement-assignment.ts`
- `lib/preliminary-survey-v2/service.ts`
- `app/api/preliminary-survey-v2/workbench/route.ts`
- `tests/preliminary-survey-measurement-assignment.test.ts`
- `tests/preliminary-survey-v2-measurement-assignment-persistence.test.ts`

## 공통 builder와 추천/Apply 동일성

- `buildMeasurementAssignmentTargets()`를 추가해 target ID, 측정일, 주소, 좌표, 코드, 지역과 역할 preference 3종을 한 곳에서 canonical target으로 만든다.
- 추천 생성과 Apply 재계산이 모두 이 builder를 직접 호출한다.
- Apply용 `loadV2ManualContext()`도 추천 계산과 같은 `measurementStaffByDateFromSource()`를 사용해 단일일 `measurer_id`/`collaborators`와 다일 해당 `daily_staff` 행을 날짜별로 읽는다.
- Apply의 예비조사자 preference는 검증된 제출 draft의 `sourceResponsibleUserId`만 사용하며 reviewer를 책임자로 승격하지 않는다.
- 정적 회귀는 workbench에 builder 호출이 정확히 두 곳 존재하고 Apply의 축약 target 조립이 제거됐음을 확인한다. 행동 회귀는 동일 source에서 추천/Apply target 전체 객체와 canonical draft가 같음을 확인한다.

## 첫 순환과 실제 6개 fixture

- 같은 날짜의 첫 순환은 가능한 측정자를 한 번씩 사용하는 조건을 먼저 고정한다.
- 첫 순환 내부에서는 개별 target greedy 대신 전체 역할 일치 점수 합계를 최대화하고, 동점은 안정적인 user ID 순서로 해소한다.
- 실제 충돌 fixture 결과:
  - H0290 → 한기문(B)
  - H0200 → 이태환(A)
  - H0226 → 강종구(C)
  - H0188 → 이주형(D)
  - H0100 → 고유빈(F)
  - H0101 → 김민영(G)
- A/B/C/D/F/G가 각각 정확히 한 번 사용됐다. H0200의 보고서 담당자·참여자가 강종구여도 H0226까지 포함한 첫 순환 전체 최적화 결과 이태환(A)이 배정됨을 별도 assertion으로 고정했다.
- 사업장 코드는 fixture 식별에만 사용하며 제품 배정 로직에는 코드 hardcode가 없다.

## Apply canonical E2E와 stale 안전장치

- 자동화 테스트가 `추천 target 생성 → 측정자 추천 → 검토 canonical draft → 동일 source의 Apply canonical 재계산 → 전체 assignment 동일성`을 실행한다.
- 동일 source에서는 `sameCanonicalWorkbenchDraft()`가 true이고 target shape 차이로 인한 `DRAFT_REVIEW_REQUIRED` 조건이 발생하지 않는다.
- underlying 측정일을 변경한 재계산은 canonical draft가 달라져 기존 stale 재검토 경계가 유지됨을 확인했다.
- workbench의 실제 Apply 경로가 같은 builder를 호출하는지는 별도 구조 회귀로 고정했다.
- 운영 또는 Local DB에 실제 Apply write를 실행하는 브라우저 E2E는 이번 Stage 1 로직 수정 범위에서 수행하지 않았다.

## 다일 source 검증

- 공통 builder 다일 테스트에서 2026-08-24의 보고서 담당자/참여자와 2026-08-25의 보고서 담당자/참여자가 각 날짜 target에만 들어감을 확인했다.
- `loadV2ManualContext()`가 추천 계산과 동일한 날짜별 source helper를 사용하는 구조 assertion을 추가했다.

## 검증 결과

- focused test: 114/114 통과
- `npx tsc --noEmit`: 통과
- `npm test`: 425/425 통과
- `npm run build`: 통과 (`Compiled successfully`, static pages 69/69)
- `git diff --check`: 통과
- 기존 assertion 삭제·약화 없음

## 안전 확인

- DB schema/migration 변경 없음.
- 운영 DB INSERT/UPDATE/DELETE/UPSERT/RPC write 0건.
- Stage 2 historical replay/backfill/보정 미실행.
- 보호 대상 10개 업체 hardcode/rewrite 없음.
- `PROCESS_CHANGED_POLICY_OFF.enabled=false` 유지, 관련 파일 변경 없음.
- 사용자 기존 미추적 `supabase/.gitignore`, `supabase/baseline_schema.sql`, `supabase/config.toml`, `supabase/local-migrations/`는 수정·스테이징하지 않았다.

## Orca worker

- Run: `run_5398e1405c0a`.
- Worker 1 요청/effective: Codex `gpt-5.6-terra`, reasoning `medium`; 코드 흐름 읽기 전용 조사 담당. `agent_prompt_stalled`로 결과 없이 실패했다.
- Worker 2·3은 첫 시작 실패 후 같은 접근을 반복하지 않아 시작하지 않았고 task를 failed로 정리했다. 테스트 구조와 PR 상태 확인은 Main이 직접 수행했다.
- Main 요청: `gpt-5.6-terra / medium`; 실제 모델 메타데이터는 별도 노출되지 않아 요청값 적용·실제값 검증 불가다.
- 이 Run의 ready/dispatched task는 0건이다. 실패 worker terminal은 disconnected이지만 Orca resource 감사 상태가 `release_unknown`으로 남았다.

## Git/PR

- 브랜치: `feature/preliminary-survey-phase-b`
- 구현 commit SHA: `168c1d4`
- 구현 push: 성공 (`origin/feature/preliminary-survey-phase-b`)
- 본 보고서 포함 최종 브랜치 push: 성공
- PR #42: Draft/Open 유지, base `main`, merge하지 않음.
- PR: https://github.com/jgkang2365-afk/----_Html/pull/42

## 남은 위험/TODO

- 이번 자동화는 Apply 내부 canonical 계산과 draft 비교를 실제 제품 함수 조합으로 검증했지만 운영/Local DB write를 동반한 새 브라우저 Apply 검증은 수행하지 않았다.
- Orca의 실패 terminal resource가 `release_unknown` 감사 상태로 남아 있으나 terminal은 disconnected이며 작업 task는 모두 종료 상태다.
