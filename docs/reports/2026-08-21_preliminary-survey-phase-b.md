# 예비조사 Phase B 구현·PR #42 보완 보고서

## Git 기준

- 시작 main SHA: `555ae773484bd1533d4b0d252f0fa12592e93ebe`
- 작업 branch: `feature/preliminary-survey-phase-b`
- PR #42 보완 시작 head SHA: `52f214a58f929df5105c39b84c1178d8ff32ad5d`
- 최종 구현 head SHA: `4dd9c7bfbb2fff3e8f2d380d58ab00f1049ea14b`
- PR: #42 `feat: rebuild preliminary survey planning workflow` (Draft 유지, merge하지 않음)

## 주요 변경 파일

- `app/api/preliminary-survey-v2/workbench/route.ts`
- `components/features/PreliminarySurveyV2Plans.tsx`
- `lib/preliminary-survey-v2/calendar.ts`
- `lib/preliminary-survey-v2/manual-validation.ts`
- `lib/preliminary-survey-v2/measurement-staff.ts`
- `tests/preliminary-survey-phase-b.test.ts`
- `tests/preliminary-survey-v2-stale-source-sqlstate.test.ts`

## 탭·계획·목록 UI

- 기본 탭 순서 `계획 → 목록 → 검색 → 제외 일정`, HTML5 drag & drop, localStorage 복원, 오류 fallback, 누락 탭 보완, 기본 순서 복원을 유지했다.
- 계획 화면은 카드 목록 없이 12개 필수 컬럼 테이블만 사용한다.
- 계획 상단을 `연도 | 반기 | 상태 | 구분 | 액션 3개`의 compact 단일 toolbar로 바꾸고 액션을 우측 정렬했다.
- 목록 상단은 연도·반기·상태·구분·예비조사일·측정예정일·조사자·방식 8개 필터를 데스크톱 한 줄에 배치하고 좁은 화면에서만 줄바꿈한다.
- 목록은 최초실시·타기관 신규·기존업체를 같은 workbench source-of-truth에서 통합 조회하며, 업체 상세의 수동 수정·개별 재추천 UI를 유지한다.

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
- `npx tsx --test tests/preliminary-survey-phase-b.test.ts`: 7/7 통과
- Phase B 및 V2 관련 회귀 묶음: 144/144 통과
- `npm test`: 362/362 통과
- `npm run build`: 통과 (`Compiled successfully`, static pages 69/69)
- Windows CRLF 환경에서 기존 stale-source SQL 문자열 테스트 1건이 LF만 허용해 최초 실패했고, 동작 코드나 migration을 바꾸지 않고 정규식을 `\r?\n`으로 보완한 뒤 통과했다.
- 실행 중인 dev와 동일 `.next`를 사용한 첫 build가 정체·충돌해 해당 build만 중단했다. 이후 시스템 임시 복제 디렉터리에서 build를 통과시켰고, 3000번 dev는 같은 `npm run dev:turbo`로 복구해 `/survey` HTTP 200을 재확인했다.

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
- Orca screenshot은 브라우저 창 focus 문제로 timeout됐으나, 같은 연결의 실제 페이지에서 DOM 좌표·클릭·drag/drop·reload 결과는 정상 수집했다.

## 브라우저 미완료 항목과 사유

- 현재 Orca 로그인 세션은 관리자 계정이 아니어서 상단 추천 생성과 업체별 재추천 요청이 서버 403 `관리자만 추천안을 생성·적용할 수 있습니다.`로 차단됐다.
- 따라서 실제 draft 생성, draft 기반 대안 상세, 성공 apply, preview와 저장 row의 실DB 동일성은 브라우저에서 완료하지 않았다.
- 안전한 관리자 테스트 대상과 권한이 확인되지 않은 상태에서 계정 전환, 추천안 적용, 수동 저장을 강행하지 않았다.
- 위 저장 경계는 코드 경로, Phase B 테스트, stale-source/atomic batch 회귀로 검증했지만 관리자 브라우저 end-to-end 확인은 남아 있다.

## 알려진 제한사항

- 관리자 권한의 안전한 테스트 데이터 환경에서 `추천 생성 → 업체별 재추천 → 추천안 적용` 성공 흐름과 실제 저장값 동일성을 추가 확인해야 한다.
- 실제 외부 차량 경로 API 응답을 사용하는 운영 데이터 조합은 이번 브라우저 검증에서 실행하지 않았다.
- build 검증용 시스템 임시 복제 폴더는 로컬 실행 정책이 recursive delete를 차단해 저장소 밖에 남아 있다. Git과 실행 중 dev에는 영향이 없다.
- 찐확정 관리자 정비는 기존 admin repair 경로를 유지하며 일반 작업대 모달에서는 제공하지 않는다.

## 남은 TODO

- 관리자 권한과 안전한 테스트 대상을 준비해 preview/apply 성공 E2E를 완료한다.
- 새 시스템 안정화 후 별도 Phase에서 기존 V2 plan을 `automatic / manual / 실제 사용·확정 / 미사용 구형`으로 분류한다.
- 각 분류별 유지·마이그레이션·archive·삭제 여부를 결정한다.
- 새 시스템 안정화 확인 전 구형 V2 데이터를 삭제하지 않는다.

## 모델별 작업 수행 현황

| 모델 | 추론 강도 | 수행 작업 | 결과/반영 여부 | 실행/사용량 |
| --- | --- | --- | --- | --- |
| GPT-5.6 Sol | Medium | PR #42 보완 분석, 구현, 테스트, Orca 브라우저 검증, 보고서·Git 작업 | 실제 수행 결과 반영 | 주 작업자 단일 세션, 토큰/credits 확인 불가 |
| GPT-5.6 Terra | - | 미사용 | 미반영 | 0회 |
| GPT-5.6 Luna | - | 미사용 | 미반영 | 0회 |

- 하위 worker/agent는 사용하지 않았다.
- 모델별 토큰·credits는 이 세션에서 확인할 수 없어 추정하지 않았다.
