import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { recommendationDates, recommendationDatesForBusinessType } from "../lib/preliminary-survey-v2/calendar";
import { buildScheduleBlockKeys } from "../lib/preliminary-survey-v2/availability";
import { classifyMeasurementJournalBusiness, type MeasurementJournalClassificationRow } from "../lib/preliminary-survey-v2/classification";
import { recommendBatch } from "../lib/preliminary-survey-v2/engine";
import { validateManualPlanHardRules } from "../lib/preliminary-survey-v2/manual-validation";
import {
  shouldApplyProcessChangedPolicy,
  targetChangeRecommendationPolicy,
} from "../lib/preliminary-survey-v2/policy";
import { surveyMethodForKind, type ExistingAssignment, type RouteMetric, type RouteMetrics, type SurveyTarget, type SurveyUser } from "../lib/preliminary-survey-v2/types";

const experienced = (id: number, name = `경력${id}`): SurveyUser => ({ id, name, experienced: true, active: true });
const novice = (id: number, name = `비경력${id}`): SurveyUser => ({ id, name, experienced: false, active: true });
const target = (id: number, kind: "new" | "existing", responsible: SurveyUser, measurementDate = "2026-07-14"): SurveyTarget => ({
  id, code: `C${id}`, name: `사업장${id}`, kind, responsible, measurementDate,
  address: `충남 천안시 사업장로 ${id}`, region: "충남 천안시", coordinate: { latitude: 36.8 + id / 1000, longitude: 127.1 },
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

test("target business_type은 일지와 legacy rule보다 우선한다", () => {
  const existing = classifyMeasurementJournalBusiness({
    ...classificationTarget,
    business_type: "existing",
    preliminary_survey_rule_type: "general_new",
  }, [journal("타기관 신규")]);
  assert.equal(existing.kind, "existing");
  assert.equal(existing.source, "target_business_type");

  const firstMeasurement = classifyMeasurementJournalBusiness({
    ...classificationTarget,
    business_type: "first_measurement",
  }, [journal("일반 기존")]);
  assert.equal(firstMeasurement.kind, "new");
  assert.equal(firstMeasurement.source, "target_business_type");

  const externalNew = classifyMeasurementJournalBusiness({
    ...classificationTarget,
    business_type: "external_new",
  }, [journal("일반 기존")]);
  assert.equal(externalNew.kind, "new");
  assert.equal(externalNew.source, "target_business_type");
});

test("business_type이 NULL이면 기존 측정일지 parser와 legacy rule fallback을 보존한다", () => {
  const fromJournal = classifyMeasurementJournalBusiness({
    ...classificationTarget,
    business_type: null,
    preliminary_survey_rule_type: "existing",
  }, [journal("신규")]);
  assert.equal(fromJournal.kind, "new");
  assert.equal(fromJournal.source, "legacy_journal");

  const fromLegacyRule = classifyMeasurementJournalBusiness({
    ...classificationTarget,
    business_type: null,
    preliminary_survey_rule_type: "other_org_new",
  }, []);
  assert.equal(fromLegacyRule.kind, "new");
  assert.equal(fromLegacyRule.source, "legacy_rule_type");
});

test("공정변경 정책 OFF와 적용 시작 전 대상은 V2에 적용하지 않는다", () => {
  const targetInput = {
    year: 2026,
    period: "하반기",
    measurementDate: "2026-08-10",
    processChanged: true,
  };
  assert.equal(shouldApplyProcessChangedPolicy({
    policy: {
      enabled: false,
      effectiveStartYear: 2026,
      effectiveStartPeriod: "하반기",
      effectiveStartMeasurementDate: "2026-08-01",
    },
    target: targetInput,
  }), false);
  assert.equal(shouldApplyProcessChangedPolicy({
    policy: {
      enabled: true,
      effectiveStartYear: 2026,
      effectiveStartPeriod: "하반기",
      effectiveStartMeasurementDate: "2026-08-11",
    },
    target: targetInput,
  }), false);
  assert.equal(shouldApplyProcessChangedPolicy({
    policy: { enabled: false, effectiveStartYear: null, effectiveStartPeriod: null, effectiveStartMeasurementDate: null },
    target: { year: 2026, period: "하반기(수시)", measurementDate: "2026-08-10", processChanged: true },
  }), false);
});

test("공정변경 정책은 적용 시작 이후 true 값과 유효 측정일이 있을 때만 applicable이다", () => {
  const policy = {
    enabled: true,
    effectiveStartYear: 2026,
    effectiveStartPeriod: "하반기",
    effectiveStartMeasurementDate: "2026-08-01",
  };
  assert.equal(shouldApplyProcessChangedPolicy({
    policy,
    target: { year: 2026, period: "하반기", measurementDate: "2026-08-01", processChanged: true },
  }), true);
  assert.equal(shouldApplyProcessChangedPolicy({
    policy,
    target: { year: 2027, period: "상반기", measurementDate: null, processChanged: true },
  }), false);
  assert.equal(shouldApplyProcessChangedPolicy({
    policy,
    target: { year: 2027, period: "상반기", measurementDate: "2027-01-01", processChanged: null },
  }), false);
});

test("공정변경 정책은 수시 주기를 반기 기준으로 정규화해 판정한다", () => {
  const policy = {
    enabled: true,
    effectiveStartYear: 2026,
    effectiveStartPeriod: "하반기",
    effectiveStartMeasurementDate: "2026-08-01",
  };
  assert.equal(shouldApplyProcessChangedPolicy({
    policy,
    target: { year: 2026, period: "하반기", measurementDate: "2026-08-10", processChanged: true },
  }), true);
  assert.equal(shouldApplyProcessChangedPolicy({
    policy,
    target: { year: 2026, period: "하반기(수시)", measurementDate: "2026-08-10", processChanged: true },
  }), true);
  assert.equal(shouldApplyProcessChangedPolicy({
    policy,
    target: { year: 2026, period: "상반기", measurementDate: "2026-08-10", processChanged: true },
  }), false);
  assert.equal(shouldApplyProcessChangedPolicy({
    policy,
    target: { year: 2026, period: "상반기(수시)", measurementDate: "2026-08-10", processChanged: true },
  }), false);

  const upperPolicy = {
    enabled: true,
    effectiveStartYear: 2026,
    effectiveStartPeriod: "상반기",
    effectiveStartMeasurementDate: "2026-01-01",
  };
  assert.equal(shouldApplyProcessChangedPolicy({
    policy: upperPolicy,
    target: { year: 2026, period: "상반기", measurementDate: "2026-03-01", processChanged: true },
  }), true);
  assert.equal(shouldApplyProcessChangedPolicy({
    policy: upperPolicy,
    target: { year: 2026, period: "상반기(수시)", measurementDate: "2026-03-01", processChanged: true },
  }), true);
  assert.equal(shouldApplyProcessChangedPolicy({
    policy: upperPolicy,
    target: { year: 2026, period: "하반기", measurementDate: "2026-03-01", processChanged: true },
  }), true);
  assert.equal(shouldApplyProcessChangedPolicy({
    policy: upperPolicy,
    target: { year: 2026, period: "하반기(수시)", measurementDate: "2026-03-01", processChanged: true },
  }), true);
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

test("A: 같은 날짜의 blocked 조사자는 제외하고 가능한 다른 조사자를 추천한다", async () => {
  const blockedResponsible = { ...experienced(1), name: "이태환" };
  const availableResponsible = { ...experienced(2), name: "고유빈" };
  const dates = recommendationDatesForBusinessType("2026-08-27", "external_new");
  assert.equal(dates[0].date, "2026-07-29");
  const [result] = await recommendBatch({
    targets: [{ ...target(1, "new", blockedResponsible, "2026-08-27"), businessType: "external_new" }],
    surveyors: [blockedResponsible, availableResponsible],
    experiencedUsers: [blockedResponsible, availableResponsible],
    availability: available(new Set([`${blockedResponsible.id}:${dates[0].date}`])),
    routes: route(),
  });
  assert.equal(result.status, "recommended");
  assert.equal(result.date, dates[0].date);
  assert.equal(result.responsible.id, availableResponsible.id);
});

test("D: blocked 경력 검토자는 제외하고 가능한 다른 경력자를 선택한다", async () => {
  const dates = recommendationDatesForBusinessType("2026-08-27", "external_new");
  const [result] = await recommendBatch({
    targets: [{ ...target(1, "new", novice(1), "2026-08-27"), businessType: "external_new" }],
    experiencedUsers: [experienced(10), experienced(11)],
    availability: available(new Set([`10:${dates[0].date}`])),
    routes: route(),
  });
  assert.equal(result.date, dates[0].date);
  assert.equal(result.experiencedReviewer?.id, 11);
});

test("기존 사업장 유선 경력 검토자의 일정·실측은 후보일을 막지 않는다", async () => {
  const dates = recommendationDates("2026-07-14");
  const [result] = await recommendBatch({
    targets: [target(1, "existing", novice(1))],
    experiencedUsers: [experienced(10), experienced(11)],
    availability: available(new Set([`10:${dates[0].date}`])),
    routes: route(),
  });
  assert.equal(result.status, "recommended");
  assert.equal(result.date, dates[0].date);
  assert.equal(result.experiencedReviewer?.id, 10);
  assert.deepEqual(result.participants.map((item) => item.id), [1, 10]);
});

test("C: 모든 정책 유효 날짜에서 필요한 조사자가 blocked면 manual_required다", async () => {
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

test("최초실시는 authoritative 후보 순서인 -3부터 추천한다", async () => {
  const user = experienced(1);
  const [result] = await recommendBatch({
    targets: [{ ...target(1, "new", user), businessType: "first_measurement" }],
    experiencedUsers: [user], availability: available(), routes: route(),
  });
  assert.equal(result.evidence.workingDaysBefore, 3);
});

test("타기관 신규 후보는 -20~-3 뒤에 -25~-21 fallback 순서를 유지한다", () => {
  const dates = recommendationDatesForBusinessType("2026-07-14", "external_new");
  assert.deepEqual(dates.slice(0, 18).map((item) => item.workingDaysBefore),
    Array.from({ length: 18 }, (_, index) => 20 - index));
  assert.deepEqual(dates.slice(18).map((item) => item.workingDaysBefore), [25, 24, 23, 22, 21]);
});

test("B: 첫 정책 날짜의 모든 조사자가 blocked면 다음 유효 날짜를 추천한다", async () => {
  const user = experienced(1);
  const dates = recommendationDatesForBusinessType("2026-08-27", "external_new");
  assert.deepEqual(dates.slice(0, 2).map((item) => item.date), ["2026-07-29", "2026-07-30"]);
  const blocked = new Set([`${user.id}:${dates[0].date}`]);
  const [result] = await recommendBatch({
    targets: [{ ...target(1, "new", user, "2026-08-27"), businessType: "external_new" }],
    experiencedUsers: [user], availability: available(blocked), routes: route(),
  });
  assert.equal(result.date, dates[1].date);
});

test("전 기간에 유효 조사자가 없으면 수동조정 상태가 된다", async () => {
  const user = experienced(1);
  const blocked = new Set(recommendationDates("2026-07-14").map(item => `${user.id}:${item.date}`));
  const [result] = await recommendBatch({ targets: [target(1, "new", user)], experiencedUsers: [user], availability: available(blocked), routes: route() });
  assert.equal(result.status, "manual_required");
  assert.equal(result.date, null);
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

test("기존·가확정·영향범위 밖 방문도 참여자별 하루 2건 방문 용량에 포함한다", async () => {
  const user = experienced(1);
  const dates = recommendationDatesForBusinessType("2026-07-14", "first_measurement");
  const blocked = new Set(dates.slice(1).map((item) => `${user.id}:${item.date}`));
  const fieldAssignments: ExistingAssignment[] = [101, 102].map((targetId) => ({
    targetId, businessCode: `OUT${targetId}`, kind: "existing", date: dates[0].date,
    participants: [user.id], responsibleUserId: user.id, experiencedReviewerId: null,
    surveyMethod: "field", coordinate: null, region: null,
  }));
  const [result] = await recommendBatch({
    targets: [{ ...target(1, "new", user), businessType: "first_measurement" }],
    experiencedUsers: [user], existingAssignments: fieldAssignments,
    availability: available(blocked), routes: route(30),
  });
  assert.equal(result.status, "manual_required");
});

test("기존 선택방문과 신규 방문은 30분 이하 same-route를 우선하고 31~60분은 fallback으로 허용한다", async () => {
  const user = experienced(1);
  const dates = recommendationDatesForBusinessType("2026-07-14", "first_measurement");
  const blocked = new Set(dates.slice(1).map((item) => `${user.id}:${item.date}`));
  const existingField: ExistingAssignment = {
    targetId: 101, businessCode: "OUT101", kind: "existing", date: dates[0].date,
    participants: [user.id], responsibleUserId: user.id, experiencedReviewerId: null,
    surveyMethod: "field", coordinate: null, region: null,
  };
  const [automatic] = await recommendBatch({
    targets: [{ ...target(1, "new", user), businessType: "first_measurement" }],
    experiencedUsers: [user], existingAssignments: [existingField],
    availability: available(blocked), routes: route(30),
  });
  assert.equal(automatic.status, "recommended");
  assert.equal(automatic.evidence.selectionReason, "same_route_preferred_under_30");

  const [fallback] = await recommendBatch({
    targets: [{ ...target(1, "new", user), businessType: "first_measurement" }],
    experiencedUsers: [user], existingAssignments: [existingField],
    availability: available(blocked), routes: route(31),
  });
  assert.equal(fallback.status, "recommended");
  assert.equal(fallback.date, dates[0].date);
  assert.equal(fallback.evidence.selectionReason, "two_job_fallback_no_single_day");

  const [denied] = await recommendBatch({
    targets: [{ ...target(1, "new", user), businessType: "first_measurement" }],
    experiencedUsers: [user], existingAssignments: [existingField],
    availability: available(blocked), routes: route(61),
  });
  assert.equal(denied.status, "manual_required");
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

test("동일주소 방문은 route provider 실패와 무관하게 하루 2건 자동추천 가능", async () => {
  const user = experienced(1);
  const dates = recommendationDates("2026-07-14");
  const blocked = new Set(dates.slice(1).map((item) => `${user.id}:${item.date}`));
  const sameAddress = "충남 천안시 동일로 1";
  const existing = { ...existingAssignment(1, "C1", user.id, dates[0].date), address: sameAddress };
  const [result] = await recommendBatch({
    targets: [{ ...target(2, "new", user), address: sameAddress }], experiencedUsers: [user],
    availability: available(blocked), existingAssignments: [existing], routes: route(null, "unknown"),
  });
  assert.equal(result.status, "recommended");
  assert.equal(result.date, dates[0].date);
  assert.equal(result.evidence.selectionReason, "same_route_preferred_under_30");
  assert.equal(result.evidence.sameRouteMinutes, 0);
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

test("직원 일정상 기본구간이 불가하면 fallback 정책 날짜를 사용한다", async () => {
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

test("기존 사업장 경력 검토자는 차량경로를 조회하지 않는다", async () => {
  const date = recommendationDates("2026-07-14")[0].date;
  const calls: string[] = [];
  const routes: RouteMetrics = {
    between: async () => {
      calls.push("unexpected");
      throw new Error("기존업체 단독 추천에서 경로를 조회하면 안 됩니다.");
    },
  };
  const [result] = await recommendBatch({
    targets: [target(1, "existing", novice(1))],
    experiencedUsers: [experienced(10), experienced(11)],
    existingAssignments: [existingAssignment(100, "R10", 10, date), existingAssignment(101, "R11", 11, date)],
    availability: available(), routes,
  });
  assert.equal(result.experiencedReviewer?.id, 10);
  assert.deepEqual(result.participants.map((item) => item.id), [1, 10]);
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

test("기존업체 검토 역할은 신규 경력 동행자의 차량경로 선택을 막지 않는다", async () => {
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
  assert.equal(result.experiencedReviewer?.id, 10);
  assert.equal(result.evidence.crossTypeOverlap, false);
  assert.equal(result.evidence.sameDayRoute?.selectedRouteMinutes, 10);
});

test("D: 기존업체 유선 책임자는 같은 날짜 세 번째 건까지 허용한다", async () => {
  const user = experienced(1);
  const date = recommendationDates("2026-07-14")[0].date;
  const assignments = [1, 2].map((id) => ({
    ...existingAssignment(100 + id, `E${id}`, user.id, date), kind: "existing" as const, surveyMethod: "phone" as const,
  }));
  const [result] = await recommendBatch({
    targets: [target(3, "existing", user)], surveyors: [user], experiencedUsers: [user],
    existingAssignments: assignments, availability: available(), routes: route(),
  });
  assert.equal(result.status, "recommended");
  assert.equal(result.date, recommendationDates("2026-07-14")[1].date);
  assert.equal(result.responsible.id, user.id);
});

test("E: 날짜 load 우선 정책은 빈 다음 날짜에서 responsible 수행량을 균등화한다", async () => {
  const first = experienced(1);
  const second = experienced(2);
  const date = recommendationDates("2026-07-14")[0].date;
  const assignments = [1, 2, 3].map((id) => ({
    ...existingAssignment(100 + id, `E${id}`, first.id, date), kind: "existing" as const, surveyMethod: "phone" as const,
  }));
  const [result] = await recommendBatch({
    targets: [target(4, "existing", first)], surveyors: [first, second], experiencedUsers: [first, second],
    existingAssignments: assignments, availability: available(), routes: route(),
  });
  assert.equal(result.date, recommendationDates("2026-07-14")[1].date);
  assert.equal(result.responsible.id, second.id);
});

test("E2: 전역 allocator가 선택한 responsible를 후속 단계가 다시 고르지 않는다", async () => {
  const first = experienced(1);
  const second = experienced(2);
  const date = recommendationDates("2026-07-14")[0].date;
  const [result] = await recommendBatch({
    targets: [target(4, "existing", first)],
    surveyors: [first, second],
    experiencedUsers: [first, second],
    availability: {
      ...available(),
      isScheduleBlocked: (userId, candidateDate) => userId === first.id && candidateDate === date,
    },
    routes: route(),
  });
  assert.equal(result.date, date);
  assert.equal(result.responsible.id, second.id);
});

test("F: 첫 날짜의 모든 조사자가 유선 3건이면 다음 정책 날짜를 사용한다", async () => {
  const users = [experienced(1), experienced(2)];
  const dates = recommendationDates("2026-07-14");
  const assignments = users.flatMap((user) => [1, 2, 3].map((id) => ({
    ...existingAssignment(user.id * 100 + id, `E${user.id}${id}`, user.id, dates[0].date),
    kind: "existing" as const, surveyMethod: "phone" as const,
  })));
  const [result] = await recommendBatch({
    targets: [target(4, "existing", users[0])], surveyors: users, experiencedUsers: users,
    existingAssignments: assignments, availability: available(), routes: route(),
  });
  assert.equal(result.status, "recommended");
  assert.equal(result.date, dates[1].date);
});

test("G: 모든 정책 날짜의 모든 조사자가 유선 3건이면 manual_required다", async () => {
  const users = [experienced(1), experienced(2)];
  const dates = recommendationDates("2026-07-14");
  const assignments = dates.flatMap(({ date }, dateIndex) => users.flatMap((user) => [1, 2, 3].map((id) => ({
    ...existingAssignment(dateIndex * 1000 + user.id * 10 + id, `E${dateIndex}${user.id}${id}`, user.id, date),
    kind: "existing" as const, surveyMethod: "phone" as const,
  }))));
  const [result] = await recommendBatch({
    targets: [target(4, "existing", users[0])], surveyors: users, experiencedUsers: users,
    existingAssignments: assignments, availability: available(), routes: route(),
  });
  assert.equal(result.status, "manual_required");
  assert.equal(result.date, null);
});

test("K/L: 기존 사업장 비경력 담당자에게 경력 검토자를 soft balancing한다", async () => {
  const reviewer1 = experienced(10);
  const reviewer2 = experienced(11);
  const existing = await recommendBatch({
    targets: [1, 2, 3, 4, 5, 6].map(id => target(id, "existing", novice(id))),
    experiencedUsers: [reviewer1, reviewer2], availability: available(), routes: route(),
  });
  assert.ok(existing.every(item => item.status === "recommended" && item.experiencedReviewer !== null));
  const reviewCounts = [reviewer1, reviewer2].map((reviewer) =>
    existing.filter((item) => item.experiencedReviewer?.id === reviewer.id).length).sort();
  assert.deepEqual(reviewCounts, [3, 3]);
});

test("H: 경력 검토자 역할은 responsible의 유선 3건 count를 소비하지 않는다", async () => {
  const date = recommendationDates("2026-07-14")[0].date;
  const reviewer = experienced(10);
  const reviewAssignments: ExistingAssignment[] = [1, 2, 3].map((id) => ({
    targetId: 100 + id, businessCode: `R${id}`, kind: "existing", date,
    participants: [20 + id, reviewer.id], responsibleUserId: 20 + id, experiencedReviewerId: reviewer.id,
    surveyMethod: "phone", coordinate: null, region: null,
  }));
  const [result] = await recommendBatch({
    targets: [target(1, "existing", reviewer)], surveyors: [reviewer], experiencedUsers: [reviewer],
    existingAssignments: reviewAssignments, availability: available(), routes: route(),
  });
  assert.equal(result.status, "recommended");
  assert.equal(result.date, recommendationDates("2026-07-14")[1].date);
  assert.equal(result.responsible.id, reviewer.id);
});

test("기존 사업장 경력 검토는 같은 날 신규 현장과 공존할 수 있다", async () => {
  const dates = recommendationDates("2026-07-14");
  const [result] = await recommendBatch({
    targets: [target(1, "existing", novice(1))], experiencedUsers: [experienced(10)],
    existingAssignments: [existingAssignment(100, "N100", 10, dates[0].date)], availability: available(), routes: route(),
  });
  assert.equal(result.status, "recommended");
  assert.equal(result.date, dates[0].date);
  assert.equal(result.experiencedReviewer?.id, 10);
});

test("기존 사업장 검토 역할은 cross-type 수행 용량 충돌로 보지 않는다", async () => {
  const dates = recommendationDates("2026-07-14");
  const [result] = await recommendBatch({
    targets: [target(1, "existing", novice(1))], experiencedUsers: [experienced(10)],
    existingAssignments: dates.map((item, index) => existingAssignment(100 + index, `N${index}`, 10, item.date)),
    availability: available(), routes: route(),
  });
  assert.equal(result.status, "recommended");
  assert.equal(result.date, dates[0].date);
  assert.equal(result.experiencedReviewer?.id, 10);
  assert.equal(result.evidence.crossTypeOverlap, false);
});

test("측정일 순서상 기존 사업장이 먼저 확정돼도 신규 현장을 보존한다 (비경력자 단독 금지)", async () => {
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
  assert.equal(newResult.status, "recommended");
  assert.equal(newResult.date, sharedDate);
  assert.equal(existingResult.status, "recommended");
  assert.equal(existingResult.date, sharedDate);
  assert.equal(existingResult.participants.length, 2);
  assert.equal(existingResult.experiencedReviewer?.id, reviewer.id);
});

test("기존업체 선택 방문은 allocator가 확정한 역할을 바꾸지 않고 동일주소 묶음을 선택한다", async () => {
  const sameAddress = target(2, "new", experienced(2));
  sameAddress.address = "충남 천안시 동일주소";
  const existing = target(3, "existing", sameAddress.responsible);
  existing.address = " 충남  천안시 동일주소 ";

  const results = await recommendBatch({
    targets: [sameAddress, existing],
    experiencedUsers: [sameAddress.responsible],
    availability: available(),
    routes: route(10),
  });
  const existingResult = results.find((result) => result.targetId === existing.id)!;
  assert.equal(existingResult.surveyMethod, "field");
  assert.deepEqual(existingResult.participants.map((participant) => participant.id), [sameAddress.responsible.id]);
  assert.equal(existingResult.responsible.id, sameAddress.responsible.id);
  assert.match(existingResult.reason, /동일주소 묶음/);
});

test("기존 사업장 경력 검토자에는 임의의 하루 3건 hard cap을 적용하지 않는다", async () => {
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
  assert.equal(result.status, "recommended");
  assert.equal(result.date, dates[1].date);
  assert.equal(result.experiencedReviewer?.id, 10);
  assert.deepEqual(result.participants.map((item) => item.id), [1, 10]);
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

test("수동 신규도 기존 선택방문을 포함해 참여자별 방문 용량을 검증한다", async () => {
  const responsible = experienced(1);
  const current = target(3, "new", responsible);
  const date = recommendationDates(current.measurementDate)[0].date;
  const existingFieldVisits: ExistingAssignment[] = [1, 2].map((targetId) => ({
    targetId, businessCode: `E${targetId}`, kind: "existing", date, participants: [responsible.id],
    responsibleUserId: responsible.id, experiencedReviewerId: null, surveyMethod: "field",
    coordinate: null, region: null,
  }));
  const result = await validateManualPlanHardRules({
    target: current, recommendedDate: date, participants: [responsible],
    existingAssignments: existingFieldVisits, routes: route(30),
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /하루 방문 배정/);
});

test("수동 기존 담당자의 같은 날 네 번째 유선 계획은 거부한다", async () => {
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
  assert.match(result.errors.join(" "), /같은 날 최대 3건/);
});

test("수동 기존업체 유선도 비경력자 단독은 hard constraint로 거부한다", async () => {
  const responsible = novice(1);
  const current = target(4, "existing", responsible);
  const date = recommendationDates(current.measurementDate)[0].date;
  const result = await validateManualPlanHardRules({
    target: current, recommendedDate: date, participants: [responsible], surveyMethod: "phone",
    existingAssignments: [], routes: route(),
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /경력자가 최소 1명/);
});

test("기존업체 비경력 책임자의 수동 저장은 경력자가 blocked여도 warning으로 살리지 않는다", async () => {
  const responsible = novice(1);
  const reviewer = experienced(2);
  const current = target(4, "existing", responsible);
  const date = recommendationDates(current.measurementDate)[0].date;
  const missingReviewer = await validateManualPlanHardRules({
    target: current, recommendedDate: date, participants: [responsible], surveyMethod: "phone",
    existingAssignments: [], routes: route(), experiencedUsers: [reviewer], availability: available(),
  });
  assert.equal(missingReviewer.valid, false);
  assert.match(missingReviewer.errors.join(" "), /경력자가 최소 1명/);
  const allBlocked = await validateManualPlanHardRules({
    target: current, recommendedDate: date, participants: [responsible], surveyMethod: "phone",
    existingAssignments: [], routes: route(), experiencedUsers: [reviewer],
    availability: available(new Set([`${reviewer.id}:${date}`])),
  });
  assert.equal(allBlocked.valid, false);
  assert.match(allBlocked.errors.join(" "), /경력자가 최소 1명/);
  assert.equal(allBlocked.warnings.length, 0);
});

test("수동 기존업체 방문은 같은 날 참여자가 겹치는 필수 신규의 동일주소 또는 허용 route가 필요하다", async () => {
  const responsible = experienced(1);
  const current = { ...target(4, "existing", responsible), address: "충남 천안시 동일로 1" };
  const date = recommendationDates(current.measurementDate)[0].date;
  const mandatory: ExistingAssignment = {
    ...existingAssignment(1, "C1", responsible.id, date),
    address: "충남  천안시 동일로 1",
    surveyMethod: "field",
  };
  const allowed = await validateManualPlanHardRules({
    target: current, recommendedDate: date, participants: [responsible], surveyMethod: "field",
    existingAssignments: [mandatory], routes: route(null, "distance"),
  });
  const denied = await validateManualPlanHardRules({
    target: current, recommendedDate: date, participants: [responsible], surveyMethod: "field",
    existingAssignments: [], routes: route(),
  });
  assert.equal(allowed.valid, true);
  assert.equal(denied.valid, false);
  assert.match(denied.errors.join(" "), /필수 신규 방문/);
});

test("단일 planner는 blocked 책임 조사자를 제외한다", async () => {
  const blockedLead = experienced(1);
  const availableLead = experienced(2);
  const [result] = await recommendBatch({
    targets: [target(1, "new", blockedLead)],
    surveyors: [blockedLead, availableLead],
    experiencedUsers: [blockedLead, availableLead],
    availability: available(new Set([`1:${recommendationDates("2026-07-14")[0].date}`])),
    routes: route(),
  });
  assert.equal(result.status, "recommended");
  assert.equal(result.responsible.id, availableLead.id);
  assert.deepEqual(result.participants.map((user) => user.id), [availableLead.id]);
});

test("단일 planner는 경력자를 붙일 수 없는 기존업체 비경력 후보를 추천하지 않는다", async () => {
  const first = novice(1);
  const second = novice(2);
  const results = await recommendBatch({
    targets: [target(1, "existing", first), target(2, "existing", first)],
    surveyors: [first, second], experiencedUsers: [], availability: available(), routes: route(),
  });
  assert.deepEqual(results.map((result) => result.status), ["manual_required", "manual_required"]);
});

test("측정 참여자·보고서 담당자는 예비조사자 선택 preference가 아니다", async () => {
  const first = experienced(1);
  const participant = experienced(2);
  const current = {
    ...target(1, "new", first),
    measurementStaffByDate: [{
      date: "2026-07-14", reportWriterUserId: first.id,
      measurementParticipantUserIds: [participant.id],
    }],
  };
  const [result] = await recommendBatch({
    targets: [current], surveyors: [first, participant], experiencedUsers: [first, participant],
    availability: available(), routes: route(),
  });
  assert.equal(result.responsible.id, first.id);
});

test("B: 측정 역할 값과 무관하게 hard constraint를 통과한 안정적 ID를 선택한다", async () => {
  const first = experienced(1);
  const reportWriter = experienced(3);
  const other = experienced(2);
  const date = recommendationDates("2026-07-14")[0].date;
  const current = {
    ...target(1, "new", first),
    measurementStaffByDate: [{
      date: "2026-07-14", reportWriterUserId: reportWriter.id,
      measurementParticipantUserIds: [first.id],
    }],
  };
  const [result] = await recommendBatch({
    targets: [current], surveyors: [first, reportWriter, other], experiencedUsers: [first, reportWriter, other],
    availability: available(new Set([`${first.id}:${date}`])), routes: route(),
  });
  assert.equal(result.responsible.id, other.id);
});

test("C: 측정 참여자와 보고서 담당자가 unavailable이면 다른 available 조사자를 balance로 선택한다", async () => {
  const participant = experienced(1);
  const reportWriter = experienced(2);
  const other = experienced(3);
  const date = recommendationDates("2026-07-14")[0].date;
  const current = {
    ...target(1, "new", participant),
    measurementStaffByDate: [{
      date: "2026-07-14", reportWriterUserId: reportWriter.id,
      measurementParticipantUserIds: [participant.id],
    }],
  };
  const [result] = await recommendBatch({
    targets: [current], surveyors: [participant, reportWriter, other],
    experiencedUsers: [participant, reportWriter, other],
    availability: available(new Set([`${participant.id}:${date}`, `${reportWriter.id}:${date}`])), routes: route(),
  });
  assert.equal(result.date, date);
  assert.equal(result.responsible.id, other.id);
});

test("비경력 책임자 조합은 경력자를 포함해 hard rule을 통과한다", async () => {
  const lee = novice(1, "이태환");
  const kim = experienced(2, "김민영");
  const current = {
    ...target(1, "new", kim), name: "대원자동차공업사", businessType: "first_measurement" as const,
    measurementStaffByDate: [{
      date: "2026-07-14", reportWriterUserId: kim.id, measurementParticipantUserIds: [lee.id],
    }],
  };
  const [result] = await recommendBatch({
    targets: [current], surveyors: [kim, lee], experiencedUsers: [kim], availability: available(), routes: route(),
  });
  assert.equal(result.responsible.id, lee.id);
  assert.equal(result.experiencedReviewer?.id, kim.id);
  assert.deepEqual(result.participants.map((user) => user.id), [lee.id, kim.id]);
});

test("동일주소 방문은 측정 참여자 값을 예비조사자 preference에 사용하지 않는다", async () => {
  const common = experienced(10, "한기문");
  const leftOther = experienced(1);
  const rightOther = experienced(2);
  const address = "충남 천안시 동일주소 100";
  const targets = [
    {
      ...target(1, "new", leftOther), name: "더가든오브네추럴솔루션", address,
      measurementStaffByDate: [{
        date: "2026-07-14", reportWriterUserId: leftOther.id,
        measurementParticipantUserIds: [common.id],
      }],
    },
    {
      ...target(2, "new", rightOther), name: "네이처앤바이오텍", address,
      measurementStaffByDate: [{
        date: "2026-07-14", reportWriterUserId: rightOther.id,
        measurementParticipantUserIds: [common.id],
      }],
    },
  ];
  const results = await recommendBatch({
    targets, surveyors: [leftOther, rightOther, common], experiencedUsers: [leftOther, rightOther, common],
    availability: available(), routes: route(),
  });
  assert.deepEqual(results.map((result) => result.responsible.id), [leftOther.id, rightOther.id]);
  assert.equal(results[0].date, results[1].date);
  assert.equal(results[1].evidence.capacityPass, 1);
});

test("동일주소 방문은 blocked 여부만 hard constraint로 적용한다", async () => {
  const common = experienced(10, "한기문");
  const other = experienced(1);
  const date = recommendationDates("2026-07-14")[0].date;
  const sameAddressTargets = [1, 2].map((id) => ({
    ...target(id, "new", other), address: "충남 천안시 동일주소 101",
    measurementStaffByDate: [{
      date: "2026-07-14", reportWriterUserId: other.id, measurementParticipantUserIds: [common.id],
    }],
  }));
  const results = await recommendBatch({
    targets: sameAddressTargets, surveyors: [other, common], experiencedUsers: [other, common],
    availability: available(new Set([`${common.id}:${date}`])), routes: route(),
  });
  assert.deepEqual(results.map((result) => result.responsible.id), [other.id, other.id]);
  assert.deepEqual(results.map((result) => result.date), [date, date]);
});

test("다일 target의 측정 참여자는 예비조사자 선택 preference에 사용하지 않는다", async () => {
  const firstDay = experienced(2);
  const otherDay = experienced(1);
  const current = {
    ...target(1, "new", otherDay),
    measurementStaffByDate: [
      { date: "2026-07-14", reportWriterUserId: null, measurementParticipantUserIds: [firstDay.id] },
      { date: "2026-07-15", reportWriterUserId: null, measurementParticipantUserIds: [otherDay.id] },
    ],
  };
  const [result] = await recommendBatch({
    targets: [current], surveyors: [otherDay, firstDay], experiencedUsers: [otherDay, firstDay],
    availability: available(), routes: route(),
  });
  assert.equal(result.responsible.id, otherDay.id);
});

test("기존업체 유선은 reviewer 일정·실측과 무관하게 경력 조합을 유지한다", async () => {
  const responsible = novice(1);
  const reviewer = experienced(10);
  const [result] = await recommendBatch({
    targets: [target(1, "existing", responsible)], experiencedUsers: [reviewer],
    availability: {
      isBlocked: (userId) => userId === reviewer.id,
      isScheduleBlocked: (userId) => userId === reviewer.id,
      isActualMeasurementBlocked: (userId) => userId === reviewer.id,
      blockedReason: () => ["USER_SCHEDULE_BLOCK", "ACTUAL_MEASUREMENT_CONFLICT"],
    }, routes: route(),
  });
  assert.equal(result.status, "recommended");
  assert.notEqual(result.date, null);
  assert.deepEqual(result.participants.map((user) => user.id), [responsible.id, reviewer.id]);
  assert.equal(result.evidence.warnings.includes("EXPERIENCED_REVIEWER_ALL_HARD_BLOCKED"), false);
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

test("잘못된 authoritative business_type은 legacy 값으로 덮지 않고 unresolved 처리한다", () => {
  const result = classifyMeasurementJournalBusiness({
    ...classificationTarget,
    business_type: "unknown_type",
    preliminary_survey_rule_type: "general_new",
  }, [journal("타기관 신규")]);
  assert.equal(result.source, "target_business_type");
  assert.equal(result.resolved, false);
  assert.equal(result.rawValue, "unknown_type");
});

test("business_type null의 legacy fallback은 정확한 세부 businessType을 보존한다", () => {
  const journalFallback = classifyMeasurementJournalBusiness({
    ...classificationTarget, business_type: null,
  }, [journal("타기관 신규")]);
  const ruleFallback = classifyMeasurementJournalBusiness({
    ...classificationTarget, business_type: null, preliminary_survey_rule_type: "other_org_new",
  }, []);
  assert.equal(journalFallback.businessType, "external_new");
  assert.equal(ruleFallback.businessType, "external_new");
});

test("today=2026-08-26, measurement=2026-08-27이면 과거 기준일을 recommended로 생성한다", async () => {
  const user = experienced(1);
  const [result] = await recommendBatch({
    targets: [{ ...target(1, "new", user, "2026-08-27"), businessType: "first_measurement" }],
    experiencedUsers: [user], availability: available(), routes: route(),
  });
  assert.equal(result.status, "recommended");
  assert.ok(result.date! < "2026-08-26");
  assert.ok(result.date! < "2026-08-27");
  assert.equal(result.surveyMethod, "field");
});

test("I: 8/27 혼합 8건은 방문 균등과 기존업체 보고서 담당자 preference를 함께 지킨다", async () => {
  const users = [1, 2, 3, 4, 5, 6].map((id) => experienced(id));
  const targets: SurveyTarget[] = [
    { ...target(1, "new", users[0], "2026-08-27"), businessType: "first_measurement" },
    { ...target(2, "new", users[0], "2026-08-27"), businessType: "first_measurement" },
    { ...target(3, "new", users[0], "2026-08-27"), businessType: "external_new" },
    { ...target(4, "new", users[0], "2026-08-27"), businessType: "external_new" },
    ...[5, 6, 7, 8].map((id) => ({ ...target(id, "existing", users[0], "2026-08-27"), businessType: "existing" as const })),
  ];
  targets.forEach((current, index) => {
    current.measurementStaffByDate = [{
      date: "2026-08-27", reportWriterUserId: users[(index + 1) % users.length].id,
      measurementParticipantUserIds: [users[index % users.length].id],
    }];
  });
  const results = await recommendBatch({
    targets, surveyors: users, experiencedUsers: users, availability: available(), routes: route(120),
  });
  assert.equal(results.length, 8);
  assert.ok(results.every((result) => result.status === "recommended" && result.date! < "2026-08-27"));
  assert.ok(results.filter((result) => result.targetId <= 4).every((result) => result.surveyMethod === "field"));
  assert.ok(results.filter((result) => result.targetId >= 5).every((result) => result.surveyMethod === "phone"));
  const existingResults = results.filter((result) => result.targetId >= 5);
  assert.equal(new Set(existingResults.map((result) => result.date)).size, existingResults.length);
  assert.deepEqual(results.filter((result) => result.targetId <= 4).map((result) => result.responsible.id), [1, 2, 3, 4]);
  assert.deepEqual(existingResults.map((result) => result.responsible.id), [6, 1, 2, 3]);
  assert.ok(Math.max(...users.map((user) => results.filter((result) => result.responsible.id === user.id).length)) <= 2);
});

test("기존업체 유선 책임자 3건 한도는 다음 정책 날짜로 이동시킨다", async () => {
  const user = experienced(1);
  const date = recommendationDatesForBusinessType("2026-08-27", "existing")[0].date;
  const assignments = Array.from({ length: 3 }, (_, index): ExistingAssignment => ({
    targetId: 100 + index, businessCode: `E${index}`, kind: "existing", date,
    participants: [user.id], responsibleUserId: user.id, experiencedReviewerId: null,
    surveyMethod: "phone", coordinate: null, region: null,
  }));
  const [result] = await recommendBatch({
    targets: [{ ...target(1, "existing", user, "2026-08-27"), businessType: "existing" }],
    experiencedUsers: [user], existingAssignments: assignments, availability: available(), routes: route(),
  });
  assert.equal(result.status, "recommended");
  assert.equal(result.date, recommendationDatesForBusinessType("2026-08-27", "existing")[1].date);
});

test("manual validator는 비활성 사용자와 근거 없는 기존업체 field를 거부한다", async () => {
  const inactive = { ...experienced(1), active: false };
  const existingTarget = { ...target(1, "existing", inactive, "2026-08-27"), businessType: "existing" as const };
  const result = await validateManualPlanHardRules({
    target: existingTarget,
    recommendedDate: recommendationDatesForBusinessType("2026-08-27", "existing")[0].date,
    participants: [inactive], surveyMethod: "field", existingAssignments: [], routes: route(),
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /비활성/);
  assert.match(result.errors.join(" "), /필수 신규 방문/);
});

test("Apply 재검증에서 기존업체 선택 방문은 유선 책임자 3건 한도를 소비하지 않는다", async () => {
  const responsible = experienced(1);
  const current = { ...target(10, "existing", responsible, "2026-08-27"), businessType: "existing" as const };
  const date = recommendationDatesForBusinessType(current.measurementDate, "existing")[0].date;
  const assignments: ExistingAssignment[] = [
    ...[1, 2].map((id) => ({
      targetId: id, businessCode: `P${id}`, kind: "existing" as const, date,
      participants: [responsible.id], responsibleUserId: responsible.id, experiencedReviewerId: null,
      surveyMethod: "phone" as const, coordinate: null, region: null,
    })),
    {
      targetId: 3, businessCode: "F3", kind: "existing", date,
      participants: [responsible.id], responsibleUserId: responsible.id, experiencedReviewerId: null,
      surveyMethod: "field", address: current.address, coordinate: null, region: null,
    },
  ];
  const result = await validateManualPlanHardRules({
    target: current, recommendedDate: date, participants: [responsible], surveyMethod: "phone",
    existingAssignments: assignments, routes: route(),
  });
  assert.equal(result.valid, true);
});

test("Apply 재검증은 동일주소 신규 field와 기존업체 선택 방문을 route 미검증이어도 허용한다", async () => {
  const responsible = experienced(1);
  const current = { ...target(10, "existing", responsible, "2026-08-27"), businessType: "existing" as const };
  current.address = " 충남  천안시 동일주소 ";
  const date = recommendationDatesForBusinessType(current.measurementDate, "existing")[0].date;
  const mandatoryNew: ExistingAssignment = {
    targetId: 1, businessCode: "N1", kind: "new", date,
    participants: [responsible.id], responsibleUserId: responsible.id, experiencedReviewerId: null,
    surveyMethod: "field", address: "충남 천안시 동일주소", coordinate: null, region: null,
  };
  const result = await validateManualPlanHardRules({
    target: current, recommendedDate: date, participants: [responsible], surveyMethod: "field",
    existingAssignments: [mandatoryNew], routes: route(null, "unknown"),
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.routeEvidence, []);
});

test("recommend/apply/manual은 기존 route·방문 capacity와 유선 3건 한도를 함께 적용한다", () => {
  const service = readFileSync("lib/preliminary-survey-v2/service.ts", "utf8");
  const workbench = readFileSync("app/api/preliminary-survey-v2/workbench/route.ts", "utf8");
  const manual = readFileSync("app/api/preliminary-survey-v2/[targetId]/route.ts", "utf8");
  const validator = readFileSync("lib/preliminary-survey-v2/manual-validation.ts", "utf8");
  assert.match(service, /validateManualPlanHardRules/);
  assert.match(workbench, /validateManualPlanHardRules/);
  assert.match(manual, /validateManualPlanHardRules/);
  assert.match(service, /user_schedule_blocks/);
  assert.match(workbench, /isScheduleBlocked/);
  assert.match(workbench, /isActualMeasurementBlocked/);
  assert.match(manual, /isScheduleBlocked/);
  assert.match(validator, /evaluateSameDayRoute/);
  assert.match(validator, /하루 방문 배정|허용 동선/);
  assert.match(validator, /fitsExistingPhoneResponsibleLimit/);
});

test("today cutoff는 추천 후보에서 제거하고 조회용 KST helper만 유지한다", () => {
  const engine = readFileSync("lib/preliminary-survey-v2/engine.ts", "utf8");
  const service = readFileSync("lib/preliminary-survey-v2/service.ts", "utf8");
  const calendar = readFileSync("lib/preliminary-survey-v2/calendar.ts", "utf8");
  const range = readFileSync("lib/preliminary-survey-v2/recommendation-range.ts", "utf8");
  assert.doesNotMatch(engine, /planningDate|minimumDate|currentDateInKst/);
  assert.doesNotMatch(service, /planningDate|minimumDate|currentDateInKst/);
  assert.doesNotMatch(calendar, /minimumDate/);
  assert.match(range, /export function currentDateInKst/);
});

test("측정자·공시료 assignment의 user_schedule_blocks hard constraint는 별도 정책으로 유지한다", () => {
  const assignment = readFileSync("lib/preliminary-survey-v2/measurement-assignment.ts", "utf8");
  const workbench = readFileSync("app/api/preliminary-survey-v2/workbench/route.ts", "utf8");
  assert.match(assignment, /직원 제외 일정은 측정자·공시료 배정에서도 예외 없는 hard constraint/);
  assert.match(assignment, /input\.availability\?\.isBlocked/);
  assert.match(workbench, /user_schedule_blocks/);
  assert.match(workbench, /assigneeBlockKeys/);
});

test("Q-V: 단일 추천 저장/UI/수동수정/Google 신호 배제/score 제거 구조", () => {
  const ui = readFileSync("components/features/MeasurementTargetBusinessManagement.tsx", "utf8");
  const recommendRoute = readFileSync("app/api/preliminary-survey-v2/recommend/route.ts", "utf8");
  const manualRoute = readFileSync("app/api/preliminary-survey-v2/[targetId]/route.ts", "utf8");
  const engine = readFileSync("lib/preliminary-survey-v2/engine.ts", "utf8");
  const service = readFileSync("lib/preliminary-survey-v2/service.ts", "utf8");
  const migration = readFileSync("supabase/migrations/20260808_add_preliminary_survey_v2.sql", "utf8");
  assert.match(recommendRoute, /V2_LEGACY_PERSIST_DISABLED_USE_WORKBENCH/);
  // Phase A: 수정 모달의 구형 V2 편집 UI(예비조사자 선택)는 제거됐다. V2 편집은 예비조사 전용 API로만 수행.
  assert.doesNotMatch(ui, /예비조사자\(복수선택 가능\)/);
  assert.doesNotMatch(ui, /예비조사 자동추천 V2/);
  assert.doesNotMatch(ui, /선택한 추천안 적용|추천일 숨김/);
  assert.match(manualRoute, /plan_origin[\s\S]*manual/);
  assert.doesNotMatch(engine, /Google|occupied|preferredDate|preferred_date/);
  assert.match(service, /business_type/);
  assert.match(service, /preliminary_survey_rule_type/);
  assert.doesNotMatch(manualRoute, /preliminary_survey_rule_type/);
  assert.match(manualRoute, /loadV2ManualContext/);
  assert.match(migration, /survey_method text NOT NULL/);
  assert.match(migration, /measurement_journal[\s\S]*V2_CLASSIFICATION_SOURCE_MISMATCH/);
  assert.doesNotMatch(migration, /recommendation_score\s+(integer|bigint)/i);
});
