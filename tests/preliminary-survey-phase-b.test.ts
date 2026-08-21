import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { recommendationDatesForBusinessType } from "../lib/preliminary-survey-v2/calendar";
import { recommendBatch } from "../lib/preliminary-survey-v2/engine";
import { measurementStaffForDate } from "../lib/preliminary-survey-v2/measurement-staff";
import { SURVEY_TAB_IDS, moveSurveyTab, restoreSurveyTabOrder } from "../lib/preliminary-survey-v2/tab-order";
import type { SurveyTarget, SurveyUser } from "../lib/preliminary-survey-v2/types";

const experienced: SurveyUser = { id: 1, name: "경력", experienced: true, active: true };
const novice: SurveyUser = { id: 2, name: "비경력", experienced: false, active: true };
const target = (id: number, businessType: NonNullable<SurveyTarget["businessType"]>, responsible = experienced): SurveyTarget => ({
  id, code: `H${id}`, name: `사업장${id}`, kind: businessType === "existing" ? "existing" : "new",
  businessType, measurementDate: "2026-07-14", responsible, address: "충남 천안시",
  region: "충남 천안시", coordinate: null, createdAt: "2026-01-01",
});

test("Phase B 유형별 날짜 후보는 측정예정일에서 역산한다", () => {
  assert.equal(recommendationDatesForBusinessType("2026-07-14", "first_measurement")[0].workingDaysBefore, 3);
  assert.equal(recommendationDatesForBusinessType("2026-07-14", "external_new")[0].workingDaysBefore, 30);
  assert.deepEqual(
    recommendationDatesForBusinessType("2026-07-14", "external_new").slice(0, 3).map((item) => item.workingDaysBefore),
    [30, 29, 28],
  );
  assert.equal(recommendationDatesForBusinessType("2026-07-14", "external_new").at(-1)?.workingDaysBefore, 60);
  assert.equal(recommendationDatesForBusinessType("2026-07-14", "existing")[0].workingDaysBefore, 3);
  assert.ok(recommendationDatesForBusinessType("2026-07-14", "first_measurement").every((item) => ![0, 6].includes(new Date(`${item.date}T00:00:00Z`).getUTCDay())));
});

test("daily_staff는 측정예정일별 메인측정자/조력자를 우선하고 collaborators는 역할 없는 fallback이다", () => {
  const userNameById = new Map([[1, "첫날 메인"], [2, "첫날 조력"], [3, "둘째날 메인"], [4, "둘째날 조력"]]);
  const dailyStaff = [
    { date: "2026-07-14", main_measurer_id: 1, helper_ids: [2] },
    { date: "2026-07-15", main_measurer_id: 3, helper_ids: [4] },
  ];
  assert.deepEqual(measurementStaffForDate({ dailyStaff, measurementDate: "2026-07-15", collaborators: "구형1,구형2", userNameById }), {
    mainMeasurer: "둘째날 메인", helper: "둘째날 조력", source: "daily_staff",
  });
  assert.deepEqual(measurementStaffForDate({ dailyStaff: null, measurementDate: "2026-07-15", collaborators: "구형1,구형2", userNameById }), {
    mainMeasurer: "-", helper: "구형1, 구형2", source: "collaborators",
  });
  assert.deepEqual(measurementStaffForDate({
    dailyStaff: [{ date: "2026-07-15", measurer_id: 3, collaborators: ["둘째날 조력"] }],
    measurementDate: "2026-07-15", collaborators: "구형1,구형2", userNameById,
  }), { mainMeasurer: "둘째날 메인", helper: "둘째날 조력", source: "daily_staff" });
});

test("Phase B 기존업체도 비경력자 단독으로 자동 추천하지 않는다", async () => {
  const [result] = await recommendBatch({
    targets: [target(1, "existing", novice)], experiencedUsers: [experienced],
    availability: { isBlocked: () => false },
    routes: { between: async () => ({ source: "unknown", durationMinutes: null, distanceKm: null, sameRegion: true }) },
  });
  assert.deepEqual(result.participants.map((user) => user.id), [2, 1]);
});

test("날짜별 통합 추천 정렬은 최초실시, 타기관 신규, 기존업체 순이다", async () => {
  const results = await recommendBatch({
    targets: [target(3, "existing"), target(2, "external_new"), target(1, "first_measurement")], experiencedUsers: [experienced],
    availability: { isBlocked: () => false },
    routes: { between: async () => ({ source: "unknown", durationMinutes: null, distanceKm: null, sameRegion: true }) },
  });
  assert.deepEqual(results.map((result) => result.targetId), [1, 2, 3]);
});

test("탭 순서 저장값 복원, 오류 fallback, 누락 탭 보완, 이동을 지원한다", () => {
  assert.deepEqual(restoreSurveyTabOrder(null), [...SURVEY_TAB_IDS]);
  assert.deepEqual(restoreSurveyTabOrder("not-json"), [...SURVEY_TAB_IDS]);
  assert.deepEqual(restoreSurveyTabOrder('["plans","list","search"]'), [...SURVEY_TAB_IDS]);
  assert.deepEqual(moveSurveyTab([...SURVEY_TAB_IDS], "search", "plans"), ["search", "plans", "list", "schedule-blocks"]);
});

test("계획/목록은 동일 작업대와 단일 추천 API를 사용하고 추천은 apply 전 저장하지 않는다", () => {
  const page = readFileSync("app/survey/page.tsx", "utf8");
  const ui = readFileSync("components/features/PreliminarySurveyV2Plans.tsx", "utf8");
  const api = readFileSync("app/api/preliminary-survey-v2/workbench/route.ts", "utf8");
  assert.match(page, /<PreliminarySurveyV2Plans mode="list"/);
  assert.match(ui, /<table/);
  for (const column of ["상태", "예비조사일", "코드", "사업장명", "구분", "측정예정일", "예비조사자", "방식", "메인측정자", "조력자", "보고서담당", "충돌"]) assert.match(ui, new RegExp(column));
  assert.match(ui, /이 업체 재추천/);
  assert.match(ui, /action: "apply", drafts: targetIds\.map/);
  assert.match(api, /applySubmittedDrafts/);
  assert.match(api, /participant_user_ids: draft\.participantUserIds/);
  assert.match(api, /recommended_date: draft\.preliminaryDate/);
  assert.match(api, /survey_method: draft\.surveyMethod/);
  assert.match(api, /context\.target\.responsible\.id !== draft\.sourceResponsibleUserId/);
  assert.match(api, /user_schedule_blocks/);
  assert.match(api, /blockedKeys\.has/);
  assert.match(api, /DRAFT_REVIEW_REQUIRED/);
  const applyStart = api.indexOf("async function applySubmittedDrafts");
  const applyEnd = api.indexOf("export async function GET", applyStart);
  assert.doesNotMatch(api.slice(applyStart, applyEnd), /calculateV2Recommendations|recommendBatch/);
  assert.match(ui, /data-testid=\{mode === "plan" \? "phase-b-plan-toolbar" : "phase-b-list-toolbar"\}/);
  assert.match(ui, /min-w-\[760px\] flex-nowrap/);
  assert.match(ui, /flex-wrap xl:flex-nowrap/);
  assert.match(api, /measurement_journal/);
  assert.doesNotMatch(api, /sequence_number/);
});

test("측정대상사업장관리에는 예비조사 작업 UI가 없다", () => {
  const source = readFileSync("components/features/MeasurementTargetBusinessManagement.tsx", "utf8");
  assert.doesNotMatch(source, />예비조사 정보</);
  assert.doesNotMatch(source, /이 업체 재추천|추천안 적용|예비조사 상태/);
});
