import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  v2BusinessKindLabel,
  v2StatusLabel,
  v2SurveyMethodLabel,
  v2WarningLabel,
} from "../lib/preliminary-survey-v2/presentation";

const read = (path: string) => readFileSync(path, "utf8");
const route = read("app/api/preliminary-survey-v2/plans/route.ts");
const component = read("components/features/PreliminarySurveyV2Plans.tsx");
const page = read("app/survey/page.tsx");
const workbenchRoute = read("app/api/preliminary-survey-v2/workbench/route.ts");
const migration = read("supabase/migrations/20260808_add_preliminary_survey_v2.sql");

test("V2 계획 GET은 V2 테이블만 읽고 mutation을 수행하지 않음", () => {
  assert.match(route, /checkPermission\("survey:read"\)/);
  assert.match(route, /from\("preliminary_survey_v2_plans"\)/);
  assert.doesNotMatch(route, /from\("preliminary_survey_plans"\)/);
  assert.doesNotMatch(route, /\.update\(|\.insert\(|\.delete\(|\.upsert\(|\.rpc\(/);
});

test("V2 화면은 단일 작업대 API와 테이블을 사용하고 PR #9 동작을 노출하지 않음", () => {
  assert.match(page, /PreliminarySurveyV2Plans/);
  assert.match(page, /activeTab === "plans"/);
  assert.match(component, /\/api\/preliminary-survey-v2\/workbench/);
  assert.match(component, /<table/);
  assert.doesNotMatch(component, /preliminary-survey-plans/);
  assert.doesNotMatch(component, /MANUAL_SELECTION_APPLIED|PAST_PRELIMINARY_SURVEY_DATE|NO_AVAILABLE_DATE/);
});

test("V2 표시값은 사용자용 한글로 변환됨", () => {
  assert.equal(v2StatusLabel("recommended"), "추천 완료");
  assert.equal(v2StatusLabel("manual_required"), "수동 조정 필요");
  assert.equal(v2SurveyMethodLabel("field"), "현장 방문");
  assert.equal(v2SurveyMethodLabel("phone"), "전화");
  assert.equal(v2BusinessKindLabel("existing", null), "기존");
  assert.equal(v2BusinessKindLabel("new", { evidence: { classificationSource: { rawValue: "타기관 신규" } } }), "타기관 신규");
  assert.equal(v2BusinessKindLabel("new", { evidence: { classificationSource: { rawValue: "external_new" } } }), "타기관 신규");
  assert.equal(v2BusinessKindLabel("new", { evidence: { classificationSource: { rawValue: "신규" } } }), "최초실시");
  assert.doesNotMatch(v2WarningLabel("NO_AVAILABLE_DATE_THROUGH_MINUS_3"), /^[A-Z0-9_]+$/);
});

test("V2 생성과 수동 수정은 관리자 또는 예비조사 담당자에게만 허용됨", () => {
  assert.match(workbenchRoute, /canManagePreliminarySurvey\(supabase, session\)/);
  const manualRoute = read("app/api/preliminary-survey-v2/[targetId]/route.ts");
  assert.match(manualRoute, /canManagePreliminarySurvey\(supabase, session\)/);
});

test("V2 migration은 기존 테이블/RPC를 사용하며 legacy 원본을 수정하지 않음", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.preliminary_survey_v2_plans/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.persist_preliminary_survey_v2_plan/);
  for (const column of [
    "measurement_target_business_id", "recommended_date", "responsible_user_id",
    "experienced_reviewer_id", "participant_user_ids", "participant_names", "status",
    "plan_origin", "source_measurement_date", "source_responsible_user_id", "source_rule_type",
    "survey_method", "recommendation_reason", "route_evidence", "warnings", "created_at", "updated_at",
  ]) assert.match(migration, new RegExp(column));
  assert.doesNotMatch(migration, /UPDATE public\.preliminary_survey\s/);
  assert.doesNotMatch(migration, /DROP TABLE[^;]*(preliminary_survey|preliminary_survey_plans)/);
});
