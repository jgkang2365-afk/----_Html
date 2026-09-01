# 측정일지_웹 — 측정자 고정형 역산 플래너 인수인계서 v0.3

기준일: 2026-09-02
Canonical: `docs/business-rules/preliminary-survey.md`
Canonical Git blob SHA: `aca759e7d785231cc89bc656ba635eb367f65de3`
Planner version: `fixed-assignee-reverse-planner-v1.1.0`

이 문서는 PR #78 구현 완료 시점의 v0.2를 보존하고, 독립 검수에서 발견된 운영 정확성 결함과 v1.1 보완 결과를 기록한다.

## 1. PR #78 검수 FAIL 항목

- Golden fixture의 경력/비경력 값이 Canonical과 반대였다.
- `responsible → reviewer` 우선 조합의 조회 방향이 뒤집혀 있었다.
- 선택 batch 밖의 기존 예비조사, 실제 측정, 공시료 그룹 점유를 solver가 보지 않았다.
- 방문 수행자의 실제 측정 일정 충돌과 사람별 방문 capacity/route 검증이 불완전했다.
- fallback 후보가 primary의 전체 hard-rule 해 존재 여부보다 먼저 배제될 수 있었다.
- 음수 preference score와 부분합 pruning의 조합으로 전역 최적해를 버릴 수 있었다.
- Preview 공시료 그룹과 Apply transaction의 정규화 대상이 달라질 수 있었다.
- 고정 측정자 비참여 확인을 UI 확인창에 의존했다.
- 기존 일반 수동 PATCH가 새 저장 계약을 우회할 수 있었다.
- 관리자 override가 `automatic` origin으로 저장되고 구체적인 위반 목록을 고정하지 않았다.
- `KEEP_EXISTING`과 보고서 담당 null 처리가 전체 Canonical validator를 통과하지 않았다.
- 1차 Fresh Verification에서 유선 reviewer 일정 오차단, planning target 중 미선택 persisted 점유 누락,
  outside fixed 공시료 그룹 누락, Apply group 동시성, 보호 NULL code backfill 시도, batch writer counter 누락과
  미존재 역할 사용자의 조용한 drop을 추가 확인했다. 이 상태의 PR #80 merge를 중단하고 모두 보완한 뒤 재검증했다.

## 2. 최종 PlanningSnapshot 구조

Pure solver 입력은 다음 원천을 결정론적으로 정렬·동결한다.

- `targets`: 선택일에 속하는 계산 대상이며 다일 대상은 전체 측정기간으로 확장한다.
- `fixedAssignments`: 사용자가 명시 확정한 날짜별 측정자와 비참여 명시 확인 근거다.
- `existingSurveyOccupancy`: batch 밖 persisted plan의 날짜, 방식, 참여자, responsible, reviewer, 작성자, 주소와 보호상태다.
- `actualMeasurementOccupancy`: top-level 측정일과 `daily_staff[].date`별 fixed/collaborators 실제 측정팀이다.
- `existingPublicSampleAssignments`: 같은 실제 측정일·고정 측정자의 batch 밖 persisted 공시료 그룹이다.
- 사용자 활성·경력·base code, 불가 일정, 기존 plan/assignment, 보호상태, 작성 counter와 route evidence를 포함한다.
- Canonical SHA와 planner version을 source fingerprint에 포함한다.

DB 조회와 route provider 호출은 API 경계에서 끝내며 solver는 Supabase, route API, React state, 현재 시각과 조회 순서에 의존하지 않는다.

## 3. 최종 validator와 solver

- 실제 경력 원천은 `users.is_preliminary_survey_experienced`만 사용한다.
- Canonical 인력은 경력자 이태환(A)·한기문(B)·이주형(D), 비경력자 강종구(C)·고유빈(F)·김민영(G)이다.
- reviewer preference는 강종구→이태환, 고유빈→이주형, 김민영→한기문 방향이며 hard rule 충돌 시 다른 경력자를 탐색한다.
- 경력자 단독은 경력자가 작성자이고, 경력자+비경력자는 비경력 responsible가 작성자이며 경력자는 reviewer다.
- 기존 persisted 유선 plan은 responsible 3건 capacity, 날짜 분산과 작성 counter에 포함한다.
- 방문 capacity와 route는 날짜별 공유 participant 기준으로 계산한다. 방문 수행자는 불가 일정과 실제 측정 일정 모두를 통과해야 한다.
- 기존업체 유선은 responsible/reviewer의 실제 측정 일정 때문에 차단하지 않는다.
- 유선 불가 일정은 실제 전화·작성 responsible에게만 적용하며 reviewer의 일정은 유선 후보를 차단하지 않는다.
- primary 후보로 전체 batch hard-rule 해를 먼저 탐색하고, 정상해가 없을 때만 fallback 후보를 허용한다.
- objective는 비음수 lexicographic tuple이며 단조 lower-bound만 가지치기한다. 순서 permutation과 전역 최적해 회귀를 고정했다.
- `KEEP_EXISTING`도 날짜·방식·경력·역할·교집합·일정·capacity·route·보호·fixed·원천 구조를 동일 validator로 다시 통과한다.
- 보고서 담당 미입력은 preference 부재이며 단독 `SOURCE_INVALID` 사유가 아니다. 단일/다일 원천이 구조적으로 충돌할 때만 invalid다.
- non-null 보고서 담당 ID 또는 collaborator 이름이 사용자 원천에 없으면 `USER_NOT_FOUND`로 자동결정을 중단한다.
- 계산 batch에 포함됐더라도 SOURCE_INVALID·전환·보호 때문에 선택되지 않은 target의 persisted plan은 고정 점유로 유지한다.
- 작성업무 preference는 persisted counter에 현재 batch의 선택 writer count를 누적해 계산한다.

## 4. 저장 경로와 보안

- 구형 Workbench recommend/apply는 계속 `410 LEGACY_WORKBENCH_DISABLED`다.
- 기존 일반 수동 `PATCH /api/preliminary-survey-v2/[targetId]`는 `410 LEGACY_MANUAL_PLAN_WRITE_DISABLED`로 유지한다.
- 정상 Apply는 Preview와 재구성 snapshot fingerprint가 같고 CREATE/REPLACE mutation일 때만 service-role 전용 RPC를 호출한다.
- 비참여 고정 측정자는 서버가 collaborators를 다시 검사하며 명시 flag가 없으면 `NON_PARTICIPANT_ASSIGNEE_CONFIRMATION_REQUIRED`로 거부한다. 확인 근거는 fixed source snapshot에 남는다.
- 관리자 override는 서버 validator가 계산한 위반 목록을 먼저 반환하고, 클라이언트가 같은 목록과 사유를 명시 재확인한 경우만 저장한다.
- override는 `plan_origin = manual`, audit `event_type/decision = MANUAL_OVERRIDE`로 저장한다.
- Apply transaction은 Preview 공시료 코드와 정규화 후 persisted 코드가 다르면 `PUBLIC_SAMPLE_PREVIEW_MISMATCH`로 전체 rollback한다.
- 보호 plan의 공시료 코드를 변경하는 UPDATE는 DB trigger도 차단한다.
- assignment가 아직 없는 batch 밖 fixed confirmation도 Preview 공시료 그룹에 포함한다.
- 보호 assignment의 NULL code가 base-code fallback과 같은 경우 trigger는 기존 NULL row를 그대로 반환해 backfill하지 않는다.
- 같은 날짜·담당자 공시료 그룹은 transaction advisory lock으로 직렬화하며 CREATE/REPLACE는 기존 plan ID·updated_at baseline을 재검증한다.
- 유선 responsible/date, 방문 participant/date와 공시료 group resource key 전체를 정렬 잠근다. users, fixed,
  schedule, actual measurement, external survey occupancy와 보호상태 원천을 transaction 안에서 baseline 재검증한다.
- plan/assignment table은 짧은 `SHARE ROW EXCLUSIVE` 경계로 다른 저장 경로의 phantom write까지 차단한다.
- 관리자 override RPC만 transaction-local repair flag를 설정하며 일반 Apply는 찐확정 보호를 우회하지 않는다.
- RPC 실행권한은 `service_role`만 가지며 `PUBLIC/anon/authenticated`에는 부여하지 않는다.

## 5. Golden Regression

v1.1 focused suite는 다음 범주를 영구 고정한다.

- 실제 6인 경력/base code와 세 reviewer 조합, 우선 reviewer 불가 fallback
- 비경력 단독 금지, 경력 단독/경력+비경력 작성자
- fixed와 예비조사자가 달라도 collaborator 교집합이 있는 정상안
- batch 밖 유선 capacity·날짜 점유, 방문 capacity, 실제 측정 일정 충돌
- 방문 차단과 기존업체 유선 비차단의 방식별 차이
- primary 실패 뒤 fallback, primary 정상해 시 fallback 금지, 전역 최적해
- 입력/query 순서 permutation 불변
- batch 밖 assignment를 포함한 C/CC/CCC Preview와 persisted 결과 일치
- 보호 그룹 자동변경 금지, 일반 PATCH/direct fixed API 우회 차단
- 관리자 override manual origin과 구체 violation audit
- `KEEP_EXISTING` full validator, 다일 fixed 독립, 과거 assignment의 fixed 승격 금지
- source 변경 Apply 0건, 8월·전환구간 backfill/write 0

## 6. DB 변경과 Staging 결과

`20260902150000_harden_reverse_planner_v1_1.sql`부터 `20260902250000_order_reverse_planner_table_locks.sql`까지의
v1.1 forward migrations은 additive/forward-compatible이다.

- reconciliation의 applied plan/assignment 참조에 partial index를 추가했다.
- 보호 plan 공시료 코드 UPDATE 차단 trigger를 추가했다.
- 기존 Apply RPC를 같은 signature로 forward 교체하여 override origin과 Preview/persisted 코드 일치 검사를 보강했다.
- 같은 공시료 그룹 advisory lock, target plan baseline, 관리자 override transaction 경계와 보호 NULL 무백필을 추가했다.
- 기존 table/column 삭제·rename·backfill은 없다.

Staging synthetic 검증 결과:

- `MANUAL_OVERRIDE`: target 735, `plan_origin=manual`, 구체 warning/audit 저장 PASS
- 잘못된 Preview 코드 `FF`: `PUBLIC_SAMPLE_PREVIEW_MISMATCH`, plan/audit 0건 rollback PASS
- 올바른 자동 코드 `F`: automatic plan/assignment/audit 원자 저장 PASS
- 보호 assignment 직접 변경: 기존 찐확정 lock에서 write 0건 PASS
- 실제 Staging 함수 정의: advisory lock, plan baseline, override flag, Preview guard, empty search_path PASS
- 보호+NULL assignment의 base-code 정규화 시도: transaction rollback 검증에서 NULL 보존 PASS
- outside fixed-only ZRP9040 + Apply ZRP9041: Preview 기대 `FF`와 persisted `FF` 일치 PASS
- user/fixed/schedule/actual/occupancy/protection baseline과 deterministic resource lock 실제 함수 정의 PASS
- target lifecycle writer와 같은 target → plan/assignment table lock 순서 적용 PASS

## 7. 운영 보호와 rollback

- Production business-data backfill은 0건이며 기존 plan/assignment/fixed/public code를 일괄 수정하지 않는다.
- 8월 및 8·9월 전환 자료를 자동 재계산하거나 변경하지 않는다.
- 코드는 merge revert로 rollback한다.
- DB 변경은 additive이며 필요하면 신규 RPC/function만 이전 안전버전으로 forward 재정의한다.
- 기존 PR #78 table/column은 삭제하지 않는다.

## 8. 남은 MANUAL_REQUIRED 정책

- fixed 미확정, 실제 측정팀 교집합 없음, 경력 partner 없음, 유효 날짜 없음
- route evidence 부재 또는 60분 초과
- 보호 plan 변경 필요, 보호 공시료 그룹 재정규화 필요
- Canonical 전환 경계 검토, authoritative source 충돌

이 사유들은 자동 범위를 넓혀 억지 값을 만들지 않고 사용자 또는 관리자 검토 대상으로 유지한다.
