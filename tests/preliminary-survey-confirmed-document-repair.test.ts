import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { classifyConfirmedDocumentState, firstValidConfirmedRepairDate, hasAuthoritativeBusinessTypePlanMismatch } from "../lib/preliminary-survey-v2/confirmed-document-repair";

describe("찐확정 누락정보 보정 경계", () => {
  it("date와 surveyor가 모두 있으면 COMPLETE이고 변화가 없다", () => {
    assert.deepEqual(classifyConfirmedDocumentState({ recommended_date: "2026-07-30", participant_user_ids: [1] }, false, true), {
      fillDate: false, fillSurveyors: false, fillMeasurementAssignment: false, classification: "COMPLETE",
    });
  });
  it("date만 NULL이면 date만 보정 대상으로 분류한다", () => {
    assert.deepEqual(classifyConfirmedDocumentState({ recommended_date: null, participant_user_ids: [1] }, false), {
      fillDate: true, fillSurveyors: false, fillMeasurementAssignment: true, classification: "MISSING_DOCUMENTARY_INFO",
    });
  });
  it("surveyor만 비어 있으면 surveyor만 보정 대상으로 분류한다", () => {
    assert.deepEqual(classifyConfirmedDocumentState({ recommended_date: "2026-07-30", participant_user_ids: [] }, false), {
      fillDate: false, fillSurveyors: true, fillMeasurementAssignment: true, classification: "MISSING_DOCUMENTARY_INFO",
    });
  });
  it("조사자 snapshot의 이름·책임자·검토자 중 하나라도 있으면 preview는 overwrite fill을 만들지 않는다", () => {
    for (const plan of [
      { recommended_date: "2026-07-30", participant_user_ids: [], participant_names: ["기존 조사자"] },
      { recommended_date: "2026-07-30", participant_user_ids: [], responsible_user_id: 13 },
      { recommended_date: "2026-07-30", participant_user_ids: [], experienced_reviewer_id: 16 },
    ]) {
      assert.equal(classifyConfirmedDocumentState(plan, false, true).fillSurveyors, false);
    }
  });
  it("assignment만 비어 있으면 기존 date·surveyor를 보존하고 assignment만 보정한다", () => {
    assert.deepEqual(classifyConfirmedDocumentState({ recommended_date: "2026-07-30", participant_user_ids: [1] }, false, false), {
      fillDate: false, fillSurveyors: false, fillMeasurementAssignment: true, classification: "MISSING_DOCUMENTARY_INFO",
    });
  });
  it("date-only와 surveyor-only도 기존 assignment가 있으면 각각의 NULL만 보정한다", () => {
    assert.deepEqual(classifyConfirmedDocumentState({ recommended_date: null, participant_user_ids: [1] }, false, true), {
      fillDate: true, fillSurveyors: false, fillMeasurementAssignment: false, classification: "MISSING_DOCUMENTARY_INFO",
    });
    assert.deepEqual(classifyConfirmedDocumentState({ recommended_date: "2026-07-30", participant_user_ids: [] }, false, true), {
      fillDate: false, fillSurveyors: true, fillMeasurementAssignment: false, classification: "MISSING_DOCUMENTARY_INFO",
    });
  });
  it("plan이 없으면 date와 surveyor 모두 보정 대상으로 분류한다", () => {
    assert.deepEqual(classifyConfirmedDocumentState(null, false), {
      fillDate: true, fillSurveyors: true, fillMeasurementAssignment: true, classification: "MISSING_DOCUMENTARY_INFO",
    });
  });
  it("역사 보호도 NULL 자체를 영구 잠그지 않으며 non-null 보호는 RPC가 맡는다", () => {
    assert.equal(classifyConfirmedDocumentState(null, false).classification, "MISSING_DOCUMENTARY_INFO");
  });

  it("H0288 exact 조사자는 첫 후보의 실제 측정 충돌을 건너뛰고 다음 hard-rule 통과 후보를 쓴다", async () => {
    const selected = await firstValidConfirmedRepairDate({
      candidateDates: ["2026-08-05", "2026-08-06", "2026-08-07"],
      participants: [
        { id: 13, name: "H0288-조사자1", experienced: true, active: true },
        { id: 16, name: "H0288-조사자2", experienced: true, active: true },
      ],
      blockedKeys: new Set(["13:2026-08-05", "16:2026-08-05"]),
      validate: async (date) => ({ valid: date === "2026-08-06", errors: ["capacity"], experiencedReviewer: null }),
    });
    assert.equal(selected.date, "2026-08-06");
  });

  it("H0524와 기존 non-null 문서값은 각각 첫 통과 후보와 COMPLETE 보호를 유지한다", async () => {
    const selected = await firstValidConfirmedRepairDate({
      candidateDates: ["2026-08-05", "2026-08-06"],
      participants: [{ id: 2, name: "H0524-조사자", experienced: true, active: true }],
      blockedKeys: new Set(),
      validate: async () => ({ valid: true, errors: [], experiencedReviewer: null }),
    });
    assert.equal(selected.date, "2026-08-05");
    assert.deepEqual(classifyConfirmedDocumentState({ recommended_date: "2026-08-05", participant_user_ids: [2] }, false, true), {
      fillDate: false, fillSurveyors: false, fillMeasurementAssignment: false, classification: "COMPLETE",
    });
  });
  it("SQL은 non-null overwrite를 차단하고 감사 provenance를 남기며 업무 원천을 갱신하지 않는다", () => {
    const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260830113000_fix_true_confirmed_document_repair_assignments.sql"), "utf8");
    assert.match(sql, /NON_NULL_OVERWRITE_FORBIDDEN/);
    assert.match(sql, /true_confirmed_missing_documentary_info_repair/);
    assert.match(sql, /repair_true_confirmed_preliminary_v2_missing_batch/);
    assert.match(sql, /REPAIR_EXACT_SURVEYOR_SOURCE_REQUIRED/);
    assert.match(sql, /REPAIR_EXACT_PUBLIC_SAMPLE_SOURCE_REQUIRED/);
    assert.match(sql, /measurementAssignments/);
    const existingPlanUpdate = sql.match(/UPDATE public\.preliminary_survey_v2_plans SET([\s\S]*?)WHERE id = plan_row\.id/)?.[1] ?? "";
    assert.doesNotMatch(existingPlanUpdate, /recommendation_reason|updated_at/);
    assert.doesNotMatch(sql, /UPDATE\s+public\.measurement_target_business/i);
    assert.doesNotMatch(sql, /UPDATE\s+public\.measurement_journal/i);
    assert.match(sql, /INSERT INTO public\.preliminary_survey_v2_measurement_assignments/);
    assert.match(sql, /preliminary_survey_v2_document_repair_audit/);
  });
  it("forward RPC guard는 assignment-only payload의 기존 조사자 snapshot을 alias로 정확히 보존한다", () => {
    const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260830130000_guard_true_confirmed_repair_non_null_snapshots.sql"), "utf8");
    assert.match(sql, /NOT COALESCE\(\(item->>'fillSurveyors'\)::boolean, false\)[\s\S]*incoming_participant_ids IS DISTINCT FROM plan_row\.participant_user_ids[\s\S]*incoming_participant_names IS DISTINCT FROM plan_row\.participant_names[\s\S]*responsibleUserId[\s\S]*experiencedReviewerUserId/);
    assert.match(sql, /UPDATE public\.preliminary_survey_v2_plans AS current_plan SET/);
    assert.match(sql, /ELSE current_plan\.participant_user_ids END/);
    assert.match(sql, /ELSE current_plan\.participant_names END/);
    assert.doesNotMatch(sql, /ELSE participant_names END/);
  });
  it("exact reconciliation 조사자 우선순위는 기존 plan snapshot fallback보다 앞선다", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "lib/preliminary-survey-v2/confirmed-document-repair.ts"), "utf8");
    assert.match(source, /if \(entry\.fillSurveyors && reconciledIds\.length\) participants = reconciledIds/);
    assert.match(source, /entry\.plan && entry\.fillSurveyors && !reconciledIds\.length && !legacyNames\.length/);
  });
  it("권위 business_type과 기존 non-null plan 방식이 다르면 자동 덮어쓰기 대신 수동 확인으로 분류한다", () => {
    for (const [code, businessType] of [["H0521", "first_measurement"], ["H0524", "external_new"], ["H0526", "first_measurement"]] as const) {
      assert.equal(hasAuthoritativeBusinessTypePlanMismatch(businessType, {
        source_rule_type: "existing", survey_method: "phone",
      }), true, `${code} is protected as manual review without rewriting non-null plan fields`);
    }
    assert.equal(hasAuthoritativeBusinessTypePlanMismatch("existing", {
      source_rule_type: "existing", survey_method: "phone",
    }), false);
    const source = fs.readFileSync(path.join(process.cwd(), "lib/preliminary-survey-v2/confirmed-document-repair.ts"), "utf8");
    assert.match(source, /hasAuthoritativeBusinessTypePlanMismatch/);
    assert.match(source, /businessTypePlanMismatch: hasAuthoritativeBusinessTypePlanMismatch/);
    assert.match(source, /!entry\.businessTypePlanMismatch/);
    assert.match(source, /찐확정 non-null 값은 자동 변경할 수 없습니다/);
  });
  it("일반 apply와 누락 보정 apply API가 분리되어 있다", () => {
    const ui = fs.readFileSync(path.join(process.cwd(), "components/features/PreliminarySurveyV2Plans.tsx"), "utf8");
    const api = fs.readFileSync(path.join(process.cwd(), "app/api/preliminary-survey-v2/confirmed-document-repair/route.ts"), "utf8");
    assert.match(ui, /action: "apply",\s*targetIds: confirmedRepairDrafts/);
    assert.match(ui, /누락정보 보정/);
    assert.match(ui, /추천안 적용/);
    assert.match(api, /repair_true_confirmed_preliminary_v2_missing_batch/);
    assert.doesNotMatch(api, /for \(const draft of canonical\)/);
  });
  it("관리 열은 persisted plan에만 계획 삭제를 노출하고 상세 모달의 중복 진입점은 없다", () => {
    const ui = fs.readFileSync(path.join(process.cwd(), "components/features/PreliminarySurveyV2Plans.tsx"), "utf8");
    assert.match(ui, /"보고서 담당", "관리", "충돌"/);
    assert.match(ui, /저장된 예비조사 계획이 없습니다\./);
    assert.match(ui, /찐확정 계획은 삭제할 수 없습니다\./);
    assert.match(ui, /역사 복원 보호 계획입니다\./);
    assert.match(ui, /row\.hasPersistedPlan \? <Button/);
    assert.match(ui, />계획 삭제<\/Button>/);
  });
});
