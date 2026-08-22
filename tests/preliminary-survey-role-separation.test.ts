import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  changeMeasurementDayReportWriter,
  defaultEmptyParticipantsToReportWriter,
  serializeMeasurementDayForms,
  validateMeasurementDayForms,
} from "../lib/business/measurement-day-form";
import { measurementStaffForDate } from "../lib/preliminary-survey-v2/measurement-staff";

const businessApi = readFileSync("app/api/businesses/route.ts", "utf8");
const businessUi = readFileSync("components/features/MeasurementTargetBusinessManagement.tsx", "utf8");
const workbench = readFileSync("app/api/preliminary-survey-v2/workbench/route.ts", "utf8");
const service = readFileSync("lib/preliminary-survey-v2/service.ts", "utf8");
const policy = readFileSync("docs/business-rules/preliminary-survey.md", "utf8");
const access = readFileSync("lib/preliminary-survey-v2/access.ts", "utf8");
const targetApi = readFileSync("app/api/preliminary-survey-v2/[targetId]/route.ts", "utf8");
const managerMigration = readFileSync("supabase/migrations/20260822_add_preliminary_survey_manager.sql", "utf8");

test("보고서 담당·측정 참여자·예비조사자·측정자 공시료는 독립 역할이다", () => {
  assert.doesNotMatch(businessApi, /기존 예비조사자 전원이 실제 측정 인원에서 빠집니다/);
  assert.doesNotMatch(businessApi, /연계측정자는 실제 측정 인원에 반드시 포함/);
  assert.doesNotMatch(service, /!responsible && "link_measurer"/);
  assert.match(workbench, /assignMeasurementAssignees/);
  assert.match(policy, /측정자, 메인측정자, 공시료 담당자는 같은 역할/);
});

test("사업장 상세는 측정 참여자 용어와 해제 가능한 보고서 담당 기본 체크를 사용한다", () => {
  assert.match(businessUi, /측정 참여자 \(복수 선택\)/);
  assert.doesNotMatch(businessUi, /조력자 \(복수 선택\)/);
  assert.match(businessUi, /defaultEmptyParticipantsToReportWriter/);
  assert.match(businessUi, /changeMeasurementDayReportWriter/);
  assert.doesNotMatch(businessUi, /disabled=\{isLink\}/);
  assert.doesNotMatch(businessUi, /checked=\{isChecked \|\| isLink\}/);
});

test("모달 초기화는 참여자가 빈 날짜에만 보고서 담당자를 기본 체크한다", () => {
  const result = defaultEmptyParticipantsToReportWriter([
    { date: "2026-08-25", measurerId: 1, collaborators: [] },
    { date: "2026-08-26", measurerId: 1, collaborators: ["김민영"] },
  ], [{ id: 1, name: " 한기문 " }]);
  assert.deepEqual(result[0].collaborators, ["한기문"]);
  assert.deepEqual(result[1].collaborators, ["김민영"]);
});

test("보고서 담당 변경은 새 담당자를 추가하되 기존 참여자를 보존하고 중복을 제거한다", () => {
  const changed = changeMeasurementDayReportWriter(
    { date: "2026-08-25", measurerId: 1, collaborators: ["김민영", " 김민영 "] },
    2,
    " 강종구 ",
  );
  assert.equal(changed.measurerId, 2);
  assert.deepEqual(changed.collaborators, ["김민영", "강종구"]);
});

test("단일 빈 측정일은 미실시 null로 저장한다", () => {
  assert.deepEqual(serializeMeasurementDayForms([
    { date: "", measurerId: null, collaborators: [] },
  ]), {
    daily_staff: null,
    measurement_date: null,
    measurement_end_date: null,
    measurer_id: null,
    collaborators: null,
  });
});

test("다일 측정의 빈 날짜·중복 날짜·잘못된 날짜를 저장 전에 차단한다", () => {
  assert.equal(validateMeasurementDayForms([
    { date: "2026-08-25", measurerId: 1, collaborators: [] },
    { date: "", measurerId: 1, collaborators: [] },
  ]).valid, false);
  assert.deepEqual(validateMeasurementDayForms([
    { date: "2026-08-25", measurerId: 1, collaborators: [] },
    { date: "2026-08-25", measurerId: 2, collaborators: [] },
  ]), {
    valid: false,
    code: "DUPLICATE_MEASUREMENT_DATE",
    message: "측정일이 중복되었습니다: 1, 2",
  });
  assert.equal(validateMeasurementDayForms([
    { date: "2026-02-30", measurerId: 1, collaborators: [] },
  ]).valid, false);
  assert.throws(() => serializeMeasurementDayForms([
    { date: "2026-08-25", measurerId: 1, collaborators: [] },
    { date: "", measurerId: 1, collaborators: [] },
  ]), /INCOMPLETE_MULTI_DAY_MEASUREMENT/);
});

test("다일 측정의 시작일·종료일은 정렬된 유효 날짜로 재계산한다", () => {
  const serialized = serializeMeasurementDayForms([
    { date: "2026-08-28", measurerId: 1, collaborators: [] },
    { date: "2026-08-24", measurerId: 2, collaborators: [] },
  ]);
  assert.equal(serialized.measurement_date, "2026-08-24");
  assert.equal(serialized.measurement_end_date, "2026-08-28");
});

test("일자 추가 시 기존 1일 일정을 첫 daily_staff entry로 보존해 UI 의미를 통일한다", () => {
  assert.match(businessUi, /date: prev\.measurement_date \|\| ""/);
  assert.match(businessUi, /measurer_id: prev\.measurer_id \|\| null/);
  assert.match(businessUi, /daily_staff:/);
});

test("legacy daily_staff measurer/collaborators에서 main/helper 역할을 추론하지 않는다", () => {
  const result = measurementStaffForDate({
    dailyStaff: [{ date: "2026-08-25", measurer_id: 1, collaborators: ["강종구", "김민영"] }],
    measurementDate: "2026-08-25",
    collaborators: null,
    userNameById: new Map([[1, "한기문"]]),
  });
  assert.equal(result.mainMeasurer, "-");
  assert.equal(result.helper, "-");
  assert.equal(result.measurementParticipants, "강종구, 김민영");
});

test("보고서 담당자를 실제 측정 참가자 또는 측정자 공시료로 자동 승격하지 않는다", () => {
  assert.doesNotMatch(workbench, /target\.measurer_id.*measurementAssignee/);
  assert.doesNotMatch(workbench, /staff\.measurementParticipants.*measurementAssignee/);
  assert.match(workbench, /plan\?\.recommendation_reason\?\.measurementAssignee/);
});

test("measurement_journal row 존재 기준 찐확정과 자동화 PAUSE를 유지한다", () => {
  assert.doesNotMatch(workbench, /sequence_number/);
  assert.match(workbench, /measurement_journal/);
  assert.match(policy, /기존 V2 자동추천 정책은 OFF/);
});

test("추천·재추천·적용 권한은 관리자 또는 예비조사 담당자를 서버에서 검증한다", () => {
  assert.match(access, /session\.role === "관리자"/);
  assert.match(access, /is_preliminary_survey_manager/);
  assert.match(workbench, /canManagePreliminarySurvey/);
  assert.match(targetApi, /canManagePreliminarySurvey/);
  assert.match(managerMigration, /ADD COLUMN IF NOT EXISTS is_preliminary_survey_manager/);
});

test("사용자 수동 보정 10개 코드는 장기 정책에서 자동 재수정 금지 대상으로 고정한다", () => {
  for (const code of ["H0399", "H0524", "H0288", "H0528", "H0348", "H0126", "H0281", "H0260", "H0063", "H0077"]) {
    assert.match(policy, new RegExp(code));
    assert.doesNotMatch(workbench, new RegExp(code));
  }
});

test("선택 업체 재추천은 같은 예비조사일·조사자·주소·측정일 영향 범위를 함께 계산한다", () => {
  assert.match(workbench, /calculatePreliminarySurveyImpactScope/);
  assert.match(workbench, /preliminaryDate: plan\?\.recommended_date/);
  assert.match(workbench, /participantUserIds: Array\.isArray\(plan\?\.participant_user_ids\)/);
  assert.match(workbench, /address: target\.address/);
  assert.match(workbench, /measurementDate: target\.measurement_date/);
  assert.match(workbench, /lockedTargetIds/);
  assert.match(workbench, /impactSummary/);
});
