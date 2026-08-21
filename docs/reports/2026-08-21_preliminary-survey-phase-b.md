# 예비조사 Phase B 구현·PR #42 보완 보고서

## Git 기준

- 시작 main SHA: `555ae773484bd1533d4b0d252f0fa12592e93ebe`
- 작업 branch: `feature/preliminary-survey-phase-b`
- PR #42 보완 시작 head SHA: `52f214a58f929df5105c39b84c1178d8ff32ad5d`
- 추천 기간 UI 단순화 최종 구현 head SHA: `d156e90fb4f69ed8edf23bd134d332b00132cdfb`
- 추천 기간 UI 단순화 최종 구현 commit SHA: `d156e90fb4f69ed8edf23bd134d332b00132cdfb`
- PR #42 구현 head SHA: `d156e90fb4f69ed8edf23bd134d332b00132cdfb`
- PR: #42 `feat: rebuild preliminary survey planning workflow` (Draft 유지, merge하지 않음)

보고서 자체를 반영하는 Git commit은 자신의 SHA를 파일 안에 미리 기록할 수 없으므로, 위 값은 최종 구현 commit 기준이다. 보고서 반영 후 실제 PR head는 PR 메타데이터와 완료 보고에 별도로 기록한다.

## 주요 변경 파일

- `app/api/preliminary-survey-v2/workbench/route.ts`
- `components/features/PreliminarySurveyV2Plans.tsx`
- `lib/preliminary-survey-v2/calendar.ts`
- `lib/preliminary-survey-v2/manual-validation.ts`
- `lib/preliminary-survey-v2/measurement-staff.ts`
- `lib/preliminary-survey-v2/measurement-conflicts.ts`
- `lib/preliminary-survey-v2/recommendation-range.ts`
- `tests/preliminary-survey-phase-b.test.ts`
- `tests/preliminary-survey-recommendation-range.test.ts`
- `tests/preliminary-survey-v2-stale-source-sqlstate.test.ts`

## 탭·계획·목록 UI

- 기본 탭 순서 `계획 → 목록 → 검색 → 제외 일정`, HTML5 drag & drop, localStorage 복원, 오류 fallback, 누락 탭 보완, 기본 순서 복원을 유지했다.
- 계획 화면은 카드 목록 없이 12개 필수 컬럼 테이블만 사용한다.
- 계획 상단 기본 필터와 액션을 compact toolbar로 구성하고, 추천 조건 보완 후에도 데스크톱 최대 2행과 액션 우측 정렬을 유지했다.
- 목록 상단은 연도·반기·상태·구분·예비조사일·측정예정일·조사자·방식 8개 필터를 데스크톱 한 줄에 배치하고 좁은 화면에서만 줄바꿈한다.
- 목록은 최초실시·타기관 신규·기존업체를 같은 workbench source-of-truth에서 통합 조회하며, 업체 상세의 수동 수정·개별 재추천 UI를 유지한다.

## 추천 기간·사업장 다중 선택 보완

- 계획 toolbar에서 `없음 / 일자 / 기간` mode와 `이번 주` 버튼을 제거하고 시작일·종료일을 항상 표시한다. 시작일과 종료일이 같으면 하루, 시작일이 더 빠르면 해당 기간 추천으로 동일하게 처리한다.
- 시작일을 직접 바꾸면 종료일도 즉시 같은 값으로 맞추며 이후 종료일은 자유롭게 변경할 수 있다. 두 날짜 중 하나가 비었거나 종료일이 시작일보다 빠르면 명확한 안내와 함께 추천 요청을 클라이언트에서 차단한다.
- 오렌지색 `다음 주` 버튼만 보조 기능으로 유지했다. 시작일이 있으면 그 날짜가 속한 주, 없으면 현재 KST 날짜가 속한 주를 기준으로 다음 월요일~금요일을 입력한다. UTC 문자열 절단은 사용하지 않으며 공휴일 제외는 기존 추천 엔진의 워킹데이 필터가 담당한다.
- `preliminaryDateFrom`/`preliminaryDateTo`는 기존 `measurementDateFrom`/`measurementDateTo`와 분리했다. 엔진은 업체별 날짜 후보를 먼저 만든 뒤 사용자가 지정한 예비조사일 범위와 교차하므로 후보 규칙 밖 날짜를 강제 배정하지 않는다.
- 추천 요청은 별도 mode 없이 항상 입력된 `preliminaryDateFrom`과 `preliminaryDateTo`를 전달한다. 요일 선택·반복 추천 기능은 추가하지 않았다.
- 코드와 사업장명을 정확·부분 검색할 수 있고 쉼표·줄바꿈으로 여러 검색어를 함께 사용할 수 있다. 표 checkbox로 여러 업체를 선택하며 개별 해제, 표시 결과 전체 선택, 전체 해제를 제공한다.
- 검색어 변경은 선택을 해제하지 않는다. 선택 대상이 있으면 `선택 사업장 ∩ 연도/반기/상태/구분 필터 ∩ 예비조사일 범위`, 선택 대상이 없으면 `현재 필터 대상 ∩ 예비조사일 범위`만 추천한다.
- 추천 생성 후 날짜 범위, 대상 수, 추천 생성 수, 추천 불가 수를 표시한다. 날짜·필터·사업장 선택을 바꾸면 기존 draft를 초기화하거나 apply를 비활성화해 이전 scope의 draft 오적용을 막는다.
- apply 경로는 이 보완에서도 추천 엔진을 다시 실행하지 않고 사용자가 본 동일 draft만 기존 lock/stale/hard constraint 규칙으로 재검증한다.

## 날짜 추천 정책

- 추천 시작점은 `measurement_target_business.measurement_date`다.
- 최초실시는 기존대로 `-3 → -4 → -5 → 더 이전 영업일` 순서를 유지한다.
- 타기관 신규는 `-30 → -29 → -28 → … → -3 영업일` 순서로 측정일 쪽을 먼저 탐색하고, 이 범위가 불가능할 때만 `-31 → … → -60`을 보조 후보로 사용한다.
- 주말과 2025~2027 공휴일 snapshot을 후보에서 제외한다.
- 기존업체는 현장·유선 방식을 지원하고 단일 추천 엔진의 기존 유연한 후보 정책을 사용한다.

## 추천 엔진과 preview/apply 동일성

- 전체/기간과 업체별 추천은 같은 `recommendBatch` 엔진을 사용하고 scope만 달리한다.
- `추천 생성`은 SELECT 기반 계산 결과를 브라우저 메모리 draft로만 만들며 DB를 변경하지 않는다.
- apply 요청은 target ID만 보내지 않고 사용자가 본 draft의 예비조사일, 조사자 ID·이름, 방식, 측정계획·연계측정자·분류 snapshot을 전달한다.
- apply 서버 경로는 추천 엔진을 다시 실행하지 않는다. 제출 draft를 대상으로 다음을 재검증한 후 동일 날짜·동일 조사자·동일 방식을 atomic batch RPC에 전달한다.
  - 유효한 `measurement_journal` row 잠금
  - 측정예정일, 보고서 담당 snapshot, 연계측정자, 업체 구분 stale 여부
  - 조사자 ID·이름·활성 상태, 제외 일정, 같은 날 측정 업무
  - 경력, 날짜 범위, 업무량, 같은 날짜 다른 draft, 신규 2건 차량 경로 hard rule
- stale/lock/hard conflict 또는 저장 직전 RPC source 충돌이면 다른 안을 계산·저장하지 않고 HTTP 409 `DRAFT_REVIEW_REQUIRED`를 반환한다. 클라이언트 draft는 `재검토 필요`로 표시한다.
- 저장 성공 응답에는 서버가 적용한 제출 draft를 반환해 preview와 저장 대상의 비교가 가능하다.

## 업체별 재추천과 minimum-change

- 업체별 재추천은 target scope로 같은 엔진을 호출하며 자동 저장하지 않는다.
- 기존 plan은 existing assignment로 유지하고 같은 날짜·관련 조사자·업무량·경력·동선 제약만 재검증한다.
- apply에서도 문제없는 기존 plan을 재계산하지 않고 제출된 변경 대상만 batch upsert하므로 다른 업체를 자동 덮어쓰지 않는다.

## daily_staff source-of-truth

- workbench 표시는 해당 사업장의 `measurement_date`와 일치하는 `daily_staff` entry를 먼저 선택한다.
- `main_measurer_id`/`helper_ids`를 사용자 이름으로 변환하며, 현재 저장 데이터의 기존 필드명 `measurer_id`/`collaborators`도 같은 날짜 entry 안에서 호환한다.
- 일치하는 `daily_staff`가 없을 때만 사업장 `collaborators`를 legacy fallback으로 표시한다. collaborators에는 역할 정보가 없으므로 첫 사람을 메인측정자로 간주하지 않는다.
- `measurement_target_business.measurer_id`는 계속 보고서 담당자로 별도 표시한다.

## 실제 측정 인력 충돌 판정 최종 보완

- preview 공통 추천 계산과 apply 직전 재검증이 같은 `loadActualMeasurementBlockedKeys` 판정기를 사용한다.
- 예비조사 후보일과 정확히 같은 `daily_staff` entry의 `main_measurer_id`와 `helper_ids`만 새 구조의 실제 측정 참가자로 차단한다.
- 다일 측정은 다른 날짜 entry의 인원을 현재 날짜 충돌로 확장하지 않는다.
- 기존 `daily_staff.measurer_id`는 보고서 담당자이므로 unavailable 판정에서 제외한다. 기존 `daily_staff.collaborators`는 같은 날짜의 실제 측정자 목록으로만 fallback한다.
- `daily_staff`가 없는 legacy 경로는 사업장 `collaborators` 및 `preliminary_survey.actual_measurer`만 사용한다. `report_writer`는 조회·차단 대상에서 제거했다.
- apply는 이 재검증 결과가 제출 draft와 충돌하면 다른 조사자를 재추천하거나 저장하지 않고 기존 409 `DRAFT_REVIEW_REQUIRED` 흐름을 유지한다.

## 상태 모델

- 미추천: plan 없음
- 추천: 브라우저 메모리 임시 draft
- 조정 필요: hard constraint를 만족하는 추천 없음
- 가확정: 사용자가 적용하거나 수동 저장한 manual plan
- 재검토 필요: source 변경, 구형 automatic plan 또는 apply 재검증 실패
- 찐확정: 해당 code/year/period의 유효한 `measurement_journal` row 존재
- Phase B workbench의 찐확정 판정에는 `sequence_number`를 사용하지 않으며 일반 수정·재추천을 차단한다.

## 기존 V2·정책·DB 보호

- 기존 `preliminary_survey_v2_plans`, service/API/audit, admin repair, legacy sync를 삭제하거나 대체하지 않았다.
- 기존 automatic plan은 자동 승인하지 않고 재검토 대상으로 유지한다.
- target-save 자동생성/자동추천을 복원하지 않았고, 정책 미존재 시에도 `PROCESS_CHANGED_POLICY_OFF.enabled = false`로 차단하는 기존 PAUSE gate를 유지했다.
- `MeasurementTargetBusinessManagement.tsx`에 예비조사 작업 UI를 추가하지 않았다.
- 예비조사 경로 순서와 측정 경로 순서를 혼용하지 않았다.
- schema/migration 변경 없음. 운영 DB INSERT/UPDATE/DELETE 또는 migration 적용 없음.
- 브라우저 검증 중 추천안 적용·수동 저장을 실행하지 않아 운영 V2 데이터 변경 없음.

## 테스트 결과

- `npx tsc --noEmit`: 통과
- Phase B 및 V2 집중 회귀 묶음: 126/126 통과
- 신규 회귀에는 시작일→종료일 자동 동기화, 필수값·역전 범위 차단, 시작일과 현재 KST 각각을 기준으로 한 다음 주 월~금 계산, UTC/KST 날짜 경계, 하루·기간 후보 교집합, 선택 `targetIds`와 날짜 범위의 동시 적용, 선택·scope 변경 후 draft 적용 차단, apply 재계산 금지를 포함했다.
- `npm test`: 362/362 통과
- `npm run build`: 통과 (`Compiled successfully`, static pages 69/69)
- 최종 보완 신규 회귀에는 report writer 비차단, 날짜별 main/helper 차단, 다일 exact-date 판정, legacy `actual_measurer` fallback을 포함했다.
- 참고로 표준 스크립트 밖의 모든 `preliminary-survey*.test.ts` 역사 테스트를 추가 실행한 결과 281개 중 278개가 통과했고, Phase B 이전 화면·SQL 문자열을 전제로 한 구형 assertion 3개(`v2-3a-ui`, `v2-persist-source-fix`, `v2-plans`)는 현재 통합 UI/정책과 불일치해 실패했다. 제품 코드나 migration을 이 구형 assertion에 맞춰 되돌리지 않았다.
- Windows CRLF 환경에서 기존 stale-source SQL 문자열 테스트 1건이 LF만 허용해 최초 실패했고, 동작 코드나 migration을 바꾸지 않고 정규식을 `\r?\n`으로 보완한 뒤 통과했다.
- 최종 빌드 전 3000번 dev 프로세스만 종료해 `.next` 잠금을 피했고 저장소에서 직접 build를 통과시켰다. 이후 같은 `npm run dev:turbo`와 3000번 포트로 복구해 `/survey` 정상 로드를 재확인했다.

## Orca 브라우저 실제 검증

- 기존 Orca 탭 `http://localhost:3000/survey`, viewport 1399px에서 작업 중간부터 실제 DOM과 상호작용을 확인했다.
- 계획 toolbar: 한 행, 필터 좌측·액션 우측, card scrollWidth/clientWidth 동일.
- 목록 toolbar: 8개 필터의 top 좌표가 모두 동일한 한 행.
- 계획 테이블: 검증 폭에서 컨테이너 `clientWidth=1286`, `scrollWidth=1286`으로 불필요한 가로 스크롤 없음.
- 탭 기본 순서 확인, `사업장 검색` drag & drop 이동, 새로고침 후 이동 순서 유지, `기본 순서로 복원` 후 기본 순서 복귀 확인.
- `대안 보기` 안내 동작 확인.
- 찐확정 행 상세에서 잠금 안내와 재추천·수동 저장 버튼 disabled 확인.
- 미추천 행 상세에서 예비조사일·방식 수정 필드와 업체별 재추천 버튼 활성 상태 확인. 저장은 실행하지 않았다.
- `/businesses` 실제 화면에서 예비조사 상태·추천·재추천·적용·예비조사자·묶음추천 UI 문구가 없음을 확인했다.
- 최종 인력 충돌 보완 후에도 `/survey` 계획 toolbar와 목록 8개 필터 toolbar가 한 행을 유지했고, 두 테이블 모두 검증 viewport에서 `clientWidth=scrollWidth=1132`로 레이아웃 깨짐이 없음을 재확인했다.
- 최종 보완 후 현재 비관리자 세션에서 `추천 생성` 요청이 다시 403으로 차단됨을 확인했다. 안전한 관리자 환경이 없어 apply 성공 E2E와 DB write는 실행하지 않았다.
- Orca screenshot은 브라우저 창 focus 문제로 timeout됐으나, 같은 연결의 실제 페이지에서 DOM 좌표·클릭·drag/drop·reload 결과는 정상 수집했다.
- 추천 범위·다중 선택 보완은 1550px Orca 브라우저에서 계획 toolbar가 약 117px 높이의 2행이며, 테이블 컨테이너 폭 1526px에서 가로 스크롤이 비활성임을 확인했다.
- `H0205` 코드 정확 검색은 2행, `그린자동차` 사업장명 부분 검색은 4행이 표시됐다. 검색어를 바꾼 뒤에도 선택 1건이 유지됐고, 표시 대상 전체 선택 4건, 개별 해제 후 3건, 전체 해제 후 0건을 확인했다.
- 최종 UI에서 `없음 / 일자 / 기간` mode가 사라지고 시작일·종료일이 항상 노출되며, 오렌지 `다음 주` 버튼과 최대 2행 toolbar를 확인했다. 검증 viewport에서 toolbar와 테이블 모두 `clientWidth=scrollWidth`로 불필요한 가로 스크롤이 없었다.
- 시작일 `2026-08-19` 또는 `2026-08-21`을 입력하면 종료일이 같은 날짜로 자동 설정됐고, `다음 주` 클릭 결과는 모두 `2026-08-24 ~ 2026-08-28`이었다. 시작일이 빈 상태에서도 현재 KST `2026-08-21` 기준으로 같은 범위가 입력됐다.
- 종료일이 시작일보다 빠른 경우와 두 날짜가 빈 경우 각각 지정된 오류 문구가 표시되고 추천 요청이 차단됨을 확인했다. 이 검증에서는 추천 적용·수동 저장을 실행하지 않았다.
- `H0205` 선택 후 검색어를 `그린자동차`로 바꿔도 선택 1건이 유지됐으며, 검증 후 선택과 검색 조건을 모두 초기화했다.
- 브라우저 worker는 자신의 터미널에서 `Browser is not available: iab`로 실패했으나, 메인 작업자가 같은 Orca 내장 브라우저 탭에 재연결해 위 검증을 완료했다.

## 브라우저 미완료 항목과 사유

- 현재 Orca 로그인 세션은 관리자 계정이 아니어서 상단 추천 생성과 업체별 재추천 요청이 서버 403 `관리자만 추천안을 생성·적용할 수 있습니다.`로 차단됐다.
- 따라서 실제 draft 생성, draft 기반 대안 상세, 성공 apply, preview와 저장 row의 실DB 동일성은 브라우저에서 완료하지 않았다.
- 안전한 관리자 테스트 대상과 권한이 확인되지 않은 상태에서 계정 전환, 추천안 적용, 수동 저장을 강행하지 않았다.
- 위 저장 경계는 코드 경로, Phase B 테스트, stale-source/atomic batch 회귀로 검증했지만 관리자 브라우저 end-to-end 확인은 남아 있다.

## 알려진 제한사항

- 관리자 권한의 안전한 테스트 데이터 환경에서 `추천 생성 → 업체별 재추천 → 추천안 적용` 성공 흐름과 실제 저장값 동일성을 추가 확인해야 한다.
- 실제 외부 차량 경로 API 응답을 사용하는 운영 데이터 조합은 이번 브라우저 검증에서 실행하지 않았다.
- 찐확정 관리자 정비는 기존 admin repair 경로를 유지하며 일반 작업대 모달에서는 제공하지 않는다.

## 남은 TODO

- 관리자 권한과 안전한 테스트 대상을 준비해 preview/apply 성공 E2E를 완료한다.
- 새 시스템 안정화 후 별도 Phase에서 기존 V2 plan을 `automatic / manual / 실제 사용·확정 / 미사용 구형`으로 분류한다.
- 각 분류별 유지·마이그레이션·archive·삭제 여부를 결정한다.
- 새 시스템 안정화 확인 전 구형 V2 데이터를 삭제하지 않는다.

## 모델별 작업 수행 현황

| 모델 | 추론 강도 | 수행 작업 | 결과/반영 여부 | 실행/사용량 |
| --- | --- | --- | --- | --- |
| GPT-5.6 Sol | Medium | 메인 통합, 요구사항·diff 검토, 검색/선택 scope 경계 보완, 전체 테스트·빌드, 보고서·Git/PR 작업 | 실제 수행 결과 반영 | 주 작업자 1세션, 토큰/credits 확인 불가 |
| GPT-5.6 Terra | Medium | UI·scope state·다중 검색/선택 구현 worker | 메인 검토 후 반영 | worker 1회, 토큰/credits 확인 불가 |
| GPT-5.6 Terra | High | 추천 엔진의 `preliminaryDate` 후보 교집합, API 검증, 회귀 테스트 worker | 메인 검토 후 반영 | worker 1회, 토큰/credits 확인 불가 |
| GPT-5.6 Terra | Medium | Orca 실제 브라우저 검색·다중 선택·레이아웃 검증 및 기간 scope 안정 재검증 | 검증 결과 반영, 코드 변경 없음 | worker 2회, 토큰/credits 확인 불가 |
| GPT-5.6 Terra | Medium | 추천 mode 제거, 시작일·종료일 UI/state, 오렌지 `다음 주` 버튼 구현 | 메인 검토 후 반영 | 이번 보완 UI worker 1회, 토큰/credits 확인 불가 |
| GPT-5.6 Terra | Medium | KST 다음 주 계산 함수와 날짜 검증 회귀 테스트 구현 | 메인 검토 후 반영 | 이번 보완 계산/테스트 worker 1회, 토큰/credits 확인 불가 |
| GPT-5.6 Terra | Medium | 이번 보완 Orca 브라우저 검증 시도 | `Browser is not available: iab`로 중단, 메인 작업자가 재검증 완료 | 이번 보완 브라우저 worker 1회, 토큰/credits 확인 불가 |
| GPT-5.6 Luna | - | 미사용 | 미반영 | 0회 |

- Orca Run `run_a53b8bcb30b3`에서 구현, 엔진/테스트, 브라우저 검증을 하위 worker로 분담했다.
- Orca Run `run_76c26c41accf`에서 이번 추천 기간 UI 보완을 UI, KST 계산/테스트, 브라우저 검증 worker로 분담했다.
- 모델별 토큰·credits는 이 세션에서 확인할 수 없어 추정하지 않았다.
