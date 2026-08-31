import assert from "node:assert/strict";
import test from "node:test";
import { recommendationDatesForBusinessType } from "../lib/preliminary-survey-v2/calendar";
import { recommendBatch } from "../lib/preliminary-survey-v2/engine";
import { validateManualPlanHardRules } from "../lib/preliminary-survey-v2/manual-validation";
import { assignMeasurementAssignees } from "../lib/preliminary-survey-v2/measurement-assignment";
import type { RouteMetrics, SurveyTarget, SurveyUser } from "../lib/preliminary-survey-v2/types";

const senior = (id: number, name = `경력${id}`): SurveyUser => ({ id, name, experienced: true, active: true });
const junior = (id: number, name = `비경력${id}`): SurveyUser => ({ id, name, experienced: false, active: true });
const routes: RouteMetrics = {
  between: async () => ({ source: "unknown", durationMinutes: null, distanceKm: null, sameRegion: true }),
};
const target = (responsible: SurveyUser, businessType: "existing" | "first_measurement" = "existing"): SurveyTarget => ({
  id: 1,
  code: "H0001",
  name: "검증 사업장",
  kind: businessType === "existing" ? "existing" : "new",
  businessType,
  responsible,
  measurementDate: "2026-08-31",
  address: null,
  region: null,
  coordinate: null,
  createdAt: null,
});

test("canonical: 기존업체 유선 비경력 단독은 자동추천과 수동수정 모두 거부한다", async () => {
  const novice = junior(1);
  const [automatic] = await recommendBatch({
    targets: [target(novice)], experiencedUsers: [], availability: { isBlocked: () => false }, routes,
  });
  assert.equal(automatic.status, "manual_required");

  const manual = await validateManualPlanHardRules({
    target: target(novice), recommendedDate: recommendationDatesForBusinessType("2026-08-31", "existing")[0].date,
    participants: [novice], surveyMethod: "phone", existingAssignments: [], routes,
  });
  assert.equal(manual.valid, false);
  assert.match(manual.errors.join(" "), /경력자가 최소 1명/);
});

test("canonical: 기존업체 유선의 경력 단독과 경력+비경력 조합은 허용한다", async () => {
  const experienced = senior(1);
  const novice = junior(2);
  const date = recommendationDatesForBusinessType("2026-08-31", "existing")[0].date;
  for (const participants of [[experienced], [experienced, novice]]) {
    const result = await validateManualPlanHardRules({
      target: target(experienced), recommendedDate: date, participants, surveyMethod: "phone", existingAssignments: [], routes,
    });
    assert.equal(result.valid, true);
  }
});

test("canonical: 비경력자만 가능한 우선일은 탈락하고 다음 유효일을 탐색한다", async () => {
  const novice = junior(1);
  const experienced = senior(2);
  const candidates = recommendationDatesForBusinessType("2026-08-31", "existing");
  const [result] = await recommendBatch({
    targets: [target(novice)], experiencedUsers: [experienced],
    availability: { isBlocked: (userId, date) => userId === experienced.id && date === candidates[0].date },
    routes,
  });
  assert.equal(result.status, "recommended");
  assert.equal(result.date, candidates[1].date);
  assert.deepEqual(result.participants.map((user) => user.id), [novice.id, experienced.id]);
});

test("canonical: 공시료 match가 비경력 단독 hard block을 이기지 못한다", async () => {
  const novice = junior(1);
  const [recommendation] = await recommendBatch({
    targets: [target(novice)], experiencedUsers: [], availability: { isBlocked: () => false }, routes,
  });
  const [assignment] = assignMeasurementAssignees({
    users: [{ id: novice.id, name: novice.name, surveyCode: "A" }],
    targets: [{
      targetId: 1, businessCode: "H0001", measurementDate: "2026-08-31", address: null, coordinate: null,
      preliminarySurveyorUserIds: [novice.id],
    }],
  });
  assert.equal(assignment.userId, novice.id, "공시료 soft match 자체는 계산될 수 있다");
  assert.equal(recommendation.status, "manual_required", "그러나 경력자 없는 예비조사는 추천되지 않는다");
});

test("canonical: 경력자+경력자 수동 선택은 확인 뒤에만 저장할 수 있다", async () => {
  const first = senior(1);
  const second = senior(2);
  const result = await validateManualPlanHardRules({
    target: target(first), recommendedDate: recommendationDatesForBusinessType("2026-08-31", "existing")[0].date,
    participants: [first, second], surveyMethod: "phone", existingAssignments: [], routes,
  });
  assert.equal(result.valid, true);
  assert.equal(result.requiresUserConfirmation, true);
});

test("2026-08-31 canonical fixture는 고정 역할을 바꾸지 않고 공시료 1/1/1/1/1/1을 만든다", () => {
  const fixture = [
    ["H0028", 1, "A"], ["H0033", 2, "C"], ["H0195", 4, "F"],
    ["H0049", 5, "B"], ["H0361", 3, "D"], ["H0130", 6, "G"],
  ] as const;
  const users = [
    { id: 1, name: "이태환", surveyCode: "A" as const }, { id: 2, name: "강종구", surveyCode: "C" as const },
    { id: 3, name: "이주형", surveyCode: "D" as const }, { id: 4, name: "고유빈", surveyCode: "F" as const },
    { id: 5, name: "한기문", surveyCode: "B" as const }, { id: 6, name: "김민영", surveyCode: "G" as const },
  ];
  const result = assignMeasurementAssignees({
    users,
    targets: fixture.map(([code, assigneeUserId], index) => ({
      targetId: index + 1, businessCode: code, measurementDate: "2026-08-31", address: null, coordinate: null,
      preliminarySurveyorUserIds: [assigneeUserId],
    })),
  });
  assert.deepEqual(result.map((item) => [item.userId, item.publicSampleCode]), fixture.map(([, id, code]) => [id, code]));
  assert.deepEqual(result.map((item) => item.dailyCount), [1, 1, 1, 1, 1, 1]);
});

test("2026-08-31 canonical fixture는 Production 8/31 READ-ONLY snapshot에서 역할을 고정하고 날짜만 역산한다", async () => {
  const users = new Map([
    [2, junior(2, "강종구")], [13, senior(13, "이주형")], [15, senior(15, "이태환")],
    [16, junior(16, "고유빈")], [17, senior(17, "한기문")], [20, junior(20, "김민영")],
  ]);
  const blockedByDate = new Map<string, Set<number>>([
    ["2026-07-31", new Set([2, 13, 15, 16, 17, 20])],
    ["2026-08-03", new Set([2, 13, 15, 16, 17, 20])],
    ["2026-08-04", new Set([2, 13, 15, 16, 17, 20])],
    ["2026-08-05", new Set([13, 15, 16, 17, 20])],
    ["2026-08-06", new Set([2, 17, 20])],
    ["2026-08-07", new Set([15, 17, 20])],
    ["2026-08-10", new Set([13, 15, 17, 20])],
    ["2026-08-11", new Set([13, 17, 20])],
    ["2026-08-12", new Set([17, 20])],
    ["2026-08-13", new Set([13, 17, 20])],
    ["2026-08-18", new Set([2, 13, 16, 17, 20])],
    ["2026-08-19", new Set([2, 15, 17, 20])],
    ["2026-08-20", new Set([13, 16, 17, 20])],
    ["2026-08-21", new Set([2, 13, 15, 16, 17, 20])],
    ["2026-08-24", new Set([2, 13, 15, 16, 17])],
    ["2026-08-25", new Set([2, 13, 15, 16, 17, 20])],
    ["2026-08-26", new Set([2, 13, 15, 17, 20])],
    ["2026-07-24", new Set([2, 15, 17, 20])],
    ["2026-07-27", new Set([2, 13, 15, 16, 17, 20])],
    ["2026-07-28", new Set([2, 13, 15, 16, 17, 20])],
    ["2026-07-29", new Set([2, 13, 15, 16, 17, 20])],
    ["2026-07-30", new Set([2, 16])],
  ]);
  const existingPhoneCounts: Array<[string, number, number]> = [
    ["2026-08-06", 15, 3], ["2026-08-06", 16, 3], ["2026-08-07", 16, 1],
    ["2026-08-11", 2, 3], ["2026-08-12", 2, 3], ["2026-08-13", 2, 1],
    ["2026-08-14", 17, 3], ["2026-08-14", 20, 3],
    ["2026-07-24", 13, 2], ["2026-07-24", 16, 3],
    ["2026-07-30", 13, 2], ["2026-07-30", 15, 3], ["2026-07-30", 17, 3], ["2026-07-30", 20, 3],
  ];
  const assignments = existingPhoneCounts.flatMap(([date, responsibleUserId, count], groupIndex) =>
    Array.from({ length: count }, (_, index) => ({
      targetId: -(groupIndex * 10 + index + 1), kind: "existing" as const, date,
      businessCode: `FIXTURE-${groupIndex}-${index}`,
      participants: [responsibleUserId], responsibleUserId, experiencedReviewerId: null,
      surveyMethod: "phone" as const, address: null, coordinate: null, region: null,
    })));
  const fixture = [
    { id: 466, code: "H0028", responsible: 15, participants: [15], expected: "2026-08-11" },
    { id: 438, code: "H0033", responsible: 15, participants: [15, 2], expected: "2026-08-11" },
    { id: 495, code: "H0195", responsible: 13, participants: [13, 16], expected: "2026-08-06" },
    { id: 569, code: "H0049", responsible: 17, participants: [17], expected: null },
    { id: 502, code: "H0361", responsible: 13, participants: [13], expected: "2026-08-06" },
    { id: 531, code: "H0130", responsible: 13, participants: [13, 20], expected: "2026-08-14" },
  ];
  const selected = new Map<string, string | null>();
  for (const row of fixture) {
    const participants = row.participants.map((id) => users.get(id)!);
    const surveyTarget = { ...target(users.get(row.responsible)!), id: row.id, code: row.code };
    let date: string | null = null;
    for (const candidate of recommendationDatesForBusinessType("2026-08-31", "existing")) {
      const validation = await validateManualPlanHardRules({
        target: surveyTarget, recommendedDate: candidate.date, participants, surveyMethod: "phone",
        existingAssignments: assignments, routes,
        availability: { isBlocked: (userId, candidateDate) => blockedByDate.get(candidateDate)?.has(userId) ?? false },
      });
      if (!validation.valid) continue;
      date = candidate.date;
      assignments.push({
        targetId: row.id, kind: "existing", date, participants: row.participants,
        businessCode: row.code,
        responsibleUserId: row.responsible, experiencedReviewerId: null,
        surveyMethod: "phone", address: null, coordinate: null, region: null,
      });
      break;
    }
    selected.set(row.code, date);
  }
  assert.deepEqual(Object.fromEntries(selected), Object.fromEntries(fixture.map((row) => [row.code, row.expected])));
});
