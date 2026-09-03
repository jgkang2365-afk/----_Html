import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { classifyConfirmedDocumentState, isCanonicalAutoSurveyorCombination, orderRepairReviewerCandidates, selectRepairReviewerCandidate } from "../lib/preliminary-survey-v2/confirmed-document-repair";
import { buildTargetBusinessEditPatch } from "../lib/business/target-business-form";
import { defaultEmptyParticipantsToReportWriter, measurementDayFormsFrom } from "../lib/business/measurement-day-form";
import { validateManualPlanHardRules } from "../lib/preliminary-survey-v2/manual-validation";
import { storedPlanWorkbenchState } from "../lib/preliminary-survey-v2/workbench-status";

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
  it("자동 보정 조합은 Canonical exact role shape만 허용한다", () => {
    const experienced = { id: 15, experienced: true };
    const novice = { id: 2, experienced: false };
    assert.equal(isCanonicalAutoSurveyorCombination([experienced], 15, null), true);
    assert.equal(isCanonicalAutoSurveyorCombination([experienced, novice], 2, 15), true);
    assert.equal(isCanonicalAutoSurveyorCombination([novice], 2, null), false);
    assert.equal(isCanonicalAutoSurveyorCombination([{ id: 2, experienced: false }, { id: 3, experienced: false }], 2, 3), false);
    assert.equal(isCanonicalAutoSurveyorCombination([{ id: 15, experienced: true }, { id: 17, experienced: true }], 15, 17), false);
    assert.equal(isCanonicalAutoSurveyorCombination([experienced, novice, { id: 16, experienced: false }], 2, 15), false);
  });
  it("responsible별 preferred reviewer를 유효 후보의 첫 순서로 둔다", () => {
    const users = [
      { id: 17, name: "한기문", experienced: true },
      { id: 15, name: "이태환", experienced: true },
      { id: 13, name: "이주형", experienced: true },
    ];
    assert.equal(orderRepairReviewerCandidates({ id: 2, name: "강종구", experienced: false }, users)[0].name, "이태환");
    assert.equal(orderRepairReviewerCandidates({ id: 16, name: "고유빈", experienced: false }, users)[0].name, "이주형");
    assert.equal(orderRepairReviewerCandidates({ id: 20, name: "김민영", experienced: false }, users)[0].name, "한기문");
  });
  it("실제 reviewer 선택 helper가 preferred·fallback·수동검토를 결정한다", async () => {
    const experienced = (id: number, name: string) => ({ id, name, experienced: true, active: true });
    const cases = [
      [{ id: 2, name: "강종구", experienced: false, active: true }, [experienced(17, "한기문"), experienced(15, "이태환")], [15, 17]],
      [{ id: 16, name: "고유빈", experienced: false, active: true }, [experienced(17, "한기문"), experienced(13, "이주형")], [13, 17]],
      [{ id: 20, name: "김민영", experienced: false, active: true }, [experienced(15, "이태환"), experienced(17, "한기문")], [17, 15]],
    ] as const;
    for (const [responsible, candidates, expected] of cases) {
      assert.equal((await selectRepairReviewerCandidate(responsible, [...candidates], async (candidate) => candidate.id === expected[0]))?.id, expected[0]);
      assert.equal((await selectRepairReviewerCandidate(responsible, [...candidates], async (candidate) => candidate.id !== expected[0]))?.id, expected[1]);
      assert.equal(await selectRepairReviewerCandidate(responsible, [...candidates], async () => false), null);
    }
  });
  it("기본 체크 유지 시 collaborators에 보고서 담당자를 저장한다", () => {
    const source = measurementDayFormsFrom({ dailyStaff: null, measurementDate: "2026-09-03", measurerId: 16, collaborators: null });
    const uiDays = defaultEmptyParticipantsToReportWriter(source, [{ id: 16, name: "고유빈" }] as any);
    const patch = buildTargetBusinessEditPatch(
      { code: "H0452", business_name: "QA", measurer_id: 16, collaborators: null } as any,
      { code: "H0452", business_name: "QA", measurer_id: 16, collaborators: null } as any,
      source,
      uiDays,
    );
    assert.equal(patch.collaborators, "고유빈");
    const readSource = measurementDayFormsFrom({ dailyStaff: null, measurementDate: "2026-09-03", measurerId: 16, collaborators: patch.collaborators });
    assert.deepEqual(readSource[0].collaborators, ["고유빈"]);
    assert.equal(readSource[0].measurerId, 16);
  });
  it("사용자가 측정 참여자 체크를 해제하면 보고서 담당자를 재삽입하지 않는다", () => {
    const source = measurementDayFormsFrom({ dailyStaff: null, measurementDate: "2026-09-03", measurerId: 16, collaborators: null });
    const uncheckedDays = source.map((day) => ({ ...day, collaborators: [] }));
    const patch = buildTargetBusinessEditPatch(
      { code: "H0452", business_name: "QA", measurer_id: 16, collaborators: null } as any,
      { code: "H0452", business_name: "QA", measurer_id: 16, collaborators: [] } as any,
      source,
      uncheckedDays,
    );
    assert.equal(patch.collaborators, undefined);
    const component = fs.readFileSync(path.join(process.cwd(), "components/features/MeasurementTargetBusinessManagement.tsx"), "utf8");
    assert.match(component, /const measurementDays = editMeasurementDays;/);
  });
  it("Repair hard rule은 참여자·보고서 담당자만의 일치를 공시료 담당자 일치로 인정하지 않는다", async () => {
    const target = { id: 1, code: "H0452", name: "QA", kind: "existing" as const, measurementDate: "2026-09-03", businessType: "existing" as const,
      responsible: { id: 2, name: "강종구", experienced: false, active: true }, address: null, region: null, coordinate: null,
      measurementAssigneeUserIds: [16], createdAt: "2026-09-01T00:00:00Z" };
    const participants = [{ id: 2, name: "강종구", experienced: false, active: true }, { id: 15, name: "이태환", experienced: true, active: true }];
    const result = await validateManualPlanHardRules({ target, recommendedDate: "2026-08-25", participants, surveyMethod: "phone", existingAssignments: [], routes: { byPair: new Map() } as any });
    assert.ok(result.errors.some((error) => error.includes("공시료 담당자")));
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
    assert.match(api, /REPAIR_CANONICAL_ROLE_INVALID/);
    assert.match(api, /isCanonicalAutoSurveyorCombination/);
    assert.doesNotMatch(api, /for \(const draft of canonical\)/);
  });
  it("공시료 assignment 조회는 실제 plan_id 관계를 사용하고 존재하지 않는 target FK 컬럼을 조회하지 않는다", () => {
    const service = fs.readFileSync(path.join(process.cwd(), "lib/preliminary-survey-v2/service.ts"), "utf8");
    const api = fs.readFileSync(path.join(process.cwd(), "app/api/preliminary-survey-v2/confirmed-document-repair/route.ts"), "utf8");
    for (const source of [service, api]) {
      assert.match(source, /preliminary_survey_v2_plans/);
      assert.match(source, /preliminary_survey_v2_measurement_assignments/);
      assert.match(source, /plan_id/);
      assert.doesNotMatch(source, /from\("preliminary_survey_v2_measurement_assignments"\)[\s\S]{0,180}measurement_target_business_id/);
    }
  });
  it("측정대상사업장 저장 경계에서 보고서 담당자 기본 참여자를 보장한다", () => {
    const businessUi = fs.readFileSync(path.join(process.cwd(), "components/features/MeasurementTargetBusinessManagement.tsx"), "utf8");
    assert.match(businessUi, /저장 경계에서도 보고서 담당자 기본 참여자 값을 보장한다/);
    assert.match(businessUi, /const sourceDays = measurementDayFormsFrom\(/);
    assert.match(businessUi, /const initialDays = defaultEmptyParticipantsToReportWriter\(sourceDays/);
    assert.match(businessUi, /const measurementDays = editMeasurementDays;/);
  });
  it("자동 배정 모달이 보호 누락정보 repair preview/apply를 같은 workflow로 연결한다", () => {
    const ui = fs.readFileSync(path.join(process.cwd(), "components/features/FixedAssigneeReversePlanner.tsx"), "utf8");
    assert.match(ui, /confirmed-document-repair/);
    assert.match(ui, /action: "preview",[\s\S]*targetIds: protectedTargetIds/);
    assert.match(ui, /action: "apply", targetIds: repairable\.map/);
    assert.match(ui, /누락정보 보정 가능/);
    assert.match(ui, /일반 자동배정 .* 완료되었습니다/);
  });
  it("Reverse Planner에서 사용자가 배정 확정한 automatic plan은 가확정으로 표시하고 legacy automatic은 재검토를 유지한다", () => {
    const base = {
      trueConfirmed: false, stale: false, hasPlan: true, planOrigin: "automatic", planStatus: "recommended",
      preliminaryScheduleBlocked: false, measurementScheduleBlocked: false, measurementRoleScheduleBlocked: false,
    };
    assert.equal(storedPlanWorkbenchState({ ...base, reviewedAutomatic: true }).status, "provisional");
    assert.equal(storedPlanWorkbenchState({ ...base, reviewedAutomatic: false }).status, "review_required");
    assert.equal(storedPlanWorkbenchState({ ...base, reviewedAutomatic: true, stale: true }).status, "review_required");
    assert.equal(storedPlanWorkbenchState({ ...base, reviewedAutomatic: true, measurementScheduleBlocked: true }).status, "review_required");
  });
  it("누락정보 보정 Preview는 apply RPC보다 먼저 반환되는 read-only 경로다", () => {
    const api = fs.readFileSync(path.join(process.cwd(), "app/api/preliminary-survey-v2/confirmed-document-repair/route.ts"), "utf8");
    const previewReturn = api.indexOf('if (body.action === "preview") return NextResponse.json');
    const applyRpc = api.indexOf('repair_true_confirmed_preliminary_v2_missing_batch');
    assert.ok(previewReturn >= 0 && applyRpc > previewReturn);
    const builder = fs.readFileSync(path.join(process.cwd(), "lib/preliminary-survey-v2/confirmed-document-repair.ts"), "utf8");
    const start = builder.indexOf("export async function buildConfirmedDocumentRepairPreview");
    const end = builder.indexOf("\nexport ", start + 10);
    const previewBuilder = builder.slice(start, end > start ? end : undefined);
    assert.doesNotMatch(previewBuilder, /\.(?:insert|update|delete|upsert|rpc)\(/);
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
