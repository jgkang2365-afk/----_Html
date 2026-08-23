import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalReplayResults,
  normalizeReplayPeriod,
  replayChangeType,
  replayJournalKey,
  replaySourceFingerprint,
  sameReplayResults,
  STAGE2_PROTECTED_CODES,
} from "../lib/preliminary-survey-v2/historical-replay";

test("historical replay 식별자는 period를 정규화하고 보호 대상은 runner guard로 분리한다", () => {
  assert.equal(normalizeReplayPeriod(" 2026년 하반기 "), "2026년하반기");
  assert.equal(replayJournalKey("H0011", 2026, " 하반기 "), "H0011|2026|하반기");
  assert.equal(STAGE2_PROTECTED_CODES.size, 10);
  assert.ok(STAGE2_PROTECTED_CODES.has("H0399"));
});

test("source fingerprint는 object key 순서와 무관하고 source 변경에는 민감하다", () => {
  assert.equal(replaySourceFingerprint({ b: 2, a: [1] }), replaySourceFingerprint({ a: [1], b: 2 }));
  assert.notEqual(replaySourceFingerprint({ a: 1 }), replaySourceFingerprint({ a: 2 }));
});

test("replay 비교는 대상과 assignment 입력 순서에 대해 결정적이다", () => {
  const result = {
    targetId: 1, replayDate: "2026-07-01", responsibleUserId: 1, reviewerUserId: null,
    participantUserIds: [2, 1], warning: ["B", "A"], status: "recommended",
    measurementAssignments: [
      { measurementDate: "2026-08-02", assigneeUserId: 2, surveyCode: "B", approvalRequired: false },
      { measurementDate: "2026-08-01", assigneeUserId: 1, surveyCode: "A", approvalRequired: false },
    ],
  };
  const reordered = { ...result, participantUserIds: [1, 2], warning: ["A", "B"], measurementAssignments: [...result.measurementAssignments].reverse() };
  assert.ok(sameReplayResults([result], [reordered]));
  assert.deepEqual(canonicalReplayResults([result]), canonicalReplayResults([reordered]));
});

test("change type은 제외·manual 보존·날짜·조사자·측정자 변경을 구분한다", () => {
  const base = { currentDate: "2026-07-01", replayDate: "2026-07-01", currentResponsibleUserId: 1, replayResponsibleUserId: 1, measurementAssigneeChanged: false };
  assert.equal(replayChangeType({ ...base, excluded: "true_confirmed" }), "true_confirmed_excluded");
  assert.equal(replayChangeType({ ...base, excluded: "protected" }), "protected_excluded");
  assert.equal(replayChangeType({ ...base, manualPreserved: true }), "manual_preserved");
  assert.equal(replayChangeType({ ...base, replayDate: "2026-07-02" }), "date_changed");
  assert.equal(replayChangeType({ ...base, replayResponsibleUserId: 2 }), "surveyor_changed");
  assert.equal(replayChangeType({ ...base, measurementAssigneeChanged: true }), "measurement_assignee_changed");
});
