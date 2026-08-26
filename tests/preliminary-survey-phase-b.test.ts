import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { adjacentWorkingDay, recommendationDatesForBusinessType } from "../lib/preliminary-survey-v2/calendar";
import { recommendBatch } from "../lib/preliminary-survey-v2/engine";
import { filterPreliminaryCandidateDates } from "../lib/preliminary-survey-v2/service";
import { measurementStaffForDate } from "../lib/preliminary-survey-v2/measurement-staff";
import { actualMeasurementBlockedKeys } from "../lib/preliminary-survey-v2/measurement-conflicts";
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
  assert.deepEqual(
    recommendationDatesForBusinessType("2026-07-14", "first_measurement").map((item) => item.workingDaysBefore),
    Array.from({ length: 28 }, (_, index) => index + 3),
  );
  assert.deepEqual(
    recommendationDatesForBusinessType("2026-07-14", "external_new").map((item) => item.workingDaysBefore),
    [...Array.from({ length: 18 }, (_, index) => 20 - index), ...Array.from({ length: 5 }, (_, index) => 25 - index)],
  );
  assert.deepEqual(
    recommendationDatesForBusinessType("2026-07-14", "existing").map((item) => item.workingDaysBefore),
    [...Array.from({ length: 18 }, (_, index) => 20 - index), ...Array.from({ length: 5 }, (_, index) => 25 - index)],
  );
  assert.ok(recommendationDatesForBusinessType("2026-07-14", "first_measurement").every((item) => ![0, 6].includes(new Date(`${item.date}T00:00:00Z`).getUTCDay())));
  const existingCandidates = recommendationDatesForBusinessType("2026-07-14", "existing");
  const oneDayScope = filterPreliminaryCandidateDates(existingCandidates, {
    preliminaryDateFrom: existingCandidates[0].date,
    preliminaryDateTo: existingCandidates[0].date,
  });
  assert.deepEqual(oneDayScope.map((item) => item.date), [existingCandidates[0].date]);
  const rangeScope = filterPreliminaryCandidateDates(existingCandidates, {
    preliminaryDateFrom: existingCandidates[0].date,
    preliminaryDateTo: existingCandidates[2].date,
  });
  assert.deepEqual(rangeScope.map((item) => item.date), existingCandidates.slice(0, 3).map((item) => item.date));
});

test("실시간 후보는 KST 기준일 이전과 측정 당일을 자동추천하지 않는다", () => {
  const all = recommendationDatesForBusinessType("2026-09-10", "external_new");
  const minimumDate = all[8].date;
  const filtered = recommendationDatesForBusinessType("2026-09-10", "external_new", { minimumDate });
  assert.ok(filtered.length > 0);
  assert.ok(filtered.every((item) => item.date >= minimumDate && item.date < "2026-09-10"));
});

test("목록 날짜 이동은 예비조사 캘린더의 주말·공휴일을 건너뛴다", () => {
  assert.equal(adjacentWorkingDay("2026-08-10", -1), "2026-08-07");
  assert.equal(adjacentWorkingDay("2026-08-14", 1), "2026-08-18");
  assert.equal(adjacentWorkingDay("2026-08-04", 1), "2026-08-05");
  assert.equal(adjacentWorkingDay("", 1), null);
});

test("정책 후보가 모두 기준일보다 과거면 강제 과거 배정 없이 수동조정한다", async () => {
  const [result] = await recommendBatch({
    targets: [target(1, "external_new")], experiencedUsers: [experienced],
    availability: { isBlocked: () => false },
    routes: { between: async () => ({ source: "unknown", durationMinutes: null, distanceKm: null, sameRegion: true }) },
    planningDate: "2026-07-14",
  });
  assert.equal(result.status, "manual_required");
  assert.equal(result.date, null);
});

test("H0399 신규 future target은 사업장 코드 때문에 일반 추천에서 제외되지 않는다", async () => {
  const futureTarget = {
    ...target(399, "existing"),
    code: "H0399",
    measurementDate: "2026-09-25",
  };
  const [result] = await recommendBatch({
    targets: [futureTarget], surveyors: [experienced], experiencedUsers: [experienced],
    availability: { isBlocked: () => false },
    routes: { between: async () => ({ source: "unknown", durationMinutes: null, distanceKm: null, sameRegion: true }) },
    planningDate: "2026-08-26",
  });
  assert.equal(result.targetId, futureTarget.id);
  assert.equal(result.status, "recommended");
  assert.ok(result.date);
});

test("daily_staff는 측정예정일별 메인측정자/조력자를 우선하고 collaborators는 역할 없는 fallback이다", () => {
  const userNameById = new Map([[1, "첫날 메인"], [2, "첫날 조력"], [3, "둘째날 메인"], [4, "둘째날 조력"]]);
  const dailyStaff = [
    { date: "2026-07-14", main_measurer_id: 1, helper_ids: [2] },
    { date: "2026-07-15", main_measurer_id: 3, helper_ids: [4] },
  ];
  assert.deepEqual(measurementStaffForDate({ dailyStaff, measurementDate: "2026-07-15", collaborators: "구형1,구형2", userNameById }), {
    mainMeasurer: "둘째날 메인", helper: "둘째날 조력", measurementParticipants: "-", source: "daily_staff",
  });
  assert.deepEqual(measurementStaffForDate({ dailyStaff: null, measurementDate: "2026-07-15", collaborators: "구형1,구형2", userNameById }), {
    mainMeasurer: "-", helper: "-", measurementParticipants: "구형1, 구형2", source: "collaborators",
  });
  assert.deepEqual(measurementStaffForDate({
    dailyStaff: [{ date: "2026-07-15", measurer_id: 3, collaborators: ["둘째날 조력"] }],
    measurementDate: "2026-07-15", collaborators: "구형1,구형2", userNameById,
  }), { mainMeasurer: "-", helper: "-", measurementParticipants: "둘째날 조력", source: "daily_staff" });
});

test("보고서 담당자는 실제 측정 참가자가 아니면 예비조사 가능 인원을 차단하지 않는다", () => {
  const legacyWithReportWriter = {
    measurement_date: "2026-08-25", actual_measurer: null, report_writer: "경력",
  };
  const blocked = actualMeasurementBlockedKeys({
    dates: ["2026-08-25"], users: [experienced, novice],
    targets: [{
      measurement_date: "2026-08-25", collaborators: null,
      daily_staff: [{ date: "2026-08-25", measurer_id: 1, collaborators: ["비경력"] }],
    }],
    legacySchedules: [legacyWithReportWriter],
  });
  assert.equal(blocked.has("1:2026-08-25"), false);
  assert.equal(blocked.has("2:2026-08-25"), true);
});

test("daily_staff의 같은 날짜 메인측정자와 조력자는 예비조사 배정에서 차단한다", () => {
  const blocked = actualMeasurementBlockedKeys({
    dates: ["2026-08-25"], users: [experienced, novice], legacySchedules: [],
    targets: [{
      measurement_date: "2026-08-25", collaborators: null,
      daily_staff: [{ date: "2026-08-25", main_measurer_id: 1, helper_ids: [2] }],
    }],
  });
  assert.deepEqual([...blocked].sort(), ["1:2026-08-25", "2:2026-08-25"]);
});

test("다일 측정은 예비조사일과 같은 daily_staff entry만 충돌에 사용한다", () => {
  const blocked = actualMeasurementBlockedKeys({
    dates: ["2026-08-26"], users: [experienced, novice], legacySchedules: [],
    targets: [{
      measurement_date: "2026-08-25", measurement_end_date: "2026-08-26", collaborators: "경력",
      daily_staff: [
        { date: "2026-08-25", main_measurer_id: 1, helper_ids: [] },
        { date: "2026-08-26", main_measurer_id: 2, helper_ids: [] },
      ],
    }],
  });
  assert.equal(blocked.has("1:2026-08-26"), false);
  assert.equal(blocked.has("2:2026-08-26"), true);
});

test("daily_staff가 없을 때 legacy 실제 측정자만 차단하고 report_writer는 차단하지 않는다", () => {
  const reportWriterOnly = {
    measurement_date: "2026-08-25", actual_measurer: null, report_writer: "경력",
  };
  const blocked = actualMeasurementBlockedKeys({
    dates: ["2026-08-25"], users: [experienced, novice], targets: [],
    legacySchedules: [
      { measurement_date: "2026-08-25", actual_measurer: "비경력" },
      reportWriterOnly,
    ],
  });
  assert.equal(blocked.has("1:2026-08-25"), false);
  assert.equal(blocked.has("2:2026-08-25"), true);
});

test("Phase B 기존업체 비경력 유선은 가능한 경력 검토자를 우선한다", async () => {
  const [result] = await recommendBatch({
    targets: [target(1, "existing", novice)], experiencedUsers: [experienced],
    availability: { isBlocked: () => false },
    routes: { between: async () => ({ source: "unknown", durationMinutes: null, distanceKm: null, sameRegion: true }) },
  });
  assert.deepEqual(result.participants.map((user) => user.id), [2, 1]);
  assert.equal(result.experiencedReviewer?.id, 1);
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
  const surveyPage = readFileSync("app/survey/page.tsx", "utf8");
  assert.deepEqual(restoreSurveyTabOrder(null), [...SURVEY_TAB_IDS]);
  assert.deepEqual(restoreSurveyTabOrder("not-json"), [...SURVEY_TAB_IDS]);
  assert.deepEqual(restoreSurveyTabOrder('["plans","list","search"]'), [...SURVEY_TAB_IDS]);
  assert.deepEqual(moveSurveyTab([...SURVEY_TAB_IDS], "search", "plans"), ["search", "plans", "list", "schedule-blocks"]);
  assert.match(surveyPage, /sticky top-16 z-40 flex h-12 items-center gap-\[3cm\] border-b/);
  assert.match(surveyPage, /shrink-0 text-2xl font-bold text-text-900">예비조사/);
});

test("계획/목록은 동일 작업대와 단일 추천 API를 사용하고 추천은 apply 전 저장하지 않는다", () => {
  const page = readFileSync("app/survey/page.tsx", "utf8");
  const ui = readFileSync("components/features/PreliminarySurveyV2Plans.tsx", "utf8");
  const api = readFileSync("app/api/preliminary-survey-v2/workbench/route.ts", "utf8");
  assert.match(page, /<PreliminarySurveyV2Plans mode="list"/);
  assert.match(ui, /<table/);
  for (const column of ["상태", "예비조사일", "코드", "사업장명", "구분", "측정예정일", "예비조사자", "방식", "측정자\\(공시료\\)", "측정 참여자", "보고서담당", "충돌"]) assert.match(ui, new RegExp(column));
  assert.match(ui, /이 업체 재추천/);
  assert.match(ui, /action: "apply", drafts: targetIds\.map/);
  assert.match(api, /applySubmittedDrafts/);
  assert.match(api, /participant_user_ids: draft\.participantUserIds/);
  assert.match(api, /recommended_date: draft\.preliminaryDate/);
  assert.match(api, /survey_method: draft\.surveyMethod/);
  assert.match(api, /participants\.find\(\(user\) => user\.id === draft\.sourceResponsibleUserId\)/);
  assert.match(api, /user_schedule_blocks/);
  assert.match(api, /blockedKeys\.has/);
  assert.match(api, /loadActualMeasurementBlockedKeys/);
  assert.match(api, /DRAFT_REVIEW_REQUIRED/);
  const applyStart = api.indexOf("async function applySubmittedDrafts");
  const applyEnd = api.indexOf("export async function GET", applyStart);
  // apply는 draft를 새로 저장하지 않지만, stale 방지를 위해 서버에서 동일 추천을 재계산한다.
  assert.match(api.slice(applyStart, applyEnd), /calculateV2Recommendations/);
  assert.match(api.slice(applyStart, applyEnd), /canonicalFingerprint/);
  assert.doesNotMatch(api.slice(applyStart, applyEnd), /report_writer/);
  assert.match(ui, /data-testid=\{mode === "plan" \? "phase-b-plan-toolbar" : "phase-b-list-toolbar"\}/);
  assert.match(ui, /flex flex-wrap items-end gap-2 xl:flex-nowrap/);
  assert.match(api, /measurement_journal/);
  assert.doesNotMatch(api, /sequence_number/);
});

test("측정 기준일 범위·선택 대상 추천은 검색 결과 교집합만 사용하고 draft scope 변경 시 적용을 막는다", () => {
  const ui = readFileSync("components/features/PreliminarySurveyV2Plans.tsx", "utf8");
  const api = readFileSync("app/api/preliminary-survey-v2/workbench/route.ts", "utf8");
  const service = readFileSync("lib/preliminary-survey-v2/service.ts", "utf8");
  const engine = readFileSync("lib/preliminary-survey-v2/engine.ts", "utf8");
  assert.match(ui, /collectWorkbenchRecommendationTargetIds\(displayRows, selectedTargetIds\)/);
  assert.match(ui, /onChange=\{\(event\) => setSearchDraft\(event\.target\.value\)\}/);
  assert.match(ui, /explicitTargetSelection: Boolean\(targetId\) \|\| selectedTargetIds\.size > 0/);
  assert.doesNotMatch(ui, /recommendDateMode|추천 범위"|>없음<|>일자<|>기간</);
  assert.match(ui, /measurementRangeFromReference\(measurementBaseDate, measurementRangeUnit\)/);
  assert.match(ui, /adjacentMeasurementReferenceDate\(measurementBaseDate, measurementRangeUnit, direction\)/);
  assert.match(ui, /measurementDateFrom: planSearchSnapshot\.measurementDateFrom \|\| undefined/);
  assert.match(ui, /measurementDateTo: planSearchSnapshot\.measurementDateTo \|\| undefined/);
  assert.doesNotMatch(ui, /preliminaryDateFrom|preliminaryDateTo/);
  assert.match(ui, /bg-slate-200 text-slate-900/);
  assert.match(ui, /bg-slate-100 p-0 text-slate-700/);
  assert.equal((ui.match(/className="shrink-0 whitespace-nowrap"/g) || []).length, 3);
  assert.match(ui, /w-\[360px\] max-w-\[420px\] shrink text-xs font-medium text-text-700">코드 · 사업장명/);
  assert.match(ui, /w-\[280px\] max-w-\[300px\] shrink text-xs font-medium text-text-700">코드 · 사업장명/);
  assert.doesNotMatch(ui, /<textarea|resize-none/);
  assert.match(ui, /phase-b-plan-table-scroll/);
  assert.match(ui, /className="overflow-visible"/);
  assert.doesNotMatch(ui, /max-h-\[calc\(100vh-20rem\)\] overflow-auto/);
  assert.match(ui, /if \(draftScope !== currentScope\)/);
  assert.match(api, /!Array\.isArray\(body\.targetIds\) \|\| body\.targetIds\.length === 0/);
  assert.match(api, /new Set\(requestedTargetIds\)\.size !== requestedTargetIds\.length/);
  assert.match(api, /parseDateOnly\(measurementDateFrom\)/);
  assert.match(api, /candidateQuery = candidateQuery\.gte\("measurement_date", measurementDateFrom\)/);
  assert.match(api, /candidateQuery = candidateQuery\.lte\("measurement_date", measurementDateTo\)/);
  assert.match(api, /selectedTargetIds\.has\(Number\(row\.id\)\)/);
  assert.match(api, /if \(explicitTargetSelection\) return true/);
  assert.match(api, /measurementDateFrom: requestedTargetIds\.length === 1 \? undefined : measurementDateFrom/);
  assert.match(api, /measurementDateTo: requestedTargetIds\.length === 1 \? undefined : measurementDateTo/);
  assert.match(service, /preliminaryDateFrom\?: string/);
  assert.match(service, /preliminaryDateTo\?: string/);
  assert.match(service, /candidateDatesByTarget/);
  assert.doesNotMatch(service, /recommendSurveyors/);
  assert.match(service, /validateManualPlanHardRules/);
  assert.match(engine, /surveyors\?: SurveyUser\[\]/);
  assert.match(service, /filter\(\(candidate\) => isInPreliminaryDateScope\(candidate\.date, scope\)\)/);
  assert.match(service, /!isInPreliminaryDateScope\(date, scope\) \|\| blockedKeys\.has/);
  assert.match(service, /manualRequiredOutsidePreliminaryScope/);
  const applyStart = api.indexOf("async function applySubmittedDrafts");
  const applyEnd = api.indexOf("export async function GET", applyStart);
  assert.match(api.slice(applyStart, applyEnd), /calculateV2Recommendations/);
  assert.doesNotMatch(api.slice(applyStart, applyEnd), /recommendBatch/);
});

test("목록 검색은 조사자 필터 없이 독립 snapshot과 기준일 범위를 사용한다", () => {
  const ui = readFileSync("components/features/PreliminarySurveyV2Plans.tsx", "utf8");
  assert.doesNotMatch(ui, /aria-label="조사자"/);
  assert.match(ui, /"예비조사자"/);
  assert.equal((ui.match(/aria-label="코드 또는 사업장명 검색"/g) || []).length, 2);
  assert.match(ui, /const \[listSearchSnapshot, setListSearchSnapshot\]/);
  assert.match(ui, /PRELIMINARY_SURVEY_LIST_FILTERS_STORAGE_KEY/);
  for (const field of ["year", "period", "statusFilter", "kindFilter", "preliminaryDateFilter", "methodFilter", "measurementBaseDate", "measurementRangeUnit", "searchQuery"]) {
    assert.match(ui, new RegExp(`${field}[,:]`));
  }
  assert.match(ui, /onClick=\{commitSearch\}>검색<\/Button>/);
  assert.match(ui, /matchesMeasurementDateRange\(row\.measurementDate, activeMeasurementDateFrom, activeMeasurementDateTo\)/);
  assert.match(ui, /!activePreliminaryDateFilter \|\| row\.preliminaryDate === activePreliminaryDateFilter/);
  assert.match(ui, /matchesWorkbenchSearch\(row, activeSearchQuery\)/);
});

test("계획 검색은 기준일 snapshot을 확정한 뒤 화면 결과와 같은 대상을 추천한다", () => {
  const ui = readFileSync("components/features/PreliminarySurveyV2Plans.tsx", "utf8");
  assert.match(ui, /interface PlanSearchSnapshot/);
  assert.match(ui, /const \[planSearchSnapshot, setPlanSearchSnapshot\]/);
  assert.match(ui, /PRELIMINARY_SURVEY_PLAN_FILTERS_STORAGE_KEY/);
  assert.match(ui, /const commitSearch = \(\) =>/);
  assert.match(ui, /onKeyDown=\{commitSearchOnEnter\} onBlur=\{commitSearch\}/);
  assert.match(ui, /lastCommittedSearchRef\.current === searchDraft/);
  assert.match(ui, /collectWorkbenchRecommendationTargetIds\(displayRows, selectedTargetIds\)/);
  assert.doesNotMatch(ui, /filteredRows\.filter\(\(row\) => selectedTargetIds/);
  assert.match(ui, /action: "recommend", year: queryYear, period: queryPeriod/);
  assert.match(ui, /matchesMeasurementDateRange\(row\.measurementDate, activeMeasurementDateFrom, activeMeasurementDateTo\)/);
  assert.match(ui, /measurementBaseDate !== planSearchSnapshot\.measurementBaseDate/);
  assert.match(ui, /measurementRangeUnit !== planSearchSnapshot\.measurementRangeUnit/);
  assert.match(ui, /측정예정일 범위:/);
  assert.match(ui, /searchQuery: activeSearchQuery/);
  assert.match(ui, /disabled=\{working \|\| isPlanSearchDirty\}/);
  assert.match(ui, /검색어 변경 · 검색 필요/);
  assert.match(ui, /추천 검토 결과: 추천 \$\{recommendedCount\}개 · 조정 필요\/불가 \$\{unavailableCount\}개/);
});

test("예비조사 탭·toolbar와 table header는 동적 sticky 계층과 단일 세로 스크롤을 사용한다", () => {
  const page = readFileSync("app/survey/page.tsx", "utf8");
  const ui = readFileSync("components/features/PreliminarySurveyV2Plans.tsx", "utf8");
  assert.match(page, /sticky top-16 z-40 flex h-12/);
  assert.match(ui, /sticky top-28 z-30 bg-white p-3 shadow-sm/);
  assert.match(ui, /phase-b-plan-table-scroll/);
  assert.match(ui, /phase-b-list-table-scroll/);
  assert.match(ui, /ResizeObserver/);
  assert.match(ui, /const tableHeaderTop = 112 \+ toolbarHeight/);
  assert.match(ui, /thead className="sticky z-20 bg-surface-50/);
  assert.match(ui, /style=\{\{ top: tableHeaderTop \}\}/);
  assert.match(ui, /className="overflow-visible"/);
  assert.doesNotMatch(ui, /max-h-\[calc\(100vh-20rem\)\] overflow-auto/);
});

test("계획과 목록은 요구한 필터 순서·일주월 탐색·독립 저장 조건을 사용한다", () => {
  const ui = readFileSync("components/features/PreliminarySurveyV2Plans.tsx", "utf8");
  const planStart = ui.indexOf('{mode === "plan" ?');
  const listStart = ui.indexOf(': <div className="flex flex-wrap items-end gap-2 xl:flex-nowrap">', planStart);
  const plan = ui.slice(planStart, listStart);
  const list = ui.slice(listStart, ui.indexOf('<div className="mt-2 flex h-9', listStart));
  for (const labels of [
    ["연도", "반기", "상태", "구분", "측정 기준일", "측정 조회 단위", "측정 기준일 이동", "코드 · 사업장명", "검색"],
    ["연도", "반기", "예비조사일", "상태", "구분", "방식", "측정 기준일", "측정 조회 단위", "측정 기준일 이동", "코드 · 사업장명", "검색"],
  ]) {
    const source = labels === undefined ? "" : labels.length === 9 ? plan : list;
    let cursor = -1;
    for (const label of labels) {
      const next = source.indexOf(label, cursor + 1);
      assert.ok(next > cursor, `${label} 순서`);
      cursor = next;
    }
  }
  assert.match(ui, /\(\["day", "week", "month"\] as const\)/);
  assert.match(ui, /aria-label=\{`이전 \$\{navigationUnitLabel\}`\}/);
  assert.match(ui, /aria-label=\{`다음 \$\{navigationUnitLabel\}`\}/);
  assert.doesNotMatch(ui, /측정 종료일|다음 주|<textarea/);
  assert.match(ui, /preliminarySurveyV2PlanFiltersV2/);
  assert.match(ui, /preliminarySurveyV2ListFiltersV2/);
  assert.doesNotMatch(ui.slice(ui.indexOf("const stored ="), ui.indexOf("window.localStorage.setItem")), /selectedTargetIds|drafts|modal|fingerprint/);
});

test("측정대상사업장관리에는 예비조사 작업 UI가 없다", () => {
  const source = readFileSync("components/features/MeasurementTargetBusinessManagement.tsx", "utf8");
  assert.doesNotMatch(source, />예비조사 정보</);
  assert.doesNotMatch(source, /이 업체 재추천|추천안 적용|예비조사 상태/);
});

test("수동 수정과 draft apply는 선택한 조사 방식을 hard-rule 검증에 전달한다", () => {
  const manualApi = readFileSync("app/api/preliminary-survey-v2/[targetId]/route.ts", "utf8");
  const workbenchApi = readFileSync("app/api/preliminary-survey-v2/workbench/route.ts", "utf8");
  assert.match(manualApi, /validateManualPlanHardRules\(\{[\s\S]*?surveyMethod,[\s\S]*?existingAssignments/);
  assert.match(workbenchApi, /validateManualPlanHardRules\(\{[\s\S]*?surveyMethod: draft\.surveyMethod,[\s\S]*?existingAssignments/);
});

test("수동 수정과 apply는 예비조사자 및 실제 측정 역할의 후발 직원 불가 일정을 저장 전에 차단한다", () => {
  const manualRoute = readFileSync("app/api/preliminary-survey-v2/[targetId]/route.ts", "utf8");
  const workbench = readFileSync("app/api/preliminary-survey-v2/workbench/route.ts", "utf8");
  assert.match(manualRoute, /user_schedule_blocks/);
  assert.match(manualRoute, /USER_UNAVAILABLE_ON_SURVEY_DATE/);
  assert.match(workbench, /measurementRoleKeysByTarget/);
  assert.match(workbench, /보고서 담당자 또는 측정 참여자에게 직원 불가 일정/);
  assert.match(workbench, /measurementRoleConflictTargetIds/);
});
