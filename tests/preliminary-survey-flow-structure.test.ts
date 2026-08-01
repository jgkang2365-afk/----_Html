import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("사업장 POST는 예비조사 대상 구분을 필수 검증하고 서버에서 현장 여부를 계산한다", () => {
  const route = read("app/api/businesses/route.ts");

  assert.match(route, /PRELIMINARY_SURVEY_RULE_TYPE_REQUIRED/);
  assert.match(route, /INVALID_PRELIMINARY_SURVEY_RULE_TYPE/);
  assert.match(
    route,
    /requires_field_preliminary_survey:\s*requiresFieldPreliminarySurvey\(preliminary_survey_rule_type\)/,
  );
});

test("신규등록 화면의 예비조사 대상 구분에는 기본 선택값이 없다", () => {
  const component = read(
    "components/features/MeasurementTargetBusinessManagement.tsx",
  );

  assert.match(component, /preliminary_survey_rule_type:\s*""/);
  assert.match(component, /예비조사 대상 구분/);
  assert.match(component, /기존업체/);
  assert.match(component, /일반 신규/);
  assert.match(component, /타기관 신규/);
  assert.match(component, /신규 여부 미확정/);
});

test("기존 행은 existing/false 기본값으로 두고 측정대상 일괄 분류를 하지 않는다", () => {
  const migration = read(
    "supabase/migrations/20260731_add_preliminary_survey_recommendation_mvp.sql",
  );

  assert.match(
    migration,
    /preliminary_survey_rule_type TEXT NOT NULL DEFAULT 'existing'/,
  );
  assert.match(
    migration,
    /requires_field_preliminary_survey BOOLEAN NOT NULL DEFAULT FALSE/,
  );
  assert.doesNotMatch(migration, /UPDATE public\.measurement_target_business/i);
});

test("미경력 사용자의 동행 지원 자동배정은 API와 DB에서 모두 거부한다", () => {
  const createRoute = read("app/api/users/route.ts");
  const updateRoute = read("app/api/users/[id]/route.ts");
  const migration = read(
    "supabase/migrations/20260731_add_preliminary_survey_recommendation_mvp.sql",
  );

  assert.match(createRoute, /PRELIMINARY_SURVEY_SUPPORT_REQUIRES_EXPERIENCE/);
  assert.match(updateRoute, /PRELIMINARY_SURVEY_SUPPORT_REQUIRES_EXPERIENCE/);
  assert.match(migration, /users_preliminary_survey_support_requires_experience/);
});

test("불완전한 공휴일 데이터의 관리자 확정은 상태 snapshot과 확인 사유를 감사한다", () => {
  const migration = read(
    "supabase/migrations/20260731_add_preliminary_survey_recommendation_mvp.sql",
  );
  const confirmRoute = read(
    "app/api/preliminary-survey-plans/[planId]/confirm/route.ts",
  );

  assert.match(migration, /holiday_verification_status/);
  assert.match(migration, /holiday_verification_override_by/);
  assert.match(migration, /holiday_verification_override_at/);
  assert.match(migration, /holiday_verification_override_reason/);
  assert.match(migration, /holiday_calendar_status_snapshot/);
  assert.match(confirmRoute, /HOLIDAY_OVERRIDE_ADMIN_REQUIRED/);
  assert.match(confirmRoute, /HOLIDAY_OVERRIDE_REASON_REQUIRED/);
});

test("1차 구현은 큐·워커를 추가하지 않고 자동 사업장 저장에서 외부 캘린더를 조회하지 않는다", () => {
  const migration = read(
    "supabase/migrations/20260731_add_preliminary_survey_recommendation_mvp.sql",
  );
  const service = read("lib/preliminary-survey/service.ts");
  const businessesRoute = read("app/api/businesses/route.ts");

  assert.doesNotMatch(migration, /queue|lease|claim|completed/i);
  assert.doesNotMatch(service, /listEvents|@\/lib\/google|geocod|coordinate/i);
  assert.doesNotMatch(businessesRoute, /loadPreliminarySurveyCalendarSignals/);
  assert.doesNotMatch(service, /preliminary_surveyor.*강종구|이태환.*한기문/);
});

test("기존업체 추천 확장은 원본을 재작성하지 않고 후속 migration으로 적용한다", () => {
  const migration = read(
    "supabase/migrations/20260731_extend_existing_business_preliminary_survey_recommendation.sql",
  );
  const component = read(
    "components/features/MeasurementTargetBusinessManagement.tsx",
  );

  assert.match(migration, /existing_field_visit/);
  assert.match(migration, /source_rule_type/);
  assert.doesNotMatch(component, /자동 추천 제외/);
  assert.match(component, /유선 파악 가능 · 추천은 방문 일정 기준/);
});

test("사업장 수정 모달은 측정자 아래와 하단 중앙 버튼에서 핵심 추천 정보를 연다", () => {
  const component = read(
    "components/features/MeasurementTargetBusinessManagement.tsx",
  );

  assert.match(component, /showPreliminarySurveyInfo/);
  assert.match(component, />예비조사일</);
  assert.match(component, /예비조사 조합/);
  assert.match(component, /최우선 추천/);
  assert.match(component, /선택한 추천안 적용/);
  assert.equal(component.match(/추천 전/g)?.length, 1);
  assert.match(component, /justify-self-center[\s\S]*예비조사 정보 추천/);
});

test("사업장 수정 모달은 추천 기준 변경사항을 저장한 뒤 닫지 않고 바로 추천한다", () => {
  const component = read(
    "components/features/MeasurementTargetBusinessManagement.tsx",
  );

  assert.match(
    component,
    /if \(hasUnsavedPreliminarySurveySource\(\)\)[\s\S]*await saveChanges\(editingItem\.code, sourceUpdates, editingItem\)[\s\S]*handlePreliminarySurveyRecommend\(recommendationTarget\)/,
  );
  assert.match(component, /모달을 닫지 않은 채 추천안 3개를 새로 계산합니다/);
});

test("사업장 측정일 삭제는 시작일과 종료일 빈 문자열을 null로 정규화한다", () => {
  const component = read(
    "components/features/MeasurementTargetBusinessManagement.tsx",
  );
  const route = read("app/api/businesses/route.ts");

  assert.match(component, /raw\.measurement_date === ""[\s\S]*measurement_date = null/);
  assert.match(component, /raw\.measurement_end_date === ""[\s\S]*measurement_end_date = null/);
  assert.match(route, /"measurement_date",[\s\S]*"measurement_end_date",[\s\S]*"future_measurement_date"/);
  assert.match(route, /updatePayload\[dateColumn\] === ""[\s\S]*updatePayload\[dateColumn\] = null/);
});

test("직원 제외 일정은 전체 및 다중 선택을 한 번의 원자적 insert로 저장한다", () => {
  const component = read("components/features/UserScheduleBlockManagement.tsx");
  const route = read("app/api/user-schedule-blocks/route.ts");

  assert.match(component, />\s*전체\s*</);
  assert.match(component, /userIds: \[\] as string\[\]/);
  assert.match(component, /form\.userIds\.map\(Number\)/);
  assert.match(route, /Array\.isArray\(body\.userIds\)/);
  assert.match(route, /\.insert\(userIds\.map/);
});

test("예비조사 추천 수동 변경은 서버에서 일정 조건을 재검증한 뒤 저장한다", () => {
  const component = read(
    "components/features/MeasurementTargetBusinessManagement.tsx",
  );
  const service = read("lib/preliminary-survey/service.ts");
  const route = read(
    "app/api/preliminary-survey-plans/[planId]/manual/route.ts",
  );

  assert.match(component, /manualPreliminaryDate/);
  assert.match(component, /manualPreliminaryUserId/);
  assert.match(component, /manualPreliminaryExperiencedUserId/);
  assert.match(component, /선택한 추천안 적용/);
  assert.match(component, /buildPreliminaryRecommendationOptions/);
  assert.match(component, /다른 날짜나 직원을 선택해 주세요/);
  assert.match(service, /USER_SCHEDULE_BLOCK_CONFLICT/);
  assert.match(service, /DIFFERENT_REGION_MEASUREMENT_CONFLICT/);
  assert.match(service, /RECOMMENDED_DATE_OUT_OF_RANGE/);
  assert.match(service, /RECOMMENDATION_OPTION_NOT_ALLOWED/);
  assert.match(route, /expectedRowVersion/);
});

test("예비조사 목록은 추천 계획의 날짜와 초보·경력 조사자를 함께 표시한다", () => {
  const surveyRoute = read("app/api/survey/route.ts");
  const surveyPage = read("app/survey/page.tsx");
  const service = read("lib/preliminary-survey/service.ts");

  assert.match(surveyRoute, /preliminary_survey_date/);
  assert.match(surveyRoute, /preliminary_survey_plan_surveyors/);
  assert.match(surveyPage, />예비조사일</);
  assert.match(surveyPage, /preliminary_survey_plan_surveyors \|\| survey\.preliminary_surveyor/);
  assert.match(service, /MANUAL_NOVICE_REQUIRES_EXPERIENCED_COMPANION/);
  assert.match(service, /p_responsible_user_id: result\.responsibleUserId/);
  assert.match(service, /RESPONSIBLE_DIFFERS_FROM_MEASURER/);
});

test("추천은 공시료 기준 측정자를 우선하고 2026년 7월은 다른 주 담당자로 대체하지 않는다", () => {
  const service = read("lib/preliminary-survey/service.ts");
  const businessRoute = read("app/api/businesses/route.ts");
  const assignment = read("lib/utils/survey-assignment.ts");

  assert.match(service, /preliminary_survey[\s\S]*select\("measurer, measurement_date"\)/);
  assert.match(service, /measurementDate >= "2026-07-01"[\s\S]*measurementDate <= "2026-07-31"/);
  assert.match(service, /strictPublicSampleMeasurerMatch \? \[\] : users\.filter/);
  assert.match(service, /syncPlanSurveyorsToPreliminarySurvey/);
  assert.match(businessRoute, /measurer: scheduledMeasurer \|\| null/);
  assert.match(businessRoute, /resolveSurveyAssignment\([\s\S]*confirmOverlap: true/);
  assert.match(assignment, /assignmentNumber === 2 \? `\$\{baseCode\}\$\{baseCode\}` : baseCode/);
});
