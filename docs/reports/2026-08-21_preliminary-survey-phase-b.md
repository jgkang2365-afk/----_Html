# 예비조사 Phase B 구현·PR #42 보완 보고서

## Git 기준

- 시작 main SHA: `555ae773484bd1533d4b0d252f0fa12592e93ebe`
- 작업 branch: `feature/preliminary-survey-phase-b`
- PR #42 보완 시작 head SHA: `52f214a58f929df5105c39b84c1178d8ff32ad5d`
- 측정예정일 검색 scope 최종 구현 head SHA: `fbd451c81187f87c74dac948a3074b237451a27f`
- 측정예정일 검색 scope 최종 구현 commit SHA: `fbd451c81187f87c74dac948a3074b237451a27f`
- PR #42 구현 head SHA: `fbd451c81187f87c74dac948a3074b237451a27f`
- 원천 데이터 검증 시작 head SHA: `5dbf55b5fd6b781883174ccab0cc87e031ec6d53`
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
