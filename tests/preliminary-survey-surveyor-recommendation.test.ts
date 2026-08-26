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

test("유선 기존업체의 기존 일일 건수는 배정 불가 사유가 아니다", () => {
  const result = recommendSurveyors({
    targets: [{ id: 1, kind: "existing", businessType: "existing", measurementDate: "2026-07-14", createdAt: null, candidateDates: ["2026-06-01", "2026-06-02"] }],
    users: [novice(2), experienced(10)],
    assignments: [1, 2, 3].map((id) => assignment(id + 10, "existing", 2, "2026-06-01")),
    availability: available(),
  });
  assert.equal(result[0].date, "2026-06-01");
  assert.equal(result[0].responsible?.id, 10);
  assert.deepEqual(result[0].participants.map((user) => user.id), [10]);
});

test("직원 일정과 방문 개인 용량은 후보 날짜를 제외하지 않는다", () => {
  const result = recommendSurveyors({
    targets: [{ id: 1, kind: "new", businessType: "first_measurement", measurementDate: "2026-07-14", createdAt: null, candidateDates: ["2026-06-01", "2026-06-02"] }],
    users: [experienced(1), novice(2)],
    assignments: [assignment(10, "new", 1, "2026-06-01"), assignment(11, "new", 1, "2026-06-01")],
    availability: available(new Set(["2:2026-06-01"])),
  });
  assert.equal(result[0].date, "2026-06-01");
  assert.equal(result[0].responsible?.id, 1);
  assert.deepEqual(result[0].participants.map((user) => user.id), [1]);
});

test("유효한 기존 가확정은 신규 후보보다 먼저 reserve하여 최소 변경으로 유지한다", () => {
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
  assert.equal(preserved.preserved, true);
  assert.equal(preserved.date, "2026-06-02");
  assert.equal(preserved.responsible?.id, 2);
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
