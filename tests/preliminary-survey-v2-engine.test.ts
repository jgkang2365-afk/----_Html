import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { recommendationDatesForBusinessType } from "../lib/preliminary-survey-v2/calendar";
import {
  classifyMeasurementJournalBusiness,
  type MeasurementJournalClassificationRow,
} from "../lib/preliminary-survey-v2/classification";
import { recommendBatch } from "../lib/preliminary-survey-v2/engine";
import { validateManualPlanHardRules } from "../lib/preliminary-survey-v2/manual-validation";
import { targetChangeRecommendationPolicy } from "../lib/preliminary-survey-v2/policy";
import { surveyMethodForKind, type ExistingAssignment, type RouteMetrics, type SurveyTarget, type SurveyUser } from "../lib/preliminary-survey-v2/types";

const experienced = (id: number, name = `경력${id}`): SurveyUser => ({ id, name, experienced: true, active: true });
const novice = (id: number, name = `비경력${id}`): SurveyUser => ({ id, name, experienced: false, active: true });
const businessTypeForKind = (kind: "new" | "existing") => kind === "new" ? "first_measurement" as const : "existing" as const;
const target = (
  id: number,
  kind: "new" | "existing",
  responsible: SurveyUser,
  measurementDate = "2026-08-27",
  businessType: NonNullable<SurveyTarget["businessType"]> = businessTypeForKind(kind),
): SurveyTarget => ({
  id,
  code: `H${String(id).padStart(4, "0")}`,
  name: `사업장${id}`,
  kind,
  businessType,
  responsible,
  measurementDate,
  address: `충남 천안시 사업장로 ${id}`,
  region: "충남 천안시",
  coordinate: null,
  createdAt: `2026-01-${String(Math.min(id, 28)).padStart(2, "0")}`,
});
const available = (blocked = new Set<string>()) => ({
  isBlocked: (userId: number, date: string) => blocked.has(`${userId}:${date}`),
});
const routes = (minutes: number | null = null): RouteMetrics => ({
  between: async () => ({
    source: minutes == null ? "unknown" : "vehicle",
    durationMinutes: minutes,
    distanceKm: minutes == null ? null : 20,
    sameRegion: true,
  }),
});
const assignment = (
  targetId: number,
  userId: number,
  date: string,
  kind: "new" | "existing" = "new",
): ExistingAssignment => ({
  targetId,
  businessCode: `OLD${targetId}`,
  kind,
  date,
  participants: [userId],
  responsibleUserId: userId,
  experiencedReviewerId: null,
  surveyMethod: kind === "new" ? "field" : "phone",
  coordinate: null,
  region: "충남 천안시",
});
const journal = (note: unknown): MeasurementJournalClassificationRow => ({
  id: 1,
  code: "H0001",
  measurement_year: 2026,
  measurement_period: "하반기",
  note,
  updated_at: "2026-08-01T00:00:00Z",
});

test("authoritative business_type은 journal과 legacy rule보다 우선한다", () => {
  const result = classifyMeasurementJournalBusiness({
    code: "H0001",
    year: 2026,
    period: "하반기",
    business_type: "existing",
    preliminary_survey_rule_type: "general_new",
  }, [journal("타기관 신규")]);
  assert.equal(result.kind, "existing");
  assert.equal(result.source, "target_business_type");
  assert.equal(result.resolved, true);
});

test("business_type이 null일 때만 journal과 legacy rule fallback을 사용한다", () => {
  const fromJournal = classifyMeasurementJournalBusiness({
    code: "H0001", year: 2026, period: "하반기", business_type: null,
    preliminary_survey_rule_type: "existing",
  }, [journal("최초실시")]);
  assert.equal(fromJournal.kind, "new");
  assert.equal(fromJournal.businessType, "first_measurement");
  assert.equal(fromJournal.source, "legacy_journal");
  assert.equal(fromJournal.resolved, true);

  const fromRule = classifyMeasurementJournalBusiness({
    code: "H0001", year: 2026, period: "하반기", business_type: null,
    preliminary_survey_rule_type: "other_org_new",
  }, []);
  assert.equal(fromRule.kind, "new");
  assert.equal(fromRule.businessType, "external_new");
  assert.equal(fromRule.source, "legacy_rule_type");
  assert.equal(fromRule.resolved, true);
});

test("유형 원천이 전혀 없거나 authoritative 값이 잘못되면 unresolved이다", () => {
  const missing = classifyMeasurementJournalBusiness({
    code: "H0001", year: 2026, period: "하반기", business_type: null,
  }, []);
  const invalid = classifyMeasurementJournalBusiness({
    code: "H0001", year: 2026, period: "하반기", business_type: "general_new",
    preliminary_survey_rule_type: "general_new",
  }, [journal("최초실시")]);
  assert.equal(missing.resolved, false);
  assert.equal(invalid.resolved, false);
  assert.equal(invalid.source, "target_business_type");
});

test("유형별 날짜 범위와 방식 정책을 유지한다", () => {
  assert.deepEqual(
    recommendationDatesForBusinessType("2026-08-27", "first_measurement").map((item) => item.workingDaysBefore),
    Array.from({ length: 28 }, (_, index) => index + 3),
  );
  const external = recommendationDatesForBusinessType("2026-08-27", "external_new")
    .map((item) => item.workingDaysBefore);
  assert.deepEqual(external, [
    ...Array.from({ length: 18 }, (_, index) => 20 - index),
    ...Array.from({ length: 5 }, (_, index) => 25 - index),
  ]);
  assert.deepEqual(
    recommendationDatesForBusinessType("2026-08-27", "existing").map((item) => item.workingDaysBefore),
    external,
  );
  assert.equal(surveyMethodForKind("new"), "field");
  assert.equal(surveyMethodForKind("existing"), "phone");
});

test("today=2026-08-26, measurement=2026-08-27이면 과거 기준일을 recommended로 생성한다", async () => {
  const user = experienced(1);
  const [result] = await recommendBatch({
    targets: [target(1, "new", user, "2026-08-27")],
    experiencedUsers: [user],
    availability: available(),
    routes: routes(),
  });
  assert.equal(result.status, "recommended");
  assert.ok(result.date && result.date < "2026-08-26");
  assert.ok(result.date < "2026-08-27");
  assert.equal(result.surveyMethod, "field");
});

test("직원 제외 일정은 추천 hard blocker가 아니다", async () => {
  const user = experienced(1);
  const candidate = recommendationDatesForBusinessType("2026-08-27", "first_measurement")[0].date;
  const [result] = await recommendBatch({
    targets: [target(1, "new", user)],
    experiencedUsers: [user],
    availability: available(new Set([`${user.id}:${candidate}`])),
    routes: routes(),
  });
  assert.equal(result.status, "recommended");
  assert.equal(result.date, candidate);
});

test("같은 날짜 측정 업무와 다른 예비조사 기록은 추천을 차단하지 않는다", async () => {
  const user = experienced(1);
  const candidate = recommendationDatesForBusinessType("2026-08-27", "first_measurement")[0].date;
  const existing = Array.from({ length: 5 }, (_, index) => assignment(100 + index, user.id, candidate));
  const [result] = await recommendBatch({
    targets: [target(1, "new", user)],
    experiencedUsers: [user],
    existingAssignments: existing,
    availability: available(),
    routes: routes(90),
  });
  assert.equal(result.status, "recommended");
  assert.equal(result.date, candidate);
});

test("동선이 60분을 넘거나 검증되지 않아도 그것만으로 manual_required가 되지 않는다", async () => {
  const user = experienced(1);
  const candidate = recommendationDatesForBusinessType("2026-08-27", "first_measurement")[0].date;
  for (const metric of [routes(90), routes(null)]) {
    const [result] = await recommendBatch({
      targets: [target(1, "new", user)],
      experiencedUsers: [user],
      existingAssignments: [assignment(100, user.id, candidate)],
      availability: available(),
      routes: metric,
    });
    assert.equal(result.status, "recommended");
  }
});

test("8/27 측정대상 8건은 today cutoff와 일일 capacity 때문에 8/8 실패하지 않는다", async () => {
  const users = [experienced(1), experienced(2), experienced(3), experienced(4), experienced(5), experienced(6)];
  const targets = [
    target(1, "new", users[0], "2026-08-27", "first_measurement"),
    target(2, "new", users[0], "2026-08-27", "first_measurement"),
    target(3, "new", users[0], "2026-08-27", "external_new"),
    target(4, "new", users[0], "2026-08-27", "external_new"),
    ...Array.from({ length: 4 }, (_, index) =>
      target(index + 5, "existing", users[0], "2026-08-27", "existing")),
  ];
  const results = await recommendBatch({
    targets,
    surveyors: users,
    experiencedUsers: users,
    availability: available(),
    routes: routes(),
  });
  assert.equal(results.length, 8);
  assert.ok(results.every((result) => result.status === "recommended" && result.date! < "2026-08-27"));
  assert.ok(results.filter((result) => result.targetId <= 4).every((result) => result.surveyMethod === "field"));
  assert.ok(results.filter((result) => result.targetId >= 5).every((result) => result.surveyMethod === "phone"));
  assert.ok(new Set(results.map((result) => result.responsible.id)).size > 1);
});

test("최초실시와 타기관 신규는 field, 기존업체는 route와 무관하게 phone이다", async () => {
  const user = experienced(1);
  const results = await recommendBatch({
    targets: [
      target(1, "new", user, "2026-08-27", "first_measurement"),
      target(2, "new", user, "2026-08-27", "external_new"),
      target(3, "existing", user, "2026-08-27", "existing"),
    ],
    experiencedUsers: [user],
    availability: available(),
    routes: routes(5),
  });
  assert.deepEqual(results.map((result) => result.surveyMethod), ["field", "field", "phone"]);
});

test("최초실시 비경력자에게 유효 경력자가 없으면 document hard rule로 manual_required이다", async () => {
  const [result] = await recommendBatch({
    targets: [target(1, "new", novice(1))],
    experiencedUsers: [],
    availability: available(),
    routes: routes(),
  });
  assert.equal(result.status, "manual_required");
  assert.equal(result.evidence.reviewerConflict, true);
});

test("경력자 배정과 조사자 순환은 deterministic하게 유지한다", async () => {
  const reviewerA = experienced(10);
  const reviewerB = experienced(11);
  const input = {
    targets: Array.from({ length: 6 }, (_, index) => target(index + 1, "existing", novice(index + 1))),
    experiencedUsers: [reviewerA, reviewerB],
    availability: available(),
    routes: routes(),
  };
  const forward = await recommendBatch(input);
  const reverse = await recommendBatch({ ...input, targets: [...input.targets].reverse() });
  assert.deepEqual(
    forward.map((result) => [result.targetId, result.experiencedReviewer?.id]),
    reverse.map((result) => [result.targetId, result.experiencedReviewer?.id]),
  );
  const counts = [reviewerA.id, reviewerB.id].map((id) =>
    forward.filter((result) => result.experiencedReviewer?.id === id).length).sort();
  assert.deepEqual(counts, [3, 3]);
});

test("manual validator는 날짜·방식·유효 사용자·신규 경력자만 hard rule로 검증한다", async () => {
  const user = experienced(1);
  const current = target(1, "new", user);
  const allowedDate = recommendationDatesForBusinessType(current.measurementDate, "first_measurement")[0].date;
  const overloaded = Array.from({ length: 5 }, (_, index) => assignment(100 + index, user.id, allowedDate));
  const valid = await validateManualPlanHardRules({
    target: current,
    recommendedDate: allowedDate,
    participants: [user],
    surveyMethod: "field",
    existingAssignments: overloaded,
    routes: routes(120),
  });
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.routeEvidence, []);

  const wrongMethod = await validateManualPlanHardRules({
    target: current,
    recommendedDate: allowedDate,
    participants: [user],
    surveyMethod: "phone",
    existingAssignments: [],
    routes: routes(),
  });
  assert.equal(wrongMethod.valid, false);
  assert.match(wrongMethod.errors.join(" "), /방문/);

  const existingField = await validateManualPlanHardRules({
    target: target(2, "existing", user),
    recommendedDate: recommendationDatesForBusinessType("2026-08-27", "existing")[0].date,
    participants: [user],
    surveyMethod: "field",
    existingAssignments: [],
    routes: routes(),
  });
  assert.equal(existingField.valid, false);
  assert.match(existingField.errors.join(" "), /기존업체.*유선/);
});

test("manual validator는 비활성 사용자와 정책 범위 밖 날짜를 계속 거부한다", async () => {
  const inactive = { ...experienced(1), active: false };
  const current = target(1, "new", inactive);
  const result = await validateManualPlanHardRules({
    target: current,
    recommendedDate: current.measurementDate,
    participants: [inactive],
    surveyMethod: "field",
    existingAssignments: [],
    routes: routes(),
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /영업일 범위|비활성/);
});

test("recommend/apply/manual 경로는 같은 document hard-rule validator를 사용하고 일정 충돌을 저장 차단하지 않는다", () => {
  const service = readFileSync("lib/preliminary-survey-v2/service.ts", "utf8");
  const workbench = readFileSync("app/api/preliminary-survey-v2/workbench/route.ts", "utf8");
  const manual = readFileSync("app/api/preliminary-survey-v2/[targetId]/route.ts", "utf8");
  const validator = readFileSync("lib/preliminary-survey-v2/manual-validation.ts", "utf8");
  assert.match(service, /validateManualPlanHardRules/);
  assert.match(workbench, /validateManualPlanHardRules/);
  assert.match(manual, /validateManualPlanHardRules/);
  assert.doesNotMatch(manual, /USER_UNAVAILABLE_ON_SURVEY_DATE|user_schedule_blocks/);
  assert.doesNotMatch(validator, /evaluateSameDayRoute|하루 최대|차량 60분|허용 동선/);
  const applyBody = workbench.slice(workbench.indexOf("async function applySubmittedDrafts"), workbench.indexOf("export async function GET"));
  assert.doesNotMatch(applyBody, /loadScheduleBlockKeys|loadActualMeasurementBlockedKeys|blockedKeys\.has/);
});

test("추천 후보 경로에는 today/minimumDate cutoff가 없고 조회용 KST helper는 유지한다", () => {
  const engine = readFileSync("lib/preliminary-survey-v2/engine.ts", "utf8");
  const service = readFileSync("lib/preliminary-survey-v2/service.ts", "utf8");
  const calendar = readFileSync("lib/preliminary-survey-v2/calendar.ts", "utf8");
  const range = readFileSync("lib/preliminary-survey-v2/recommendation-range.ts", "utf8");
  assert.doesNotMatch(engine, /planningDate|minimumDate|currentDateInKst/);
  assert.doesNotMatch(service, /planningDate|minimumDate|currentDateInKst/);
  assert.doesNotMatch(calendar, /minimumDate/);
  assert.match(range, /export function currentDateInKst/);
});

test("측정일 변경 시 기존 추천일의 working-day 범위 검증은 유지한다", () => {
  const validDate = recommendationDatesForBusinessType("2026-09-10", "existing")[0].date;
  assert.equal(targetChangeRecommendationPolicy({
    responsibleChanged: false,
    measurementDateChanged: true,
    existingRecommendedDate: validDate,
    nextMeasurementDate: "2026-09-10",
  }), "keep");
  assert.equal(targetChangeRecommendationPolicy({
    responsibleChanged: false,
    measurementDateChanged: true,
    existingRecommendedDate: "2026-09-10",
    nextMeasurementDate: "2026-09-10",
  }), "recalculate");
});
