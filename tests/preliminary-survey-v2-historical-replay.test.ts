import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalReplayCandidateUsers,
  canonicalReplayScheduleBlocks,
  canonicalReplayResults,
  measurementAssignmentBlockedKeys,
  normalizeReplayPeriod,
  replayChangeType,
  replayJournalKey,
  replaySourceFingerprint,
  sameReplayResults,
  STAGE2_PROTECTED_CODES,
} from "../lib/preliminary-survey-v2/historical-replay";
import { assignMeasurementAssignees, type MeasurementAssignmentTarget } from "../lib/preliminary-survey-v2/measurement-assignment";

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

const assignmentUsers = [
  { id: 1, name: "A", surveyCode: "A" as const, active: true },
  { id: 2, name: "B", surveyCode: "B" as const, active: true },
];
const assignmentTarget = (targetId: number, measurementDate: string): MeasurementAssignmentTarget => ({
  targetId, measurementDate, address: null, coordinate: null, reportWriterUserId: 1,
  measurementParticipantUserIds: [1], preliminarySurveyorUserId: 1,
});

test("측정자 availability는 예비조사 후보일이 아니라 실제 측정일 block만 적용한다", () => {
  const blocks = [
    { user_id: 1, start_date: "2026-08-20", end_date: "2026-08-20" },
    { user_id: 1, start_date: "2026-08-24", end_date: "2026-08-24" },
  ];
  const keys = measurementAssignmentBlockedKeys(blocks, ["2026-08-24"]);
  const [result] = assignMeasurementAssignees({
    targets: [assignmentTarget(1, "2026-08-24")], users: assignmentUsers,
    availability: { isBlocked: (userId, date) => keys.has(`${userId}:${date}`) },
  });
  assert.equal(result.userId, 2);
  assert.ok(!keys.has("1:2026-08-20"));
});

test("다일 측정 block은 날짜별로 독립 적용한다", () => {
  const keys = measurementAssignmentBlockedKeys([
    { user_id: 1, start_date: "2026-08-24", end_date: "2026-08-24" },
  ], ["2026-08-24", "2026-08-25"]);
  const results = assignMeasurementAssignees({
    targets: [assignmentTarget(1, "2026-08-24"), assignmentTarget(1, "2026-08-25")], users: assignmentUsers,
    availability: { isBlocked: (userId, date) => keys.has(`${userId}:${date}`) },
  });
  assert.equal(results.find((item) => item.measurementDate === "2026-08-24")?.userId, 2);
  assert.equal(results.find((item) => item.measurementDate === "2026-08-25")?.userId, 1);
});

test("후보 직원 일정과 상태 변경은 fingerprint에 반영되고 관련 밖 일정은 제외한다", () => {
  const users = [{ id: 1, is_active: true, survey_code: "A", is_preliminary_survey_experienced: true,
    is_preliminary_survey_support_assignable: true }];
  const source = (blocks: any[], candidateUsers = users) => ({
    candidateUsers: canonicalReplayCandidateUsers(candidateUsers),
    scheduleBlocks: canonicalReplayScheduleBlocks({ blocks, candidateUserIds: [1],
      relevantDates: ["2026-08-03", "2026-08-24"] }),
  });
  const base = replaySourceFingerprint(source([]));
  assert.notEqual(base, replaySourceFingerprint(source([
    { id: 1, user_id: 1, start_date: "2026-08-03", end_date: "2026-08-03", block_type: "leave" },
  ])));
  assert.notEqual(base, replaySourceFingerprint(source([
    { id: 2, user_id: 1, start_date: "2026-08-24", end_date: "2026-08-24", block_type: "leave" },
  ])));
  assert.equal(base, replaySourceFingerprint(source([
    { id: 3, user_id: 2, start_date: "2026-08-24", end_date: "2026-08-24", block_type: "leave" },
    { id: 4, user_id: 1, start_date: "2026-08-26", end_date: "2026-08-26", block_type: "leave" },
  ])));
  assert.notEqual(base, replaySourceFingerprint(source([], [{ ...users[0], survey_code: "B" }])));
  assert.notEqual(base, replaySourceFingerprint(source([], [{ ...users[0], is_active: false }])));
  assert.equal(replaySourceFingerprint(source([])), replaySourceFingerprint(source([])));
});
