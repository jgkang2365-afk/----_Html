import assert from "node:assert/strict";
import test from "node:test";
import { recommendPreliminarySurvey } from "../lib/preliminary-survey/engine";
import {
  isNewPreliminarySurveyRule,
  requiresFieldPreliminarySurvey,
  type RecommendationUser,
  type WorkloadSummary,
} from "../lib/preliminary-survey/types";
import { parsePreliminarySurveyCalendarSignals } from "../lib/preliminary-survey/google-calendar-signals";

const experienced: RecommendationUser = {
  id: 10,
  name: "경력 담당자",
  job: "측정",
  is_active: true,
  is_preliminary_survey_experienced: true,
  is_preliminary_survey_support_assignable: true,
};
const novice: RecommendationUser = {
  id: 20,
  name: "미경력 담당자",
  job: "측정",
  is_active: true,
  is_preliminary_survey_experienced: false,
  is_preliminary_survey_support_assignable: false,
};
const support: RecommendationUser = {
  ...experienced,
  id: 30,
  name: "동행 경력자",
};
const emptyWorkload = (): WorkloadSummary => ({
  halfYear: 0,
  recent30Days: 0,
  byDate: {},
});

test("경력 담당자는 측정일 5워킹데이 전 단독 현장방문으로 추천한다", () => {
  const result = recommendPreliminarySurvey({
    measurementDate: "2026-08-31",
    targetRegion: "서울특별시 강남구",
    responsible: experienced,
    supportCandidates: [support],
    blocks: [],
    schedules: [],
    workloads: new Map(),
  });

  assert.equal(result.status, "recommended");
  assert.equal(result.visitMode, "experienced_solo_visit");
  assert.equal(result.experiencedUserId, null);
  assert.equal(result.reasonDetails.selectedWorkingDaysBefore, 5);
});

test("미경력 담당자는 가용 경력자와 공동 현장방문으로 추천한다", () => {
  const result = recommendPreliminarySurvey({
    measurementDate: "2026-08-31",
    targetRegion: "서울특별시 강남구",
    responsible: novice,
    supportCandidates: [support],
    blocks: [],
    schedules: [],
    workloads: new Map([[support.id, emptyWorkload()]]),
  });

  assert.equal(result.status, "recommended");
  assert.equal(result.visitMode, "joint_field_visit");
  assert.equal(result.experiencedUserId, support.id);
});

test("제외 일정과 다른 지역 측정 일정은 후보에서 제외한다", () => {
  const base = recommendPreliminarySurvey({
    measurementDate: "2026-08-31",
    targetRegion: "서울특별시 강남구",
    responsible: novice,
    supportCandidates: [support],
    blocks: [],
    schedules: [],
    workloads: new Map([[support.id, emptyWorkload()]]),
  });
  assert.ok(base.recommendedDate);

  const result = recommendPreliminarySurvey({
    measurementDate: "2026-08-31",
    targetRegion: "서울특별시 강남구",
    responsible: novice,
    supportCandidates: [support],
    blocks: [
      {
        user_id: novice.id,
        start_date: base.recommendedDate,
        end_date: base.recommendedDate,
      },
    ],
    schedules: [
      {
        userId: support.id,
        date: base.recommendedDate,
        kind: "different_region",
      },
    ],
    workloads: new Map([[support.id, emptyWorkload()]]),
  });

  assert.equal(result.status, "recommended");
  assert.notEqual(result.recommendedDate, base.recommendedDate);
});

test("같은 지역 측정 일정은 허용하되 확인 경고를 남긴다", () => {
  const idealDate = recommendPreliminarySurvey({
    measurementDate: "2026-08-31",
    targetRegion: "서울특별시 강남구",
    responsible: experienced,
    supportCandidates: [],
    blocks: [],
    schedules: [],
    workloads: new Map(),
  }).recommendedDate!;
  const result = recommendPreliminarySurvey({
    measurementDate: "2026-08-31",
    targetRegion: "서울특별시 강남구",
    responsible: experienced,
    supportCandidates: [],
    blocks: [],
    schedules: [
      { userId: experienced.id, date: idealDate, kind: "same_region" },
    ],
    workloads: new Map(),
  });

  assert.equal(result.recommendedDate, idealDate);
  assert.ok(result.warnings.includes("SAME_REGION_SCHEDULE_TIME_CHECK_REQUIRED"));
});

test("기존업체는 경력 여부와 무관하게 담당자를 방문 가정으로 추천한다", () => {
  const result = recommendPreliminarySurvey({
    ruleType: "existing",
    measurementDate: "2026-08-31",
    targetRegion: "서울특별시 강남구",
    responsible: novice,
    supportCandidates: [support],
    blocks: [],
    schedules: [],
    workloads: new Map(),
  });

  assert.equal(result.status, "recommended");
  assert.equal(result.visitMode, "existing_field_visit");
  assert.equal(result.experiencedUserId, null);
  assert.equal(result.reasonDetails.selectedWorkingDaysBefore, 5);
  assert.equal(result.reasonDetails.phoneSurveyAllowed, true);
});

test("기존업체는 5워킹데이보다 일정이 없는 날짜를 우선한다", () => {
  const base = recommendPreliminarySurvey({
    ruleType: "existing",
    measurementDate: "2026-08-31",
    targetRegion: "서울특별시 강남구",
    responsible: novice,
    supportCandidates: [],
    blocks: [],
    schedules: [],
    workloads: new Map(),
  });
  assert.ok(base.recommendedDate);

  const result = recommendPreliminarySurvey({
    ruleType: "existing",
    measurementDate: "2026-08-31",
    targetRegion: "서울특별시 강남구",
    responsible: novice,
    supportCandidates: [],
    blocks: [],
    schedules: [
      { userId: novice.id, date: base.recommendedDate, kind: "same_region" },
    ],
    workloads: new Map(),
  });

  assert.notEqual(result.recommendedDate, base.recommendedDate);
  assert.equal(result.warnings.includes("SAME_REGION_SCHEDULE_TIME_CHECK_REQUIRED"), false);
});

test("명시적인 같은 사업장 캘린더 예비조사는 조건 충돌이 없으면 우선한다", () => {
  const base = recommendPreliminarySurvey({
    ruleType: "existing",
    measurementDate: "2026-08-31",
    targetRegion: "서울특별시 강남구",
    responsible: experienced,
    supportCandidates: [],
    blocks: [],
    schedules: [],
    workloads: new Map(),
  });
  const preferredDate = base.alternatives[0].date;
  const result = recommendPreliminarySurvey({
    ruleType: "existing",
    measurementDate: "2026-08-31",
    targetRegion: "서울특별시 강남구",
    responsible: experienced,
    supportCandidates: [],
    blocks: [],
    schedules: [],
    workloads: new Map(),
    calendarSignals: [{
      userId: experienced.id,
      date: preferredDate,
      kind: "preferred",
      eventId: "calendar-event",
      eventUpdatedAt: "2026-07-31T00:00:00Z",
    }],
  });

  assert.equal(result.recommendedDate, preferredDate);
  assert.equal(result.reasonDetails.calendarPreferenceApplied, true);
});

test("캘린더 휴가는 무시하고 이름이 명시된 예비조사만 해석한다", () => {
  const signals = parsePreliminarySurveyCalendarSignals(
    [
      { summary: "[한기문 휴가]", start: { date: "2026-08-10" } },
      { summary: "[경력 담당자] 휴가(예비조사)", start: { date: "2026-08-10" } },
      { summary: "[이주형] 아람(예비조사)-13시", start: { date: "2026-07-09" }, id: "preferred" },
      { summary: "[경력 담당자] 다른업체(예비조사)", start: { date: "2026-08-12" }, id: "occupied" },
    ],
    [
      { id: experienced.id, name: experienced.name },
      { id: 13, name: "이주형" },
    ],
    "주식회사 아람",
  );

  assert.deepEqual(signals.map((signal) => [signal.date, signal.kind]), [
    ["2026-07-09", "preferred"],
    ["2026-08-12", "occupied"],
  ]);
});

test("H0498 주식회사 아람은 캘린더의 짧은 사업장명을 7월 9일 추천에 반영한다", () => {
  const aramUser = { ...experienced, id: 13, name: "이주형" };
  const signals = parsePreliminarySurveyCalendarSignals(
    [{
      summary: "[이주형] 아람(예비조사)-13시",
      start: { date: "2026-07-09" },
      id: "aram-calendar-event",
    }],
    [{ id: aramUser.id, name: aramUser.name }],
    "주식회사 아람",
  );
  const result = recommendPreliminarySurvey({
    ruleType: "existing",
    measurementDate: "2026-07-13",
    targetRegion: "경기도 광주시",
    responsible: aramUser,
    supportCandidates: [],
    blocks: [],
    schedules: [],
    workloads: new Map(),
    calendarSignals: signals,
  });

  assert.equal(result.recommendedDate, "2026-07-09");
  assert.equal(result.reasonDetails.calendarPreferenceApplied, true);
});

test("가용성과 동선이 같으면 지원 건수가 적은 경력자를 결정적으로 선택한다", () => {
  const busy = { ...support, id: 25, name: "지원 많은 경력자" };
  const available = { ...support, id: 40, name: "지원 적은 경력자" };
  const input = {
    measurementDate: "2026-08-31",
    targetRegion: "서울특별시 강남구",
    responsible: novice,
    supportCandidates: [available, busy],
    blocks: [],
    schedules: [],
    workloads: new Map([
      [busy.id, { halfYear: 5, recent30Days: 2, byDate: {} }],
      [available.id, emptyWorkload()],
    ]),
  };

  assert.equal(recommendPreliminarySurvey(input).experiencedUserId, available.id);
  assert.equal(recommendPreliminarySurvey(input).experiencedUserId, available.id);
});

test("세 신규 유형만 동일하게 현장 예비조사 대상으로 판정한다", () => {
  for (const rule of ["general_new", "other_org_new", "unconfirmed_new"] as const) {
    assert.equal(isNewPreliminarySurveyRule(rule), true);
    assert.equal(requiresFieldPreliminarySurvey(rule), true);
  }
  assert.equal(isNewPreliminarySurveyRule("existing"), false);
  assert.equal(requiresFieldPreliminarySurvey("existing"), false);
});
