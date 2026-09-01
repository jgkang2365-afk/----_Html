import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPlanningSnapshot } from "../lib/preliminary-survey-v2/reverse-planner/snapshot";
import { candidateDates } from "../lib/preliminary-survey-v2/reverse-planner/candidate-dates";
import { normalizePublicSampleCodes } from "../lib/preliminary-survey-v2/reverse-planner/public-sample-code";
import { planPreliminarySurveyGivenFixedAssignments, validateCandidateHardRules } from "../lib/preliminary-survey-v2/reverse-planner/solver";
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

test("우선 reviewer가 불가하면 다른 경력자를 탐색한다", () => {
  const input = fixture({ scheduleBlocks: [{ userId: 2, startDate: "2026-08-01", endDate: "2026-09-30" }] });
  assert.equal(resultFor(input).candidate?.reviewerUserId, 4);
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

test("fixed assignee와 예비조사자가 달라도 collaborator 교집합으로 정상이다", () => {
  const input = fixture({ targets: [target({
    days: [{ date: "2026-09-16", collaboratorUserIds: [1], reportWriterUserId: 1 }],
    fixedAssignments: [{ targetId: 10, measurementDate: "2026-09-16", assigneeUserId: 3, confirmedAt: "x", updatedAt: "x" }],
  })] });
  assert.equal(resultFor(input).decision, "AUTO_ASSIGNED");
  assert.ok(resultFor(input).candidate?.participantUserIds.includes(1));
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

test("C/CC/CCC Preview는 batch 밖 persisted 그룹까지 natural sort한다", () => {
  const input = fixture({ targets: [target({ code: "H0002" })], existingPublicSampleAssignments: [{
    targetId: 20, businessCode: "H0001", measurementDate: "2026-09-16", assigneeUserId: 1,
    surveyCode: "C", publicSampleCode: "C", protected: false,
  }] });
  assert.equal(resultFor(input).publicSampleAssignments[0].publicSampleCode, "CC");
  const direct = normalizePublicSampleCodes({ targets: [...input.targets].reverse(), users: [...users].reverse(),
    existingAssignments: [...input.existingPublicSampleAssignments].reverse() });
  assert.deepEqual(direct.map((item) => item.publicSampleCode), ["C", "CC"]);
});

test("보호 plan code group 자동변경은 MANUAL_REQUIRED다", () => {
  const input = fixture({ targets: [target({ code: "H0001" })], existingPublicSampleAssignments: [{
    targetId: 20, businessCode: "H0002", measurementDate: "2026-09-16", assigneeUserId: 1,
    surveyCode: "C", publicSampleCode: "C", protected: true,
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
  assert.match(ui, /저장 전 확인할 위반사항/);
  assert.match(migration, /ELSE ''manual'' END/);
  assert.match(migration, /PUBLIC_SAMPLE_PREVIEW_MISMATCH/);
});

test("migration은 additive·service-only·보호 code trigger·backfill 0이다", () => {
  const migration = readFileSync("supabase/migrations/20260902150000_harden_reverse_planner_v1_1.sql", "utf8");
  assert.match(migration, /CREATE TRIGGER trg_protect_preliminary_survey_v2_public_sample_code/);
  assert.match(migration, /PROTECTED_PLAN_REQUIRES_REVIEW/);
  assert.match(migration, /REVOKE ALL ON FUNCTION/);
  assert.doesNotMatch(migration, /UPDATE public\.measurement_target_business|INSERT INTO public\.measurement_target_business/i);
});

test("v1.1 정상 Apply만 재활성화하고 legacy manual write는 계속 차단한다", () => {
  const route = readFileSync("app/api/preliminary-survey-v2/reverse-planner/route.ts", "utf8");
  const ui = readFileSync("components/features/FixedAssigneeReversePlanner.tsx", "utf8");
  assert.doesNotMatch(route, /REVERSE_PLANNER_APPLY_TEMPORARILY_DISABLED/);
  assert.match(route, /body\.action !== "apply"/);
  assert.match(ui, />\s*정상안 적용\s*</);
});
