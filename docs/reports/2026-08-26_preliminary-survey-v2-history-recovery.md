# 예비조사 V2 PR #59 후속 2단계

## 기준

- 시작 main: `b983b96fe65b9ebf5f2d1877f2fa2fda8a7b7a24`
- branch: `fix/preliminary-survey-plan-navigation-history-recovery`
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

- migration: 미적용
- one-shot plan 복원: 미실행
- 운영 source write: 0
- 운영 assignment write: 0
- Vercel Preview / fresh verifier / 운영 적용 결과는 최종 gate 완료 후 이 보고서에 추가한다.
