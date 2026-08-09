import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { recommendationDates } from "../lib/preliminary-survey-v2/calendar";
import { buildScheduleBlockKeys } from "../lib/preliminary-survey-v2/availability";
import { classifyMeasurementJournalBusiness, type MeasurementJournalClassificationRow } from "../lib/preliminary-survey-v2/classification";
import { recommendBatch } from "../lib/preliminary-survey-v2/engine";
import { validateManualPlanHardRules } from "../lib/preliminary-survey-v2/manual-validation";
import { targetChangeRecommendationPolicy } from "../lib/preliminary-survey-v2/policy";
import { surveyMethodForKind, type ExistingAssignment, type RouteMetric, type RouteMetrics, type SurveyTarget, type SurveyUser } from "../lib/preliminary-survey-v2/types";

const experienced = (id: number, name = `경력${id}`): SurveyUser => ({ id, name, experienced: true, active: true });
const novice = (id: number, name = `비경력${id}`): SurveyUser => ({ id, name, experienced: false, active: true });
const target = (id: number, kind: "new" | "existing", responsible: SurveyUser, measurementDate = "2026-07-14"): SurveyTarget => ({
  id, code: `C${id}`, name: `사업장${id}`, kind, responsible, measurementDate,
  address: "충남 천안시", region: "충남 천안시", coordinate: { latitude: 36.8 + id / 1000, longitude: 127.1 },
  createdAt: `2026-01-${String(id).padStart(2, "0")}`,
});
const route = (durationMinutes: number | null = 30, source: RouteMetric["source"] = "vehicle") => ({
  between: async (): Promise<RouteMetric> => ({ source, durationMinutes, distanceKm: 10, sameRegion: true }),
});
const directionalRoutes = (minutes: Record<string, number | null>, calls: string[] = []): RouteMetrics => ({
  between: async (left, right): Promise<RouteMetric> => {
    const leftCode = "code" in left ? left.code : left.businessCode;
    const rightCode = "code" in right ? right.code : right.businessCode;
    const key = `${leftCode}->${rightCode}`;
    calls.push(key);
    const durationMinutes = minutes[key] ?? null;
    return durationMinutes === null
      ? { source: "distance", durationMinutes: null, distanceKm: 10, sameRegion: true }
      : { source: "vehicle", durationMinutes, distanceKm: 10, sameRegion: true };
  },
});
const existingAssignment = (
  targetId: number,
  businessCode: string,
  userId: number,
  date: string,
): ExistingAssignment => ({
  targetId, businessCode, kind: "new", date, participants: [userId], responsibleUserId: userId,
  experiencedReviewerId: null, coordinate: { latitude: 36.8, longitude: 127.1 }, region: "충남 천안시",
});
const available = (blocked = new Set<string>()) => ({ isBlocked: (userId: number, date: string) => blocked.has(`${userId}:${date}`) });

const journal = (
  note: unknown,
  overrides: Partial<MeasurementJournalClassificationRow> = {},
): MeasurementJournalClassificationRow => ({
  id: 1,
  code: "H0001",
  measurement_year: 2026,
  measurement_period: "하반기",
  note,
  updated_at: "2026-08-01T00:00:00Z",
  ...overrides,
});
const classificationTarget = { code: "H0001", year: 2026, period: "하반기" };

test("측정일지 신규 구분값이 신규이면 new", () => {
  assert.equal(classifyMeasurementJournalBusiness(classificationTarget, [journal("신규")]).kind, "new");
  assert.equal(classifyMeasurementJournalBusiness(classificationTarget, [journal("최초실시")]).kind, "new");
});

test("측정일지 신규 구분값이 타기관 신규이면 new", () => {
  assert.equal(classifyMeasurementJournalBusiness(classificationTarget, [journal("공정 변경,타기관 신규")]).kind, "new");
});

test("일반 기존 측정일지는 existing", () => {
  assert.equal(classifyMeasurementJournalBusiness(classificationTarget, [journal("공정 변경")]).kind, "existing");
});

test("과거에는 신규였어도 현재 반기가 기존이면 existing", () => {
  const rows = [
    journal("최초실시", { measurement_period: "상반기" }),
    journal("공정 변경", { id: 2, measurement_period: "하반기" }),
  ];
  assert.equal(classifyMeasurementJournalBusiness(classificationTarget, rows).kind, "existing");
});

test("동일 code의 다른 연도와 반기 측정일지를 혼동하지 않음", () => {
  const rows = [
    journal("타기관 신규", { measurement_year: 2025 }),
    journal("신규", { id: 2, measurement_period: "상반기" }),
    journal(null, { id: 3 }),
  ];
  assert.equal(classifyMeasurementJournalBusiness(classificationTarget, rows).kind, "existing");
});

test("측정일지 신규 구분 누락 시 임의로 new 처리하지 않음", () => {
  assert.equal(classifyMeasurementJournalBusiness(classificationTarget, []).kind, "existing");
  assert.equal(classifyMeasurementJournalBusiness(classificationTarget, [journal(null)]).kind, "existing");
});

test("동일 code/year/period 측정일지가 여러 건이면 최신 일지 값을 사용", () => {
  const rows = [
    journal("최초실시", { id: 1, updated_at: "2026-07-01T00:00:00Z" }),
    journal("공정 변경", { id: 2, updated_at: "2026-08-01T00:00:00Z" }),
  ];
  const result = classifyMeasurementJournalBusiness(classificationTarget, rows);
  assert.equal(result.kind, "existing");
  assert.equal(result.journalId, 2);
  assert.equal(result.rawValue, "공정 변경");
});

test("target 레거시 구분과 무관하게 측정일지만으로 신규/기존을 판정", () => {
  assert.equal(classifyMeasurementJournalBusiness({ ...classificationTarget, preliminary_survey_rule_type: "existing" } as any, [journal("최초실시")]).kind, "new");
  assert.equal(classifyMeasurementJournalBusiness({ ...classificationTarget, preliminary_survey_rule_type: "general_new" } as any, [journal("일반 기존")]).kind, "existing");
});

test("조사방식 기본값은 신규 field, 기존 phone", () => {
  assert.equal(surveyMethodForKind("new"), "field");
  assert.equal(surveyMethodForKind("existing"), "phone");
});

test("A: 현재 날짜가 측정일 이후여도 측정일 기준 과거 후보를 생성한다", async () => {
  const user = experienced(1);
  const [result] = await recommendBatch({ targets: [target(1, "new", user)], experiencedUsers: [user], availability: available(), routes: route() });
  assert.equal(result.status, "recommended");
  assert.ok(result.date! < "2026-07-14");
});

test("제외일 담당자는 해당 날짜 신규 현장 담당자로 추천하지 않고 다른 날짜를 선택", async () => {
  const responsible = experienced(1);
  const dates = recommendationDates("2026-07-14");
  const [result] = await recommendBatch({
    targets: [target(1, "new", responsible)],
    experiencedUsers: [responsible],
    availability: available(new Set([`${responsible.id}:${dates[0].date}`])),
    routes: route(),
  });
  assert.equal(result.status, "recommended");
  assert.equal(result.date, dates[1].date);
});

test("제외일 경력자는 신규업체 경력 동행자로 선택하지 않음", async () => {
  const dates = recommendationDates("2026-07-14");
  const [result] = await recommendBatch({
    targets: [target(1, "new", novice(1))],
    experiencedUsers: [experienced(10), experienced(11)],
    availability: available(new Set([`10:${dates[0].date}`])),
    routes: route(),
  });
  assert.equal(result.date, dates[0].date);
  assert.equal(result.experiencedReviewer?.id, 11);
});

test("제외일 경력자는 기존업체 전화 경력 검토자로 선택하지 않음", async () => {
  const dates = recommendationDates("2026-07-14");
  const [result] = await recommendBatch({
    targets: [target(1, "existing", novice(1))],
    experiencedUsers: [experienced(10), experienced(11)],
    availability: available(new Set([`10:${dates[0].date}`])),
    routes: route(),
  });
  assert.equal(result.date, dates[0].date);
  assert.equal(result.experiencedReviewer?.id, 11);
});

test("가능한 담당자와 날짜가 전혀 없으면 강제 배정하지 않음", async () => {
  const responsible = novice(1);
  const reviewer = experienced(10);
  const blocked = new Set(recommendationDates("2026-07-14").flatMap(({ date }) => [
    `${responsible.id}:${date}`,
    `${reviewer.id}:${date}`,
  ]));
  const [result] = await recommendBatch({
    targets: [target(1, "new", responsible)],
    experiencedUsers: [reviewer],
    availability: available(blocked),
    routes: route(),
  });
  assert.equal(result.status, "manual_required");
  assert.equal(result.date, null);
  assert.deepEqual(result.participants, []);
});

test("제외일 범위는 시작일과 종료일을 모두 포함", () => {
  const blocked = buildScheduleBlockKeys([{
    user_id: 7,
    start_date: "2026-08-10",
    end_date: "2026-08-12",
  }]);
  assert.deepEqual([...blocked], [
    "7:2026-08-10",
    "7:2026-08-11",
    "7:2026-08-12",
  ]);
});

test("B: -30~-20 기본구간에서 -30을 우선한다", () => {
  assert.equal(recommendationDates("2026-07-14")[0].workingDaysBefore, 30);
});

test("C: 기본구간이 모두 불가능하면 -19부터 탐색한다", async () => {
  const user = experienced(1);
  const dates = recommendationDates("2026-07-14");
  const blocked = new Set(dates.filter(item => item.workingDaysBefore >= 20).map(item => `${user.id}:${item.date}`));
  const [result] = await recommendBatch({ targets: [target(1, "new", user)], experiencedUsers: [user], availability: available(blocked), routes: route() });
  assert.equal(result.evidence.workingDaysBefore, 19);
});

test("D: -3까지 불가능하면 수동조정 상태다", async () => {
  const user = experienced(1);
  const blocked = new Set(recommendationDates("2026-07-14").map(item => `${user.id}:${item.date}`));
  const [result] = await recommendBatch({ targets: [target(1, "new", user)], experiencedUsers: [user], availability: available(blocked), routes: route() });
  assert.equal(result.status, "manual_required");
});

test("E/F: 경력 담당자는 단독, 비경력 담당자는 담당자+경력자", async () => {
  const senior = experienced(10);
  const results = await recommendBatch({ targets: [target(1, "new", senior), target(2, "new", novice(2))], experiencedUsers: [senior], availability: available(), routes: route() });
  assert.deepEqual(results[0].participants.map(item => item.id), [10]);
  assert.deepEqual(results[1].participants.map(item => item.id), [2, 10]);
  assert.equal(results[0].surveyMethod, "field");
  assert.equal(results[1].evidence.surveyMethod, "field");
});

test("기존업체 자동추천 조사방식은 phone", async () => {
  const senior = experienced(10);
  const [result] = await recommendBatch({
    targets: [target(1, "existing", senior)], experiencedUsers: [senior], availability: available(), routes: route(),
  });
  assert.equal(result.surveyMethod, "phone");
  assert.equal(result.evidence.surveyMethod, "phone");
});

test("G: 신규업체는 가능한 날짜에 하루 1건씩 먼저 분산한다", async () => {
  const user = experienced(1);
  const results = await recommendBatch({ targets: [target(1, "new", user), target(2, "new", user)], experiencedUsers: [user], availability: available(), routes: route(null, "distance") });
  assert.notEqual(results[0].date, results[1].date);
  assert.equal(results[1].evidence.capacityPass, 1);
});

test("H/I: 날짜 부족 시 신규 2건을 60분 이내만 허용한다", async () => {
  const user = experienced(1);
  const allowedDate = recommendationDates("2026-07-14")[0].date;
  const blocked = new Set(recommendationDates("2026-07-14").slice(1).map(item => `${user.id}:${item.date}`));
  const okay = await recommendBatch({ targets: [target(1, "new", user), target(2, "new", user)], experiencedUsers: [user], availability: available(blocked), routes: route(60) });
  assert.equal(okay[1].date, allowedDate);
  assert.equal(okay[1].evidence.capacityPass, 2);
  const denied = await recommendBatch({ targets: [target(1, "new", user), target(2, "new", user)], experiencedUsers: [user], availability: available(blocked), routes: route(61) });
  assert.equal(denied[1].status, "manual_required");
});

test("-30의 10분 same-route는 -29 단독보다 우선", async () => {
  const user = experienced(1);
  const dates = recommendationDates("2026-07-14");
  const [result] = await recommendBatch({
    targets: [target(2, "new", user)], experiencedUsers: [user], availability: available(),
    existingAssignments: [existingAssignment(1, "C1", user.id, dates[0].date)],
    routes: directionalRoutes({ "C1->C2": 10, "C2->C1": 12 }),
  });
  assert.equal(result.date, dates[0].date);
  assert.equal(result.evidence.selectionMode, "same_route_preferred");
  assert.equal(result.evidence.selectionReason, "same_route_preferred_under_30");
  assert.equal(result.evidence.singleCandidateAvailable, true);
});

test("-30의 38분 묶음보다 -29 단독을 우선", async () => {
  const user = experienced(1);
  const dates = recommendationDates("2026-07-14");
  const [result] = await recommendBatch({
    targets: [target(2, "new", user)], experiencedUsers: [user], availability: available(),
    existingAssignments: [existingAssignment(1, "C1", user.id, dates[0].date)],
    routes: directionalRoutes({ "C1->C2": 38, "C2->C1": 40 }),
  });
  assert.equal(result.date, dates[1].date);
  assert.equal(result.evidence.selectionMode, "single");
  assert.equal(result.evidence.selectionReason, "single_day_preferred_over_30");
  assert.equal(result.evidence.sameRouteMinutes, 38);
});

test("기본구간 -30의 55분 묶음보다 후순위구간 정상 단독 날짜를 우선", async () => {
  const user = experienced(1);
  const dates = recommendationDates("2026-07-14");
  const blocked = new Set(dates.filter((item) => item.workingDaysBefore >= 20).slice(1).map((item) => `${user.id}:${item.date}`));
  const [result] = await recommendBatch({
    targets: [target(2, "new", user)], experiencedUsers: [user], availability: available(blocked),
    existingAssignments: [existingAssignment(1, "C1", user.id, dates[0].date)],
    routes: directionalRoutes({ "C1->C2": 55, "C2->C1": 58 }),
  });
  assert.equal(result.evidence.workingDaysBefore, 19);
  assert.equal(result.evidence.selectionMode, "single");
  assert.equal(result.evidence.singleCandidateAvailable, true);
});

test("전체 허용기간에 단독 날짜가 없을 때만 55분 묶음을 fallback으로 허용", async () => {
  const user = experienced(1);
  const dates = recommendationDates("2026-07-14");
  const blocked = new Set(dates.slice(1).map((item) => `${user.id}:${item.date}`));
  const [result] = await recommendBatch({
    targets: [target(2, "new", user)], experiencedUsers: [user], availability: available(blocked),
    existingAssignments: [existingAssignment(1, "C1", user.id, dates[0].date)],
    routes: directionalRoutes({ "C1->C2": 55, "C2->C1": 58 }),
  });
  assert.equal(result.date, dates[0].date);
  assert.equal(result.evidence.selectionMode, "two_job_fallback");
  assert.equal(result.evidence.selectionReason, "two_job_fallback_no_single_day");
  assert.equal(result.evidence.singleCandidateAvailable, false);
});

test("기본구간 단독 날짜가 없어도 61분 묶음은 금지하고 다음 구간 탐색", async () => {
  const user = experienced(1);
  const dates = recommendationDates("2026-07-14");
  const blocked = new Set(dates.filter((item) => item.workingDaysBefore >= 20).slice(1).map((item) => `${user.id}:${item.date}`));
  const [result] = await recommendBatch({
    targets: [target(2, "new", user)], experiencedUsers: [user], availability: available(blocked),
    existingAssignments: [existingAssignment(1, "C1", user.id, dates[0].date)],
    routes: directionalRoutes({ "C1->C2": 61, "C2->C1": 65 }),
  });
  assert.notEqual(result.date, dates[0].date);
  assert.equal(result.evidence.range, "fallback");
  assert.ok(result.evidence.rejectedSameDayRoutes.some((item) => item.routeDecision === "both_directions_over_60"));
});

test("기본구간 단독 불가 시 후순위구간 단독을 우선", async () => {
  const user = experienced(1);
  const dates = recommendationDates("2026-07-14");
  const blocked = new Set(dates.filter((item) => item.workingDaysBefore >= 20).map((item) => `${user.id}:${item.date}`));
  const [result] = await recommendBatch({
    targets: [target(1, "new", user)], experiencedUsers: [user], availability: available(blocked), routes: route(),
  });
  assert.equal(result.evidence.workingDaysBefore, 19);
  assert.equal(result.evidence.selectionMode, "single");
});

test("기본구간 단독 불가 시 25분 same-route를 기본구간에서 허용", async () => {
  const user = experienced(1);
  const dates = recommendationDates("2026-07-14");
  const blocked = new Set(dates.filter((item) => item.workingDaysBefore >= 20).slice(1).map((item) => `${user.id}:${item.date}`));
  const [result] = await recommendBatch({
    targets: [target(2, "new", user)], experiencedUsers: [user], availability: available(blocked),
    existingAssignments: [existingAssignment(1, "C1", user.id, dates[0].date)],
    routes: directionalRoutes({ "C1->C2": 25, "C2->C1": 28 }),
  });
  assert.equal(result.date, dates[0].date);
  assert.equal(result.evidence.selectionMode, "same_route_preferred");
  assert.equal(result.evidence.sameRouteMinutes, 25);
});

async function recommendTwoNewWithOnlyFirstDate(routes: RouteMetrics) {
  const user = experienced(1);
  const dates = recommendationDates("2026-07-14");
  const blocked = new Set(dates.slice(1).map(item => `${user.id}:${item.date}`));
  return recommendBatch({
    targets: [target(1, "new", user), target(2, "new", user)],
    experiencedUsers: [user], availability: available(blocked), routes,
  });
}

test("신규 2건 A→B 50분/B→A 55분이면 A→B 순서로 허용", async () => {
  const results = await recommendTwoNewWithOnlyFirstDate(directionalRoutes({ "C1->C2": 50, "C2->C1": 55 }));
  assert.equal(results[1].status, "recommended");
  assert.equal(results[1].evidence.sameDayRoute?.selectedRouteMinutes, 50);
  assert.deepEqual(results[1].evidence.sameDayRoute?.selectedVisitOrder, ["C1", "C2"]);
  assert.equal(results[1].evidence.sameDayRoute?.routeDecision, "same_day_allowed");
});

test("신규 2건 A→B 67분/B→A 54분이면 B→A 순서로 허용", async () => {
  const results = await recommendTwoNewWithOnlyFirstDate(directionalRoutes({ "C1->C2": 67, "C2->C1": 54 }));
  assert.equal(results[1].status, "recommended");
  assert.equal(results[1].evidence.sameDayRoute?.routeABMinutes, 67);
  assert.equal(results[1].evidence.sameDayRoute?.routeBAMinutes, 54);
  assert.deepEqual(results[1].evidence.sameDayRoute?.selectedVisitOrder, ["C2", "C1"]);
});

test("신규 2건 양방향 모두 60분 초과면 같은 날 배정하지 않음", async () => {
  const results = await recommendTwoNewWithOnlyFirstDate(directionalRoutes({ "C1->C2": 64, "C2->C1": 71 }));
  assert.equal(results[1].status, "manual_required");
  assert.equal(results[1].evidence.rejectedSameDayRoutes[0]?.routeDecision, "both_directions_over_60");
});

test("신규 2건 A→B 실패/B→A 48분이면 B→A 순서로 허용", async () => {
  const results = await recommendTwoNewWithOnlyFirstDate(directionalRoutes({ "C1->C2": null, "C2->C1": 48 }));
  assert.equal(results[1].status, "recommended");
  assert.equal(results[1].evidence.sameDayRoute?.routeABMinutes, null);
  assert.deepEqual(results[1].evidence.sameDayRoute?.selectedVisitOrder, ["C2", "C1"]);
});

test("신규 2건 A→B 70분/B→A 실패면 판단 불가로 같은 날 배정하지 않음", async () => {
  const results = await recommendTwoNewWithOnlyFirstDate(directionalRoutes({ "C1->C2": 70, "C2->C1": null }));
  assert.equal(results[1].status, "manual_required");
  assert.equal(results[1].evidence.rejectedSameDayRoutes[0]?.routeDecision, "reverse_direction_unavailable");
});

test("신규 2건 양방향 실패면 같은 날 배정하지 않음", async () => {
  const results = await recommendTwoNewWithOnlyFirstDate(directionalRoutes({ "C1->C2": null, "C2->C1": null }));
  assert.equal(results[1].status, "manual_required");
  assert.equal(results[1].evidence.rejectedSameDayRoutes[0]?.routeDecision, "both_directions_failed");
});

test("기존업체 경력 검토자 선정은 차량경로를 조회하거나 반영하지 않음", async () => {
  const date = recommendationDates("2026-07-14")[0].date;
  const calls: string[] = [];
  const routes: RouteMetrics = {
    between: async () => {
      calls.push("unexpected");
      throw new Error("기존업체 검토자 선정에서 경로를 조회하면 안 됩니다.");
    },
  };
  const [result] = await recommendBatch({
    targets: [target(1, "existing", novice(1))],
    experiencedUsers: [experienced(10), experienced(11)],
    existingAssignments: [existingAssignment(100, "R10", 10, date), existingAssignment(101, "R11", 11, date)],
    availability: available(), routes,
  });
  assert.equal(result.experiencedReviewer?.id, 10);
  assert.deepEqual(calls, []);
  assert.equal(result.evidence.route, null);
});

test("신규업체 경력 동행자 선정은 양방향 차량경로 우선순위를 적용", async () => {
  const date = recommendationDates("2026-07-14")[0].date;
  const [result] = await recommendBatch({
    targets: [target(1, "new", novice(1))],
    experiencedUsers: [experienced(10), experienced(11)],
    existingAssignments: [existingAssignment(100, "R10", 10, date), existingAssignment(101, "R11", 11, date)],
    availability: available(),
    routes: directionalRoutes({
      "R10->C1": 100, "C1->R10": 95,
      "R11->C1": 20, "C1->R11": 25,
    }),
  });
  assert.equal(result.experiencedReviewer?.id, 11);
  assert.equal(result.evidence.sameDayRoute?.selectedRouteMinutes, 20);
  assert.deepEqual(result.evidence.sameDayRoute?.selectedVisitOrder, ["R11", "C1"]);
});

test("신규 경력 동행자는 차량경로보다 cross-type 비중복을 우선", async () => {
  const dates = recommendationDates("2026-07-14");
  const responsible = novice(1);
  const blocked = new Set(dates.slice(1).map((item) => `${responsible.id}:${item.date}`));
  const existingReviewByA: ExistingAssignment = {
    targetId: 200,
    businessCode: "E200",
    kind: "existing",
    date: dates[0].date,
    participants: [20, 10],
    responsibleUserId: 20,
    experiencedReviewerId: 10,
    coordinate: null,
    region: "충남 천안시",
  };
  const [result] = await recommendBatch({
    targets: [target(1, "new", responsible)],
    experiencedUsers: [experienced(10), experienced(11)],
    existingAssignments: [
      existingAssignment(100, "R10", 10, dates[0].date),
      existingAssignment(101, "R11", 11, dates[0].date),
      existingReviewByA,
    ],
    availability: available(blocked),
    routes: directionalRoutes({
      "R10->C1": 10, "C1->R10": 12,
      "R11->C1": 20, "C1->R11": 22,
    }),
  });
  assert.equal(result.experiencedReviewer?.id, 11);
  assert.equal(result.evidence.crossTypeOverlap, false);
  assert.equal(result.evidence.sameDayRoute?.selectedRouteMinutes, 20);
});

test("J: 기존업체는 동일 담당자 하루 최대 3건", async () => {
  const user = experienced(1);
  const results = await recommendBatch({ targets: [1, 2, 3, 4].map(id => target(id, "existing", user)), experiencedUsers: [user], availability: available(), routes: route() });
  assert.equal(results.slice(0, 3).filter(item => item.date === results[0].date).length, 3);
  assert.notEqual(results[3].date, results[0].date);
});

test("K/L: 기존 경력 검토는 일 6건까지이며 신규 경력자 균등 카운트에서 제외", async () => {
  const reviewer1 = experienced(10);
  const reviewer2 = experienced(11);
  const existing = await recommendBatch({
    targets: [1, 2, 3, 4, 5, 6].map(id => target(id, "existing", novice(id))),
    experiencedUsers: [reviewer1, reviewer2], availability: available(), routes: route(),
  });
  assert.equal(existing.filter(item => item.date === existing[0].date && item.experiencedReviewer?.id === 10).length, 6);
  assert.ok(existing.every(item => item.evidence.experiencedNewAssignments === 0));
});

test("기존 검토는 같은 날 신규 현장이 없는 다른 경력자를 우선", async () => {
  const date = recommendationDates("2026-07-14")[0].date;
  const [result] = await recommendBatch({
    targets: [target(1, "existing", novice(1))], experiencedUsers: [experienced(10), experienced(11)],
    existingAssignments: [existingAssignment(100, "N100", 10, date)], availability: available(), routes: route(),
  });
  assert.equal(result.date, date);
  assert.equal(result.experiencedReviewer?.id, 11);
  assert.equal(result.evidence.crossTypeOverlap, false);
  assert.equal(result.evidence.crossTypeOverlapAvoided, true);
});

test("기존 검토는 같은 날 신규 현장 중복보다 다음 적절한 날짜를 우선", async () => {
  const dates = recommendationDates("2026-07-14");
  const [result] = await recommendBatch({
    targets: [target(1, "existing", novice(1))], experiencedUsers: [experienced(10)],
    existingAssignments: [existingAssignment(100, "N100", 10, dates[0].date)], availability: available(), routes: route(),
  });
  assert.equal(result.date, dates[1].date);
  assert.equal(result.evidence.crossTypeOverlap, false);
  assert.equal(result.evidence.crossTypeOverlapAvoided, true);
});

test("다른 경력자와 날짜가 모두 없으면 기존 검토의 cross-type 중복을 evidence와 함께 허용", async () => {
  const dates = recommendationDates("2026-07-14");
  const [result] = await recommendBatch({
    targets: [target(1, "existing", novice(1))], experiencedUsers: [experienced(10)],
    existingAssignments: dates.map((item, index) => existingAssignment(100 + index, `N${index}`, 10, item.date)),
    availability: available(), routes: route(),
  });
  assert.equal(result.status, "recommended");
  assert.equal(result.date, dates[0].date);
  assert.equal(result.evidence.crossTypeOverlap, true);
  assert.equal(result.evidence.crossTypeOverlapReason, "unavoidable_cross_type_overlap");
});

test("측정일 순서상 기존 검토가 먼저 확정돼도 뒤 신규 현장을 보존하고 기존 검토 날짜를 옮김", async () => {
  const reviewer = experienced(10);
  const existingTarget = target(1, "existing", novice(1), "2026-07-13");
  const newTarget = target(2, "new", novice(20), "2026-07-14");
  const existingDates = recommendationDates(existingTarget.measurementDate);
  const newDates = recommendationDates(newTarget.measurementDate);
  const sharedDate = newDates.find((item) => existingDates.some((existing) => existing.date === item.date))!.date;
  const blocked = new Set([
    ...existingDates.slice(0, existingDates.findIndex((item) => item.date === sharedDate))
      .map((item) => `${existingTarget.responsible.id}:${item.date}`),
    ...newDates.filter((item) => item.date !== sharedDate).map((item) => `${newTarget.responsible.id}:${item.date}`),
  ]);
  const results = await recommendBatch({
    targets: [existingTarget, newTarget], experiencedUsers: [reviewer], availability: available(blocked), routes: route(),
  });
  const existingResult = results.find((result) => result.targetId === existingTarget.id)!;
  const newResult = results.find((result) => result.targetId === newTarget.id)!;
  assert.equal(newResult.date, sharedDate);
  assert.notEqual(existingResult.date, sharedDate);
  assert.equal(existingResult.evidence.crossTypeOverlap, false);
  assert.equal(existingResult.evidence.crossTypeOverlapAvoided, true);
});

test("기존 경력 검토자는 하루 6건을 초과하지 않음", async () => {
  const dates = recommendationDates("2026-07-14");
  const reviews: ExistingAssignment[] = Array.from({ length: 6 }, (_, index) => ({
    targetId: 200 + index, businessCode: `E${index}`, kind: "existing", date: dates[0].date,
    participants: [20 + index, 10], responsibleUserId: 20 + index, experiencedReviewerId: 10,
    coordinate: null, region: null,
  }));
  const [result] = await recommendBatch({
    targets: [target(1, "existing", novice(1))], experiencedUsers: [experienced(10)],
    existingAssignments: reviews, availability: available(), routes: route(),
  });
  assert.equal(result.date, dates[1].date);
});

test("수동 신규 2건은 실제 차량 30분이면 허용하고 61분/미검증이면 거부", async () => {
  const responsible = experienced(1);
  const current = target(2, "new", responsible);
  const date = recommendationDates(current.measurementDate)[0].date;
  const other = existingAssignment(1, "C1", responsible.id, date);
  for (const [metrics, valid] of [[route(30), true], [route(61), false], [route(null, "distance"), false]] as const) {
    const result = await validateManualPlanHardRules({
      target: current, recommendedDate: date, participants: [responsible], existingAssignments: [other], routes: metrics,
    });
    assert.equal(result.valid, valid);
  }
});

test("수동 기존 담당자의 같은 날 네 번째 계획은 거부", async () => {
  const responsible = experienced(1);
  const current = target(4, "existing", responsible);
  const date = recommendationDates(current.measurementDate)[0].date;
  const assignments: ExistingAssignment[] = [1, 2, 3].map((id) => ({
    targetId: id, businessCode: `E${id}`, kind: "existing", date, participants: [responsible.id],
    responsibleUserId: responsible.id, experiencedReviewerId: null, coordinate: null, region: null,
  }));
  const result = await validateManualPlanHardRules({
    target: current, recommendedDate: date, participants: [responsible], existingAssignments: assignments, routes: route(),
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /하루 최대 3건/);
});

test("M/N: 보고서 담당자 변경은 자동/수동 계획 구분 없이 재추천", () => {
  for (const manual of [false, true]) {
    assert.equal(targetChangeRecommendationPolicy({ responsibleChanged: true, measurementDateChanged: false, existingRecommendedDate: manual ? "2026-06-01" : "2026-06-02", nextMeasurementDate: "2026-07-14" }), "recalculate");
  }
});

test("O/P: 측정일 단순 변경은 유지하고 -3 이내/이후만 재추천", () => {
  const validDate = recommendationDates("2026-07-20").find((item) => item.workingDaysBefore === 20)!.date;
  assert.equal(targetChangeRecommendationPolicy({ responsibleChanged: false, measurementDateChanged: true, existingRecommendedDate: validDate, nextMeasurementDate: "2026-07-20" }), "keep");
  assert.equal(targetChangeRecommendationPolicy({ responsibleChanged: false, measurementDateChanged: true, existingRecommendedDate: "2026-07-17", nextMeasurementDate: "2026-07-20" }), "recalculate");
  assert.equal(targetChangeRecommendationPolicy({ responsibleChanged: false, measurementDateChanged: true, existingRecommendedDate: "2026-07-21", nextMeasurementDate: "2026-07-20" }), "recalculate");
  assert.equal(targetChangeRecommendationPolicy({ responsibleChanged: false, measurementDateChanged: true, existingRecommendedDate: "2026-05-01", nextMeasurementDate: "2026-07-20" }), "recalculate");
});

test("Q-V: 단일 추천 저장/UI/수동수정/Google 신호 배제/score 제거 구조", () => {
  const ui = readFileSync("components/features/MeasurementTargetBusinessManagement.tsx", "utf8");
  const recommendRoute = readFileSync("app/api/preliminary-survey-v2/recommend/route.ts", "utf8");
  const manualRoute = readFileSync("app/api/preliminary-survey-v2/[targetId]/route.ts", "utf8");
  const engine = readFileSync("lib/preliminary-survey-v2/engine.ts", "utf8");
  const service = readFileSync("lib/preliminary-survey-v2/service.ts", "utf8");
  const migration = readFileSync("supabase/migrations/20260808_add_preliminary_survey_v2.sql", "utf8");
  assert.match(recommendRoute, /recommendAndPersistV2/);
  assert.match(ui, /예비조사자\(복수선택 가능\)/);
  assert.doesNotMatch(ui, /선택한 추천안 적용|추천일 숨김/);
  assert.match(manualRoute, /plan_origin[\s\S]*manual/);
  assert.doesNotMatch(engine, /Google|occupied|preferredDate|preferred_date/);
  assert.doesNotMatch(service, /preliminary_survey_rule_type/);
  assert.doesNotMatch(manualRoute, /preliminary_survey_rule_type/);
  assert.match(manualRoute, /loadV2ManualContext/);
  assert.match(migration, /survey_method text NOT NULL/);
  assert.match(migration, /measurement_journal[\s\S]*V2_CLASSIFICATION_SOURCE_MISMATCH/);
  assert.doesNotMatch(migration, /recommendation_score\s+(integer|bigint)/i);
});
