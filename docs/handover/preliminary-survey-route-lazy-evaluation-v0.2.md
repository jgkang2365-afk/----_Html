# 측정자 고정형 역산 플래너 Route Lazy Evaluation v0.2

기준일: 2026-09-02
Canonical blob SHA: `aca759e7d785231cc89bc656ba635eb367f65de3`
Planner version: `fixed-assignee-reverse-planner-v1.2.1`

## 최종 구조

- `/survey` 진입, Planner GET, 대상 조회, 고정 측정자 확정, Apply는 Route provider를 호출하지 않는다.
- Preview만 실제 동일 직원 이동 pair를 수집한다. 실제 측정팀 중복은 solver 결과와 무관하므로 먼저 수집하고, 예비조사 방문 pair는 provisional solve 결과에서 추가 수집한다.
- 동일주소는 정규화 비교로 즉시 해결하며 외부 호출 budget에서 제외한다.
- 동일주소가 아닌 pair는 A→B와 B→A를 독립 조회하고 두 방향의 최댓값을 유효시간으로 사용한다. 한 방향이라도 실패하면 `incomplete_direction`으로 보수 처리한다.
- Lazy 반복은 target 수로 제한하지 않는다. 새 evidence 추가, 정상 수렴, pair guard, 전체 deadline만 종료 조건으로 사용한다.
- provider가 AbortSignal을 무시해도 resolver가 Promise 자체를 deadline과 race한다. 좌표 지연조회도 같은 deadline을 사용한다.
- 실제 측정팀 Route pair를 global solver보다 먼저 처리한다. solver 재귀도 같은 wall-clock deadline을 확인하며, 초과 시 부분 최적해를 AUTO로 사용하지 않고 `MANUAL_REQUIRED`로 낮춘다.
- Preview evidence는 actor, 측정일, source fingerprint, 만료시각과 함께 HMAC token으로 동결된다. Apply는 token과 DB 원천을 재검증하며 Route provider를 다시 호출하지 않는다.

## 운영 안전값

- unique external pair guard: 기본 20
- pair worker concurrency: 기본 4
- directional call 상한: guard 20 기준 최대 40
- Route resolution deadline: 기본 20,000ms
- 성공 cache: 방향별 5분
- 일시 실패 negative cache: 방향별 90초
- guard/deadline 도달 시 임의 앞쪽 pair만 처리하지 않고 관련 unresolved target을 `ROUTE_EVIDENCE_REQUIRED`로 낮춘다. Route와 무관한 target의 계산은 계속한다.

## 날짜 및 좌표 범위

- `45 calendar days` magic range는 없다.
- 다일 대상은 `daily_staff[].date`를 정렬해 최솟값을 기준일로 사용한다.
- Canonical working-day primary/fallback 후보를 실제 계산하고 전체 후보 최솟값을 occupancy 조회 시작일로 사용한다.
- Calculation Snapshot은 좌표를 일괄 선조회하지 않는다. required pair에서 동일주소를 제거한 뒤 필요한 사업장 code만 `business_info`에서 읽는다.

## 자동 검증

- Route Lazy focused: 18/18 PASS
- Reverse Planner + Route focused: 49/49 PASS
- 전체 `npm test`: 544/544 PASS
- `npx tsc --noEmit`: PASS
- `npm run lint`: 신규 오류 0, 기존 warning만 존재
- `npm run build`: PASS
- `git diff --check`: PASS
- 핵심 회귀: 3단계 후보 탈락 후 정상 후보 탐색, 양방향 최댓값, 한 방향 실패, 1,000개 무관 target 불변, same-address 0-call, guard, deadline, provider Abort 무시, token 변조, 다일 날짜 순서, 장기휴일 working-day 범위

## Staging authenticated headless E2E

- browser mode: headless Chromium
- final HEAD: `88365bfde1172888518370c368baf95793266d2c`
- session: `route-lazy-staging-final-v121`
- Preview URL: `https://html-gxmedq0zl-joos-projects-3d60ca1e.vercel.app/survey`
- DB: Staging synthetic fixture `ZRP9040`, `ZRP9041`
- 화면 진입/대상 조회/고정 측정자 확정: Route resolver 호출 0
- 동일주소 Preview: required 1, same-address 1, directional 0, external 0
- final HEAD Preview: HTTP 200, 499ms, planning 2, snapshot 85, `AUTO_ASSIGNED + KEEP_EXISTING`, `F/FF`
- final HEAD Apply: HTTP 200, 568ms, `appliedCount=0` (`KEEP_EXISTING` 재검증)
- SOURCE_CHANGED: synthetic fixed assignment 변경 후 stale Apply HTTP 409, `appliedCount=0`; 원래 fixed assignment로 즉시 복원
- persisted 결과: `ZRP9040=F`, `ZRP9041=FF`, plan `automatic`, audit `AUTO_ASSIGNED/CREATE`, source fingerprint 저장
- Apply network에는 새 Route 요청이 없다.
- QA 계정 임시 비밀번호는 E2E 종료 후 무작위 폐기값으로 회전했다.
- screenshot: `C:\Users\USER\orca\artifacts\route-lazy-pr82-v121\staging-final-head-after-apply.png`

## 실제 Route 호출 Acceptance

Production DB는 READ-ONLY로 연결하고 업무 데이터 write 없이 독립 headless session `route-lazy-prod-readonly-3`에서 Preview만 실행했다.

```text
measurement date: 2026-09-02
planningTargetCount: 6
snapshotTargetCount: 131
candidatePairs: 4
requiredPairs: 4
sameAddressResolved: 0
directionalRequests: 8
externalCalls: 8
routeSuccess: 8
routeFailure: 0
guardedPairs: 0
deadlinePairs: 0
HTTP: 200
elapsed: 21.175s (DB snapshot 포함)
```

외부 호출량은 snapshot 131건이 아니라 shared-person pair 4건에 비례했다. Kakao 양방향 8회가 모두 성공했다. 해당 Production snapshot의 global solve는 Route deadline 뒤 부분 최적해를 사용하지 않고 `solverTimedOut=true`로 보수 처리됐다.

- screenshot: `C:\Users\USER\orca\artifacts\route-lazy-pr82-v121\production-readonly-preview.png`
- Production business-data write: 0
- Production backfill: 0
- Route migration: 0

## 환경 관찰

- Vercel Preview에는 `KAKAO_REST_API_KEY`가 없어 다른 주소 fixture에서 directional request 2건, external call 0건으로 계측됐다. 동일주소 Staging Apply E2E와 실제 키가 있는 Production READ-ONLY Preview를 결합하여 저장 흐름과 실제 외부 호출을 분리 검증했다.
- stable branch alias의 Deployment Protection 우회 링크가 간헐적으로 실패하여 최종 HEAD 고유 deployment URL에서 검증했다. 고유 deployment의 Staging synthetic fixture 조회와 Apply가 정상 동작했다.
- 기존 migration ledger reconciliation과 Staging-only trigger drift는 v0.1 기록을 유지하며 이번 Route PR에서 변경하지 않았다.

## Fresh Verification

- independent verifier: Sol/high, READ-ONLY
- 검증 HEAD: `88365bfde1172888518370c368baf95793266d2c` (이후 문서 증거 정리만 추가)
- 12개 필수 질문: PASS 12/12
- blocking issue: 0
- merge 권고: PASS

## 배포 및 rollback

- PR: `#82` (모든 Merge Gate 통과 전 Draft 유지)
- DB migration/backfill: 없음
- code rollback: PR merge revert
- 신규 table/column/업무 데이터 변경이 없으므로 code rollback이 기존 DB 구조에 영향을 주지 않는다.
- merge 및 Production smoke의 최종 SHA/결과는 PR #82 본문과 완료 보고에 기록한다.
