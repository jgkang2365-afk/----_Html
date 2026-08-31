import assert from "node:assert/strict";
import test from "node:test";
import { recommendSurveyors } from "../lib/preliminary-survey-v2/surveyor-recommendation";
import type { ExistingAssignment, SurveyUser } from "../lib/preliminary-survey-v2/types";

const experienced = (id: number): SurveyUser => ({ id, name: `경력${id}`, experienced: true, active: true });
const novice = (id: number): SurveyUser => ({ id, name: `비경력${id}`, experienced: false, active: true });
const available = (blocked = new Set<string>()) => ({ isBlocked: (userId: number, date: string) => blocked.has(`${userId}:${date}`) });
const assignment = (targetId: number, kind: "new" | "existing", userId: number, date: string): ExistingAssignment => ({
  targetId, businessCode: `H${targetId}`, kind, date, participants: [userId], responsibleUserId: userId,
  experiencedReviewerId: null, coordinate: null, region: null,
});

test("유선 책임자 3건 한도에 도달하면 같은 날짜의 다른 조사자를 선택한다", () => {
  const result = recommendSurveyors({
    targets: [{ id: 1, kind: "existing", businessType: "existing", measurementDate: "2026-07-14", createdAt: null, candidateDates: ["2026-06-01", "2026-06-02"] }],
    users: [novice(2), experienced(10)],
    assignments: [1, 2, 3].map((id) => assignment(id + 10, "existing", 2, "2026-06-01")),
    availability: available(),
  });
  assert.equal(result[0].date, "2026-06-02");
  assert.equal(result[0].responsible?.id, 2);
  assert.deepEqual(result[0].participants.map((user) => user.id), [2, 10]);
});

test("후보 날짜×조합에서 직원 불가 일정과 방문 개인 용량을 함께 적용한다", () => {
  const result = recommendSurveyors({
    targets: [{ id: 1, kind: "new", businessType: "first_measurement", measurementDate: "2026-07-14", createdAt: null, candidateDates: ["2026-06-01", "2026-06-02"] }],
    users: [experienced(1), novice(2)],
    assignments: [assignment(10, "new", 1, "2026-06-01"), assignment(11, "new", 1, "2026-06-01")],
    availability: available(new Set(["2:2026-06-01"])),
  });
  assert.equal(result[0].date, "2026-06-02");
  assert.equal(result[0].responsible?.id, 1);
  assert.deepEqual(result[0].participants.map((user) => user.id), [1]);
});

test("유선 책임자 후보가 첫 날짜에 모두 3건이면 다음 정책 날짜를 선택한다", () => {
  const users = [experienced(1), experienced(2)];
  const assignments = users.flatMap((user) => [1, 2, 3].map((id) =>
    assignment(user.id * 10 + id, "existing", user.id, "2026-06-01")));
  const [result] = recommendSurveyors({
    targets: [{ id: 1, kind: "existing", businessType: "existing", measurementDate: "2026-07-14", createdAt: null, candidateDates: ["2026-06-01", "2026-06-02"] }],
    users, assignments, availability: available(),
  });
  assert.equal(result.date, "2026-06-02");
});

test("유선 4건이 되는 기존 tentative plan은 보존하지 않고 재추천한다", () => {
  const responsible = experienced(1);
  const assignments = [
    ...[1, 2, 3].map((id) => assignment(10 + id, "existing", responsible.id, "2026-06-01")),
    { ...assignment(1, "existing", responsible.id, "2026-06-01"), tentative: true },
  ];
  const [result] = recommendSurveyors({
    targets: [{ id: 1, kind: "existing", businessType: "existing", measurementDate: "2026-07-14", createdAt: null, candidateDates: ["2026-06-01", "2026-06-02"] }],
    users: [responsible], assignments, availability: available(),
  });
  assert.equal(result.preserved, false);
  assert.equal(result.date, "2026-06-02");
});

test("첫 날짜의 모든 사용자가 blocked면 다음 정책 유효 날짜를 사용한다", () => {
  const result = recommendSurveyors({
    targets: [{ id: 1, kind: "existing", businessType: "existing", measurementDate: "2026-07-14", createdAt: null, candidateDates: ["2026-06-01", "2026-06-02"] }],
    users: [experienced(1), novice(2)],
    assignments: [],
    availability: available(new Set(["1:2026-06-01", "2:2026-06-01"])),
  });
  assert.equal(result[0].date, "2026-06-02");
});

test("비경력자 단독 기존 가확정은 보존하지 않고 경력 포함 조합으로 재추천한다", () => {
  const result = recommendSurveyors({
    targets: [
      { id: 2, kind: "existing", businessType: "existing", measurementDate: "2026-07-14", createdAt: "2026-01-02", candidateDates: ["2026-06-01"] },
      { id: 1, kind: "existing", businessType: "existing", measurementDate: "2026-07-14", createdAt: "2026-01-01", candidateDates: ["2026-06-01", "2026-06-02"] },
    ],
    users: [novice(2), experienced(10)],
    assignments: [{ ...assignment(1, "existing", 2, "2026-06-02"), tentative: true }],
    availability: available(),
  });
  const preserved = result.find((item) => item.targetId === 1)!;
  assert.equal(preserved.preserved, false);
  assert.equal(preserved.date, "2026-06-02");
  assert.equal(preserved.responsible?.id, 2);
  assert.deepEqual(preserved.participants.map((user) => user.id), [2, 10]);
});

test("동일 입력은 입력 배열 순서와 무관하게 동일한 안정적 tie-break 결과를 낸다", () => {
  const targets = [1, 2].map((id) => ({
    id, kind: "existing" as const, businessType: "existing" as const, measurementDate: "2026-07-14",
    createdAt: `2026-01-0${id}`, candidateDates: ["2026-06-01"],
  }));
  const input = { users: [experienced(9), novice(2)], availability: available() };
  const forward = recommendSurveyors({ ...input, targets });
  const reverse = recommendSurveyors({ ...input, targets: [...targets].reverse() });
  assert.deepEqual(forward.map((item) => [item.targetId, item.date, item.responsible?.id]), reverse.map((item) => [item.targetId, item.date, item.responsible?.id]));
});
