# 예비조사 V2 최종 완결 보고서

## 판정

`PASS`

- 기준일: 2026-08-25 KST
- 요청 총지휘 모델: GPT-5.6 Sol Pro / high
- 실제 총지휘 모델 metadata: 확인 불가
- Fresh-context 독립 검증: GPT-5.6 Sol / high 요청, pre-apply PASS. 운영 사후검증은 별도 fresh verifier가 재검산했다.

## Git / PR / 배포

- 시작 feature HEAD: `70efdef3328c691d21e7a19b885be0df6f127152`
- 백업 branch: `backup/pr42-pre-final-20260825`
- 동기화한 latest main: `f51e1cf20fd06cda4520b554f726b6b0411d8eba`
- main merge commit(feature 내부): `573d1d6`
- 충돌: `package.json` 1건. main 신규 테스트와 PR #42 테스트를 모두 보존하는 합집합으로 해결했다.
- 종료 feature 구현 HEAD: `80e76be0727cbdce10aae3cc3bd88b614232243b`
- PR #42 merge commit: `e94af261fb8bc8d7febe3502ac51a841dc000289`
- PR #42: merged (Draft 해제 후 merge), force push/rebase 없음
- Vercel Production deployment: success
- 배포 URL은 Vercel Authentication으로 보호되어 비인증 smoke에서 `/`, `/login`, V2 API가 정상 SSO redirect(302)를 반환했다.

## CLEAN_BASELINE_SOURCE

- snapshot 기준: `measurement_date >= 2026-08-01`, baseline `2026-08-25` KST
- 전체 target: 106
- true-confirmed: 82
- protected: 10
- past-due unmeasured: 0
- future clean replay eligible: 18
- source incomplete: 0
- 운영 자동화 정책 `process_changed_preliminary_survey.enabled=false`: 유지
- CLEAN_INPUT은 strict allowlist를 사용하며 금지 필드가 있으면 `FORBIDDEN_LEGACY_ASSIGNMENT_FIELD_DETECTED`로 실패한다.
- 실제 legacy 역할값 / 변조값 / NULL 값의 canonical digest가 모두 `6b4c9f65e4a9edcde503bf2ebb698740ae7f671da57f1c19e571ec6745edda4d`로 일치했다.
- V1 날짜 영향: 0
- 기존 V2 plan/assignment 영향: 0
- 과거 날짜 자동추천: 0

## 운영 V1 clear

- 저장 원천: `public.preliminary_survey_plans.recommended_date`
- 초기 non-null: 2
- 실제 운영 update: 2
- 종료 non-null: 0
- H0098은 CHECK-valid 초기 상태인 `pending`으로 전환했고, H0011은 `cancelled`를 유지했다.
- 두 row 모두 사람 배정 정보는 유지했다.
- V2 plan/assignment 및 보호·찐확정 업무값 변경: 0
- transaction은 대상 ID, 기존 날짜/status/row_version, EXPECTED_COUNT=2, 전후 digest를 guard로 사용했다.

## Docker 최종 리허설

- environment: Local Supabase `127.0.0.1:54322`, production project ref 차단
- replay: 18
- apply candidate: 6
- manual-required 확정 예외: 12
- hard-block: 0
- canonical approval-required: 0
- plan actual apply: 6
- assignment actual apply: 8
- expected/actual mismatch: 0
- schedule conflict: 0
- multi-day partial assignment: 0
- protected/true-confirmed write: 0
- source table write: 0
- second run additional changes: 0
- second run RPC write: 0
- Local isolated exact-3 기술검증: 승인 없는 wrapper 전체 rollback PASS, 승인 후 저장 PASS
- isolated approval fingerprint expected/actual: `31671e35cedec7a785ec3827bb83f34f`
- Local cleanup: target/users/plans/assignments/V1/journal/blocks/business/policy 모두 0

## 운영 V2 one-shot apply

- persistence boundary: `persist_preliminary_survey_v2_plan_and_assignment_groups(...)` wrapper만 사용
- core RPC 직접 호출: 0
- apply target: 6
- plan 신규: 6
- plan 갱신: 0
- assignment: 8
- 운영 approval group: 0 (최신 canonical에는 exact-3 그룹 없음)
- expected/actual plan mismatch: 0
- expected/actual assignment mismatch: 0
- `survey_code_source = users.survey_code`: 전 행 확인
- source CLEAN_INPUT digest: `9367ac42dabfc9aff0582fcb52d6e5becc84977140682feaca0355e684f48fda`
- wrapper 직전 동일 digest를 두 번 재조회하여 stale 0 확인
- measurement target/journal/V1/users/schedule/business/policy source field 변경: 0
- protected 변경: 0
- true-confirmed 변경: 0
- hard-block 변경: 0

## 사후 전수검증

- 운영 V2 plan: 43 → 49
- 운영 V2 measurement assignment: 0 → 8
- 운영 V1 recommended_date non-null: 0
- canonical replay digest pre/post 동일
- persisted 결과와 재계산: unchanged 6
- manual-required: 12
- stale: 0
- source incomplete: 0
- protected/true-confirmed proposal: 0
- second run additional changes: 0
- 불필요한 second wrapper write: 0

## 확정 예외 queue

다음 12건은 기준일 이후 가능한 정책 후보일이 없어 과거 예비조사일을 만들지 않고 `manual_required / NO_AVAILABLE_DATE_THROUGH_MINUS_3`로 종료했다.

`H0216, H0098, H0069, H0038, H0182, H0238, H0070, H0257, H0099, H0293, H0294, H0521`

자동 처리 불가능 사유는 예비조사일 정책 범위가 이미 경과한 것이다. 측정일 변경, 일정 무시 또는 과거 날짜 강제배정은 수행하지 않았다.

## 검증

- focused Stage 2 / assignment / persistence / canonical suite: 220/220 PASS
- 전체 `npm test`: 471/471 PASS
- `npx tsc --noEmit --pretty false`: PASS
- `npm run build`: PASS (69 pages)
- `git diff --check`: PASS
- Fresh-context Sol pre-apply verifier: PASS
- Fresh-context Sol post-apply verifier: PASS

## Raw evidence (Local only)

- pre-apply source: `C:\Users\USER\Downloads\2026-08-25_preliminary-survey-v2-clean-source-preapply.json` / SHA-256 `BDF9DB3C4AB8B455729839C67FD93E8456624728B8C1CAAF1E5D8B5A65324E17`
- pre-apply canonical: `C:\Users\USER\Downloads\2026-08-25_preliminary-survey-v2-clean-canonical-preapply.json` / SHA-256 `1F4188EC533290CBACCAE62038EE5AD00730607D67FB0C37D939C6CB85F96C36`
- Docker evidence: `C:\Users\USER\Downloads\2026-08-25_preliminary-survey-v2-clean-docker-evidence-preapply.json` / SHA-256 `6CB9A8EB20CD433BA03381F74745AC817D0F3C847CEA6CFA1B4A47F6C22532BE`
- production apply evidence: `C:\Users\USER\Downloads\2026-08-25_preliminary-survey-v2-production-apply-evidence.json` / SHA-256 `69E940D11C1C74B0FFDD072914C8AD26349133C3D852721F1BC9CDD2D19914DC`
- post-apply source: `C:\Users\USER\Downloads\2026-08-25_preliminary-survey-v2-clean-source-postapply.json` / SHA-256 `75ED6BB2102FAC314CDE28471E79AAC119740313C893E9CA1D295ACCC91C75C8`
- post-apply canonical: `C:\Users\USER\Downloads\2026-08-25_preliminary-survey-v2-clean-canonical-postapply.json` / SHA-256 `A992AEB28F2F89B6F9435159EA4FBE40870586A6C38D7F5F8A725C3C711EA8E0`

Raw production manifests와 before-image는 Git에 포함하지 않았다.

## 최종 배정표 / worker

- 최종 사람이 읽는 배정표: `docs/reports/2026-08-25_preliminary-survey-v2-final-assignments.csv`
- direct active worker: 0 (최종 verifier 종료 확인 후 기록)
- Orca run `run_e35fe99e9aad`: created 3, completed 3. resource release 응답은 3건 모두 `release_unknown`이었으며 실제 direct active worker와 분리해 기록한다.
