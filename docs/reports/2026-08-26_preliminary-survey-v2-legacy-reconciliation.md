# 예비조사 V2 기존 입력 역산·운영 복원

## 판정

구현 및 Docker one-shot 리허설 PASS. 운영 migration/data apply는 Fresh-context 독립 검증과 PR 병합 후에만 수행한다.

## 기준

- 시작 main: `0aad6a9cf5e4268102736ef8405df5e51274115d`
- PR #55 merge: `0aad6a9cf5e4268102736ef8405df5e51274115d`
- 총지휘 요청 모델: GPT-5.6 Sol Pro / high
- 실제 모델 metadata: 확인 불가
- 운영 snapshot: 2026-08-26 08:30 KST 전후
- raw inventory: `C:\Users\USER\Downloads\2026-08-26_preliminary-survey-v2-legacy-inventory.json`
- raw inventory SHA-256: `AE6C2DA0A8B9184240F86EA76D7903A89B935EDC7933EA7E839C8B2056EAD823`
- Docker evidence: `C:\Users\USER\Downloads\2026-08-26_preliminary-survey-v2-legacy-docker-evidence.json`
- Docker evidence SHA-256: `2826D1D1EE1BB3D13A263985D3D26706C3EFF89BC20961900FEAF2F8C653EAB2`
- Docker canonical manifest SHA-256: `3e27f1fae8b1d1a7fdfe41c275449dd402296bf36818cbefcc8d4270767c2900`

Raw production 자료는 Git에 포함하지 않았다.

## Inventory

| 분류 | 건수 |
|---|---:|
| 전체 legacy source | 110 |
| V2_ALREADY_AUTHORITATIVE | 8 |
| PLAN_AND_ASSIGNMENT_EXACT_RECOVERY | 0 |
| PLAN_ONLY_EXACT_RECOVERY | 0 |
| ASSIGNMENT_ONLY_EXACT_RECOVERY | 41 |
| SNAPSHOT_ONLY | 57 |
| NO_RECOVERABLE_SOURCE | 4 |

`preliminary_survey`에는 legacy 예비조사일 컬럼이 실제로 존재하지 않는다. 따라서 예비조사일·방법·plan은 추측 복원하지 않고, 기존 정상 recommended plan의 정확한 공시료 assignment gap 41건만 복원 대상으로 확정했다. 다일 연결은 target 시작일과 `daily_staff[*].date`에 명시된 날짜만 사용하며 날짜 범위를 생성하지 않는다.

## manual_required 예외 12건

- assignment-only exact recovery: H0293 1건
- snapshot-only: H0216, H0098, H0069, H0038, H0182, H0238, H0070, H0257, H0099, H0294, H0521 11건
- plan 복원: 0건

H0293만 기존 정상 V2 recommended plan이 있어 assignment gap을 채울 수 있다. 나머지는 legacy 예비조사일과 survey method가 없어 active plan을 생성하지 않는다.

## 저장 구조 및 안전 경계

- 신규 forward-only migration으로 raw reconciliation table과 assignment provenance를 추가한다.
- 일반 V2 assignment는 `assignment_origin=v2`, 복원 행은 `legacy_reconciled`로 분리한다.
- FF 5건, GG 2건은 raw snapshot에 원문 그대로 보존한다. active assignment에는 현재 `users.survey_code` F/G를 사용한다.
- one-shot RPC는 manifest SHA, source hash, exact target key, exact user mapping, expected count를 DB에서 재검산한다.
- 일반 true-confirmed lock은 유지하며 one-shot SECURITY DEFINER 내부 transaction에서만 제한적으로 repair flag를 사용한다.
- PUBLIC/anon/authenticated 함수 실행 권한은 제거하고 service_role에만 부여한다.
- rollback은 audit를 삭제하지 않고 batch assignment만 제거하며 `rolled_back` 상태를 남긴다.

## 표시 우선순위

1. 일반 V2 assignment
2. legacy reconciled assignment의 raw historical measurer/code
3. reconciliation raw snapshot
4. 찐확정 live legacy fallback
5. 원천 없음 `-`

API는 `mainMeasurerSource`로 내부 source를 진단할 수 있다. 운영 `/survey` 완료 기준은 공시료 이름과 코드 원천이 존재하는 대상의 `측정자(공시료) = '-'` 건수 0이다. Docker 검증 결과는 0이었다.

## Docker 리허설

- 시작 fixture: 0
- migration: fresh 적용 PASS
- manifest: 110
- one-shot assignment insert: 41
- reconciliation audit: 110
- 기존 V2 assignment 8행 변경: 0
- legacy source 변경: 0
- true-confirmed 일반 write guard: PASS
- FF/GG raw 보존: PASS
- expected/actual mismatch: 0
- 공시료 원천 존재 `-`: 0
- 2회차 additional changes: 0
- 2회차 assignment digest 변경: 0
- rollback assignment delete: 41
- rollback 후 audit 보존: 110
- 종료 fixture: 0

## 검증

- focused reconciliation/display: 12/12 PASS
- 전체 `npm test`: 478/478 PASS
- `npx tsc --noEmit --pretty false`: PASS
- `npm run build`: PASS
- `git diff --check`: PASS

## 운영 반영 결과

PR 병합, Production migration, one-shot apply, UI 전수검증 및 Fresh-context verifier 결과는 실행 완료 후 이 절에 최종 기록한다.
