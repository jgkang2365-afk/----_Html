# PR #42 Stage 1 최종 Local Apply E2E 검증 보고서

## 1. 검증 결과

- 결과: **PASS**
- 검증일: 2026-08-23 (Asia/Seoul)
- 저장소: `jgkang2365-afk/----_Html`
- 브랜치: `feature/preliminary-survey-phase-b`
- 시작 HEAD: `9b6676597bd17dd11e3784e0f46383b947c636a6`
- PR #42: Draft / Open 유지, merge 미실행
- 제품 코드 수정: 없음
- 보고서 외 신규 migration: 없음

## 2. 검증 환경과 Local/Production 구분

- 애플리케이션: 현재 브랜치의 실제 Next.js API (`/api/preliminary-survey-v2/workbench`)
- Local Supabase: `C:\Users\USER\supabase-pr42-validation`의 독립 project
- Local API/DB 포트: `127.0.0.1:54321` / `127.0.0.1:54322`
- 전용 개발 서버: 기존 3000 포트를 건드리지 않고 3010 포트로 별도 실행 후 종료
- 운영 Supabase 연결 및 write: 0건
- 운영 migration 적용: 0건
- 보호 대상 10개 사업장 write: 0건
- Stage 2 실행: 0건

지정 측정일 `2026-08-24`를 실제 제품의 과거 후보일 정책으로 검증하기 위해 전용 3010 프로세스의 기준 시각만 `2026-07-01 KST`로 고정했다. 제품 코드, 정책, assertion은 변경하지 않았다.

## 3. fixture 구성

Local DB에만 다음 6개 측정대상, business/user 원천, 정책 OFF 행과 현재 manual V2 plan 원천을 구성했다.

| 사업장 | 예비조사 책임자 | 표시 조사자/검토자 | 측정 참여자·보고서 담당 | 기대 측정자 |
| --- | --- | --- | --- | --- |
| H0290 벧엘금속 | 한기문 | 한기문 | 한기문 | 한기문(B) |
| H0200 인주농협 미곡처리장 | 이태환 | 이태환 | 강종구 | 이태환(A) |
| H0226 현대자동차충청써비스 | 강종구 | 이태환 + 강종구 | 강종구 | 강종구(C) |
| H0188 빛나는자동차공업사 | 이주형 | 이주형 | 고유빈 | 이주형(D) |
| H0100 통운모터스 | 고유빈 | 이주형 + 고유빈 | 고유빈 | 고유빈(F) |
| H0101 이수모터스 | 김민영 | 이주형 + 김민영 | 고유빈 | 김민영(G) |

- users의 `survey_code`: A/B/C/D/F/G
- 측정일: 6개 모두 `2026-08-24`
- Recommend 직전: fixture plan 6, measurement assignment 0
- plan digest: `61636ed1b63aa1deb0692e4232c2bd58`

초기 probe에서는 책임 예비조사자 원천 plan을 넣지 않아 API가 동적 책임자를 계산했다. Apply 전에 fixture 누락으로 특정했고 Local fixture를 전부 초기화한 뒤, 실제 제품이 책임자/검토자 원천으로 읽는 current manual plan을 구성해 본 검증을 처음부터 다시 실행했다. 초기 probe와 본 검증 모두 Recommend 단계에서 assignment write는 없었다.

## 4. Recommend 결과

실제 로그인 API로 생성한 세션을 사용해 실제 workbench Recommend API를 호출했다.

- HTTP: 200
- draft: 6개
- missing: 0개
- 상태: 6개 모두 `recommended`
- canonical fingerprint: 6개가 동일한 요청 fingerprint `29266a2f76b6...` 사용
- 배정: A/B/C/D/F/G 각각 정확히 1회
- H0200: 이태환(A)
- H0226: 강종구(C)

Recommend 직후 DB는 plan 6, assignment 0, plan digest `61636ed1b63aa1deb0692e4232c2bd58`로 직전과 동일했다. 즉 Recommend는 기존 source fixture plan을 변경하거나 신규 plan/assignment/decision을 저장하지 않은 draft-only 동작이었다.

## 5. Apply 및 RPC 결과

Recommend 응답의 `drafts` 배열을 재조립하지 않고 그대로 JSON 직렬화해 실제 workbench Apply API에 전달했다.

- HTTP: 200
- success: true
- appliedCount: 6
- appliedDraftCount: 6
- 동일 source의 `DRAFT_REVIEW_REQUIRED`: 미발생
- 실제 호출 RPC: `persist_preliminary_survey_v2_plan_and_assignment_groups`
- mock RPC 또는 테스트 전용 Apply 경로: 사용하지 않음

Recommend와 Apply 재계산은 report writer, measurement participants, preliminary survey responsible를 유지했으며 canonical survey/measurement assignment 비교와 fingerprint 검증을 통과했다.

## 6. Local DB 저장 결과

Apply 후 `preliminary_survey_v2_plans` 6개와 `preliminary_survey_v2_measurement_assignments` 6개를 직접 조회했다.

| 사업장 | 측정일 | 저장 assignee | 저장 survey_code | authoritative source |
| --- | --- | --- | --- | --- |
| H0290 | 2026-08-24 | 한기문 | B | `users.survey_code` |
| H0200 | 2026-08-24 | 이태환 | A | `users.survey_code` |
| H0226 | 2026-08-24 | 강종구 | C | `users.survey_code` |
| H0188 | 2026-08-24 | 이주형 | D | `users.survey_code` |
| H0100 | 2026-08-24 | 고유빈 | F | `users.survey_code` |
| H0101 | 2026-08-24 | 김민영 | G | `users.survey_code` |

6개 모두 plan 연결, measurement date, assignee user ID, survey code가 기대값과 일치했다. assignment의 `survey_code_source`도 모두 `users.survey_code`였다.

## 7. cleanup 결과

Apply 검증 후 Local fixture를 transaction으로 삭제하고 직접 count했다.

| 대상 | 잔여 |
| --- | ---: |
| fixture/current plan 전체 | 0 |
| measurement assignment 전체 | 0 |
| fixture measurement target | 0 |
| fixture business_info | 0 |
| fixture user | 0 |
| fixture policy setting | 0 |

전용 3010 개발 서버도 종료했으며 기존 3000 서버는 유지했다.

## 8. 자동화 검증

| 검증 | 결과 |
| --- | --- |
| focused tests (V2/measurement assignment/persistence/canonical) | PASS, 114/114 |
| `npx tsc --noEmit --pretty false` | PASS |
| `npm test` | PASS, 425/425 |
| `npm run build` | PASS |
| `git diff --check` | PASS |

focused/전체 테스트에는 source 변경 시 `DRAFT_REVIEW_REQUIRED`, 다일 `daily_staff`, 날짜별 report writer/measurement participants, RPC atomicity 및 hard max 방어가 포함되며 assertion 삭제·완화는 없었다.

## 9. 변경·안전 확인

- 제품 코드 수정: 없음
- 테스트/fixture 기준 완화: 없음
- migration 생성/적용: 없음
- 운영 DB INSERT/UPDATE/DELETE/UPSERT/RPC write: 0건
- Stage 2 historical replay/backfill: 0건
- 보호 대상 10개 사업장 운영 write: 0건
- 남은 제품 blocker/TODO: 없음

## 10. Worker 종료 상태

- created: 1
- completed task: 1
- active task: 0
- active worker: 0
- 요청/확인 모델: `gpt-5.6-terra`, reasoning `medium`
- 담당: Local Supabase/운영 분리 및 안전한 E2E 절차 읽기 전용 독립 확인
- 결과: 성공, 파일/DB 변경 0
- closed: exact worker terminal은 종료(`observation.status=exited`, disconnected)
- remaining: 실행 중 worker 0
- Orca resource accounting: 종료 후 release 요청에서 프로세스 중지를 재확인하지 못해 해당 terminal resource가 `release_unknown`으로 기록됨. transcript는 보존됐고 exact worker는 exited 상태이며, 코드/E2E 검증 결과와 무관하다.

## 11. 결론

실제 제품 경로의 `Recommend → canonical draft → Apply → Local RPC → Local DB 재조회`가 동일 source에서 정상 완료됐다. A/B/C/D/F/G가 각각 1회 저장됐고 H0200=A, H0226=C를 만족했다. Stage 1 Local Apply E2E 완료 조건을 충족하며 Stage 2는 실행하지 않았다.
