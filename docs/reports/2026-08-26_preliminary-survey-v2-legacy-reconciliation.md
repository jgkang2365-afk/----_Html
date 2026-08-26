# 예비조사 V2 기존 입력 역산·운영 복원

## 판정

운영 역산 복원 및 사후검증 PASS. 정확히 역산 가능한 assignment gap만 one-shot으로 복원했고, 원본 legacy/V2 값은 변경하지 않았다.

## 기준

- 시작 main: `0aad6a9cf5e4268102736ef8405df5e51274115d`
- PR #55 merge: `0aad6a9cf5e4268102736ef8405df5e51274115d`
- reconciliation PR #56 merge: `487d0db14e0d60baeddc7bc66824b89600503788`
- canonical ID 보완 PR #57 merge: `4b933a5045433398119bba35e659c8d372c1af7f`
- 총지휘 요청 모델: GPT-5.6 Sol Pro / high
- 실제 모델 metadata: 확인 불가
- 운영 snapshot: 2026-08-26 08:30 KST 전후
- raw inventory: `C:\Users\USER\Downloads\2026-08-26_preliminary-survey-v2-legacy-inventory.json`
- raw inventory SHA-256: `AE6C2DA0A8B9184240F86EA76D7903A89B935EDC7933EA7E839C8B2056EAD823`
- Docker evidence: `C:\Users\USER\Downloads\2026-08-26_preliminary-survey-v2-legacy-docker-evidence.json`
- Docker evidence SHA-256: `042926283983DB20A30EBA981E7CD5A5E598AB64ED33F172F40EF023AC81514F`
- Docker/운영 canonical manifest SHA-256: `9454ec18fc3a910754c219e58afe0deb0df32c08a86b5e53bbd73b3f6331ceb0`
- 운영 pre-apply evidence SHA-256: `68E1E13FFF529769835E2B26DD9827F55065E39AF4DDE4D5D0252A16C4D41194`
- 운영 apply evidence: `C:\Users\USER\Downloads\2026-08-26_preliminary-survey-v2-legacy-production-apply.json`
- 운영 apply evidence SHA-256: `5185B39001A40DBF2EB545FE3716BDCDAA17AB55EFF99253EBDFCC90A66AA863`
- 운영 post-verify evidence: `C:\Users\USER\Downloads\2026-08-26_preliminary-survey-v2-legacy-production-postverify.json`
- 운영 post-verify evidence SHA-256: `C994971475052DD2D2550E3EC29A49AEFBEF7C24279A22FD2C78A156C22D04D9`
- 운영 2회차 evidence: `C:\Users\USER\Downloads\2026-08-26_preliminary-survey-v2-legacy-production-second-run.json`
- 운영 2회차 evidence SHA-256: `01F7E736CCBB9DB04F5D0A022BCD2A1D33532D76F5B6B63124A2F6ECB506E9D3`

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

- focused reconciliation/display: 15/15 PASS
- 전체 `npm test`: 478/478 PASS
- `npx tsc --noEmit --pretty false`: PASS
- `npm run build`: PASS
- `git diff --check`: PASS

## 운영 반영 결과

- batch ID: `7ecbc1be-587c-4f82-8eb2-4a1669a8cd45`
- forward-only migration: 적용 PASS
- reconciliation audit insert: 110
- assignment insert: 41
- V2 plan: 49 → 49 (변경 0)
- V2 assignment: 8 → 49 (`v2` 8 유지, `legacy_reconciled` 41 추가)
- 기존 V2 assignment overwrite: 0
- legacy `preliminary_survey` source digest 변경: 0
- protected write: 0
- FF/GG raw 원문: FF 5, GG 2 보존
- expected/actual mismatch: 0
- 동일 manifest 2회차 additional changes: 0 (`alreadyReconciled=110`)
- 2회차 assignment count: 49 → 49, full-row digest 변경: 0
- 지시 범위인 측정일 2026-08-01 이후 V1 `recommended_date` non-null: 0

## 운영 표시 전수검증

- 공시료 이름과 코드 원천이 존재하는 legacy 행: 98
- 원천 존재 행 중 `/survey` 표시 `-`: **0**
- 실제 원천이 없는 행: 12 (`-` 허용)
- 찐확정 기준 8건 expected/actual mismatch: 0
- 신규 V2 6건 expected/actual mismatch: 0
- H0102 다일 2026-09-14/15/16 assignment 모두 `이태환(A)` 확인

표시 검증은 운영 DB의 실제 plan → target ID → 날짜별 assignment와 reconciliation snapshot을 API 표시 우선순위와 동일하게 READ-ONLY로 전수 대조했다. 브라우저 자동화 런타임 제약으로 로그인된 화면 픽셀 검증은 수행하지 못했으나, Production 배포 성공과 화면 API의 모든 표시 원천/결과값을 검증했다.

## 배포 및 독립 검증

- PR #55, #56, #57: merge 완료
- 각 Production deployment: success
- Fresh-context GPT-5.6 Sol / high 독립 검증: PASS
  - exact route semantics 기준 source-backed 98 / `-` 0
  - legacy 8 / 신규 V2 6 mismatch 0
  - 2회차 0/110/insert 0 및 assignment full-row digest 불변
  - 로그인 화면 픽셀 자동화만 런타임 제약으로 미수행(운영 DB/API 표시 데이터 검증에는 영향 없음)
