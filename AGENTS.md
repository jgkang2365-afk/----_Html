# AGENTS.md

이 문서는 `측정일지_html` 저장소에서만 필요한 **프로젝트 진입 Gate, 필독 문서, 업무 특수 제약**을 정의한다.

공통 작업 방식, Git 안전, 승인, 검증, Worker/Fresh Verifier, 모델·추론 선택, 완료 판정 및 결과 보고는 상위 Codex/Orca 전역 규칙을 따른다.

## 1. 프로젝트 문서와 우선순위

작업을 시작할 때 작업 범위에 필요한 문서를 확인한다.

1. `AGENTS.md`
   - 프로젝트 진입 Gate와 특수 제약
2. `project_rules.md`
   - 프로젝트 전반에 지속 적용되는 기술·운영 정책
3. `BUSINESS_LOGIC.md`
   - 업무 데이터, 계산, 분류, 우선순위 및 Source of Truth
4. 기능별 canonical 문서
   - 예비조사: `docs/business-rules/preliminary-survey.md`
5. 실제 코드·DB 스키마
   - 현재 구현 상태와 실제 데이터 구조 확인

업무 정책의 기준과 현재 구현 상태를 구분한다.

- 업무 정책의 정답은 해당 canonical 또는 업무 규칙 문서다.
- 코드와 DB는 현재 구현 상태를 확인하는 근거다.
- 문서와 코드·DB가 충돌하면 어느 한쪽을 임의로 정답으로 간주하지 말고 차이를 확인한 뒤 처리한다.

## 2. 예비조사 작업 필수 Gate

예비조사 관련 코드, DB, 추천·재추천, 역산, 자동배정, repair, UI, 테스트 또는 검수 작업을 시작하기 전에 반드시 다음을 수행한다.

- `docs/business-rules/preliminary-survey.md` 전체를 직접 읽는다.
- 예비조사 업무 정책은 해당 문서를 단일 canonical 기준으로 사용한다.
- 작업 시작 시 `origin/main`의 canonical 최신성을 1회 확인한다.
- 현재 작업 사본이 `origin/main`보다 오래된 경우 최신 canonical을 반영한 뒤 정책 판단을 시작한다.
- Windows 기준 canonical 사본은 다음 경로를 사용한다.

  `C:\Users\USER\Desktop\안티그래비티\측정일지_html\docs\business-rules\preliminary-survey.md`

- WSL에서는 다음 경로로 동일 파일에 접근한다.

  `/mnt/c/Users/USER/Desktop/안티그래비티/측정일지_html/docs/business-rules/preliminary-survey.md`

- 예비조사 업무 규칙을 변경할 때는 canonical을 먼저 갱신하고 코드·DB·테스트를 그 결정에 맞춘다.
- 테스트 기간의 과거 한시 특례, 과거 작업지시서, 코드 주석, 오래된 fixture를 현재 canonical보다 우선하지 않는다.
- 하위 Worker에는 canonical 전체를 복사하지 말고 현재 작업에 필요한 섹션·경로·근거만 전달한다.

## 3. 업무 데이터와 Source of Truth

사업장, 측정일지, 측정대상, 예비조사, 국고지원, K2B, 매출·미수금 등 업무 규칙을 임의로 단순화하거나 추론하지 않는다.

- 업무별 데이터 원천과 우선순위는 `BUSINESS_LOGIC.md`와 해당 canonical을 확인한다.
- 화면 표시값과 DB 원천값을 동일한 값으로 가정하지 않는다.
- 표시용 문자열이나 가공값을 authoritative source로 역산하여 저장하지 않는다.
- 기존 상세 데이터를 단순 상태값이나 편의값으로 덮어쓰지 않는다.
- 업무 데이터의 Source of Truth를 변경하는 작업은 기존 구현과 영향 범위를 함께 확인한다.
- 오래된 구현 계획서나 과거 장애 기록을 현재 업무 정책으로 사용하지 않는다.

예비조사 업무에는 §2의 canonical 규칙을 우선 적용한다.

## 4. 로컬 자동화 및 외부 프로그램

이 프로젝트에는 일반 웹 기능 외에 Windows 로컬 환경에서 실행되는 자동화가 포함된다.

대표적으로 다음 기능이 있다.

- MES
- K2B
- 문서 생성 Worker
- 네트워크 드라이브 및 로컬 파일 연동

관련 작업에서는 다음을 지킨다.

- 웹 서버와 Windows 로컬 Worker의 실행 책임을 구분한다.
- 외부 GUI, 로컬 파일, 네트워크 드라이브가 필요한 작업을 클라우드 환경에서 동작한다고 가정하지 않는다.
- Realtime 또는 Queue 기반 작업은 중복 실행, 재시도, 상태 전이 및 최종 상태를 확인한다.
- 네트워크 드라이브나 외부 프로그램 연결 실패를 정상 완료로 처리하지 않는다.
- 백그라운드 Worker에 보이지 않는 사용자 입력 대기나 무한 대기 상태를 만들지 않는다.

세부 운영 정책은 `project_rules.md`를 따른다.

## 5. 개발·검증 환경

이 프로젝트의 상세 개발·검증 절차는 다음 문서를 기준으로 한다.

`docs/operations/local-first-development-verification-v1.md`

프로젝트 AGENTS에서는 해당 절차를 중복 정의하지 않는다.

특히 localhost에서 검증 가능한 기능을 일상적으로 Vercel Preview/Production 검증으로 대체하지 않는다.

Supabase Local/Staging/Production 구분과 migration 승격 정책은 `project_rules.md`를 따른다.

## 6. 패키지 보안

프로젝트의 `.npmrc` 공급망 보안 설정을 임의로 완화하지 않는다.

보호 대상에는 다음 설정이 포함된다.

- `min-release-age`
- `ignore-scripts`

패키지 설치가 차단되면 설정을 우회하기 전에 원인과 실제 필요성을 확인한다.

Secret, service role, token, credential 등 비밀값은 코드·문서·로그에 기록하지 않는다.

## 7. UI/UX

업무용 UI/UX를 신규 개발하거나 수정할 때는 프로젝트 로컬 `office-ui` 스킬을 따른다.

기준 문서:

`.agents/skills/office-work-ui-ux/SKILL.md`

세부 공통 UI 정책은 `project_rules.md`를 따른다.

새 UI를 만들기 전에 기존 공통 컴포넌트와 현재 프로젝트의 화면 패턴을 우선 확인한다.

## 8. 충돌 및 불명확한 상태

다음 상황에서는 추측으로 진행하지 않는다.

- canonical과 코드가 충돌함
- DB 실제 구조와 문서가 다름
- 둘 이상의 업무 규칙 문서가 서로 충돌함
- 현재 원천값과 화면 표시값의 관계가 불명확함
- 운영값인지 과거 테스트값인지 구분되지 않음

먼저 현재 Source of Truth와 실제 구현 상태를 확인한다.

사용자의 정책 판단이 필요한 경우에는 확인된 사실, 충돌 지점, 영향 범위를 구분하여 보고한다.
