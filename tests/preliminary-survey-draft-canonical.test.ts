import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeWorkbenchDraft,
  sameCanonicalWorkbenchDraft,
  type CanonicalWorkbenchDraft,
} from "../lib/preliminary-survey-v2/draft-canonical";

const draft = (): CanonicalWorkbenchDraft => ({
  scope: {
    measurementDateFrom: "2026-08-01", measurementDateTo: "2026-08-31",
    preliminaryDateFrom: null, preliminaryDateTo: null,
  },
  surveys: [{
    targetId: 1, preliminaryDate: "2026-08-20", participantUserIds: [10], surveyors: ["조사자"],
    surveyMethod: "field", sourceMeasurementDate: "2026-08-25", sourceMeasurerId: 20,
    sourceResponsibleUserId: 10, sourceRuleType: "new", sourceAddress: "주소",
    sourceMeasurementParticipants: "참여자", sourcePlanFingerprint: "a".repeat(64),
    reason: "최초실시 · 방문",
  }],
  measurementAssignments: [{
    targetId: 1, measurementDate: "2026-08-25", userId: 30, userName: "측정자",
    surveyCode: "C", approvalRequired: false, reason: "측정자 균등배정",
  }],
});

test("canonical draft는 survey와 날짜별 assignment 순서에 무관하다", () => {
  const left = draft();
  const right = draft();
  right.surveys = [...right.surveys].reverse();
  right.measurementAssignments = [...right.measurementAssignments].reverse();
  assert.equal(sameCanonicalWorkbenchDraft(left, right), true);
});

test("측정자·공시료 preview 또는 추천 scope 변경은 stale이다", () => {
  const original = draft();
  const changedAssignee = draft();
  changedAssignee.measurementAssignments[0].userId = 31;
  const changedScope = draft();
  changedScope.scope.measurementDateFrom = "2026-08-02";
  const changedSource = draft();
  changedSource.surveys[0].sourcePlanFingerprint = "b".repeat(64);
  assert.equal(sameCanonicalWorkbenchDraft(original, changedAssignee), false);
  assert.equal(sameCanonicalWorkbenchDraft(original, changedScope), false);
  assert.equal(sameCanonicalWorkbenchDraft(original, changedSource), false);
  assert.deepEqual(canonicalizeWorkbenchDraft(original).scope, original.scope);
});
