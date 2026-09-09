# 로컬 우선 개발·검증 전환 v1

## 목적

측정일지 웹의 개발·검증을 Vercel 중심에서 localhost 중심으로 전환한다. Production 운영은 유지하면서 Preview 배포, 반복 실서버 호출, Orca/Verifier/GPT의 중복 외부 조회를 줄인다.

## 기본 개발 흐름

```text
worktree
→ npm run dev:turbo -- -p <worktree별 전용 포트>
→ localhost API/UI 검증
→ focused test / typecheck / build
→ PR 및 코드 검수
→ 사용자 승인
→ main 반영
→ Vercel Production 배포 확인
→ 핵심 smoke test 1회
```

- worktree마다 전용 포트를 사용한다.
- 기존 사용자 서버·프로세스·포트를 임의 종료하거나 점유하지 않는다.
- localhost에서 확인 가능한 API·UI·회귀는 localhost에서 검증한다.
- UI 자동 검증은 headless 또는 격리 세션을 사용해 사용자 마우스·키보드·활성 창에 간섭하지 않는다.

## Vercel 사용 원칙

- Vercel Preview는 기본 개발 검증 경로로 사용하지 않는다.
- branch/PR 생성만으로 Preview를 요구하지 않는다.
- `vercel.json`의 main-only 자동배포 제한 정책을 유지한다.
- 사용자가 승인한 main 반영 후 Production 배포 상태 확인과 핵심 smoke test 1회를 기본 종료 검증으로 한다.
- 같은 deployment ID의 상태, build, logs, runtime을 의미 없이 반복 조회하지 않는다.
- Production 환경변수, Vercel Cron, domain/alias, Vercel runtime 고유 장애처럼 로컬에서 확인할 수 없는 항목만 예외적으로 최소 조회한다.
- 이 운영문을 검증한다는 이유로 Vercel Production/Preview를 호출하지 않는다.

## 외부 서비스 및 증거 재사용

- Orca, Implementation Worker, Fresh Verifier, GPT가 같은 외부 사실을 각각 처음부터 재조회하지 않는다.
- commit SHA, test 결과, deployment ID, 로그 등 신뢰 가능한 기존 증거를 재사용한다.
- 독립 재조회는 보고와 실제 상태가 모순되거나, Production/DB/권한 등 고위험 항목이거나, 사용자가 명시적으로 요청한 경우로 제한한다.
- Supabase/K2B 등도 같은 원칙을 적용하며, 필요한 행·필드·호출만 최소 조회한다.
- Production DB write/migration의 기존 승인 규칙은 그대로 유지한다.

## 일시중지 Orca 작업 재개 Gate

현재 pause된 기능 작업은 이 운영문 반영만으로 자동 재개하지 않는다.
재개 지시를 받은 각 작업은 먼저 최신 전역 `C:\Users\USER\.codex\AGENTS.md`, 저장소 `AGENTS.md`, `project_rules.md`, 이 문서를 다시 읽는다.
기존 기능 요구사항·branch·진행 상태는 유지하고 개발·검증 경로만 local-first로 전환한다.
이미 완료된 검증은 이유 없이 반복하지 않는다.
