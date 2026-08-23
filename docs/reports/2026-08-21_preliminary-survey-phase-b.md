# 예비조사 Phase B 구현·PR #42 보완 보고서

## Git 기준

- 시작 main SHA: `555ae773484bd1533d4b0d252f0fa12592e93ebe`
- 작업 branch: `feature/preliminary-survey-phase-b`
- PR #42 보완 시작 head SHA: `52f214a58f929df5105c39b84c1178d8ff32ad5d`
- 측정예정일 검색 scope 최종 구현 head SHA: `fbd451c81187f87c74dac948a3074b237451a27f`
- 측정예정일 검색 scope 최종 구현 commit SHA: `fbd451c81187f87c74dac948a3074b237451a27f`
- PR #42 구현 head SHA: `fbd451c81187f87c74dac948a3074b237451a27f`
- 원천 데이터 검증 시작 head SHA: `5dbf55b5fd6b781883174ccab0cc87e031ec6d53`
- 최종 정책 정렬 시작 head SHA: `c3ef18a4a413aa4ae2d629abaf7885913f72a175`
- 최종 정책 정렬 확인 origin/main SHA: `74c5366fc9f012081bf7fe9a78e0cd74a0f7150b`
- 최종 정책 정렬 구현 commit SHA: `7eff489fc032aac550e9b7c406ffd96aa220c051`
- PR: #42 `feat: rebuild preliminary survey planning workflow` (Draft 유지, merge하지 않음)

보고서 자체를 반영하는 Git commit은 자신의 SHA를 파일 안에 미리 기록할 수 없으므로, 위 값은 최종 구현 commit 기준이다. 보고서 반영 후 실제 PR head는 PR 메타데이터와 완료 보고에 별도로 기록한다.

## 주요 변경 파일

- `app/api/preliminary-survey-v2/workbench/route.ts`
- `components/features/PreliminarySurveyV2Plans.tsx`
- `app/survey/page.tsx`
- `lib/preliminary-survey-v2/calendar.ts`
- `lib/preliminary-survey-v2/manual-validation.ts`
- `lib/preliminary-survey-v2/measurement-staff.ts`
- `lib/preliminary-survey-v2/measurement-conflicts.ts`
- `lib/preliminary-survey-v2/recommendation-range.ts`
- `lib/preliminary-survey-v2/workbench-search.ts`
- `tests/preliminary-survey-phase-b.test.ts`
- `tests/preliminary-survey-recommendation-range.test.ts`
- `tests/preliminary-survey-workbench-search.test.ts`
- `tests/preliminary-survey-v2-stale-source-sqlstate.test.ts`

## 탭·계획·목록 UI

- 기본 탭 순서 `계획 → 목록 → 검색 → 제외 일정`, HTML5 drag & drop, localStorage 복원, 오류 fallback, 누락 탭 보완, 기본 순서 복원을 유지했다.
- 계획 화면은 카드 목록 없이 12개 필수 컬럼 테이블만 사용한다.
- 계획 상단 기본 필터와 액션을 compact toolbar로 구성하고, 추천 조건 보완 후에도 데스크톱 최대 2행과 액션 우측 정렬을 유지했다.
- 계획 화면에도 명시적 `검색` 버튼과 검색 snapshot을 적용했다. 연도·반기·상태·구분·코드·사업장명 입력을 바꾼 동안에는 기존 검색 결과를 유지하고 추천·대안·적용 버튼을 잠그며, `검색` 실행 후 결과를 새 scope로 확정한다.
- 계획 추천 대상은 검색 결과 전체 또는 `검색 결과 ∩ 선택 사업장`만 사용한다. 화면에는 보이지 않는 검색 전 행이나 선택했지만 현재 검색 결과 밖인 사업장을 추천 요청에 포함하지 않는다.
- 추천 완료 문구는 임시 draft 수를 추천 성공으로 오해하지 않도록 `추천 n개 · 조정 필요/불가 n개`로 구분했다. 적용 가능한 추천 draft가 없으면 `추천안 적용`을 비활성화한다.
- 목록 상단 조사자 검색 필터를 제거하되 테이블의 `예비조사자` 컬럼은 유지했다. 연도·반기·상태·구분·예비조사일·측정예정일·방식과 `코드 · 사업장명`, 명시적 `검색` 버튼을 compact toolbar에 배치했다.
- 코드·사업장명 검색은 대소문자와 공백을 정규화하며 정확·부분 일치, 쉼표·줄바꿈 다중 검색을 OR 조건으로 지원한다.
- 목록의 연도·반기와 모든 필터·검색어는 입력 중 draft 상태로 유지하고 `검색`을 누른 시점의 snapshot으로 조회·표시 조건을 함께 확정한다.
- 목록은 최초실시·타기관 신규·기존업체를 같은 workbench source-of-truth에서 통합 조회하며, 업체 상세의 수동 수정·개별 재추천 UI를 유지한다.
- 앱 Header 아래 예비조사 제목·탭을 `top-16`, 계획·목록 toolbar를 `top-28` sticky 계층으로 고정했다. 두 테이블은 동일한 세로·가로 scroll container 안에서 header를 `top-0`으로 고정해 body와 컬럼 폭을 공유하며, toolbar 아래에서 겹치지 않게 했다.

## 측정예정일 범위·사업장 다중 선택 보완

- 계획 toolbar의 날짜는 최종 정책에 따라 `측정 시작일`·`측정 종료일`로 표시하고 `measurement_target_business.measurement_date` 검색 범위로 사용한다. 같은 날짜면 하루, 시작일이 더 빠르면 해당 측정예정 기간을 조회한다.
- 측정 시작일을 직접 바꾸면 종료일도 같은 값으로 맞추며 이후 종료일은 자유롭게 변경할 수 있다. 두 날짜 중 하나가 비었거나 종료일이 시작일보다 빠르면 검색과 추천을 차단한다.
- 오렌지색 `다음 주` 버튼은 측정예정일 검색 범위를 다음 월요일~금요일로 입력한다. 시작일이 있으면 그 날짜가 속한 주, 없으면 현재 KST 날짜가 속한 주를 기준으로 계산한다.
- 검색 snapshot과 workbench 추천 API 양쪽에서 `measurementDateFrom`/`measurementDateTo`를 검증하고 측정예정일 범위 밖 target을 제외한다.
- 이 측정예정일 범위를 `preliminaryDateFrom`/`preliminaryDateTo`로 재사용하지 않는다. 검색된 업체의 예비조사일은 측정예정일에서 유형별 규칙으로 역산해 추천 엔진이 자동 계산한다.
- 코드와 사업장명을 정확·부분 검색할 수 있고 쉼표·줄바꿈으로 여러 검색어를 함께 사용할 수 있다. 표 checkbox로 여러 업체를 선택하며 개별 해제, 표시 결과 전체 선택, 전체 해제를 제공한다.
- 검색어 변경은 선택을 해제하지 않는다. 선택 대상이 있으면 `선택 사업장 ∩ 연도/반기/상태/구분 필터 ∩ 측정예정일 범위`, 선택 대상이 없으면 `현재 필터 대상 ∩ 측정예정일 범위`만 추천한다.
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
- Phase B 및 V2 집중 회귀 묶음: 135/135 통과
- 신규 검색 helper: 쉼표·줄바꿈 분리와 중복 제거, 코드 정확·부분 검색, 사업장명 정확·부분 검색, 다중 OR 검색, 검색 결과와 선택 대상 교집합, 측정예정일 범위 경계 6/6 통과
- 신규 회귀에는 측정 시작일→종료일 자동 동기화, 필수값·역전 범위 차단, 현재 KST 기준 다음 주 월~금 계산, 측정예정일 시작·종료 경계 포함, 범위 밖 및 null 측정일 제외, `targetIds`와 측정예정일 범위 동시 적용, scope 변경 후 draft 적용 차단을 포함했다.
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
- 이번 목록 검색·sticky 최종 보완에서는 메인 작업자가 Orca 인앱 브라우저 런타임 재연결과 가용 브라우저 목록 조회를 다시 수행했으나 `Browser is not available: iab`, 가용 목록 `[]`가 반환됐다. 따라서 이번 변경분의 조사자 필터 제거, 검색 snapshot, 세로·가로 스크롤 위치는 새 브라우저 세션에서 실제 재검증했다고 기록하지 않는다.
- 계획 검색·추천 scope 최종 보완에서도 자동 연결 가능한 브라우저가 없어 검색 버튼 클릭 전후, 추천 버튼 잠금, 검색 결과 건수 표시는 브라우저에서 재검증하지 못했다. 개발 서버는 build 후 같은 `npm run dev:turbo`와 3000번 포트로 복구했다.
- 측정예정일 범위 최종 보완은 사용자가 제공한 화면에서 기존 날짜와 무관하게 335건이 표시되는 문제를 확인한 뒤 수정했다. 자동 브라우저 연결은 여전히 없어 변경 후 실제 클릭 검증은 완료했다고 기록하지 않으며, 3000번 개발 서버에서 사용자가 새로고침해 확인할 수 있다.

## 브라우저 미완료 항목과 사유

- 현재 Orca 인앱 브라우저 런타임에 연결 가능한 브라우저가 없어 이번 목록 검색·sticky 변경분의 실제 스크롤 전후 DOM 좌표 검증은 미완료다. 소스 구조와 정적·함수 테스트로는 검증했으나 브라우저 검증을 대체하지 않는다.
- 현재 Orca 로그인 세션은 관리자 계정이 아니어서 상단 추천 생성과 업체별 재추천 요청이 서버 403 `관리자만 추천안을 생성·적용할 수 있습니다.`로 차단됐다.
- 따라서 실제 draft 생성, draft 기반 대안 상세, 성공 apply, preview와 저장 row의 실DB 동일성은 브라우저에서 완료하지 않았다.
- 안전한 관리자 테스트 대상과 권한이 확인되지 않은 상태에서 계정 전환, 추천안 적용, 수동 저장을 강행하지 않았다.
- 위 저장 경계는 코드 경로, Phase B 테스트, stale-source/atomic batch 회귀로 검증했지만 관리자 브라우저 end-to-end 확인은 남아 있다.

## 메인측정자·조력자·보고서담당 원천 데이터 검증

### 1. 검증 범위

- 1차 범위: `measurement_target_business.measurement_date >= 2026-08-01` 및 `< 2027-01-01`, 105건.
- 확대 여부: 예. 1차 범위에 `daily_staff`가 있는 3건 모두 구형 `measurer_id/collaborators` 구조였고, `main_measurer_id/helper_ids` 실제 표본과 Case D가 없었다. 지시서의 확대 조건 4·6에 따라 구조 전환과 Case D를 확인하기 위해 `2026-01-01 <= measurement_date < 2027-01-01` 472건까지 확대했다.
- 2025년 이하 데이터는 조회하지 않았다. 확대 조회는 구조·역할 패턴 확인에 필요한 필드만 SELECT했으며 전체 DB dump를 만들지 않았다.
- 운영 DB INSERT/UPDATE/DELETE/UPSERT, migration, V2 plan 변경은 전혀 수행하지 않았다.

### 2. 확인된 데이터 구조와 필드 의미

| 필드 | 확인된 의미 | 근거 |
| --- | --- | --- |
| `measurement_target_business.measurer_id` | 보고서담당 사용자 ID | 측정대상 관리 UI의 `보고서 담당자` 입력, 저장 API가 `preliminary_survey.report_writer`로 변환하는 경로, 실제 사용자 참조 대조 |
| `daily_staff[].measurer_id` | 해당 날짜의 보고서담당 사용자 ID | 다일 UI의 `보고서 담당자` 입력과 저장 API의 `report_writer` 생성 경로. 2026년 36개 entry 모두 상위 `measurer_id`와 불일치 0건 |
| `daily_staff[].collaborators` | 해당 날짜의 실제 측정 참여자 이름 목록. 메인/조력자 역할 구분 없음 | 다일 UI의 `측정자` 복수 선택과 저장 API가 이 목록만 `actual_measurer`로 만드는 경로 |
| 상위 `collaborators` | 단일일 실제 측정 참여자 또는 다일 참여자 요약 이름 목록. 역할 구분 없음 | 단일일 UI의 `조력자 (복수 선택)` 역사 명칭과 현재 API의 실제 측정 인원 처리. 다일 union과 불일치하는 2026년 행 3건이 있어 날짜별 원천으로는 사용할 수 없음 |
| `daily_staff[].main_measurer_id` | 명시적 메인측정자용으로 Phase B 판독 코드가 지원하는 필드 | 실제 2026년 저장 행과 현재 입력 UI/저장 경로에서는 0건. 운영 데이터 의미를 실제 사례로 확인할 수 없음 |
| `daily_staff[].helper_ids` | 명시적 조력자용으로 Phase B 판독 코드가 지원하는 필드 | 실제 2026년 저장 행과 현재 입력 UI/저장 경로에서는 0건. 운영 데이터 의미를 실제 사례로 확인할 수 없음 |

- 2026년 `daily_staff` 사용 사업장은 15건, entry는 36개였고 모든 entry 구조가 `date + measurer_id + collaborators`였다.
- 유효 날짜가 있는 구형 entry는 2026-03-16부터 2026-09-16까지 계속 존재했다. `main_measurer_id/helper_ids` 신형 저장 행은 0건이므로 신형 구조 전환일은 확인할 수 없다.
- 1차 범위의 보고서담당 ID와 측정 참여자 이름은 모두 현재 `users`의 `job = 측정` 사용자와 연결됐다. 잘못된 사용자 참조는 0건이었다.
- `preliminary_survey.actual_measurer`는 legacy 동기화 결과이지만 1차 범위 비교 가능 109개 일자 중 현재 측정대상 참여자와 44건이 달랐다. 현재 목록의 인력 원천을 검증하는 독립 근거로 사용할 수 없으며, 이 검증에서는 `measurement_target_business`를 원천으로 유지했다.

### 3. 확정 가능한 업무 규칙

| Case | 1차 건수 | 2026년 확대 건수 | 판정 | 안전한 표시 규칙 |
| --- | ---: | ---: | --- | --- |
| A: 보고서담당 = 실제 측정자 1명 | 48 | 195 | 확정 | 실제 참여자가 1명이므로 그 사람을 메인측정자로 표시하고 조력자는 없음, 보고서담당은 별도 표시 |
| B: 보고서담당이 실제 참여자 2명 이상에 포함 | 3 | 19 | 판정 불가 | 참여자 목록은 확정할 수 있으나 보고서담당이라는 이유만으로 메인으로 정할 수 없음 |
| C: 보고서담당과 실제 측정자 1명이 다름 | 47 | 81 | 확정 | 유일한 실제 참여자를 메인측정자로 표시하고 조력자는 없음, 보고서담당은 별도 표시 |
| D: 보고서담당이 실제 참여자 2명 이상에 불포함 | 0 | 2 | 판정 불가 | 실제 참여자는 알 수 있으나 그중 메인 역할을 판별할 원천 필드가 없음 |

- Case A 대표: `H0057 우리모터스주식회사`, `H0122 노랑자동차공업사`, `H0515 한국지엠남천안서비스센터 (주)`.
- Case B 1차 전체: `H0063 은진모터스`, `H0077 정림모터스`, `H0260 국립해양생물자원관`.
- Case C 대표: `H0055 남대전서비스기아오토큐 주식회사`, `H0058 산내모터스`, `H0051 이안현대모터스`.
- Case D는 1차 범위에 없었고 확대 범위에서 `H0260 국립해양생물자원관`(2026-04-22), `H0495 구주제약(주)`(2026-06-30) 2건을 확인했다. 두 건 모두 메인 역할 판별 근거는 없었다.
- helper가 여러 명이거나 실제 참여자가 2명 이상인 경우 현재 저장 구조만으로 메인/조력자를 나누지 않는다. 배열 순서, 이름 순서, 보고서담당 포함 여부로 추정하면 안 된다.
- 다일 사업장은 해당 날짜 `daily_staff` entry를 사용해야 한다. 현재 `measurementStaffForDate`는 전달된 날짜와 정확히 일치하는 entry를 고르는 부분은 안전하지만, workbench 행은 사업장의 시작일인 `measurement_date` 하나만 전달하므로 후속 측정일별 역할을 한 행에서 표현하지 못한다.

### 4. H0508 원천값과 중복 원인

- 코드/사업장: `H0508` / `남영물류산업 (주) YAN5 Manless Mezzanine 공사`
- 측정예정 시작일/종료일: `2026-08-03` / `2026-08-25`
- 상위 `measurer_id`: `2`(강종구), 상위 `collaborators`: `강종구`
- `daily_staff`: 2026-08-03과 2026-08-25 모두 `measurer_id = 2`, `collaborators = [강종구]`
- 현재 화면 판독: 메인측정자 강종구 / 조력자 강종구 / 보고서담당 강종구
- 판정: `MAIN_HELPER_DUPLICATE`. 원천에서 메인과 조력자 역할이 중복 저장된 것이 아니라, `entry.measurer_id`를 메인으로 오해하고 실제 참여자 전체인 `entry.collaborators`를 조력자로 오해한 fallback이 같은 사람을 두 번 출력한다.
- 안전하게 확정 가능한 의미: 실제 측정 참여자가 강종구 1명이므로 메인측정자 강종구 / 조력자 없음 / 보고서담당 강종구다. 이번 검증에서는 코드나 DB를 수정하지 않았다.

### 5. 현재 코드 평가

- 종합 평가: **수정 필요**.
- `entry.main_measurer_id ?? entry.measurer_id`: 명시적 `main_measurer_id`만 사용하면 의도상 안전하지만, 운영 데이터의 `entry.measurer_id`는 보고서담당이므로 메인 fallback으로 사용하면 안 된다.
- `entry.helper_ids ?? entry.collaborators`: 명시적 `helper_ids`만 사용하면 의도상 안전하지만, 운영 데이터의 `entry.collaborators`는 조력자만이 아니라 실제 참여자 전체이므로 helper fallback으로 사용하면 안 된다.
- 일치하는 `daily_staff`가 없을 때 상위 `collaborators` 전체를 조력자로 표시하는 현재 fallback도 역할 정보가 없는 값을 조력자로 단정하므로 안전하지 않다. 단일 참여자는 메인으로 확정 가능하지만, 복수 참여자는 `MAIN_ROLE_AMBIGUOUS`로 남겨야 한다.
- 2026년 실제 데이터에는 명시적 main/helper 필드가 0건이므로, 현재 코드의 신형 우선 경로는 코드 구조만 검토할 수 있고 실제 운영 표본으로 검증하지 못했다.
- 측정대상 저장·legacy sync 경로는 현재도 `daily_staff.measurer_id/collaborators`만 생성·해석한다. 향후 `main_measurer_id/helper_ids`만 저장하면 workbench 표시는 읽을 수 있어도 legacy `actual_measurer` 동기화는 빈 값이 될 수 있으므로, 신형 구조를 도입할 때 저장·동기화 경로를 함께 통일해야 한다.

### 6. 1차 범위 사용자 확인·수정 판단 대상

| 코드 | 사업장명 | 측정예정일 | 분류 | 확인 필요 사유 |
| --- | --- | --- | --- | --- |
| H0508 | 남영물류산업 (주) YAN5 Manless Mezzanine 공사 | 2026-08-03 | `MAIN_HELPER_DUPLICATE` | 보고서담당을 메인으로, 실제 참여자 전체를 helper로 중복 판독. 단일 참여자이므로 표시 로직만 바로 수정 가능 |
| H0260 | 국립해양생물자원관 | 2026-08-12 | `MAIN_HELPER_DUPLICATE`, `MAIN_ROLE_AMBIGUOUS` | 참여자 한기문·김민영 중 메인 근거가 없고 현재 한기문이 메인/조력자에 중복 표시됨 |
| H0102 | 국립농업과학원 | 2026-09-14 | `MAIN_HELPER_DUPLICATE` | 보고서담당을 메인으로, 단일 실제 참여자를 helper로 중복 판독. 단일 참여자이므로 표시 로직만 바로 수정 가능 |
| H0063 | 은진모터스 | 2026-08-06 | `MAIN_ROLE_AMBIGUOUS` | 실제 참여자 강종구·이태환 중 메인 역할을 판별할 원천값 없음 |
| H0077 | 정림모터스 | 2026-08-06 | `MAIN_ROLE_AMBIGUOUS` | 실제 참여자 이주형·한기문 중 메인 역할을 판별할 원천값 없음 |
| H0399 | (주)조은자동차서비스 | 2026-08-25 | `MEASUREMENT_STAFF_MISSING` | 실제 측정 참여자 원천값 없음 |
| H0524 | 주식회사 대영이엔씨 | 2026-08-27 | `MEASUREMENT_STAFF_MISSING` | 실제 측정 참여자 원천값 없음 |
| H0288 | 동아하이테크 주식회사 2공장 | 2026-08-27 | `MEASUREMENT_STAFF_MISSING` | 실제 측정 참여자 원천값 없음 |
| H0528 | (주) 한양건설 아산 리버뷰 지역주택조합 아파트 신축공사 | 2026-09-03 | `MEASUREMENT_STAFF_MISSING` | 실제 측정 참여자 원천값 없음 |
| H0348 | 동아하이테크 주식회사 | 2026-09-04 | `MEASUREMENT_STAFF_MISSING` | 실제 측정 참여자 원천값 없음 |
| H0126 | 주식회사 협성솔루션 | 2026-09-09 | `MEASUREMENT_STAFF_MISSING` | 실제 측정 참여자 원천값 없음 |
| H0281 | 의료법인 삼광의료재단 에스엠엘대전의원 | 2026-09-10 | `MEASUREMENT_STAFF_MISSING` | 실제 측정 참여자 원천값 없음 |

- 1차 범위의 복수 참여자 역할 모호 3건, 동일인 중복 표시 3건, 측정 참여자 누락 7건을 전부 위 표에 포함했다. H0260은 두 분류에 중복 해당한다.
- 2026년 확대 범위는 구조 전환과 Case D 확인을 위한 보조 검증이다. 확대 범위 전체에서는 복수 참여자 역할 모호 21건, 측정 참여자 누락 175건이었으며, 8월 이전 대량 legacy 누락은 이번 1차 사용자 확인 목록에 재나열하지 않았다.

### 7. 수정 권고

- 바로 수정 가능한 로직: `daily_staff.measurer_id`를 메인측정자 fallback으로 사용하지 않고 보고서담당으로만 유지한다. 역할 없는 실제 참여자가 1명이면 그 사람을 메인으로 표시하고 helper에서 제거한다. 메인과 helper 출력 전 동일 ID/이름 중복을 방어한다.
- 사용자 확인 후 수정할 로직: 실제 참여자가 2명 이상인 legacy 행은 메인 역할을 추정하지 않는다. 위 `MAIN_ROLE_AMBIGUOUS` 사업장의 실제 메인을 확인하거나 저장 UI에 명시적 main/helper 입력과 저장 경로를 마련한 후 표시한다.
- 유지할 로직: 보고서담당은 상위/날짜별 `measurer_id`, 실제 참여자는 날짜별 `daily_staff.collaborators` 우선, 단일일은 상위 `collaborators`, 다일은 exact-date entry를 사용하는 역할 분리 원칙.
- DB 자동 보정은 금지한다. 특히 collaborators 배열 첫 사람 또는 보고서담당을 일괄 메인으로 저장하면 안 된다.
- 코드 검증 worker가 관련 Phase B·역할 분리 테스트 50건을 실행해 모두 통과했다. 이번 변경은 보고서뿐이므로 제품 전체 테스트와 build는 다시 실행하지 않았다.

## 2026-08-22 인력·공시료·재추천 정책 최종 정렬

### 현재 구현 분류

- 유지: 측정예정일 검색 snapshot, 유형별 예비조사 후보일, preview/apply 동일 draft, PAUSE OFF, 기존 V2/legacy 보존, `measurement_journal` 찐확정, minimum-change, 기존 탭·검색·sticky UI.
- 수정: 사업장 상세의 `조력자`를 `측정 참여자`로 변경하고, 보고서 담당자를 기본 체크하되 사용자가 해제할 수 있게 했다. 단일일에서 일자를 추가할 때 기존 일정도 첫 `daily_staff` entry로 보존해 날짜별 UI 의미를 통일했다.
- 제거: legacy `daily_staff.measurer_id → 메인측정자`, `daily_staff.collaborators → 조력자` fallback과 보고서 담당·측정 참여자·예비조사자에서 측정자(공시료)를 추론하는 경로를 제거했다.
- 신규: 고정 공시료 코드 기반 측정자 균등배정, 3건 승인 흐름, 추천 사유, 예비조사 담당자 서버 권한, 영향 범위 재추천, 찐확정 DB guard migration을 추가했다.

### 역할과 UI

- 보고서 담당자는 `measurement_target_business.measurer_id` 또는 날짜별 `daily_staff.measurer_id`이며, 측정 참여자와 측정자(공시료)와 별도다.
- `메인측정자 = 측정자 = 공시료 담당자`로 통합했다. 사업장 상세 모달에서는 이 역할이나 공시료 코드를 선택하지 않는다.
- 계획/목록 테이블과 상세 모달은 `측정자·공시료`, `측정 참여자`, `보고서 담당자`를 별도 표시한다.
- 캘린더 제목은 실제 측정 참여자만 표시한다. 보고서 담당자가 참여자에 포함되면 이름을 앞에 두며, 미포함이면 참여자만 표시한다. 색상은 기존대로 보고서 담당자 기준이다.
- 사용자 관리에서 기존 `is_preliminary_survey_experienced`를 재사용하고 `예비조사 담당자` 권한 UI/API를 추가했다. 권한 column migration은 작성만 했으며 운영 DB에는 적용하지 않았다.

### 추천 알고리즘

- 예비조사자 계산이 끝난 뒤 측정자(공시료)를 별도 단계로 배정하므로 예비조사자·실측정자·보고서 담당자를 서로 맞추지 않는다.
- 고정 코드는 `이태환 A / 한기문 B / 강종구 C / 이주형 D / 고유빈 F / 김민영 G`다.
- 같은 측정일에 6개 업체는 6명에게 1건씩, 8개 업체는 기본 `2/2/1/1/1/1`로 배정한다. 추가 배정은 `동일주소 > 근거리/동선 > 현재 배정수` 순이다.
- 1인 2건은 자동추천할 수 있고 3건부터 `3건 승인 필요`로 반환한다. 예비조사 담당자 또는 관리자가 명시적으로 확인한 동일 draft만 apply할 수 있다.
- 최초실시·타기관 신규는 방문, 기존업체는 유선 기본이다. 기존업체 방문은 같은 날 필수 신규 방문과 동일주소 또는 검증된 근거리일 때만 최대 2건 범위에서 보조적으로 승격하며 별도 방문일을 만들지 않는다.
- 유선 배정은 1인당 하루 3건으로 검증하고 경력 조건은 hard constraint로 유지한다.
- 추천 사유는 `최초실시·방문`, `타기관 신규·방문`, `기존업체·유선`, `동일주소 묶음`, `근거리 묶음`, `측정자 균등배정`, `2건 배정`, `3건 승인 필요`의 짧은 문구로 표시한다.

### 영향 범위·상태·잠금

- 업체별 재추천은 대상 한 건만 저장하지 않고 같은 예비조사일, 예비조사자 조합, 동일주소, 같은 측정일의 관련 target을 후보 범위로 확장한다. 찐확정 대상은 추천 대상에서 제외한다.
- 사업장 상세의 측정일·보고서 담당·측정 참여자·구분·주소가 적용 draft snapshot과 달라지면 GET에서 `재검토 필요`로 표시하고 apply 시 409 `DRAFT_REVIEW_REQUIRED`를 반환한다.
- 일반 V2 단건·배치 write와 직접 table update를 `measurement_journal` row 존재 기준으로 차단하는 migration을 추가했다. `sequence_number`를 찐확정 판정에 사용하지 않는다.
- 기존 관리자 repair API/service/audit는 삭제하지 않았고 trigger bypass가 관리자 repair RPC에만 열리도록 migration을 설계했다. migration은 운영 DB에 적용하지 않았다.

### 사용자 수동 보정 10개 READ-ONLY 검증

- H0399, H0524, H0288, H0528, H0348, H0126, H0281, H0260, H0063, H0077의 운영 DB 현재값을 SELECT로만 재확인했다.
- 10개 모두 자동 correction 대상에서 제외했고, 코드에는 업체별 보정값이나 UPDATE SQL을 넣지 않았다. 운영 DB write는 0건이다.
- H0260은 날짜별 참여자에 공백·중복이 남아 있으나 DB는 변경하지 않고 화면 문자열에서만 trim/dedup한다.
- 이 절은 위 원천 검증의 과거 `확인·수정 판단 대상` 표를 대체한다. 해당 10개는 사용자 보정 완료 기준값이며 더 이상 수정 대기 대상이 아니다.

### schema/migration

- 작성: `20260822_add_preliminary_survey_manager.sql`, `20260822_lock_true_confirmed_v2_plans.sql`, `20260822_enforce_true_confirmed_trigger.sql`.
- 운영 적용: 없음. 운영 적용 전 기존 함수 signature, trigger 순서, RLS/권한, rollback 절차를 별도 검토해야 한다.
- 기존 V2 table/data/service/API/audit 삭제나 migration 적용은 없었다.

### 테스트와 브라우저 검증

- `npx tsc --noEmit`: 통과.
- Phase B·역할·공시료·캘린더 집중 테스트: 33/33 통과.
- `npm test`: 최종 355/355 통과(최신 main의 대시보드 매출 회귀 테스트 포함).
- `npm run build`: 최신 main 통합 후 최종 통과(69개 static page 생성, 84.1초). 개발 서버와 동시 실행한 시도는 timeout되어 브라우저 검증 후 서버를 정상 중지하고 성공 결과를 확인했다.
- Orca 브라우저 `/businesses`: `측정 참여자` 명칭, 보고서 담당 선택 시 기본 체크, 체크 해제 가능, 일자 추가 후 날짜 2개에 동일한 보고서 담당/측정 참여자 구조를 확인했다. 저장은 누르지 않고 취소했다.
- Orca 브라우저 `/survey`: 측정예정일 `2026-08-01~2026-08-31` 검색 결과 100건, 역할 분리 컬럼, H0260 복수 참여자 표시, H0508 찐확정 상세 잠금과 재추천·수동 저장 disabled를 확인했다.
- 현재 로그인은 일반 사용자라 추천 생성은 서버 403 `예비조사 담당자 또는 관리자만...`으로 차단됐다. 안전한 관리자 환경이 없어 추천 성공·선택 재추천·apply write E2E는 수행하지 않았다.
- 외부 Google Calendar에 write하지 않았으므로 실제 이벤트 생성 결과는 실행하지 않았다. 이름 정렬과 보고서 담당 미참여 표시, 색상 원천은 순수 함수/기존 color-policy 테스트로 검증했다.

### 이번 Orca worker 기록

| 모델 | 추론 강도 | 담당 작업 | 결과 |
| --- | --- | --- | --- |
| GPT-5.6 Sol | Medium | 메인 통합, 구현, 테스트, Orca 브라우저, 보고서·Git/PR | 실제 Orca 터미널 표시값 확인, 반영 |
| GPT-5.6 Terra | High | 사업장 상세·daily_staff·캘린더 데이터 흐름 분석 | `task_5961148080fe`, 반영 |
| GPT-5.6 Terra | High | 권한·경력 속성·UI·테스트 경계 분석 | `task_57faa78517be`, 반영 |
| GPT-5.6 Terra | High | 추천기·공시료·영향 범위 분석 | 최초 `task_99284b64d373`가 `agent_prompt_stalled`, 동일 terminal의 재시도 `task_11675936af96` 성공 후 반영 |
| GPT-5.6 Luna | - | 미사용 | 0회 |

- Orca Run: `run_5cded3c14af4`. 모델별 토큰·credits는 확인할 수 없어 추정하지 않았다.

## 알려진 제한사항

- 관리자 권한의 안전한 테스트 데이터 환경에서 `추천 생성 → 업체별 재추천 → 추천안 적용` 성공 흐름과 실제 저장값 동일성을 추가 확인해야 한다.
- 실제 외부 차량 경로 API 응답을 사용하는 운영 데이터 조합은 이번 브라우저 검증에서 실행하지 않았다.
- 찐확정 관리자 정비는 기존 admin repair 경로를 유지하며 일반 작업대 모달에서는 제공하지 않는다.
- 기존 legacy 관리자 repair RPC 내부에는 `sequence_number` 확인과 예·측(link) 정비 의미가 남아 있다. 새 workbench 일반 흐름에서는 호출하지 않지만, 모든 `measurement_journal` 찐확정 row에 대한 새 역할 정비로 확장하려면 별도 migration 설계와 사용자 승인이 필요하다.
- 동일주소 영향 범위는 계산하지만 좌표 기반 근거리 묶음을 영속적으로 식별하는 별도 bundle ID는 없다. 근거리 영향 범위 자동 확장은 향후 route evidence 구조와 함께 보강해야 한다.

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
| GPT-5.6 Terra | Medium | 목록 조사자 필터 제거, 코드·사업장명 검색 snapshot, 계획·목록 sticky UI 구현 | 메인 검토 후 반영 | 목록 UI worker 1회, 토큰/credits 확인 불가 |
| GPT-5.6 Terra | Medium | 코드·사업장명 정확·부분·다중 검색 helper와 단위 테스트 구현 | 메인 검토 후 반영 | 검색 helper worker 1회, 토큰/credits 확인 불가 |
| GPT-5.6 Sol | Medium | 계획 검색 snapshot, 검색 결과와 추천 scope 일치, 추천 결과 문구·버튼 상태 보완, 테스트·빌드·Git/PR | 실제 수행 결과 반영 | 이번 최종 보완 주 작업자 1세션, 토큰/credits 확인 불가 |
| GPT-5.6 Sol | High | 측정예정일 검색 scope와 예비조사 후보일 의미 분리, API·UI·테스트·빌드·Git/PR | 실제 수행 결과 반영, 요청값 적용·실제 추론값 검증 불가 | 이번 최종 보완 주 작업자 1세션, 토큰/credits 확인 불가 |
| GPT-5.6 Sol | High | 메인측정자·조력자·보고서담당 원천 검증 통합, 2026년 제한 SELECT, 보고서·Git/PR 작업 | 요청값 적용, 주 작업자 실제 모델 메타데이터 검증 불가 | 이번 검증 주 작업자 1세션, 토큰/credits 확인 불가 |
| GPT-5.6 Terra | High | 1차 105건과 조건부 2026년 472건 데이터 구조·Case A~D 검증 | Orca 실행 영수증의 effective 값 확인, 결과 반영 | 데이터 worker 1회, 토큰/credits 확인 불가 |
| GPT-5.6 Terra | Medium | measurement-staff/workbench/저장 UI·API·migration 코드 매핑과 관련 테스트 50건 | Orca 실행 영수증의 effective 값 확인, 결과 반영·코드 변경 없음 | 코드 worker 1회, 토큰/credits 확인 불가 |
| GPT-5.6 Terra | High | H0508, 동일인 중복, 역할 모호, 누락, 사용자 참조 예외 검색 | Orca 실행 영수증의 effective 값 확인, 결과 반영·코드 변경 없음 | 예외 worker 1회, 토큰/credits 확인 불가 |
| GPT-5.6 Luna | - | 미사용 | 미반영 | 0회 |

- Orca Run `run_a53b8bcb30b3`에서 구현, 엔진/테스트, 브라우저 검증을 하위 worker로 분담했다.
- Orca Run `run_76c26c41accf`에서 이번 추천 기간 UI 보완을 UI, KST 계산/테스트, 브라우저 검증 worker로 분담했다.
- Orca Run `run_8a7c334bb33a`에서 이번 목록 검색·sticky 보완을 UI와 검색 helper/test worker로 분담했다. 브라우저는 메인 작업자가 재연결을 시도했으나 가용 런타임이 없었다.
- Orca Run `run_cb3f91db4a27`에서 이번 원천 검증을 데이터 구조, 코드 매핑, 예외 검색 worker로 분담했으며 3개 task 모두 `worker_done/succeeded`로 종료했다.
- 모델별 토큰·credits는 이 세션에서 확인할 수 없어 추정하지 않았다.

## 2026-08-22 PR #42 최종 blocker 보완

### 기준과 안전 확인

- 작업 기준 head: `e70bb1da40438b44a6ff383339283b648cafee66`, branch `feature/preliminary-survey-phase-b`, PR #42 Draft/Open이다.
- 이번 blocker 보완 구현 commit: `4579457813e6193e5b43245fe27e8c704241e5d3`. 최종 PR head는 이 보고서 갱신 commit 기준이며 완료 보고와 PR 본문에 기록한다.
- READ-ONLY 확인 결과 `users.survey_code`는 이태환 A, 한기문 B, 강종구 C, 이주형 D, 고유빈 F, 김민영 G의 기존 공시료 원천과 일치했다.
- 운영 DB에는 `preliminary_survey_v2_measurement_assignments`와 `is_preliminary_survey_manager`가 아직 없고, 관련 20260822 migration도 미적용 상태임을 확인했다.
- H0399, H0524, H0288, H0528, H0348, H0126, H0281, H0260, H0063, H0077은 SELECT만 수행했다. 운영 DB write, migration 적용, 자동 보정은 0건이다.

### blocker별 조치

- round-robin: `activeUsers[index % activeUsers.length]` 배정을 제거했다. 후보 날짜별 단독/경력+비경력 조합을 만들고 제외 일정, 실제 측정 충돌, 방문·유선 개인 용량, 기존 manual 최소변경, 날짜·기간 배정량, 안정적인 user ID tie-break로 선택한다.
- 영향 범위: `calculatePreliminarySurveyImpactScope` 순수 함수로 같은 예비조사일의 조사자·방문/유선 용량, 동일주소·방문 묶음, 다일을 포함한 같은 실제 측정일의 공시료 균형 관계를 closure로 계산한다. 새 추천 관계가 생기면 안정될 때까지 다시 확장하며, locked target은 조회에 포함하고 변경에서는 제외한다.
- 측정자·공시료: `users.survey_code`를 유일한 코드 원천으로 사용하고 날짜별 `preliminary_survey_v2_measurement_assignments` table migration을 작성했다. 다일은 유효한 `daily_staff` 날짜 각각을 저장하며 JSON `measurementAssignee`는 과거 read-only fallback이다.
- apply: 클라이언트 assignee/name/code/approval 값을 저장 근거로 사용하지 않는다. 서버가 예비조사와 공시료를 재계산해 canonical draft 및 source fingerprint를 비교하고, 같은 측정일의 기존 assignment baseline을 transaction advisory lock 뒤 재검증한다. 불일치 시 `DRAFT_REVIEW_REQUIRED`로 0건 저장한다.
- transaction: plan과 assignment upsert, 이전 날짜 assignment 정리, 3건 승인자·서버 시각 저장을 단일 RPC transaction으로 묶었다. 구형 자동 저장 API는 assignment 없는 plan을 만들 수 없도록 폐기하고 workbench로 유도했다. 기존 manual plan의 survey-only 수정은 source 측정일·구분을 바꾸지 않으며 assignment를 보존한다.
- DB guard: plan·assignment INSERT/UPDATE/DELETE에서 OLD와 NEW target의 `measurement_journal` 존재를 모두 검사한다. plan table의 service_role 직접 DML을 revoke하고 SELECT만 재부여했으며, 관리자 repair owner의 transaction-local bypass만 유지한다.
- route: 동일주소를 먼저 비교하고, 그 외에는 실제 vehicle route evidence가 policy를 통과한 경우에만 근거리 사유를 사용한다. 기존 assignment 좌표도 로드하고 같은 날짜의 모든 필수 방문 후보를 비교한다.
- 사업장 상세: 1일과 다일을 공통 `MeasurementDayAssignmentCard`와 `MeasurementDayForm[]`으로 렌더링한다. 보고서 담당자는 참여자 기본값일 뿐 해제 가능하고, 일자 추가·삭제마다 earliest/latest를 다시 계산한다. 모달 open만으로 저장하지 않는다.
- 사용자 API: manager column migration 전에도 신규 사용자 POST와 수정 fallback이 동작하도록 column-missing 경계를 유지했다.

### migration

- 신규 파일: `supabase/migrations/20260822153000_add_preliminary_survey_v2_measurement_assignments.sql`.
- 운영 적용: 0건. Supabase CLI, 연결된 Supabase MCP project, local/staging PostgreSQL이 없어 SQL 실행 검증은 수행하지 못했다.
- 배포 순서는 `검증 DB migration 실행 → rollback 확인 → 운영 migration → schema reload → 코드 배포 → 권한 부여 → 안전한 관리자 E2E`로 고정한다.

### 검증 결과

- `npx tsc --noEmit`: 통과.
- 예비조사 집중 테스트: 조사자 탐색, 영향 closure, 공시료 균형/route, canonical stale, 공통 Day Form과 기존 Phase B 회귀를 포함해 299/299 통과했다.
- `npm test`: 358/358 통과.
- `npm run build`: 3000번 dev server와 `.next`가 충돌한 첫 시도는 page artifact 누락으로 실패했다. 해당 3000번 프로세스만 종료한 뒤 재실행해 69개 page build가 통과했으며, 이후 `npm run dev:turbo`를 3000번에 복원했다.
- 독립 보안 리뷰에서 발견한 OLD/NEW guard, source race, 다일 날짜, 다일 impact, legacy DML 우회 문제를 모두 보완했다.

### 브라우저와 E2E

- 메인과 별도 Browser worker가 Orca 인앱 브라우저 연결을 시도했으나 로컬 Node `v22.18.0`이 browser runtime 최소 `v22.22.0`보다 낮아 초기화가 차단됐다. 대체 브라우저로 전환하지 않았고 화면 검증을 완료했다고 기록하지 않는다.
- 안전한 local/staging DB가 없고 신규 migration도 미적용이므로 관리자/예비조사 담당자 성공 apply, 원자 rollback, DB trigger INSERT/UPDATE/DELETE E2E는 미완료다.
- 따라서 현재 merge 판정은 **보류**다. migration을 안전한 검증 DB에서 실행하고 성공 apply·stale·동시성·rollback E2E가 끝나기 전 merge하지 않는다.

### 이번 작업 모델/worker

| 작업자 | 요청 모델 / 추론 강도 | 담당 | 결과 |
| --- | --- | --- | --- |
| Main | GPT-5.6 Sol / High | 설계, 통합, 보안·DB 검토, 테스트, 빌드, 문서·Git/PR | 반영. 실제 effective 모델 메타데이터는 별도 노출되지 않아 요청값만 기록 |
| Worker A | GPT-5.6 Terra / High | 조사자 후보 탐색, 용량, minimum-change | 재시도 후 반영. 최초 task는 `agent_prompt_stalled` |
| Worker B | GPT-5.6 Terra / High | 영향 범위 dependency closure | 반영 |
| Worker C | GPT-5.6 Terra / High | assignment migration, RPC, apply/guard | 보정 재시도 후 반영 |
| Worker D | GPT-5.6 Terra / Medium | 공통 Day Card, 날짜 helper, UI | 반영 |
| Worker E | GPT-5.6 Terra / High | 독립 보안·정합성 리뷰 | P1 발견 및 재검토 결과 반영 |
| Browser worker | GPT-5.6 Terra / Medium | Orca 실제 화면 검증 | Node runtime 버전 blocker로 중단, 코드 반영 없음 |
| GPT-5.6 Luna | 미사용 | - | 0회 |

- Orca orchestration run: `run_f42e21be0a4c`. 실제 worker token/credits와 일부 effective 모델 메타데이터는 확인할 수 없어 추정하지 않았다.

### 남은 TODO

- 검증 DB에서 새 migration의 SQL signature, RLS/GRANT/REVOKE, OLD/NEW guard 6종, service_role 직접 DML 차단, repair bypass, transaction rollback을 실행 검증한다.
- Node runtime을 browser 요구 버전 이상으로 준비한 뒤 사업장 상세와 `/survey`를 실제 검증한다.
- 안전한 관리자/예비조사 담당자 환경에서 preview → apply 동일성, client 변조, 2건→3건 동시성, stale 409를 완료한다.
- 새 시스템 안정화 뒤 구형 V2 plan을 automatic/manual/실사용·확정/미사용으로 분류한다. 안정화 전 삭제하지 않는다.

## 2026-08-22 최종 후속 검수 보완

### 기준과 구현 결과

- 시작 HEAD: `7e48c92ea35d1834266c14f21ac1488884ebde60`
- 구현 commit: `3e4b8c15efb8ef3f73d8c51570b50044b7025c3c`
- branch: `feature/preliminary-survey-phase-b`
- PR: #42 Draft/Open, merge하지 않았다. 이 보고서를 포함한 최종 PR HEAD는 PR 본문과 완료 보고에 기록한다.
- 기존 V2 자동추천 OFF, legacy sync, 기존 V2 데이터와 `measurement_journal` 찐확정 기준을 유지했다.

### blocker별 조치

- 3건 승인: `measurement_date + assignee_user_id`의 최종 그룹을 서버가 계산하고 기존 row를 먼저 정렬한 뒤 세 번째 이후 제안 row만 승인 대상으로 기록한다. 클라이언트 `approval_required`는 판단 근거에서 제외했고, 변경되지 않은 기존 승인 row는 승인자·시각을 보존한다.
- SQLSTATE: 신규 assignment RPC의 stale source/baseline 업무 오류에서 `40001`을 제거하고 `22023`으로 통일했다.
- 추천 planner: 서비스의 별도 조사자 pre-pass를 제거했다. `recommendBatch`가 후보 날짜, 책임자, 조합, 방식, 용량과 route를 한 virtual assignment에서 결정하고 날짜별·기간별 배정량과 안정적인 ID로 deterministic tie-break한다.
- manual plan: 기존 manual이라는 이유만으로 보존하지 않고 현재 방식까지 포함해 hard constraint를 재검증한다. 기존업체 유선은 비경력자 단독을 허용하고, 기존업체 방문은 참여자가 겹치는 같은 날 필수 신규와 동일주소 또는 허용 vehicle route가 있어야 한다.
- 영향 범위: 같은 날짜·같은 방식만으로 확장하지 않는다. 방문은 참여자가 겹칠 때, 유선은 책임자/참여자가 겹칠 때 용량 관계를 만들며 동일주소·방문묶음·같은 실제 측정일 공시료 관계는 유지한다.
- 사업장 상세: 참여자가 빈 날짜만 보고서 담당자를 기본 체크하고 기존 참여자가 있으면 보존한다. 보고서 담당 변경은 새 담당자를 기본 추가하지만 사용자가 해제할 수 있고 이전 담당자를 자동 삭제하지 않는다.
- 날짜 validation: 단일 빈 카드는 미실시 `null` 저장을 허용한다. 다일은 모든 날짜의 형식·실재 날짜·중복을 검사하고 오류 시 serializer와 저장을 차단한다.
- 독립 검토에서 workbench apply와 단건 수동 수정이 선택한 `surveyMethod`를 hard-rule 검증에 전달하지 않는 P1을 발견했다. 두 API 경로를 수정하고 회귀 테스트를 추가한 뒤 재검증했다.

### DB 검증과 안전

- READ-ONLY REST 확인에서 `preliminary_survey_v2_measurement_assignments`가 PGRST205를 반환해 대상 migration 미적용 상태를 확인했다.
- `supabase` 전역 CLI, Docker, 로컬 PostgreSQL 실행 파일과 연결된 Supabase test project가 없었다. `npx supabase 2.114.0`은 확인했으나 격리 DB를 실행할 backend가 없어 실제 migration, guard 6종, RPC rollback·동시성 행동 테스트는 수행하지 못했다.
- 운영 DB migration 적용 0건, 운영 DB write 0건, 보호 대상 H0399/H0524/H0288/H0528/H0348/H0126/H0281/H0260/H0063/H0077 write 0건이다.
- 따라서 SQL 정적/행동 단위 테스트는 통과했지만 실제 PostgreSQL 검증은 미완료이며 merge blocker로 남긴다.

### Orca Browser Runtime 재진단

- 진단 로그: `C:\Users\USER\AppData\Local\Temp\orca-runtime-diag-task_ecadecf33385` (Git 미포함).
- 사용 CLI: `C:\Users\USER\AppData\Local\Programs\orca\resources\bin\orca.cmd` / `orca.exe`.
- Orca 앱: `1.4.188`, PID 42260, runtime `ready/reachable`; `orca status --json`과 `orca tab list --json`은 exit 0이었다.
- 새 `browserPageId` `85882ece-745a-49c0-8a1a-86573e0dbfd5`를 생성했다. `orca eval`은 `http://localhost:3000/dashboard`, 제목 `측정일지 관리 시스템`, `readyState=complete`를 반환했다.
- 같은 fresh page의 `orca snapshot`은 약 30초 후 `runtime_unavailable: The Orca runtime closed the connection before responding`으로 실패했다.
- Orca 내장 binary `resources/agent-browser-win32-x64.exe`는 존재하며 실제 프로세스도 확인됐다. PATH/전역 Node module의 `agent-browser`는 없지만 내장 binary가 있으므로 외부 전역 설치 필요성은 확인되지 않았다.
- 시스템 Node는 v22.18.0이나 Orca runtime·tab·eval과 내장 native binary가 동작했고 Node engine 오류가 없었다. Node 직접 원인으로 확정하지 않았고 Node/Orca 설치를 변경하지 않았다.
- 실패 계층은 프로젝트 코드가 아닌 Orca browser snapshot/runtime 응답 경계다. 실제 클릭 기반 사업장 상세와 `/survey` Browser E2E는 미완료다.

### 테스트 결과

- 집중 행동 테스트: 최종 101/101 통과.
- `npx tsc --noEmit`: 통과.
- `npm test`: 394/394 통과. 신규 Phase B·impact·assignment persistence 테스트도 기본 전체 테스트에 포함했다.
- `npm run build`: 최종 코드 기준 69개 page 빌드 통과. 첫 시도는 실행 중인 dev server와 `.next` 충돌로 page artifact가 누락됐고, 확인된 이 작업공간 3000번 프로세스만 일시 종료 후 재실행해 통과했다.
- `npm run dev:turbo`: 빌드 후 3000번에 복원했고 Ready 상태를 확인했다.

### 이번 Orca worker 수행 현황

| worker | 요청/effective 모델 | 추론 | 담당 | 결과 |
| --- | --- | --- | --- | --- |
| Main | GPT-5.6 Sol / 실제값 검증 불가 | High 요청 | 통합, P1 수정, 전체 테스트·빌드, 문서·Git/PR | 반영 |
| DB 성공 worker `ctx_95ea72860677` | GPT-5.6 Terra | High | 3건 승인, SQLSTATE, migration/RPC 정적 검증 | 반영 |
| Planner worker `ctx_41c298b598dc` | GPT-5.6 Terra | High | 단일 planner, manual hard constraint, 영향 범위 | 반영 |
| Runtime worker `ctx_d570fc74e51b` | GPT-5.6 Terra | Medium | Orca CLI/runtime/browser 계층 진단 | 결과 반영, 코드 변경 없음 |
| Review retry `ctx_a21615116c42` | GPT-5.6 Terra | High | 독립 보안·정합성 검토 | P1 발견, 메인 수정 반영 |
| DB 최초 `ctx_0c6418013cf9` | GPT-5.6 Terra | High | DB 작업 | `agent_prompt_stalled`, 재시도 성공 |
| UI `ctx_ef944be46a74`, `ctx_226fd3c35758` | GPT-5.6 Terra | Medium | 상세 모달/날짜 validation | 2회 `agent_prompt_stalled`, 메인 구현 |
| Review 최초 `ctx_fe0f10d1afba` | GPT-5.6 Terra | High | 독립 검토 | `agent_prompt_stalled`, 재시도 성공 |

- run: `run_ea896146d17b`; 생성 dispatch 8개, 성공 4개, stalled/failed 4개다. 모델·추론 수준은 Orca worker-start의 requested/effective 기록을 사용했다. 토큰·credits는 확인 불가다.
- 모든 결과는 회수했고 worker terminal은 닫혔다. Orca `worker-show`에서 확인 가능한 exact worker는 exited이고 orphan=false였지만, runtime이 process stop을 확정하지 못해 7개 resource가 `release_unknown`, 최초 review retry 원본 1개가 `identity_unproven` retained 감사 상태로 남았다. 광범위 terminal close는 수행하지 않았으며 active worker는 0개다.

### 최종 판정과 남은 blocker

- 판정: **구현 완료·검증 미완료·merge 보류**.
- 격리 PostgreSQL에서 migration 최초/rollback, plan·assignment guard INSERT/UPDATE/DELETE, 3건 승인, 원자 rollback, stale·동시 apply를 실행 검증해야 한다.
- Orca snapshot/runtime 문제가 해결된 뒤 사업장 상세와 `/survey` 실제 클릭 검증 및 안전한 관리자/예비조사 담당자 성공 apply E2E를 완료해야 한다.
- Orca의 `release_unknown` 7개와 `identity_unproven` retained 1개 resource settlement도 runtime 측 후속 확인이 필요하다. active worker는 0개지만 완료 조건의 release 확정에는 미달한다.
- 새 시스템 안정화 전 구형 V2 plan 삭제 금지를 유지하며, 이후 automatic/manual/실사용·확정/미사용 분류 후 유지·migration·archive·삭제를 결정한다.

## 2026-08-23 최종 정책 확정 보완

### 기준과 변경 결과

- 시작 HEAD: `7eed8536a93f427a975f4c7cc11a5d623be6a8d6`.
- branch: `feature/preliminary-survey-phase-b`; PR #42는 Draft/Open 상태를 유지하고 merge하지 않는다.
- 최초실시는 working day `-3 → -30`, 타기관 신규는 `-30 → -3`을 모두 소진한 뒤 `-31 → -60`으로 탐색하도록 business-type 후보 순서를 그대로 사용한다.
- 방문 용량은 기존 manual/가확정 및 영향 범위 밖 유지 방문까지 포함한다. 직전 구현의 `31~60분은 대안만` 처리는 확정 정책이 아니어서 원복했다. 30분은 same-route 우선 기준이지 hard maximum이 아니며, 31~60분은 단독 날짜가 없을 때 기존 same-day fallback을 유지하고 60분 초과만 같은 날 방문을 차단한다. route evidence가 없으면 동일주소 외 근거리 자동판정을 하지 않는다.
- 측정자·공시료 배정은 1~2건 자동, 3건 그룹 승인, 4건 이상 hard block이다. 승인 fingerprint는 `measurement_date + assignee_user_id + sorted target_ids`이며 동일 구성은 기존 승인자·승인시각을 보존하고 구성 변경만 재승인한다.
- 기존 적용 가능성이 있는 `20260822153000` migration은 변경하지 않고, 후속 `20260823120000_finalize_preliminary_survey_assignment_approval_groups.sql`에서 승인 fingerprint, 4건 차단, 그룹 승인 wrapper RPC와 권한 경계를 추가했다.
- `직원 예비조사 제외 일정`을 UI에서 `직원 불가 일정`으로 정리했다. `user_schedule_blocks`를 공통 원천으로 사용해 예비조사 책임자·경력 동행자, 측정자·공시료, 측정 참여자, 보고서 담당자를 모두 hard constraint로 검사한다.
- workbench 추천·apply, 단건 수동 수정, 사업장 상세 저장이 같은 불가 일정 원천을 사용한다. 후발 불가 일정은 가확정을 재검토 대상으로 만들고, 찐확정은 자동변경하지 않으면서 충돌을 표시한다.

### 테스트와 빌드

- `npx tsc --noEmit --pretty false`: 통과.
- `npm test`: 407/407 통과. 날짜 순서, 기존 방문 포함 용량, 승인 fingerprint·4건 차단, 불가 일정 역할별 차단과 기존 Phase B 회귀를 포함한다.
- `npm run build`: 첫 시도는 실행 중 dev server의 `.next` 산출물 충돌로 실패했다. 이 작업공간의 3000번 프로세스만 확인해 일시 종료하고 기존 `.next`를 임시 경로로 이동한 뒤 69개 page build가 통과했다.
- `npm run dev:turbo`: 빌드 후 3000번에 복원했고 Ready 상태를 확인했다.
- 정적 테스트는 보조 증거다. 실제 Supabase DB migration/RPC 행동 검증은 아래 제한 때문에 완료하지 못했다.

### 실제 DB 검증과 안전

- 사용 가능한 도구는 `npx supabase 2.114.0`이었으나 Docker/Podman, local Supabase 설정, 로컬 PostgreSQL/psql, 연결된 격리 test project가 없었다. `npx supabase status`는 Docker 부재로 실행할 수 없었다.
- 따라서 migration 최초 적용·rollback, plan/assignment guard INSERT·UPDATE·DELETE 6종, 동일 3건 승인 재apply, 구성 변경 재승인, 4건 차단, 원자 rollback·동시 apply는 비운영 Supabase에서 미검증이다.
- 운영 DB를 대체 검증 환경으로 사용하지 않았다. 운영 migration 0건, 운영 DB write 0건, 보호 대상 H0399/H0524/H0288/H0528/H0348/H0126/H0281/H0260/H0063/H0077 write 0건이다.

### 실제 UI 검증

- Orca snapshot 문제를 반복 진단하지 않고 Orca computer-use로 기존 Chrome과 `http://localhost:3000`을 사용했다.
- `/survey`가 관리자 세션에서 정상 로드되고 계획 검색·추천 toolbar, 결과 table의 측정자·공시료/측정 참여자 컬럼, `직원 불가 일정` 탭을 확인했다.
- 불가 일정 화면에서 `등록된 날짜에는 예비조사자, 측정자·공시료, 측정 참여자, 보고서 담당자로 배정되지 않습니다.` 설명과 기존 일정 목록을 확인했다. 조회만 수행했고 저장하지 않았다.
- `/businesses` 목록은 정상 로드됐다. 접근성 기반 수정 버튼 클릭이 성공 상태를 확정하지 못해 공통 Day Card 모달의 이번 회차 실제 조작 검증은 완료로 기록하지 않는다.
- 안전한 격리 DB가 없으므로 성공 apply, 승인, stale·client 변조 저장 E2E는 실행하지 않았다.

### worker와 독립 검토

| 작업자 | 모델 / 추론 | 담당 | 결과 |
| --- | --- | --- | --- |
| Main | GPT-5.6 Sol / High 요청 | 통합, 독립 검토 P1 보완, 전체 테스트·빌드, UI·문서·Git/PR | 반영. 실제 effective 값은 별도 노출되지 않아 요청값 적용·실제값 검증 불가 |
| Worker A `ctx_ebb538a027c9` | GPT-5.6 Terra / High | 날짜 순서, planner, manual/방문 용량 | 반영 |
| Worker B 최초 `ctx_067…` | GPT-5.6 Terra / High | 승인·migration | 사용량 제한으로 실패, 코드 반영 없음 |
| Worker B 재시도 `ctx_97c22c0d57a3` | GPT-5.6 Terra / High | 3건 그룹 승인, 4건 hard max, RPC | 반영 |
| Worker C `ctx_a274294b30a8` | GPT-5.6 Terra / High | 직원 불가 일정 공통 원천, planner/영향 범위 | 반영 |
| Worker D `ctx_3854ef3b9981` | GPT-5.6 Terra / Medium | 사업장 상세 및 불가 일정 UI/save validation | 반영 |
| 독립 검토 `independent_review_final` | GPT-5.6 Terra / High | migration 불변성, 수동/apply 우회, 실제 측정 역할 검토 | 발견사항 반영 |
| GPT-5.6 Luna | 미사용 | - | 0회 |

- 모든 worker 결과를 회수했다. 완료·실패 worker는 더 이상 실행 중이지 않으며 최종 active worker는 0개로 확인한다. 토큰·credits는 확인할 수 없어 추정하지 않는다.

### 최종 판정

- **구현 완료·검증 미완료·merge 보류**.
- merge 전 필수 blocker는 비운영 Supabase DB migration/RPC 행동 검증과 안전한 성공 apply E2E다. 사업장 상세 공통 Day Card의 실제 조작 검증도 함께 완료해야 한다.
- 기존 V2 자동추천 OFF, legacy sync, 기존 V2 데이터 보존, `measurement_journal` 찐확정 보호를 유지한다. 새 시스템 안정화 전 구형 V2 plan을 삭제하지 않는다.

## 2026-08-23 검수 지적 3건 후속 보완

### 정책·코드 정정

- 시작 HEAD는 `77fca03f1670aa3557f5d3149796194418d06039`이며 기존 PR #42 브랜치에서만 작업했다.
- 직전 구현의 `31~60분 → 관리자 대안만` 처리를 제거했다. 30분은 same-route 우선 기준이고 hard maximum이 아니다. 단독 날짜가 없으면 31~60분 차량 route도 기존 same-day fallback으로 추천할 수 있으며, 60분 초과만 같은 날 방문을 차단한다.
- 최초실시 `-3 → -30`, 타기관 신규 `-30 → -3` 후 `-31 → -60`의 authoritative 후보 순서는 유지했다.
- 단일일 `collaborators`가 배열 또는 쉼표 문자열이어도 같은 trim·중복 제거 helper를 사용한다. `/businesses` 저장과 workbench GET·추천·apply·영향 범위가 동일한 날짜별 보고서 담당자·측정 참여자 불가 일정 key를 사용하고, 다일은 `daily_staff` 날짜별 검증을 유지한다.
- 운영 Supabase에서 `approval_group_fingerprint` 컬럼 존재를 READ-ONLY로 확인해 `20260823120000` 적용 이력이 있는 것으로 판단했다. 기존 migration은 수정하지 않고 `20260823123000_limit_assignment_approval_groups_to_affected_dates.sql` forward migration을 추가했다.
- hard max 사전검사는 proposed `(measurement_date, assignee_user_id)` 그룹으로 한정했다. 다른 날짜뿐 아니라 같은 날짜의 다른 측정자에게 남은 legacy 4건도 현재 apply를 막지 않는다.
- 저장 전 old 그룹과 저장 후 new 그룹을 같은 advisory-lock 순서로 직렬화한 뒤 합집합으로 정규화한다. 3건에서 2건으로 줄어든 그룹은 승인 필요·fingerprint·승인자·승인시각을 지우고, 동일한 3건 fingerprint만 기존 승인을 보존한다.

### 검증 결과

- 집중 행동·정적 경계 테스트: 97/97 통과.
- `npx tsc --noEmit --pretty false`: 통과.
- `npm test`: 410/410 통과.
- `npm run build`: 실행 중인 dev server와 `.next` 충돌로 첫 시도가 실패했다. 이 작업공간의 3000번 프로세스만 종료하고 기존 `.next`를 임시 경로로 이동한 뒤 clean build가 통과했다.
- `npm run dev:turbo`: clean build 후 3000번에 복원했고 `/survey` 응답과 Ready 상태를 확인했다.
- 독립 정적 검수는 첫 검수에서 같은 측정일·다른 측정자 legacy 4건이 포함되는 범위 오류를 발견했다. proposed 그룹 key로 수정한 뒤 재검수했으며 코드 blocker 없음 판정을 받았다.

### 실제 UI 검증

- 기존 Chrome 관리자 세션과 Orca computer-use를 사용했다. `/businesses`에서 사업장 상세 모달이 열리고 단일 공통 Day Card에 측정일, 보고서 담당자, 측정 참여자 복수 선택, `+ 일자 추가`가 함께 표시되는 것을 확인했다.
- 저장과 데이터 변경은 수행하지 않았다. 접근성 action 제한으로 다일 카드 추가, 기본 체크 해제, 불가 직원 선택 차단은 이번 회차에 실제 조작하지 못했다.
- clean build와 dev server 복원 후 `/survey`가 정상 로드되고 `직원 불가 일정` 탭 및 `등록된 날짜에는 예비조사자, 측정자·공시료, 측정 참여자, 보고서 담당자로 배정되지 않습니다.` 설명, 기존 일정 목록을 확인했다.

### Supabase 검증 경계와 안전

- 연결된 Supabase 도구에서 비운영 프로젝트가 없고 저장소에도 local Supabase 설정이 없었다. 운영 Supabase를 대체 테스트 환경으로 사용하지 않았다.
- forward migration/RPC의 실제 실행, 같은 날짜·다른 측정자 legacy 4건 허용, 같은 proposed 그룹 4건 차단, old/new 승인 그룹 정규화, rollback·동시 apply는 비운영 Supabase에서 미검증이다.
- 운영 Supabase migration 적용 0건, RPC write 0건, 데이터 write 0건이다. 보호 사업장 10개에도 write하지 않았다.
- 판정은 **구현 완료·UI 부분 검증 완료·Supabase 실행 검증 미완료·merge 보류**다.

### 이번 worker 수행 현황

| 작업자 | 모델 / 추론 | 담당 | 결과 |
| --- | --- | --- | --- |
| Main | GPT-5.6 Sol / High 요청 | 통합, worker 결과 검토, migration lock·group 범위 보완, 테스트·build·UI·Git/PR | 반영. 실제 effective 값은 별도 노출되지 않아 요청값 적용·실제값 검증 불가 |
| Route worker `ctx_1847f6e7d7aa` | GPT-5.6 Terra / High | 31~60분 fallback 원복과 route 테스트 | 메인 날짜 순서 재검토·보완 후 반영 |
| Route 최초 `ctx_b122a2ddb315` | GPT-5.6 Terra / High | 동일 작업 최초 시도 | `agent_prompt_stalled`, 재시도 성공 |
| Supabase worker `ctx_ac2940ff380f` | GPT-5.6 Terra / High | 적용 여부 READ-ONLY 확인, forward migration과 승인 정규화 | 메인·독립 검수 보완 후 반영 |
| 불가 일정 worker `ctx_39ef4451c20b` | GPT-5.6 Terra / High | CSV/배열 collaborators 공통 정규화와 workbench 경계 | 반영 |
| UI worker | GPT-5.6 Terra / Medium | 공통 Day Card 실제 화면 확인 | 단일 Day Card 확인, 저장 0건; 세부 조작은 접근성 제한으로 미검증 |
| 독립 review worker | GPT-5.6 Terra / High | route·날짜·불가 일정·승인 migration 독립 검수 | 같은 날짜 다른 측정자 범위 오류 발견·수정 후 blocker 없음 |

- Orca run `run_f26743801a8c`의 3개 task 결과를 모두 회수했다. task는 completed이고 정확한 worker terminal은 exited·orphan=false다. Orca runtime이 process stop을 확정하지 못해 일부 resource는 `release_unknown` 또는 `identity_unproven` 감사 상태지만 active worker는 0개다.
- 토큰·credits는 확인할 수 없어 추정하지 않았다.

## 2026-08-23 V2 DB persistence 결함 2건 보완

### 실제 결함과 원인

- 결함 A: core RPC의 PL/pgSQL `plan jsonb` 변수와 `jsonb_array_elements(... ) plan`, `preliminary_survey_v2_plans plan` SQL alias가 충돌해 Local Supabase에서 `column reference "plan" is ambiguous`가 재현됐다.
- 결함 B: 승인된 3건 그룹에서 한 target의 측정자를 변경할 때 core `ON CONFLICT UPDATE`가 승인 flag·승인자·시각만 지우고 `approval_group_fingerprint`를 남겼다. wrapper 정규화 전에 row CHECK가 실행되어 `preliminary_survey_v2_assignment_approval_check` 위반이 재현됐다.
- 기존 CHECK나 historical migration을 약화·수정하지 않고 `20260823130000_fix_preliminary_survey_assignment_persistence.sql` forward migration을 추가했다.

### 수정 내용

- core RPC 전체에서 JSON loop/payload는 `plan_item`·`plan_payload`, plan relation은 `target_plan` 등으로 분리해 식별자 충돌을 제거했다.
- 최종 `(measurement_date, assignee_user_id, sorted target_ids)` 그룹을 한 statement에서 계산한다. upsert가 `approval_required`, fingerprint, 승인자, 승인시각을 함께 갱신하므로 모든 중간 row가 CHECK-valid하다.
- 동일한 정확한 3건 fingerprint만 이전 승인 metadata를 보존한다. target 교체·일자 변경·측정자 변경은 새 승인을 요구하고, 1~2건은 승인 metadata를 전부 지운다.
- 4건 hard max와 승인 검사는 proposed 영향 그룹에만 적용한다. unrelated 다른 날짜 또는 같은 날짜의 다른 assignee legacy 4건은 현재 apply를 차단하지 않는다.
- core RPC execute는 `PUBLIC/anon/authenticated/service_role`에서 revoke하고, 기존 wrapper RPC의 service-role 전용 경계를 유지했다. `SECURITY DEFINER SET search_path=public`도 유지했다.

### Local Supabase 실제 검증

- 검증 위치: `C:\Users\USER\supabase-pr42-validation` (Git 미포함). Docker Desktop 경로는 검증 PowerShell 세션 PATH에만 추가했으며 시스템 설정은 변경하지 않았다.
- baseline부터 기존 6개 migration과 새 migration 사본을 순서대로 적용한 `npx supabase db reset --local --no-seed`가 성공했다. `patch_plan_alias_local.sql`은 실행하지 않았다.
- 기존 P1 seed에서 승인 3건 중 target 1건을 다른 assignee로 이동하는 호출이 CHECK 오류 없이 성공했다. 이전 assignee 2건과 새 assignee 1건 모두 fingerprint·승인자·승인시각이 제거됐다.
- repository 검증 스크립트 `supabase/verification/20260823_verify_preliminary_survey_assignment_persistence.sql`을 실제 Local RPC로 실행했고 `PR42_ASSIGNMENT_PERSISTENCE_VERIFICATION_OK`를 확인했다. script는 마지막에 rollback하며 fixture 잔여 0건을 확인했다.
- 확인 범위: 1건, 2건, 2→3 승인 부족 rollback, 관리자 승인 3건, 동일 3건 승인 보존, 3→2·assignee 이동 old/new 정규화, target 교체 재승인, 측정일 변경 승인 무효화, 4건 hard block, unrelated 다른 날짜 legacy 4건, 같은 날짜 다른 assignee legacy 4건, 원자 rollback, `measurement_journal` 찐확정 lock.
- Local 권한 확인: core RPC `service_role` execute=false, wrapper execute=true, core는 `SECURITY DEFINER`와 `search_path=public`을 유지했다.
- 운영 Supabase migration 적용 0건, 운영 RPC/data write 0건, 보호 대상 10개 업체 write 0건이다.

### 공식 회귀와 Orca worker

- 정적 회귀는 새 forward migration이 historical migration을 대체하지 않고 alias 충돌을 제거하며 fingerprint를 동일 upsert statement에서 갱신하는지 고정했다. 실제 DB 의미는 위 Local verification SQL로 검증했다.
- Worker A `ctx_84bb899dc965`: GPT-5.6 Terra / High 요청·effective 확인, core/wrapper·권한·affected scope 읽기 전용 검토. 결과를 반영했다.
- Worker B `ctx_eea5a42c0f84`/retry `ctx_d3c551883c12`: GPT-5.6 Terra / High 요청·최초 effective 확인. Orca dispatch input이 stalled/revoked됐지만 동일 exact terminal의 읽기 전용 결과를 transcript에서 회수해 Local 검증 설계에 반영했다.
- Main: GPT-5.6 Sol / High 요청. migration 통합, Local reset/RPC 검증, 테스트·문서·Git/PR을 담당했다. 실제 모델 메타데이터는 별도 노출되지 않아 요청값 적용·실제값 검증 불가다.
- 이번 run의 worker terminal은 결과 회수 후 닫혔고 exact terminal은 disconnected/exited다. Orca resource settlement는 `release_unknown` 감사 상태여서 최종 보고에 그대로 기록한다.

### 판정

- DB persistence 결함 A/B와 지정 Local Supabase 회귀 범위는 수정·실행 검증 완료다.
- `npx tsc --noEmit --pretty false` 통과, 관련 집중 테스트 32/32 통과, `npm test` 412/412 통과, `npm run build` 통과를 확인했다.
- UI 코드는 변경하지 않았고 기존에 남은 관리자/예비조사 담당자 성공 apply 브라우저 E2E 제한은 그대로다. PR #42는 Draft/Open, 미병합 상태를 유지한다.

## 2026-08-23 old/new 영향 그룹 통합 검증

- 마지막 blocker는 wrapper RPC가 저장 전 hard max·3건 승인을 proposed 그룹 중심으로 검사해, 측정자 이동으로 줄어드는 old 그룹을 놓칠 수 있다는 점이었다. 기존 core의 alias·stale fingerprint 수정은 유지하고 새 forward-only migration `20260823133000_fix_preliminary_survey_affected_assignment_groups.sql`에서 wrapper만 교체했다.
- 영향 범위는 `old_affected_keys UNION proposed_keys`다. 이 범위의 기존 row에서 이번 대상 target을 제거하고 proposed row를 더한 `final_rows`를 실제 저장 후 예상 상태로 사용한다. 같은 범위의 날짜를 기존 advisory-lock namespace로 정렬 잠근다.
- 사전검증은 final group의 4건 이상을 무조건 차단하고, 정확히 3건은 동일 canonical fingerprint의 기존 유효 승인만 재사용한다. 저장 뒤에도 old/new 양쪽 그룹을 정규화하며 1~2건은 승인 metadata를 모두 `NULL`로 만든다.
- Local Supabase에서 baseline부터 새 migration까지 `npx supabase db reset --local --no-seed`가 성공했고 임시 alias patch를 사용하지 않았다. 실제 RPC 검증은 legacy 4→3 무승인 시 `MEASUREMENT_ASSIGNMENT_APPROVAL_REQUIRED`와 원자 rollback, 4→3 관리자 승인 시 old 3건의 새 fingerprint 승인 및 new 1건 metadata 제거, legacy 5→4의 `MEASUREMENT_ASSIGNMENT_HARD_MAX_EXCEEDED`와 rollback, unrelated 다른 날짜·같은 날짜 다른 측정자 legacy 4건 불변을 확인했다.
- 기존 전체 persistence 회귀와 함께 `PR42_ASSIGNMENT_PERSISTENCE_VERIFICATION_OK` 및 최종 rollback을 확인했고 fixture 잔여는 0건이었다. Local 권한은 wrapper `service_role` execute=true, core execute=false이며 두 함수의 `SECURITY DEFINER`·`search_path=public`을 유지했다.
- 검증 결과: `npx tsc --noEmit --pretty false` 통과, 집중 테스트 33/33 통과, `npm test` 413/413 통과, `npm run build` 통과.
- 운영 Supabase migration/write 0건, 보호 대상 10개 업체 write 0건이다. historical migration 변경은 없고 UI 코드는 수정하지 않았다.
- Orca Worker A/B는 각각 GPT-5.6 Terra / High로 wrapper 영향 범위와 Local 회귀 설계를 읽기 전용 검토했다. 두 결과를 회수했으며 task active 수는 0이다. terminal은 닫혔으나 Orca resource 감사 상태는 `release_unknown` 2건으로 남아 있다.

## 2026-08-23 최종 UI/E2E 검증

### `/survey` 실제 흐름

- Local Supabase 전용 사용자·사업장 fixture와 3000번 개발 서버를 사용했다. 운영 Supabase write는 0건이다.
- 관리자 계정으로 측정예정일 검색, 대상 선택, 추천 생성, 검토, 적용, 새로고침과 Local DB 대조까지 완료했다.
- 2개 업체 추천은 추천 직후 plan/assignment가 0건임을 확인했고, 적용 후에만 2개 plan과 날짜별 assignment가 저장됐다. 화면의 예비조사일·예비조사자·측정자/공시료가 DB와 일치했다.
- 같은 측정일·같은 측정자 3건에서 `3건 승인 필요`와 승인 확인창을 확인했다. 승인 사유 입력 없이 관리자 승인 후 적용됐고, Local DB에는 canonical 세 번째 row에만 fingerprint·승인자·승인시각이 저장됐다.
- 일반 사용자 세션에서 추천 및 `approveThirdAssignment=true` 적용을 직접 요청했으며 두 요청 모두 HTTP 403으로 차단됐다.
- 4개 업체가 한 측정자에게 몰리는 fixture는 `측정자 1인당 같은 측정일에는 최대 3건` 안내와 적용 버튼 비활성화를 확인했다. Local DB의 해당 plan/assignment는 모두 0건이었다.
- 추천 draft 생성 뒤 검색 대상을 변경하면 draft가 제거되고 적용 버튼이 비활성화됐다. 오래된 draft가 다른 검색 결과에 적용되지 않았다.
- 역할 분리 fixture에서 `예비조사자=이태환`, `측정자·공시료=한기문 B`, `측정 참여자=김민영`, `보고서담당=한기문`을 동시에 정상 표시했다. 서로 다른 역할을 오류로 취급하거나 자동 동일화하지 않았다.
- Local `measurement_journal` fixture를 추가한 대상은 새로고침 후 `찐확정`으로 표시됐다. 일반 적용은 `TRUE_CONFIRMED_LOCKED`로 거부됐고 plan/assignment는 바뀌지 않았다.

### 직원 불가 일정과 사업장 상세

- `/survey`의 `직원 불가 일정` 탭에서 Local 일정 등록과 목록 반영을 실제 조작했다. 측정 참여자에게 후발 불가 일정을 등록한 대상은 `재검토 필요` 및 `직원 제외 일정 추가` 충돌로 표시됐다.
- `/businesses` 상세 모달은 `측정 참여자` 명칭과 공통 Day Card를 사용한다. 참여자가 빈 단일일은 보고서 담당자가 기본 체크됐으며, 모달 open만으로 DB write되지 않고 사용자가 해제해 저장할 수 있었다.
- 기존 참여자가 있는 단일일은 보고서 담당자를 강제 추가하지 않았다. 보고서 담당자를 바꾸면 새 담당자가 기본 추가되고 기존 참여자는 유지됐으며, 새 기본 체크도 즉시 해제할 수 있었다.
- 기존 참여자가 나중에 불가 상태가 되면 `김민영 (불가 일정)`으로 표시되고 그대로 저장하면 차단됐다. 해당 참여자를 해제한 뒤에는 저장됐으며 Local DB 결과와 일치했다.
- 기존 보고서 담당자가 불가 상태가 되면 선택 항목에 `(불가 일정)`으로 표시되고 참여자로 자동 추가되지 않았다. 저장은 `보고서 담당자 한기문` 충돌로 차단됐다.
- 다일 fixture는 동일한 Day Card 2개로 열렸다. 중복 날짜는 `측정일이 중복되었습니다`, 빈 두 번째 날짜는 `측정일 2을 입력해 주세요`로 저장이 차단됐다. 첫 날짜 삭제 후 남은 날짜를 저장하자 시작일·종료일이 모두 해당 날짜로 재계산되고 단일일 호환 형식으로 정규화됐다.
- 외부 Google Calendar write는 금지 범위라 실제 캘린더 이벤트 생성·갱신은 수행하지 않았다. 이름 정렬 규칙은 전체 테스트의 calendar-policy 행동 테스트로 검증했다.

### 검증·정리 결과

- `npx tsc --noEmit --pretty false`: 통과.
- 집중 테스트: 55/55 통과.
- `npm test`: 413/413 통과.
- `npm run build`: 통과.
- 이번 E2E 중 제품 코드 결함은 재현되지 않아 UI·API·DB migration은 수정하지 않았다. Local fixture는 검증 후 모두 삭제했고 대상·사용자·불가 일정·plan·journal 잔여가 0건임을 확인했다.
- Orca Worker A는 동일 prompt-injection stalled가 두 번 발생해 결과 없이 종료했고, 반복하지 않고 Main이 `/survey`를 검증했다. Worker B는 GPT-5.6 Terra / Medium 요청·effective 확인으로 상세 모달의 기본 체크/해제까지 확인했으며, 나머지는 Main이 이어서 검증했다. 생성 dispatch 3개, task active 0개이고 exact worker terminal은 닫혔다. Orca runtime의 resource 상태는 `release_unknown` 감사 상태 3건으로 남았다.
- Orca `eval` 기반 UI·API·DB 검증은 성공했지만 `snapshot`과 `screenshot`은 runtime/CDP timeout으로 증거 이미지를 남기지 못했다. 이는 제품 기능 실패와 분리한다.
- 최종 판정은 **PASS WITH MANUAL CHECK**다. Local UI/E2E와 persistence 경계는 통과했으며, 운영 외부 캘린더에 대한 실제 표시 확인만 운영 write 금지 때문에 별도 수동 확인 대상으로 남긴다.
