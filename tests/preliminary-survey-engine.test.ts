import assert from "node:assert/strict";
import test from "node:test";
import { recommendPreliminarySurvey } from "../lib/preliminary-survey/engine";
import { futureWorkingDaysBefore } from "../lib/preliminary-survey/calendar";
import type { RecommendationUser } from "../lib/preliminary-survey/types";

const today = "2026-08-03";
const measurementDate = "2026-10-30";
const measurer: RecommendationUser = {
  id: 10,
  name: "측정담당자",
  job: "측정",
  is_active: true,
  is_preliminary_survey_experienced: true,
  is_preliminary_survey_support_assignable: true,
};
const noviceMeasurer = {
  ...measurer,
  is_preliminary_survey_experienced: false,
};
const experiencedSupport: RecommendationUser = {
  id: 20,
  name: "경력 동행자",
  job: "측정",
  is_active: true,
  is_preliminary_survey_experienced: true,
  is_preliminary_survey_support_assignable: true,
};

function recommend(overrides: Record<string, unknown> = {}) {
  return recommendPreliminarySurvey({
    ruleType: "general_new",
    measurementDate,
    targetRegion: "경기 광주",
    responsible: measurer,
    supportCandidates: [experiencedSupport],
    blocks: [],
    schedules: [],
    workloads: new Map(),
    today,
    ...overrides,
  } as any);
}

function slots(result: ReturnType<typeof recommend>) {
  return result.reasonDetails.recommendationSlots as Array<{
    slot: "default" | "earlier" | "later";
    date: string | null;
    workingDaysBefore: number | null;
    emptyReason: string | null;
  }>;
}

test("예비조사 책임자는 항상 측정담당자로 유지된다", () => {
  const result = recommend({
    supportCandidates: [
      experiencedSupport,
      { ...experiencedSupport, id: 30, name: "다른 측정직원" },
    ],
  });

  assert.equal(result.status, "recommended");
  assert.equal(result.responsibleUserId, measurer.id);
  assert.notEqual(result.experiencedUserId, measurer.id);
});

test("측정담당자의 모든 미래 일정이 막히면 다른 책임자로 fallback하지 않는다", () => {
  const result = recommend({
    blocks: [{
      user_id: measurer.id,
      start_date: "2026-08-04",
      end_date: "2026-10-29",
    }],
  });

  assert.equal(result.status, "pending");
  assert.equal(result.reason, "NO_AVAILABLE_DATE");
  assert.equal(result.responsibleUserId, measurer.id);
  assert.equal(result.reasonDetails.manualAdjustmentRequired, true);
});

test("신규 비경력 측정담당자는 경력 동행자를 배정한다", () => {
  const result = recommend({ responsible: noviceMeasurer });

  assert.equal(result.status, "recommended");
  assert.equal(result.responsibleUserId, noviceMeasurer.id);
  assert.equal(result.experiencedUserId, experiencedSupport.id);
  assert.equal(result.visitMode, "joint_field_visit");
});

test("신규 비경력 측정담당자에게 동행 가능한 경력자가 없으면 수동 조정 상태다", () => {
  const result = recommend({ responsible: noviceMeasurer, supportCandidates: [] });

  assert.equal(result.status, "pending");
  assert.equal(result.reason, "NO_AVAILABLE_EXPERIENCED_USER");
  assert.equal(result.responsibleUserId, noviceMeasurer.id);
});

test("기존업체는 비경력 측정담당자도 경력 동행 없이 방문 추천한다", () => {
  const result = recommend({
    ruleType: "existing",
    responsible: noviceMeasurer,
    supportCandidates: [experiencedSupport],
  });

  assert.equal(result.status, "recommended");
  assert.equal(result.responsibleUserId, noviceMeasurer.id);
  assert.equal(result.experiencedUserId, null);
  assert.equal(result.visitMode, "existing_field_visit");
});

test("추천안은 기본·이전·이후 구간에서 각각 한 개씩 계산한다", () => {
  const result = recommend();
  const recommendationSlots = slots(result);
  const defaultSlot = recommendationSlots.find((item) => item.slot === "default")!;
  const earlierSlot = recommendationSlots.find((item) => item.slot === "earlier")!;
  const laterSlot = recommendationSlots.find((item) => item.slot === "later")!;

  assert.ok(defaultSlot.workingDaysBefore! >= 20 && defaultSlot.workingDaysBefore! <= 30);
  assert.ok(earlierSlot.workingDaysBefore! > 30);
  assert.ok(laterSlot.workingDaysBefore! >= 1 && laterSlot.workingDaysBefore! < 20);
});

test("오늘 이전 날짜는 추천안에 포함하지 않는다", () => {
  const result = recommend();
  for (const slot of slots(result)) {
    if (slot.date) assert.ok(slot.date > today);
  }
});

test("같은 지역 일정은 시간 확인 경고와 함께 지역 미확인·일정 없음보다 우선한다", () => {
  const defaultDates = futureWorkingDaysBefore(measurementDate, today)
    .filter((candidate) => candidate.workingDaysBefore >= 20 && candidate.workingDaysBefore <= 30);
  const sameRegionDate = defaultDates[defaultDates.length - 1].date;
  const result = recommend({
    schedules: [
      { userId: measurer.id, date: sameRegionDate, kind: "same_region" },
    ],
  });
  const defaultSlot = slots(result).find((slot) => slot.slot === "default")!;

  assert.equal(defaultSlot.date, sameRegionDate);
  assert.ok(result.warnings.includes("SAME_REGION_SCHEDULE_TIME_CHECK_REQUIRED"));
});

test("다른 지역 일정은 해당 날짜의 추천 조합에서 제외한다", () => {
  const defaultDates = futureWorkingDaysBefore(measurementDate, today)
    .filter((candidate) => candidate.workingDaysBefore >= 20 && candidate.workingDaysBefore <= 30);
  const excludedDate = defaultDates[0].date;
  const result = recommend({
    schedules: [
      { userId: measurer.id, date: excludedDate, kind: "different_region" },
    ],
  });
  const defaultSlot = slots(result).find((slot) => slot.slot === "default")!;

  assert.notEqual(defaultSlot.date, excludedDate);
});

test("Google Calendar preferred/occupied 입력은 추천 결과에 영향을 주지 않는다", () => {
  const baseline = recommend();
  const withLegacySignals = recommend({
    calendarSignals: [
      { userId: measurer.id, date: baseline.recommendedDate, kind: "occupied" },
      { userId: measurer.id, date: "2026-09-01", kind: "preferred" },
    ],
  });

  assert.deepEqual(withLegacySignals, baseline);
});

test("가능한 미래 근무일이 전혀 없으면 과거일 대신 수동 조정 상태를 반환한다", () => {
  const result = recommend({ measurementDate: "2026-08-04" });

  assert.equal(futureWorkingDaysBefore("2026-08-04", today).length, 0);
  assert.equal(result.status, "pending");
  assert.equal(result.reason, "NO_AVAILABLE_DATE");
  assert.equal(result.recommendedDate, null);
  assert.equal(result.reasonDetails.manualAdjustmentRequired, true);
});

test("구간에 가능한 날짜가 없으면 빈 추천안과 사유를 유지한다", () => {
  const result = recommend({ measurementDate: "2026-08-25" });
  const recommendationSlots = slots(result);

  assert.equal(recommendationSlots.length, 3);
  assert.ok(recommendationSlots.some((slot) => slot.date === null && slot.emptyReason));
});
