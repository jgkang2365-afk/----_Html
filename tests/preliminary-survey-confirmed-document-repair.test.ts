import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { classifyConfirmedDocumentState } from "../lib/preliminary-survey-v2/confirmed-document-repair";

describe("찐확정 누락정보 보정 경계", () => {
  it("date와 surveyor가 모두 있으면 COMPLETE이고 변화가 없다", () => {
    assert.deepEqual(classifyConfirmedDocumentState({ recommended_date: "2026-07-30", participant_user_ids: [1] }, false), {
      fillDate: false, fillSurveyors: false, classification: "COMPLETE",
    });
  });
  it("date만 NULL이면 date만 보정 대상으로 분류한다", () => {
    assert.deepEqual(classifyConfirmedDocumentState({ recommended_date: null, participant_user_ids: [1] }, false), {
      fillDate: true, fillSurveyors: false, classification: "MISSING_DOCUMENTARY_INFO",
    });
  });
  it("surveyor만 비어 있으면 surveyor만 보정 대상으로 분류한다", () => {
    assert.deepEqual(classifyConfirmedDocumentState({ recommended_date: "2026-07-30", participant_user_ids: [] }, false), {
      fillDate: false, fillSurveyors: true, classification: "MISSING_DOCUMENTARY_INFO",
    });
  });
  it("plan이 없으면 date와 surveyor 모두 보정 대상으로 분류한다", () => {
    assert.deepEqual(classifyConfirmedDocumentState(null, false), {
      fillDate: true, fillSurveyors: true, classification: "MISSING_DOCUMENTARY_INFO",
    });
  });
  it("역사/수동 보호 대상은 자동 보정하지 않는다", () => {
    assert.equal(classifyConfirmedDocumentState(null, true).classification, "PROTECTED_MANUAL");
  });
  it("SQL은 non-null overwrite를 차단하고 감사 provenance를 남기며 업무 원천을 갱신하지 않는다", () => {
    const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260827143000_add_true_confirmed_missing_documentary_repair.sql"), "utf8");
    assert.match(sql, /NON_NULL_OVERWRITE_FORBIDDEN/);
    assert.match(sql, /true_confirmed_missing_documentary_info_repair/);
    assert.match(sql, /repair_true_confirmed_preliminary_v2_missing_batch/);
    assert.match(sql, /target_row\.measurer_id IS DISTINCT FROM p_expected_source_measurer_id/);
    assert.match(sql, /target_row\.measurer_id, p_source_rule_type, p_survey_method/);
    assert.match(sql, /effective_date := CASE WHEN p_fill_date/);
    assert.match(sql, /effective_participant_user_ids := CASE WHEN p_fill_surveyors/);
    assert.match(sql, /effective_date BETWEEN block\.start_date AND block\.end_date/);
    const existingPlanUpdate = sql.match(/UPDATE public\.preliminary_survey_v2_plans SET([\s\S]*?)WHERE id = plan_row\.id/)?.[1] ?? "";
    assert.doesNotMatch(existingPlanUpdate, /recommendation_reason|updated_at/);
    assert.doesNotMatch(sql, /UPDATE\s+public\.measurement_target_business/i);
    assert.doesNotMatch(sql, /UPDATE\s+public\.measurement_journal/i);
    assert.doesNotMatch(sql, /preliminary_survey_v2_measurement_assignments\s+SET/i);
  });
  it("일반 apply와 누락 보정 apply API가 분리되어 있다", () => {
    const ui = fs.readFileSync(path.join(process.cwd(), "components/features/PreliminarySurveyV2Plans.tsx"), "utf8");
    const api = fs.readFileSync(path.join(process.cwd(), "app/api/preliminary-survey-v2/confirmed-document-repair/route.ts"), "utf8");
    assert.match(ui, /action: "apply",\s*targetIds: confirmedRepairDrafts/);
    assert.match(ui, /누락정보 보정/);
    assert.match(ui, /예비조사 자동 배정/);
    assert.match(api, /repair_true_confirmed_preliminary_v2_missing_batch/);
    assert.doesNotMatch(api, /for \(const draft of canonical\)/);
  });
  it("자동 배정 모달이 보호 누락정보 repair preview/apply를 같은 workflow로 연결한다", () => {
    const ui = fs.readFileSync(path.join(process.cwd(), "components/features/FixedAssigneeReversePlanner.tsx"), "utf8");
    assert.match(ui, /confirmed-document-repair/);
    assert.match(ui, /action: "preview", targetIds: protectedTargetIds/);
    assert.match(ui, /action: "apply", targetIds: repairable\.map/);
    assert.match(ui, /누락정보 보정 가능/);
    assert.match(ui, /일반 자동배정 .* 완료되었습니다/);
  });
  it("관리 열은 모든 행에 삭제 버튼을 렌더링하고 상세 모달의 중복 진입점은 없다", () => {
    const ui = fs.readFileSync(path.join(process.cwd(), "components/features/PreliminarySurveyV2Plans.tsx"), "utf8");
    assert.match(ui, /"보고서담당", "상태", "구분", "관리", "확인사항"/);
    assert.match(ui, /저장된 예비조사 계획이 없습니다\./);
    assert.match(ui, /확정 계획은 삭제할 수 없습니다\./);
    assert.match(ui, /역사 복원 보호 계획입니다\./);
    assert.equal((ui.match(/>계획 삭제<\/Button>/g) ?? []).length, 0);
  });
});
