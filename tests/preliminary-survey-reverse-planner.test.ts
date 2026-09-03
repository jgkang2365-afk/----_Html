import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPlanningSnapshot } from "../lib/preliminary-survey-v2/reverse-planner/snapshot";
import { candidateDates } from "../lib/preliminary-survey-v2/reverse-planner/candidate-dates";
import {
  resolveAutomaticMeasurementAssignments,
  withAutomaticMeasurementAssignments,
} from "../lib/preliminary-survey-v2/reverse-planner/automatic-measurement-assignment";
import { normalizePublicSampleCodes } from "../lib/preliminary-survey-v2/reverse-planner/public-sample-code";
import { planPreliminarySurveyGivenFixedAssignments, rankedCandidatesForTarget, validateCandidateHardRules } from "../lib/preliminary-survey-v2/reverse-planner/solver";
import {
  PRELIMINARY_SURVEY_CANONICAL_SHA,
  REVERSE_PLANNER_VERSION,
  type PlannerTarget,
  type PlanningSnapshot,
} from "../lib/preliminary-survey-v2/reverse-planner/types";

const users = [
  { id: 1, name: "강종구", active: true, experienced: false, baseCode: "C" },
  { id: 2, name: "이태환", active: true, experienced: true, baseCode: "A" },
  { id: 3, name: "고유빈", active: true, experienced: false, baseCode: "F" },
  { id: 4, name: "한기문", active: true, experienced: true, baseCode: "B" },
  { id: 5, name: "이주형", active: true, experienced: true, baseCode: "D" },
  { id: 6, name: "김민영", active: true, experienced: false, baseCode: "G" },
];

function target(overrides: Partial<PlannerTarget> = {}): PlannerTarget {
  return {
    id: 10,
    code: "H0527",
    name: "회귀 사업장",
    address: "대전 A",
    businessType: "existing",
    days: [{ date: "2026-09-16", collaboratorUserIds: [1], reportWriterUserId: 1 }],
    fixedAssignments: [{ targetId: 10, measurementDate: "2026-09-16", assigneeUserId: 1, confirmedAt: "x", updatedAt: "x" }],
    existingPlan: null,
    ...overrides,
  };
}

function fixture(overrides: Partial<PlanningSnapshot> = {}): PlanningSnapshot {
  return {
    canonicalSha: PRELIMINARY_SURVEY_CANONICAL_SHA,
    plannerVersion: REVERSE_PLANNER_VERSION,
    users,
    targets: [target()],
    scheduleBlocks: [],
    routeEvidence: [],
    writingCounters: {},
    existingSurveyOccupancy: [],
    actualMeasurementOccupancy: [],
    existingPublicSampleAssignments: [],
    ...overrides,
  };
}

const resultFor = (snapshot: PlanningSnapshot, targetId = 10) =>
  planPreliminarySurveyGivenFixedAssignments(snapshot).results.find((result) => result.targetId === targetId)!;

test("Golden 6인은 Production/Canonical의 경력 여부와 base code를 사용한다", () => {
  assert.deepEqual(users.map(({ name, experienced, baseCode }) => [name, experienced, baseCode]), [
    ["강종구", false, "C"], ["이태환", true, "A"], ["고유빈", false, "F"],
    ["한기문", true, "B"], ["이주형", true, "D"], ["김민영", false, "G"],
  ]);
});

for (const [noviceId, reviewerId, label] of [[1, 2, "강종구 → 이태환"], [3, 5, "고유빈 → 이주형"], [6, 4, "김민영 → 한기문"]] as const) {
  test(`${label} reviewer preference 방향`, () => {
    const input = fixture({ targets: [target({
      days: [{ date: "2026-09-16", collaboratorUserIds: [noviceId], reportWriterUserId: noviceId }],
      fixedAssignments: [{ targetId: 10, measurementDate: "2026-09-16", assigneeUserId: noviceId, confirmedAt: "x", updatedAt: "x" }],
    })] });
    const candidate = resultFor(input).candidate!;
    assert.equal(candidate.responsibleUserId, noviceId);
    assert.equal(candidate.reviewerUserId, reviewerId);
  });
}

test("유선 reviewer 불가 일정은 차단하지 않고, 비활성 reviewer면 다른 경력자를 탐색한다", () => {
  const input = fixture({ scheduleBlocks: [{ userId: 2, startDate: "2026-08-01", endDate: "2026-09-30" }] });
  assert.equal(resultFor(input).candidate?.reviewerUserId, 2);
  const inactivePreferred = fixture({ users: users.map((user) => user.id === 2 ? { ...user, active: false } : user) });
  assert.equal(resultFor(inactivePreferred).candidate?.reviewerUserId, 4);
});

test("비경력자 단독은 AUTO 후보가 아니며 경력+비경력 작성자는 비경력자다", () => {
  const input = fixture();
  const candidate = resultFor(input).candidate!;
  assert.deepEqual(new Set(candidate.participantUserIds), new Set([1, 2]));
  assert.equal(candidate.responsibleUserId, 1);
  assert.equal(candidate.writerUserId, 1);
  assert.equal(candidate.reviewerUserId, 2);
  assert.ok(validateCandidateHardRules(input, input.targets[0], { ...candidate, participantUserIds: [1], reviewerUserId: null })
    .includes("INVALID_SURVEYOR_ROLE_COMBINATION"));
});

test("공시료 담당자가 예비조사자에 포함되어야 하며 참여자·보고서 담당자만 일치하면 실패한다", () => {
  const input = fixture({ targets: [target({
    days: [{ date: "2026-09-16", collaboratorUserIds: [2], reportWriterUserId: 2 }],
    fixedAssignments: [{ targetId: 10, measurementDate: "2026-09-16", assigneeUserId: 1, confirmedAt: "x", updatedAt: "x" }],
  })] });
  const participantOnly = { preliminaryDate: "2026-08-20", surveyMethod: "phone" as const, participantUserIds: [2], responsibleUserId: 2, reviewerUserId: null, writerUserId: 2, objective: [0, 0, 0, 0, 0, 0] as const, reasons: [] };
  assert.ok(validateCandidateHardRules(input, input.targets[0], participantOnly).includes("MEASUREMENT_ASSIGNEE_INTERSECTION_REQUIRED"));
  assert.ok(resultFor(input).candidate?.participantUserIds.includes(1));
});

test("다일은 전체 날짜의 공시료 담당자 집합 중 한 명 포함이면 통과한다", () => {
  const input = fixture({ targets: [target({
    days: [
      { date: "2026-09-16", collaboratorUserIds: [2], reportWriterUserId: 2 },
      { date: "2026-09-17", collaboratorUserIds: [5], reportWriterUserId: 5 },
    ],
    fixedAssignments: [
      { targetId: 10, measurementDate: "2026-09-16", assigneeUserId: 2, confirmedAt: "x", updatedAt: "x" },
      { targetId: 10, measurementDate: "2026-09-17", assigneeUserId: 5, confirmedAt: "x", updatedAt: "x" },
    ],
  })] });
  const candidate = resultFor(input).candidate!;
  assert.ok(candidate.participantUserIds.includes(2) || candidate.participantUserIds.includes(5));
  assert.ok(validateCandidateHardRules(input, input.targets[0], { ...candidate, participantUserIds: [4], responsibleUserId: 4, reviewerUserId: null, writerUserId: 4 })
    .includes("MEASUREMENT_ASSIGNEE_INTERSECTION_REQUIRED"));
});

test("공시료 담당자만 예비조사자에 포함되면 자동 후보로 허용한다", () => {
  const input = fixture({ targets: [target({
    days: [{ date: "2026-09-16", collaboratorUserIds: [2], reportWriterUserId: 2 }],
    fixedAssignments: [{ targetId: 10, measurementDate: "2026-09-16", assigneeUserId: 1, confirmedAt: "x", updatedAt: "x" }],
  })] });
  const candidate = resultFor(input).candidate!;
  assert.ok(candidate.participantUserIds.includes(1));
});

test("경력자 단독은 본인이 작성한다", () => {
  const input = fixture({ users: users.map((user) => user.experienced ? user : { ...user, active: false }), targets: [target({
    days: [{ date: "2026-09-16", collaboratorUserIds: [2], reportWriterUserId: 2 }],
    fixedAssignments: [{ targetId: 10, measurementDate: "2026-09-16", assigneeUserId: 2, confirmedAt: "x", updatedAt: "x" }],
  })] });
  const candidate = resultFor(input).candidate!;
  assert.deepEqual(candidate.participantUserIds, [2]);
  assert.equal(candidate.writerUserId, 2);
  assert.equal(candidate.reviewerUserId, null);
});

test("기존 assignment는 fixed confirmation으로 승격하지 않는다", () => {
  const input = fixture();
  input.targets[0].fixedAssignments = [];
  input.targets[0].existingPlan = { id: "old", preliminaryDate: "2026-08-20", surveyMethod: "phone",
    participantUserIds: [2, 1], responsibleUserId: 1, reviewerUserId: 2, protected: false, updatedAt: "x",
    assignments: [{ measurementDate: "2026-09-15", assigneeUserId: 1, surveyCode: "C", publicSampleCode: null }] };
  assert.equal(resultFor(input).reason, "FIXED_ASSIGNEE_NOT_CONFIRMED");
});

test("고정값이 없는 기본 자동모드는 계산용 측정자를 만들되 fixed confirmation으로 위장하지 않는다", () => {
  const input = fixture({ targets: [target({ fixedAssignments: [] })] });
  const resolved = withAutomaticMeasurementAssignments(input);
  const [assignment] = resolved.targets[0].fixedAssignments;
  assert.equal(input.targets[0].fixedAssignments.length, 0);
  assert.equal(assignment.origin, "automatic");
  assert.equal(resultFor(resolved).decision, "AUTO_ASSIGNED");
  const route = readFileSync("app/api/preliminary-survey-v2/reverse-planner/route.ts", "utf8");
  assert.match(route, /fixed\.origin !== "automatic"/);
});

test("6개 자동 대상은 6명에게 첫 순환으로 하나씩 배정한다", () => {
  const targets = users.map((_, index) => target({
    id: 10 + index,
    code: `H00${10 + index}`,
    address: `대전 ${index}`,
    fixedAssignments: [],
  }));
  const resolved = withAutomaticMeasurementAssignments(fixture({ targets }));
  const automatic = resolved.targets.flatMap((item) => item.fixedAssignments)
    .filter((item) => item.origin === "automatic");
  assert.equal(automatic.length, 6);
  assert.equal(new Set(automatic.map((item) => item.assigneeUserId)).size, 6);
});

test("13개 batch도 정상 12건을 보존하고 자동 3건째 대상만 확인 필요로 남긴다", () => {
  const targets = Array.from({ length: 13 }, (_, index) => {
    const assignee = users[index % users.length];
    return target({
      id: 100 + index,
      code: `QA${String(index + 1).padStart(2, "0")}`,
      address: "대전 동일주소",
      days: [{ date: "2026-10-16", collaboratorUserIds: [assignee.id], reportWriterUserId: assignee.id }],
      fixedAssignments: index < 12 ? [{
        targetId: 100 + index,
        measurementDate: "2026-10-16",
        assigneeUserId: assignee.id,
        confirmedAt: "automatic-preview",
        updatedAt: "automatic-preview",
        origin: "automatic",
      }] : [],
      automaticAssignmentIssue: index === 12 ? "MEASUREMENT_ASSIGNMENT_THIRD_REQUIRES_OVERRIDE" : undefined,
    });
  });
  const output = planPreliminarySurveyGivenFixedAssignments(fixture({ targets }), {
    deadlineAt: Date.now() + 2_000,
  });
  assert.equal(output.solverTimedOut, undefined);
  assert.equal(output.results.filter((result) => result.decision === "AUTO_ASSIGNED").length, 12);
  assert.equal(output.results.find((result) => result.targetId === 112)?.reason,
    "MEASUREMENT_ASSIGNMENT_THIRD_REQUIRES_OVERRIDE");
});

test("Route 없는 두 번째 자동 측정자는 배정하지 않고 해당 target만 확인 필요로 남긴다", () => {
  const targets = Array.from({ length: 7 }, (_, index) => target({
    id: 10 + index,
    code: `H00${10 + index}`,
    address: `서로 다른 주소 ${index}`,
    fixedAssignments: [],
  }));
  const resolved = withAutomaticMeasurementAssignments(fixture({ targets }));
  assert.equal(resolved.targets.flatMap((item) => item.fixedAssignments).length, 6);
  assert.equal(resolved.targets.find((item) => item.id === 16)?.automaticAssignmentIssue,
    "MEASUREMENT_ASSIGNMENT_ROUTE_REQUIRED");
});

test("첫 Route 후보가 60분 초과여도 다음 측정자 후보를 찾아 자동 배정한다", async () => {
  const targets = Array.from({ length: 7 }, (_, index) => target({
    id: 10 + index,
    code: `H00${10 + index}`,
    address: `서로 다른 주소 ${index}`,
    coordinate: { latitude: 36.3 + index / 100, longitude: 127.3 + index / 100 },
    fixedAssignments: [],
  }));
  const durations = [65, 65, 25, 25, 65, 65, 65, 65, 65, 65, 65, 65];
  let calls = 0;
  const resolved = await resolveAutomaticMeasurementAssignments(fixture({ targets }), {
    concurrency: 1,
    routes: {
      async between() {
        calls += 1;
        return { source: "vehicle", durationMinutes: durations.shift() ?? 65,
          distanceKm: 1, sameRegion: true };
      },
    },
  });
  const finalTarget = resolved.snapshot.targets.find((item) => item.id === 16)!;
  assert.equal(calls, 12);
  assert.equal(finalTarget.fixedAssignments[0]?.origin, "automatic");
  assert.equal(finalTarget.automaticAssignmentIssue, undefined);
});

test("자동 측정자 Route provider가 AbortSignal을 무시해도 deadline 안에 확인 필요로 반환한다", async () => {
  const targets = Array.from({ length: 7 }, (_, index) => target({
    id: 10 + index,
    code: `H00${10 + index}`,
    address: `서로 다른 주소 ${index}`,
    coordinate: { latitude: 36.3 + index / 100, longitude: 127.3 + index / 100 },
    fixedAssignments: [],
  }));
  const startedAt = Date.now();
  const resolved = await resolveAutomaticMeasurementAssignments(fixture({ targets }), {
    deadlineMs: 20,
    routes: { between: () => new Promise(() => undefined) },
  });
  assert.ok(Date.now() - startedAt < 1_000);
  assert.equal(resolved.snapshot.targets.find((item) => item.id === 16)?.automaticAssignmentIssue,
    "MEASUREMENT_ASSIGNMENT_ROUTE_REQUIRED");
  assert.ok(resolved.routeEvidence.some((item) => item.provider === "route_deadline"));
});

test("자동 3건째는 target 단위 MANUAL_REQUIRED이고 4건 이상 점유는 hard block 사유다", () => {
  const sameAddressTargets = Array.from({ length: 13 }, (_, index) => target({
    id: 10 + index,
    code: `H00${10 + index}`,
    address: "대전 동일주소",
    fixedAssignments: [],
  }));
  const third = withAutomaticMeasurementAssignments(fixture({ targets: sameAddressTargets }));
  assert.equal(third.targets.flatMap((item) => item.fixedAssignments).length, 12);
  assert.equal(third.targets.find((item) => item.id === 22)?.automaticAssignmentIssue,
    "MEASUREMENT_ASSIGNMENT_THIRD_REQUIRES_OVERRIDE");

  const existingPublicSampleAssignments = users.flatMap((user, userIndex) => [0, 1, 2].map((offset) => ({
    targetId: 100 + userIndex * 10 + offset,
    businessCode: `X${userIndex}${offset}`,
    measurementDate: "2026-09-16",
    assigneeUserId: user.id,
    surveyCode: user.baseCode!,
    publicSampleCode: user.baseCode!,
    protected: false,
    source: "persisted" as const,
    updatedAt: "2026-09-01T00:00:00.000Z",
  })));
  const fourth = withAutomaticMeasurementAssignments(fixture({
    targets: [target({ fixedAssignments: [] })],
    existingPublicSampleAssignments,
  }));
  assert.equal(fourth.targets[0].automaticAssignmentIssue, "MEASUREMENT_ASSIGNMENT_CAPACITY_EXCEEDED");
});

test("동일 target/date의 fixed와 persisted는 한 번만 세고 outside persisted 측정자를 실제팀에 포함한다", () => {
  const rawTargets = [
    { id: 10, code: "H0010", business_name: "계산 대상", address: "대전 A", measurement_date: "2026-09-16",
      measurer_id: 1, collaborators: "강종구", daily_staff: null, business_type: "existing" },
    { id: 20, code: "H0020", business_name: "외부 대상", address: "대전 B", measurement_date: "2026-09-16",
      measurer_id: 1, collaborators: "강종구", daily_staff: null, business_type: "existing" },
  ];
  const rawUsers = users.map((user) => ({ id: user.id, name: user.name, is_active: user.active,
    is_preliminary_survey_experienced: user.experienced, survey_code: user.baseCode }));
  const plans = [{ id: "p20", measurement_target_business_id: 20, recommended_date: "2026-08-20",
    survey_method: "phone", participant_user_ids: [2, 1], responsible_user_id: 1,
    experienced_reviewer_id: 2, updated_at: "2026-09-01T00:00:00.000Z" }];
  const assignments = [{ plan_id: "p20", measurement_date: "2026-09-16", assignee_user_id: 3,
    survey_code: "F", public_sample_code: "F", updated_at: "2026-09-01T00:00:00.000Z" }];
  const withFixed = buildPlanningSnapshot({ targets: rawTargets, users: rawUsers,
    fixedAssignments: [{ measurement_target_business_id: 20, measurement_date: "2026-09-16",
      assignee_user_id: 1, confirmed_at: "x", updated_at: "2026-09-01T00:00:00.000Z", source_snapshot: {} }],
    plans, assignments, scheduleBlocks: [], planningTargetIds: [10] });
  assert.deepEqual(withFixed.existingPublicSampleAssignments.filter((item) => item.targetId === 20)
    .map((item) => [item.assigneeUserId, item.source]), [[1, "fixed"]]);
  assert.deepEqual(withFixed.actualMeasurementOccupancy.find((item) => item.targetId === 20)?.participantUserIds, [1]);

  const persistedOnly = buildPlanningSnapshot({ targets: rawTargets, users: rawUsers, fixedAssignments: [],
    plans, assignments, scheduleBlocks: [], planningTargetIds: [10] });
  assert.deepEqual(persistedOnly.actualMeasurementOccupancy.find((item) => item.targetId === 20)?.participantUserIds,
    [1, 3]);
});

test("fixed assignee가 빠지고 collaborator만 일치하면 자동 배정하지 않는다", () => {
  const input = fixture({ targets: [target({
    days: [{ date: "2026-09-16", collaboratorUserIds: [1], reportWriterUserId: 1 }],
    fixedAssignments: [{ targetId: 10, measurementDate: "2026-09-16", assigneeUserId: 3, confirmedAt: "x", updatedAt: "x" }],
  })] });
  const candidate = {
    preliminaryDate: candidateDates("2026-09-16", "existing").primary[0], surveyMethod: "phone" as const,
    participantUserIds: [1, 2], responsibleUserId: 1, reviewerUserId: 2, writerUserId: 1,
    objective: [0, 0, 0, 0, 0, 0] as const, reasons: [],
  };
  assert.ok(validateCandidateHardRules(input, input.targets[0], candidate)
    .includes("MEASUREMENT_ASSIGNEE_INTERSECTION_REQUIRED"));
});

test("batch 밖 기존 유선 3건은 responsible capacity에 포함된다", () => {
  const blockedDate = candidateDates("2026-09-16", "existing").primary[0];
  const occupancy = [20, 21, 22].map((targetId) => ({ targetId, businessCode: `H${targetId}`, address: "대전",
    preliminaryDate: blockedDate, surveyMethod: "phone" as const, participantUserIds: [2, 1], responsibleUserId: 1,
    reviewerUserId: 2, writerUserId: 1, protected: false }));
  assert.notEqual(resultFor(fixture({ existingSurveyOccupancy: occupancy })).candidate?.preliminaryDate, blockedDate);
});

test("batch 밖 기존 유선 날짜 점유를 포함해 빈 날짜를 우선한다", () => {
  const usedDate = candidateDates("2026-09-16", "existing").primary[0];
  const occupancy = [{ targetId: 20, businessCode: "H0020", address: "대전", preliminaryDate: usedDate,
    surveyMethod: "phone" as const, participantUserIds: [5, 3], responsibleUserId: 3, reviewerUserId: 5,
    writerUserId: 3, protected: false }];
  assert.notEqual(resultFor(fixture({ existingSurveyOccupancy: occupancy })).candidate?.preliminaryDate, usedDate);
});

test("batch 안 SOURCE_INVALID target의 persisted plan도 고정 점유로 유지한다", () => {
  const usedDate = candidateDates("2026-09-16", "existing").primary[0];
  const invalid = target({ id: 11, code: "H0011",
    fixedAssignments: [{ targetId: 11, measurementDate: "2026-09-16", assigneeUserId: 999, confirmedAt: "x", updatedAt: "x" }] });
  const occupancy = [{ targetId: 11, businessCode: "H0011", address: "대전", preliminaryDate: usedDate,
    surveyMethod: "phone" as const, participantUserIds: [2, 1], responsibleUserId: 1, reviewerUserId: 2,
    writerUserId: 1, protected: false }];
  const input = fixture({ targets: [target(), invalid], existingSurveyOccupancy: occupancy });
  assert.equal(resultFor(input, 11).decision, "SOURCE_INVALID");
  assert.notEqual(resultFor(input).candidate?.preliminaryDate, usedDate);
});

test("batch 밖 방문 capacity는 공유 수행자별로 계산한다", () => {
  const fieldTarget = target({ businessType: "first_measurement",
    days: [{ date: "2026-09-16", collaboratorUserIds: [2], reportWriterUserId: 2 }],
    fixedAssignments: [{ targetId: 10, measurementDate: "2026-09-16", assigneeUserId: 2, confirmedAt: "x", updatedAt: "x" }] });
  const blockedDate = candidateDates("2026-09-16", "first_measurement").primary[0];
  const occupancy = [20, 21].map((targetId) => ({ targetId, businessCode: `H${targetId}`, address: "대전",
    preliminaryDate: blockedDate, surveyMethod: "field" as const, participantUserIds: [2], responsibleUserId: 2,
    reviewerUserId: null, writerUserId: 2, protected: false }));
  assert.notEqual(resultFor(fixture({ targets: [fieldTarget], existingSurveyOccupancy: occupancy })).candidate?.preliminaryDate, blockedDate);
});

test("방문 수행자의 실제 측정 일정은 막고 기존업체 유선은 막지 않는다", () => {
  const conflictDate = candidateDates("2026-09-16", "first_measurement").primary[0];
  const actual = [{ targetId: 99, businessCode: "H0099", address: "대전", date: conflictDate, participantUserIds: [2] }];
  const field = target({ businessType: "first_measurement",
    days: [{ date: "2026-09-16", collaboratorUserIds: [2], reportWriterUserId: 2 }],
    fixedAssignments: [{ targetId: 10, measurementDate: "2026-09-16", assigneeUserId: 2, confirmedAt: "x", updatedAt: "x" }] });
  assert.notEqual(resultFor(fixture({ targets: [field], actualMeasurementOccupancy: actual })).candidate?.preliminaryDate, conflictDate);
  const phoneConflict = candidateDates("2026-09-16", "existing").primary[0];
  const phoneActual = [{ ...actual[0], date: phoneConflict, participantUserIds: [1, 2] }];
  assert.equal(resultFor(fixture({ actualMeasurementOccupancy: phoneActual })).candidate?.preliminaryDate, phoneConflict);
});

test("primary가 Hard rule로 모두 막힌 뒤에만 fallback을 사용한다", () => {
  const dates = candidateDates("2026-09-16", "existing");
  const input = fixture({ scheduleBlocks: [{ userId: 1, startDate: dates.primary[0], endDate: dates.primary.at(-1)! }] });
  assert.ok(dates.fallback.includes(resultFor(input).candidate?.preliminaryDate ?? ""));
  assert.ok(dates.primary.includes(resultFor(fixture()).candidate?.preliminaryDate ?? ""));
});

test("KEEP_EXISTING은 full validator를 통과하고 global objective에서 보존된다", () => {
  const input = fixture();
  const date = candidateDates("2026-09-16", "existing").primary[0];
  input.targets[0].existingPlan = { id: "plan", preliminaryDate: date, surveyMethod: "phone",
    participantUserIds: [2, 1], responsibleUserId: 1, reviewerUserId: 2, protected: false, updatedAt: "x",
    assignments: [{ measurementDate: "2026-09-16", assigneeUserId: 1, surveyCode: "C", publicSampleCode: null }] };
  assert.equal(resultFor(input).mutation, "KEEP_EXISTING");
  input.targets[0].existingPlan.reviewerUserId = null;
  assert.notEqual(resultFor(input).mutation, "KEEP_EXISTING");
});

test("target/user/query 순서를 바꿔도 fingerprint와 global optimum이 같다", () => {
  const second = target({ id: 11, code: "H0508",
    fixedAssignments: [{ targetId: 11, measurementDate: "2026-09-16", assigneeUserId: 3, confirmedAt: "x", updatedAt: "x" }] });
  const input = fixture({ targets: [target(), second] });
  const left = planPreliminarySurveyGivenFixedAssignments(input);
  const right = planPreliminarySurveyGivenFixedAssignments({ ...input, targets: [...input.targets].reverse(),
    users: [...input.users].reverse(), existingSurveyOccupancy: [...input.existingSurveyOccupancy].reverse() });
  assert.equal(left.sourceFingerprint, right.sourceFingerprint);
  assert.deepEqual(left.results, right.results);
});

test("작성업무 균등은 persisted counter와 batch 선택 writer를 함께 누적한다", () => {
  const sharedDays = [{ date: "2026-09-16", collaboratorUserIds: [1, 3], reportWriterUserId: null }];
  const first = target({ id: 10, code: "H0010", days: sharedDays,
    fixedAssignments: [{ targetId: 10, measurementDate: "2026-09-16", assigneeUserId: 4, confirmedAt: "x", updatedAt: "x" }] });
  const second = target({ id: 11, code: "H0011", days: sharedDays,
    fixedAssignments: [{ targetId: 11, measurementDate: "2026-09-16", assigneeUserId: 4, confirmedAt: "x", updatedAt: "x" }] });
  const output = planPreliminarySurveyGivenFixedAssignments(fixture({ targets: [first, second] }));
  assert.equal(new Set(output.results.map((result) => result.candidate?.writerUserId)).size, 2);
});

test("C/CC/CCC Preview는 batch 밖 persisted 그룹까지 natural sort한다", () => {
  const input = fixture({ targets: [target({ code: "H0002" })], existingPublicSampleAssignments: [{
    targetId: 20, businessCode: "H0001", measurementDate: "2026-09-16", assigneeUserId: 1,
    surveyCode: "C", publicSampleCode: "C", protected: false,
    source: "persisted", updatedAt: "2026-09-01T00:00:00.000Z",
  }] });
  assert.equal(resultFor(input).publicSampleAssignments[0].publicSampleCode, "CC");
  const direct = normalizePublicSampleCodes({ targets: [...input.targets].reverse(), users: [...users].reverse(),
    existingAssignments: [...input.existingPublicSampleAssignments].reverse() });
  assert.deepEqual(direct.map((item) => item.publicSampleCode), ["C", "CC"]);
});

test("batch 밖 fixed confirmation도 assignment 생성 전 공시료 그룹에 포함한다", () => {
  const snapshot = buildPlanningSnapshot({
    targets: [
      { id: 10, code: "H0002", business_name: "계산 대상", address: "대전", measurement_date: "2026-09-16",
        measurer_id: 1, collaborators: "강종구", daily_staff: null, business_type: "existing" },
      { id: 20, code: "H0001", business_name: "외부 fixed", address: "대전", measurement_date: "2026-09-16",
        measurer_id: 1, collaborators: "강종구", daily_staff: null, business_type: "existing" },
    ],
    users: users.map((user) => ({ id: user.id, name: user.name, is_active: user.active,
      is_preliminary_survey_experienced: user.experienced, survey_code: user.baseCode })),
    fixedAssignments: [10, 20].map((id) => ({ measurement_target_business_id: id, measurement_date: "2026-09-16",
      assignee_user_id: 1, confirmed_at: "x", updated_at: "x", source_snapshot: {} })),
    plans: [], assignments: [], scheduleBlocks: [], planningTargetIds: [10],
  });
  assert.ok(snapshot.existingPublicSampleAssignments.some((item) => item.targetId === 20));
  assert.equal(resultFor(snapshot).publicSampleAssignments[0].publicSampleCode, "CC");
});

test("보호 plan code group 자동변경은 MANUAL_REQUIRED다", () => {
  const input = fixture({ targets: [target({ code: "H0001" })], existingPublicSampleAssignments: [{
    targetId: 20, businessCode: "H0002", measurementDate: "2026-09-16", assigneeUserId: 1,
    surveyCode: "C", publicSampleCode: "C", protected: true,
    source: "persisted", updatedAt: "2026-09-01T00:00:00.000Z",
  }] });
  assert.equal(resultFor(input).reason, "PROTECTED_PLAN_REQUIRES_REVIEW");
});

test("다일 fixed assignee는 날짜별 독립이며 daily_staff 선택일 검색을 유지한다", () => {
  const input = fixture();
  input.targets[0].days.push({ date: "2026-09-17", collaboratorUserIds: [3], reportWriterUserId: 3 });
  input.targets[0].fixedAssignments.push({ targetId: 10, measurementDate: "2026-09-17", assigneeUserId: 3, confirmedAt: "x", updatedAt: "x" });
  assert.deepEqual(resultFor(input).fixedAssignments.map((item) => [item.measurementDate, item.assigneeUserId]),
    [["2026-09-16", 1], ["2026-09-17", 3]]);
  const route = readFileSync("app/api/preliminary-survey-v2/reverse-planner/route.ts", "utf8");
  assert.match(route, /\.some\(\(day\) => day\.date === measurementDate\)/);
});

test("같은 실제 측정일 실제팀 이동 근거가 없으면 route required다", () => {
  const input = fixture({ actualMeasurementOccupancy: [{ targetId: 11, businessCode: "H0050", address: "대전 B",
    date: "2026-09-16", participantUserIds: [1] }] });
  assert.equal(resultFor(input).reason, "ROUTE_EVIDENCE_REQUIRED");
});

test("보고서 담당 null은 SOURCE_INVALID가 아니며 daily_staff 원천을 사용한다", () => {
  const snapshot = buildPlanningSnapshot({
    targets: [{ id: 10, code: "H0010", business_name: "사업장", address: "대전", measurement_date: "2026-09-16",
      measurer_id: null, collaborators: "강종구", daily_staff: null, business_type: "existing" }],
    users: users.map((user) => ({ id: user.id, name: user.name, is_active: user.active,
      is_preliminary_survey_experienced: user.experienced, survey_code: user.baseCode })),
    fixedAssignments: [{ measurement_target_business_id: 10, measurement_date: "2026-09-16", assignee_user_id: 1,
      confirmed_at: "x", updated_at: "x", source_snapshot: {} }],
    plans: [], assignments: [], scheduleBlocks: [], planningTargetIds: [10],
  });
  assert.notEqual(resultFor(snapshot).decision, "SOURCE_INVALID");
});

test("미존재 collaborator 또는 non-null 보고서 담당은 SOURCE_INVALID다", () => {
  for (const source of [
    { collaborators: "없는직원", measurer_id: null },
    { collaborators: "강종구", measurer_id: 999 },
  ]) {
    const snapshot = buildPlanningSnapshot({
      targets: [{ id: 10, code: "H0010", business_name: "사업장", address: "대전", measurement_date: "2026-09-16",
        daily_staff: null, business_type: "existing", ...source }],
      users: users.map((user) => ({ id: user.id, name: user.name, is_active: user.active,
        is_preliminary_survey_experienced: user.experienced, survey_code: user.baseCode })),
      fixedAssignments: [{ measurement_target_business_id: 10, measurement_date: "2026-09-16", assignee_user_id: 1,
        confirmed_at: "x", updated_at: "x", source_snapshot: {} }],
      plans: [], assignments: [], scheduleBlocks: [], planningTargetIds: [10],
    });
    assert.equal(resultFor(snapshot).decision, "SOURCE_INVALID");
    assert.equal(resultFor(snapshot).reason, "USER_NOT_FOUND");
  }
});

test("source 역할·external occupancy·fixed·route 변경은 fingerprint를 바꾼다", () => {
  const base = fixture();
  const fingerprint = planPreliminarySurveyGivenFixedAssignments(base).sourceFingerprint;
  const variants = [
    { ...fixture(), actualMeasurementOccupancy: [{ targetId: 99, businessCode: "H0099", address: "대전", date: "2026-08-27", participantUserIds: [2] }] },
    { ...fixture(), existingSurveyOccupancy: [{ targetId: 99, businessCode: "H0099", address: "대전", preliminaryDate: "2026-08-27",
      surveyMethod: "phone" as const, participantUserIds: [2, 1], responsibleUserId: 1, reviewerUserId: 2, writerUserId: 1, protected: false }] },
    { ...fixture(), routeEvidence: [{ date: "2026-08-27", leftTargetId: 10, rightTargetId: 99, sameAddress: false,
      durationMinutes: 20, provider: "vehicle", capturedAt: "x" }] },
  ];
  variants.forEach((variant) => assert.notEqual(planPreliminarySurveyGivenFixedAssignments(variant).sourceFingerprint, fingerprint));
});

test("8월 실제 측정대상과 8·9월 경계는 write 후보를 만들지 않고 9월 대상의 정상 8월 예비조사일은 허용한다", () => {
  const august = fixture();
  august.targets[0].days[0].date = "2026-08-31";
  august.targets[0].fixedAssignments[0].measurementDate = "2026-08-31";
  assert.equal(resultFor(august).reason, "TRANSITION_BOUNDARY_REVIEW_REQUIRED");
  assert.match(resultFor(fixture()).candidate?.preliminaryDate ?? "", /^2026-08-/);
});

test("legacy manual PATCH와 non-participant direct API 우회를 서버에서 차단한다", () => {
  const manualRoute = readFileSync("app/api/preliminary-survey-v2/[targetId]/route.ts", "utf8");
  const reverseRoute = readFileSync("app/api/preliminary-survey-v2/reverse-planner/route.ts", "utf8");
  assert.match(manualRoute, /LEGACY_MANUAL_PLAN_WRITE_DISABLED/);
  assert.match(reverseRoute, /NON_PARTICIPANT_ASSIGNEE_CONFIRMATION_REQUIRED/);
  assert.match(reverseRoute, /body\.nonParticipantConfirmed !== true/);
});

test("관리자 override는 구체 violation 확인·manual origin·audit로 분리된다", () => {
  const route = readFileSync("app/api/preliminary-survey-v2/reverse-planner/route.ts", "utf8");
  const ui = readFileSync("components/features/FixedAssigneeReversePlanner.tsx", "utf8");
  const migration = readFileSync("supabase/migrations/20260902150000_harden_reverse_planner_v1_1.sql", "utf8");
  assert.match(route, /MANUAL_OVERRIDE_CONFIRMATION_REQUIRED/);
  assert.match(route, /validateCandidateForSave/);
  assert.match(route, /result\.decision === "SOURCE_INVALID"/);
  assert.match(route, /target\.protected \? \["PROTECTED_PLAN_REQUIRES_REVIEW"\]/);
  assert.match(route, /PUBLIC_SAMPLE_PREVIEW_MISMATCH[\s\S]*status: 409/);
  assert.match(ui, /확인할 위반사항/);
  assert.match(migration, /ELSE ''manual'' END/);
  assert.match(migration, /PUBLIC_SAMPLE_PREVIEW_MISMATCH/);
});

test("migration은 additive·service-only·보호 code trigger·backfill 0이다", () => {
  const migration = readFileSync("supabase/migrations/20260902150000_harden_reverse_planner_v1_1.sql", "utf8")
    + readFileSync("supabase/migrations/20260902170000_serialize_reverse_planner_v1_1_apply.sql", "utf8")
    + readFileSync("supabase/migrations/20260902180000_validate_reverse_planner_occupancy_baseline.sql", "utf8")
    + readFileSync("supabase/migrations/20260902190000_complete_reverse_planner_source_baseline.sql", "utf8")
    + readFileSync("supabase/migrations/20260902200000_lock_reverse_planner_user_fixed_sources.sql", "utf8")
    + readFileSync("supabase/migrations/20260902210000_fix_reverse_planner_lock_aliases.sql", "utf8")
    + readFileSync("supabase/migrations/20260902220000_fix_reverse_planner_lock_key_precedence.sql", "utf8")
    + readFileSync("supabase/migrations/20260902230000_lock_reverse_planner_protection_sources.sql", "utf8")
    + readFileSync("supabase/migrations/20260902240000_fix_reverse_planner_reentrant_lock_precedence.sql", "utf8")
    + readFileSync("supabase/migrations/20260902250000_order_reverse_planner_table_locks.sql", "utf8")
    + readFileSync("supabase/migrations/20260902260000_support_automatic_reverse_planner_assignments.sql", "utf8");
  assert.match(migration, /CREATE TRIGGER trg_protect_preliminary_survey_v2_public_sample_code/);
  assert.match(migration, /PROTECTED_PLAN_REQUIRES_REVIEW/);
  assert.match(migration, /REVOKE ALL ON FUNCTION/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /OLD\.public_sample_code IS NULL/);
  assert.match(migration, /app\.preliminary_survey_admin_repair/);
  assert.match(migration, /source_actual_measurement_versions/);
  assert.match(migration, /source_users/);
  assert.match(migration, /source_fixed_versions/);
  assert.match(migration, /group_members AS/);
  assert.match(migration, /source_protected/);
  assert.match(migration, /SHARE ROW EXCLUSIVE MODE/);
  assert.match(migration, /assignment_origin/);
  assert.match(migration, /INVALID_ASSIGNMENT_ORIGIN/);
  assert.match(migration, /source_assignment_occupancy_versions/);
  assert.match(migration, /fixed\.measurement_target_business_id = assignment_plan\.measurement_target_business_id/);
  assert.ok(
    migration.lastIndexOf("LOCK TABLE public.measurement_target_business IN SHARE MODE")
      < migration.lastIndexOf("LOCK TABLE public.preliminary_survey_v2_plans IN SHARE ROW EXCLUSIVE MODE"),
    "target lifecycle writer와 동일하게 target을 plan보다 먼저 잠가야 한다",
  );
  assert.doesNotMatch(migration, /UPDATE public\.measurement_target_business|INSERT INTO public\.measurement_target_business/i);
});

test("automatic Apply 계약은 fixed row를 만들지 않고 confirmed만 fixed 존재를 요구한다", () => {
  const route = readFileSync("app/api/preliminary-survey-v2/reverse-planner/route.ts", "utf8");
  const migration = readFileSync("supabase/migrations/20260902260000_support_automatic_reverse_planner_assignments.sql", "utf8");
  assert.match(route, /assignment_origin: assignmentOrigin/);
  assert.match(route, /source_assignment_scope_keys/);
  assert.match(route, /source_assignment_occupancy_versions/);
  assert.match(migration, /item->>''assignment_origin'' = ''confirmed''[\s\S]*FIXED_ASSIGNEE_SOURCE_CHANGED/);
  assert.match(migration, /item->>''assignment_origin'' = ''automatic''[\s\S]*MESSAGE = ''SOURCE_CHANGED''/);
  assert.doesNotMatch(migration, /INSERT INTO public\.preliminary_survey_v2_fixed_assignments/i);
});


test("H0527 최초실시는 -3 → -20 후보순위를 보존해 2026-08-28을 먼저 선택한다", () => {
  const h0527 = target({
    businessType: "first_measurement",
    days: [{ date: "2026-09-02", collaboratorUserIds: [5], reportWriterUserId: 5 }],
    fixedAssignments: [{ targetId: 10, measurementDate: "2026-09-02", assigneeUserId: 5, confirmedAt: "x", updatedAt: "x" }],
  });
  const input = fixture({ targets: [h0527] });
  assert.equal(candidateDates("2026-09-02", "first_measurement").primary[0], "2026-08-28");
  const result = resultFor(input);
  assert.equal(result.decision, "AUTO_ASSIGNED");
  assert.equal(result.candidate?.preliminaryDate, "2026-08-28");
});

test("사용자 검토 수정안은 forced candidate로 batch 재계산되어 선택값을 보존한다", () => {
  const h0527 = target({
    businessType: "first_measurement",
    days: [{ date: "2026-09-02", collaboratorUserIds: [5], reportWriterUserId: 5 }],
    fixedAssignments: [{ targetId: 10, measurementDate: "2026-09-02", assigneeUserId: 5, confirmedAt: "x", updatedAt: "x" }],
  });
  const input = fixture({ targets: [h0527] });
  const base = resultFor(input).candidate!;
  const forced = { ...base, preliminaryDate: candidateDates("2026-09-02", "first_measurement").primary[1],
    objective: [0, 0, 0, 0, 0, 0] as const, reasons: ["USER_REVIEW_ADJUSTMENT"] };
  const output = planPreliminarySurveyGivenFixedAssignments(input, { forcedCandidates: new Map([[10, forced]]) });
  assert.equal(output.results[0].decision, "AUTO_ASSIGNED");
  assert.equal(output.results[0].candidate?.preliminaryDate, forced.preliminaryDate);
});

test("자동배정 UI는 정상 30분 이하 차량값을 숨기고 8개까지 내부 세로스크롤을 끈다", () => {
  const ui = readFileSync("components/features/FixedAssigneeReversePlanner.tsx", "utf8");
  const route = readFileSync("app/api/preliminary-survey-v2/reverse-planner/route.ts", "utf8");
  assert.match(ui, /item\.durationMinutes == null \|\| item\.durationMinutes > 30/);
  assert.match(ui, /동선 검토/);
  assert.match(ui, /동선 불가/);
  assert.doesNotMatch(ui, /item\.durationMinutes <= 30 \? `차량/);
  assert.match(ui, /snapshotTargetCount > 8 \? "enabled" : "disabled"/);
  assert.match(ui, /reviewAdjustments: \[\.\.\.reviewAdjustments\.values\(\)\]/);
  assert.match(ui, /배정 확정 전에는 저장되지 않습니다/);
  assert.match(route, /body\.action !== "validate_adjustment"/);
  assert.match(route, /USER_REVIEW_ADJUSTMENT/);
  assert.match(route, /forcedCandidates: parsedReview\.candidates/);
});


test("H0527 수정 추천 pool은 최초실시 상위 3개 날짜를 -3 → -5 순으로 보존한다", () => {
  const h0527 = target({
    businessType: "first_measurement",
    days: [{ date: "2026-09-02", collaboratorUserIds: [5], reportWriterUserId: 5 }],
    fixedAssignments: [{ targetId: 10, measurementDate: "2026-09-02", assigneeUserId: 5, confirmedAt: "x", updatedAt: "x" }],
  });
  const input = fixture({ targets: [h0527] });
  const dates = [...new Set(rankedCandidatesForTarget(input, h0527).map((candidate) => candidate.preliminaryDate))].slice(0, 3);
  assert.deepEqual(dates, ["2026-08-28", "2026-08-27", "2026-08-26"]);
});

test("자동배정 검토 UI는 업체구분·출처·추천3안·route 환경진단·모달 무스크롤 계약을 가진다", () => {
  const ui = readFileSync("components/features/FixedAssigneeReversePlanner.tsx", "utf8");
  const route = readFileSync("app/api/preliminary-survey-v2/reverse-planner/route.ts", "utf8");
  const modal = readFileSync("components/ui/Modal.tsx", "utf8");
  const env = readFileSync(".env.example", "utf8");
  assert.match(ui, /first_measurement: "최초실시"/);
  assert.match(ui, /candidate \? "자동계산"/);
  assert.match(ui, /action: "suggest_adjustments"/);
  assert.match(ui, /지침에 맞는 추천 후보/);
  assert.match(ui, /bodyScroll=\{false\}/);
  assert.match(ui, /collapseRouteWarnings/);
  assert.match(ui, /visibleRouteWarnings/);
  assert.match(route, /body\.action !== "suggest_adjustments"/);
  assert.match(route, /rankedCandidatesForTarget/);
  assert.match(route, /preferred\.slice\(0, 3\)/);
  assert.match(route, /routeProviderConfigured: Boolean\(process\.env\.KAKAO_REST_API_KEY\)/);
  assert.match(modal, /bodyScroll\?: boolean/);
  assert.match(modal, /bodyScroll \? "overflow-y-auto custom-scrollbar" : "overflow-hidden"/);
  assert.match(env, /Vercel Preview[\s\S]*KAKAO_REST_API_KEY/);
});

test("v1.1 정상 Apply만 재활성화하고 legacy manual write는 계속 차단한다", () => {
  const route = readFileSync("app/api/preliminary-survey-v2/reverse-planner/route.ts", "utf8");
  const ui = readFileSync("components/features/FixedAssigneeReversePlanner.tsx", "utf8");
  assert.doesNotMatch(route, /REVERSE_PLANNER_APPLY_TEMPORARILY_DISABLED/);
  assert.match(route, /body\.action !== "apply"/);
  assert.match(ui, />\s*배정 확정\s*</);
});
