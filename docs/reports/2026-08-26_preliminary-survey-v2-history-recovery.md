# 예비조사 V2 PR #59 후속 2단계

## 기준

- 시작 main: `b983b96fe65b9ebf5f2d1877f2fa2fda8a7b7a24`
- branch: `fix/preliminary-survey-plan-navigation-history-recovery`
- feature HEAD: `619c9f05fb0d6b46ad348665d8aaa0d8ce173c5f`
- PR: `#60` (merged)
- main merge commit: `b556549b7b6ae776f9712ee52e18f94f8899c405`
- 운영 inventory 시각: 2026-08-26 KST
- 운영 자동정책: `process_changed_preliminary_survey.enabled=false`
- 운영 DB 조사 단계 write: 0

## UI

- 계획 화면: `측정 시작일 → 측정 종료일 → ← 이전 → 이후 → → 다음 주`
- 목록 화면: `예비조사일 → ← 이전 → 이후 → → 측정예정일`
- 계획 주 이동은 기존 주 범위 helper를 확장한 `getAdjacentWeekRangeKst()`를 사용한다.
- 목록 이동은 PR #59의 `adjacentWorkingDay()`를 그대로 사용한다.
- Orca 내부 브라우저에서 데스크톱 좌표 순서와 iPhone 12 에뮬레이션의 컨트롤 표시를 확인했다.

## Inventory / Canonical

| 분류 | 건수 |
| --- | ---: |
| 전체 대상 (2026-08-01~2026-08-26) | 88 |
| EXISTING_V2_PRESERVED | 42 |
| HISTORICAL_EXACT_RECOVERY | 45 |
| PROTECTED_PRESERVED | 1 |
| 그 외 unresolved | 0 |

- 누락 46건은 legacy `code + year + exact period + measurement_date`로 유일 연결되었다.
- legacy `preliminary_surveyor` 이름과 순서를 보존하고 active user 이름 exact unique match만 허용한다.
- 책임자/reviewer는 기존 manual save 규칙을 재사용한다.
- 기존 측정자·보고서담당·공시료 값은 역할 결정 입력으로 사용하지 않는다.
- 미복원 1건: `H0399` (보호업체 guard).

## Local Docker rehearsal

- DB: `127.0.0.1:54322`, 운영 project와 분리
- manifest rows: 88
- manifest canonical SHA: `677d577e252e6f21bf2cfc534b839f186244b0bb87925c9241d49b9ad515dee2`
- raw manifest: `C:/Users/USER/Downloads/2026-08-26_preliminary-survey-v2-history-recovery-manifest.json`
- raw manifest file SHA-256: `03d03e04e6fb68a10047b8c291fc2e5b1571533033d833854e73e3266dd48510`
- Docker evidence: `C:/Users/USER/Downloads/2026-08-26_preliminary-survey-v2-history-docker-evidence.json`
- Docker evidence SHA-256: `71eee419f8868c3262b4873625e86ba8679bca8439cb0330e51afa402eab974b`
- first apply: plan insert 45
- expected/actual mismatch: 0
- 기존 V2 plan 변경: 0
- measurement assignment 변경: 0
- legacy/target/journal 변경: 0
- 보호업체 write: 0
- 일반 true-confirmed guard: enabled
- second run additional changes: 0
- rollback: 이번 batch plan 45건만 삭제
- rollback 후 기존 plan 변경: 0
- cleanup: users/targets/legacy/plans/assignments/journals/blocks/batch/audit 모두 0

## 검증

- focused: 31 PASS
- 전체 `npm test`: 479 PASS
- `npx tsc --noEmit --pretty false`: PASS
- `npm run build`: 외부 env를 런타임에만 주입하여 PASS
- `git diff --check`: PASS

## 운영 적용

- Preview deployment: `5YSexZQv7rgMaWTcsRTgxcAqMdmt` / READY / feature HEAD 일치
- Production deployment: `BgfkjMMegtphLDQnRSXMWEZrCHS3` / READY / merge SHA 일치
- Production URL: `https://html-dupipyagw-joos-projects-3d60ca1e.vercel.app`
- Production alias: `https://html-tan-six.vercel.app`
- migration: `20260826044741_preliminary_survey_v2_historical_plan_recovery.sql` 운영 적용
- migration committed file SHA-256: `384674bb1bfad37ad27557fc448c58a31a502fdb6a3e0a091e0ceb25c3bf10a3`
- 적용 직전 inventory: 88 / 기존 42 / 복원 45 / 보호 1
- 적용 직전 manifest SHA: `677d577e252e6f21bf2cfc534b839f186244b0bb87925c9241d49b9ad515dee2`
- 적용 직전 context hash: `86d25625a4e0f59d1cacfb7c81d07ac160fb68761ca1efa4a405df603a81f955`
- batch ID: `a8c742f9-0730-4e97-8596-8751c638bf14`
- one-shot plan insert: 45
- second run additional changes: 0 (`alreadyApplied=88`)
- 사후 plan field mismatch: 0
- 기존 V2 plan 42건 full-row digest 변경: 0
- 보호 `H0399` plan write: 0
- 운영 source write (target/legacy/users/schedule/journal): 0
- 운영 assignment write: 0 (49행 유지)
- 자동 정책: OFF 유지
- 사후 audit: 88행, 생성 plan 연결 45행, batch status `applied`
- 운영 apply evidence: `C:/Users/USER/Downloads/2026-08-26_preliminary-survey-v2-history-production-apply.json`
- 운영 apply evidence SHA-256: `28aba8202670aad4f38d536a58409da5bc28b907878a7012465c1ce7f360e87d`
- 사후 검증 evidence: `C:/Users/USER/Downloads/2026-08-26_preliminary-survey-v2-history-production-postverify.json`
- 사후 검증 evidence SHA-256: `b8f9cc62e3992461e2264163ec9896739aca7ff466ce46a31bc23887af8d48a3`

## Production UI / 회귀

- 내부 브라우저 로그인 후 `/survey` 실화면 확인
- 계획 탐색: `2026-08-18` 기준 이전 `2026-08-10~08-14`, 이후 `2026-08-17~08-21`
- 목록 탐색: `2026-08-14 → 이후 → 2026-08-18`
- 복원 표시 표본: `H0096 2026-07-20 / 한기문`, `H0340 2026-07-24 / 이주형,고유빈`, `H0106 2026-08-11 / 이태환,강종구`
- 복원 45건은 모두 `찐확정`, `유선`, legacy 조사자 순서로 표시됨
- 공시료 원천 있음 + 표시 `-`: 0 (`sourceBacked=98`)
- 기존 legacy 8건 / V2 6건 공시료 mismatch: 0
- FF 5건 / GG 2건 raw provenance 유지
- 공시료 회귀 evidence SHA-256: `ab7943351af8eb4ea9b60cde359b2cbf5a1d858b49d96e341af6dc152c977499`

## 독립 검증

- Fresh-context GPT-5.6 Sol / high 요청
- 실제 model metadata: 확인 불가
- 판정: PASS, blocker 0
- manifest/canonical SHA, Docker evidence, owner/ACL/RLS/trigger, second-run 0, rollback 45, cleanup 0을 독립 재검산했다.
