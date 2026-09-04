import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assignMeasurementAssignees,
  buildMeasurementAssignmentTargets,
  collectMeasurementVehicleRouteEvidence,
  MEASUREMENT_ASSIGNMENT_CAPACITY_CODE,
  MeasurementAssignmentDailyLimitError,
  type MeasurementAssigneeUser,
  type MeasurementVehicleRouteEvidence,
} from "../lib/preliminary-survey-v2/measurement-assignment";
import {
  canonicalizeWorkbenchDraft,
  sameCanonicalWorkbenchDraft,
} from "../lib/preliminary-survey-v2/draft-canonical";
import { exactMeasurementAssignmentReference } from "./helpers/measurement-assignment-reference";

const codes = ["A", "B", "C", "D", "F", "G"] as const;
const users = codes.map((surveyCode, index) => ({ id: index + 1, name: `측정자${index + 1}`, surveyCode, active: true }));
const target = (targetId: number, address = `충남 천안시 ${targetId}`, measurementDate = "2026-08-25") => ({
  targetId, measurementDate, address,
  coordinate: { latitude: 36.8 + targetId / 1000, longitude: 127.1 },
});

test("공시료 코드는 이름 상수가 아니라 사용자 surveyCode(A/B/C/D/F/G)만 사용한다", () => {
  const result = assignMeasurementAssignees({ targets: [target(1)], users: [{ ...users[0], name: "이름 변경" }] });
  assert.equal(result[0].publicSampleCode, "A");
  assert.equal(assignMeasurementAssignees({ targets: [target(2)], users: [{ ...users[0], surveyCode: null }] }).length, 0);
});

test("측정자·공시료 배정은 직원 제외 일정의 사용자를 후보에서 제외한다", () => {
  const result = assignMeasurementAssignees({
    targets: [target(1)],
    users: users.slice(0, 2),
    availability: { isBlocked: (userId, date) => userId === 1 && date === "2026-08-25" },
  });
  assert.equal(result[0]?.userId, 2);
  assert.deepEqual(assignMeasurementAssignees({
    targets: [target(1)], users: users.slice(0, 2), availability: { isBlocked: () => true },
  }), []);
});

test("6개 업체는 측정자 6명에게 1개씩 균등 배정한다", () => {
  const result = assignMeasurementAssignees({ targets: users.map((_, index) => target(index + 1)), users });
  assert.deepEqual(result.map((item) => item.dailyCount), [1, 1, 1, 1, 1, 1]);
  assert.equal(new Set(result.map((item) => item.userId)).size, 6);
});

test("역할 연계가 일치하면 균형 범위 안에서 해당 측정자·공시료 담당자를 선택한다", () => {
  const targets = users.map((user, index) => ({
    ...target(index + 1),
    reportWriterUserId: user.id,
    measurementParticipantUserIds: [user.id],
    preliminarySurveyorUserId: user.id,
  }));
  const result = assignMeasurementAssignees({ targets: [...targets].reverse(), users });
  assert.equal(new Set(result.map((item) => item.userId)).size, 6);
  assert.deepEqual(result.map((item) => [item.targetId, item.userId]), targets.map((item) => [item.targetId, item.reportWriterUserId]));
});

test("전체 batch에서 측정 참여자·보고서 담당자 정합성이 균등 1회전보다 우선한다", () => {
  const result = assignMeasurementAssignees({
    targets: users.map((_, index) => ({
      ...target(index + 1), reportWriterUserId: 1,
      measurementParticipantUserIds: [1], preliminarySurveyorUserId: 1,
    })),
    users,
  });
  assert.equal(new Set(result.map((item) => item.userId)).size, 4);
  assert.equal(result.filter((item) => item.userId === 1).length, 3);
});

test("실제 6개 업체 역할 충돌에서도 A/B/C/D/F/G를 한 번씩 사용한다", () => {
  const result = assignMeasurementAssignees({
    targets: [
      { ...target(290), businessCode: "H0290", reportWriterUserId: 2, measurementParticipantUserIds: [2], preliminarySurveyorUserId: 2 },
      { ...target(200), businessCode: "H0200", reportWriterUserId: 3, measurementParticipantUserIds: [3], preliminarySurveyorUserId: 1 },
      // 두 이름 표시 중 책임 예비조사자만 preference에 넣고 reviewer는 제외한다.
      { ...target(226), businessCode: "H0226", reportWriterUserId: 3, measurementParticipantUserIds: [3], preliminarySurveyorUserId: 3 },
      { ...target(188), businessCode: "H0188", reportWriterUserId: 5, measurementParticipantUserIds: [5], preliminarySurveyorUserId: 4 },
      // 두 이름 표시 중 책임 예비조사자만 preference에 넣고 reviewer는 제외한다.
      { ...target(100), businessCode: "H0100", reportWriterUserId: 5, measurementParticipantUserIds: [5], preliminarySurveyorUserId: 5 },
      { ...target(101), businessCode: "H0101", reportWriterUserId: 5, measurementParticipantUserIds: [5], preliminarySurveyorUserId: 6 },
    ].map((item) => ({ ...item, measurementDate: "2026-08-24" })),
    users,
  });
  assert.deepEqual(result.map((item) => [item.targetId, item.userId, item.publicSampleCode]), [
    [100, 5, "F"], [101, 5, "F"], [188, 5, "F"], [200, 3, "C"], [226, 3, "C"], [290, 2, "B"],
  ]);
  assert.equal(result.find((item) => item.targetId === 200)?.userId, 3,
    "공시료 자동배정은 예비조사 책임자 결과를 입력으로 사용하지 않는다");
});

test("추천과 Apply는 공통 builder로 역할 필드가 같은 canonical target을 만든다", () => {
  const source = {
    id: 200,
    code: "H0200",
    address: "충남 아산시 인주면",
    coordinate: { latitude: 36.8, longitude: 126.9 },
    region: "충남 아산시",
    measurementAssignmentDates: ["2026-08-24"],
    measurementStaffByDate: [{
      date: "2026-08-24",
      reportWriterUserId: 3,
      measurementParticipantUserIds: [3],
    }],
  };
  const recommendationTargets = buildMeasurementAssignmentTargets({ target: source, preliminarySurveyorUserId: 1 });
  const applyTargets = buildMeasurementAssignmentTargets({ target: { ...source }, preliminarySurveyorUserId: 1 });

  assert.deepEqual(applyTargets, recommendationTargets);
  assert.deepEqual(applyTargets[0], {
    targetId: 200,
    measurementDate: "2026-08-24",
    address: "충남 아산시 인주면",
    coordinate: { latitude: 36.8, longitude: 126.9 },
    businessCode: "H0200",
    region: "충남 아산시",
    reportWriterUserId: 3,
    measurementParticipantUserIds: [3],
    preliminarySurveyorUserId: 1,
  });
});

test("공시료 후보는 측정 참여자·보고서 담당자 정합성을 선호한다", () => {
  const [result] = assignMeasurementAssignees({
    targets: [{
      ...target(1), preliminarySurveyorUserId: 2,
      measurementParticipantUserIds: [1], reportWriterUserId: 1,
    }],
    users: users.slice(0, 2),
    existing: [{ ...target(100), userId: 2 }],
  });
  assert.equal(result.userId, 1);
  assert.equal(result.dailyCount, 1);
  assert.equal(result.approvalRequired, false);
});

test("예비조사 책임자 필드는 공시료 자동배정 입력으로 사용하지 않는다", () => {
  const [result] = assignMeasurementAssignees({
    targets: [{
      ...target(1), preliminarySurveyorUserId: 3,
      measurementParticipantUserIds: [2], reportWriterUserId: 1,
    }],
    users: users.slice(0, 3),
    availability: { isBlocked: (userId) => userId === 3 },
  });
  assert.equal(result.userId, 2);
});

test("예비조사 책임자 변경은 공시료 자동배정 결과에 영향을 주지 않는다", () => {
  const address = "충남 천안시 동일주소 20";
  const base = {
    targets: [
      { ...target(1, address), measurementParticipantUserIds: [1], reportWriterUserId: 2, preliminarySurveyorUserId: 1 },
      { ...target(2, address), measurementParticipantUserIds: [2], reportWriterUserId: 1, preliminarySurveyorUserId: 2 },
    ],
    users: users.slice(0, 2),
  };
  const result = assignMeasurementAssignees(base);
  const changed = assignMeasurementAssignees({ ...base, targets: base.targets.map((item) => ({ ...item, preliminarySurveyorUserId: 6 })) });
  assert.deepEqual(changed.map((item) => [item.targetId, item.userId]), result.map((item) => [item.targetId, item.userId]));
});

test("공통 builder는 다일 측정의 날짜별 보고서 담당자와 참여자를 섞지 않는다", () => {
  const targets = buildMeasurementAssignmentTargets({
    target: {
      id: 1, code: "H0001", address: null, coordinate: null, region: null,
      measurementAssignmentDates: ["2026-08-24", "2026-08-25"],
      measurementStaffByDate: [
        { date: "2026-08-24", reportWriterUserId: 1, measurementParticipantUserIds: [2] },
        { date: "2026-08-25", reportWriterUserId: 3, measurementParticipantUserIds: [4, 5] },
      ],
    },
    preliminarySurveyorUserId: 6,
  });
  assert.deepEqual(targets.map((item) => [
    item.measurementDate, item.reportWriterUserId, item.measurementParticipantUserIds,
  ]), [
    ["2026-08-24", 1, [2]],
    ["2026-08-25", 3, [4, 5]],
  ]);
});

test("Apply canonical E2E: 원천이 같으면 검토 draft를 그대로 적용하고 실제 변경만 재검토한다", () => {
  const sourceTargets = [
    [290, "H0290", 2, [2], 2],
    [200, "H0200", 3, [3], 1],
    [226, "H0226", 3, [3], 3],
    [188, "H0188", 5, [5], 4],
    [100, "H0100", 5, [5], 5],
    [101, "H0101", 5, [5], 6],
  ] as const;
  const canonicalTargets = sourceTargets.flatMap(([id, code, reportWriterUserId, participantIds, responsibleId]) =>
    buildMeasurementAssignmentTargets({
      target: {
        id, code, address: `주소 ${code}`, coordinate: null, region: "충남",
        measurementAssignmentDates: ["2026-08-24"],
        measurementStaffByDate: [{
          date: "2026-08-24",
          reportWriterUserId,
          measurementParticipantUserIds: [...participantIds],
        }],
      },
      preliminarySurveyorUserId: responsibleId,
    }));
  const toDraft = (assignments: ReturnType<typeof assignMeasurementAssignees>) => canonicalizeWorkbenchDraft({
    scope: {
      measurementDateFrom: "2026-08-24", measurementDateTo: "2026-08-24",
      preliminaryDateFrom: null, preliminaryDateTo: null,
    },
    surveys: [],
    measurementAssignments: assignments.map((assignment) => ({
      targetId: assignment.targetId,
      measurementDate: assignment.measurementDate,
      userId: assignment.userId,
      userName: assignment.userName,
      surveyCode: assignment.publicSampleCode,
      approvalRequired: assignment.approvalRequired,
      reason: assignment.reason,
    })),
  });
  const reviewedDraft = toDraft(assignMeasurementAssignees({ targets: canonicalTargets, users }));
  const unchangedApplyRecalculation = toDraft(assignMeasurementAssignees({ targets: canonicalTargets, users }));

  assert.equal(sameCanonicalWorkbenchDraft(reviewedDraft, unchangedApplyRecalculation), true,
    "동일 원천에서 target shape 차이만으로 DRAFT_REVIEW_REQUIRED가 발생하면 안 된다");
  assert.deepEqual(unchangedApplyRecalculation.measurementAssignments, reviewedDraft.measurementAssignments);

  const changedTargets = canonicalTargets.map((item) => item.targetId === 200
    ? { ...item, measurementDate: "2026-08-25" } : item);
  const changedApplyRecalculation = toDraft(assignMeasurementAssignees({ targets: changedTargets, users }));
  assert.equal(sameCanonicalWorkbenchDraft(reviewedDraft, changedApplyRecalculation), false,
    "실제 역할 원천이 바뀌면 기존 stale draft 재검토 안전장치가 유지되어야 한다");
});

test("8개 업체는 2/2/1/1/1/1로 자동 배정하고 별도 3건째는 승인을 요구한다", () => {
  const result = assignMeasurementAssignees({ targets: Array.from({ length: 8 }, (_, index) => target(index + 1)), users });
  const counts = users.map((user) => result.filter((item) => item.userId === user.id).length).sort((a, b) => b - a);
  assert.deepEqual(counts, [2, 2, 1, 1, 1, 1]);
  assert.equal(result.some((item) => item.approvalRequired), false);
  const overflow = assignMeasurementAssignees({ targets: [target(20)], users, existing: users.flatMap((user, index) => [
    { ...target(100 + index), userId: user.id }, { ...target(200 + index), userId: user.id },
  ]) });
  assert.equal(overflow[0].dailyCount, 3);
  assert.equal(overflow[0].approvalRequired, true);
  assert.equal(overflow[0].reason, "3건 승인 필요");
});

test("같은 측정일 측정자 4건째는 승인 여부와 무관하게 planner에서 차단한다", () => {
  assert.throws(
    () => assignMeasurementAssignees({
      targets: [target(400)],
      users: [users[0]],
      existing: [1, 2, 3].map((id) => ({ ...target(id), userId: users[0].id })),
    }),
    (error: unknown) => error instanceof MeasurementAssignmentDailyLimitError &&
      error.code === MEASUREMENT_ASSIGNMENT_CAPACITY_CODE,
  );
});

test("같은 날짜 전체 기존 배정 중 동일주소를 우선한다", () => {
  const address = "충남 천안시 동일주소 1";
  const existing = users.map((user, index) => ({ ...target(100 + index, index === 2 ? address : `주소${index}`), userId: user.id }));
  const [result] = assignMeasurementAssignees({ targets: [target(1, address)], users, existing });
  assert.equal(result.userId, users[2].id);
  assert.equal(result.reason, "동일주소 묶음");
});

test("실제 vehicle 경로 evidence가 있을 때만 근거리 묶음을 우선한다", () => {
  const existing = users.map((user, index) => ({ ...target(100 + index, `주소 ${index}`), userId: user.id }));
  const routeEvidence: MeasurementVehicleRouteEvidence[] = [{
    fromTargetId: 1, fromMeasurementDate: "2026-08-25", toTargetId: 101, toMeasurementDate: "2026-08-25",
    source: "vehicle", durationMinutes: 12, allowed: true,
  }];
  const [result] = assignMeasurementAssignees({ targets: [target(1, "주소 C")], users, existing, routeEvidence });
  assert.equal(result.userId, users[1].id);
  assert.equal(result.reason, "근거리 묶음");
});

test("route provider의 실제 차량시간만 허용 evidence로 변환한다", async () => {
  const evidence = await collectMeasurementVehicleRouteEvidence({
    targets: [target(1)],
    existing: [{ ...target(2), userId: 1 }],
    routes: { between: async () => ({ source: "vehicle", durationMinutes: 12, distanceKm: 5, sameRegion: true }) },
  });
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].allowed, true);
  assert.equal(evidence[0].durationMinutes, 12);
});

test("직선거리 fallback은 근거리 허용 evidence가 아니다", async () => {
  const evidence = await collectMeasurementVehicleRouteEvidence({
    targets: [target(1)],
    existing: [{ ...target(2), userId: 1 }],
    routes: { between: async () => ({ source: "distance", durationMinutes: null, distanceKm: 1, sameRegion: true }) },
  });
  assert.equal(evidence[0].allowed, false);
  assert.equal(evidence[0].source, "unknown");
});

test("다일 대상은 같은 targetId라도 measurementDate별 결과를 각각 반환한다", () => {
  const result = assignMeasurementAssignees({
    targets: [target(1, "첫째날", "2026-08-25"), target(1, "둘째날", "2026-08-26")], users,
  });
  assert.deepEqual(result.map((item) => [item.targetId, item.measurementDate]), [[1, "2026-08-25"], [1, "2026-08-26"]]);
  assert.deepEqual(result.map((item) => item.publicSampleCode), ["A", "A"]);
});

test("Reverse Planner 자동모드에서는 3번째 공시료 자동배정을 만들지 않는다", () => {
  const result = assignMeasurementAssignees({
    targets: [target(20)], users: users.slice(0, 1), requireRouteForSecond: true, allowThirdWithApproval: false,
    existing: [{ ...target(100), userId: 1 }, { ...target(101), userId: 1 }],
    routeEvidence: [{
      fromTargetId: 20, fromMeasurementDate: "2026-08-25", toTargetId: 100, toMeasurementDate: "2026-08-25",
      source: "vehicle", durationMinutes: 12, allowed: true,
    }],
  });
  assert.equal(result.length, 0);
});

test("route 부담은 균등배분보다 먼저 비교한다", () => {
  const [result] = assignMeasurementAssignees({
    targets: [{ ...target(1), measurementParticipantUserIds: [], reportWriterUserId: null }],
    users: users.slice(0, 2), requireRouteForSecond: true,
    existing: [{ ...target(100), userId: 1 }, { ...target(101), userId: 2 }],
    routeEvidence: [
      { fromTargetId: 1, fromMeasurementDate: "2026-08-25", toTargetId: 100, toMeasurementDate: "2026-08-25", source: "vehicle", durationMinutes: 5, allowed: true },
      { fromTargetId: 1, fromMeasurementDate: "2026-08-25", toTargetId: 101, toMeasurementDate: "2026-08-25", source: "vehicle", durationMinutes: 40, allowed: true },
    ],
  });
  assert.equal(result.userId, 1);
  assert.equal(result.reason, "근거리 묶음");
});

test("완전 배정이 불가능해도 중간 target을 건너뛰고 뒤의 최적 partial을 계속 찾는다", () => {
  const result = assignMeasurementAssignees({
    targets: [target(1), target(2), target(3)], users: users.slice(0, 2),
    requireRouteForSecond: true, allowThirdWithApproval: false,
    existing: [{ ...target(100), userId: 1 }, { ...target(101), userId: 2 }],
    routeEvidence: [
      { fromTargetId: 1, fromMeasurementDate: "2026-08-25", toTargetId: 100, toMeasurementDate: "2026-08-25", source: "vehicle", durationMinutes: 5, allowed: true },
      { fromTargetId: 3, fromMeasurementDate: "2026-08-25", toTargetId: 101, toMeasurementDate: "2026-08-25", source: "vehicle", durationMinutes: 8, allowed: true },
    ],
  });
  assert.deepEqual(result.map((item) => item.targetId), [1, 3]);
  assert.deepEqual(result.map((item) => [item.dailyCount, item.reason]), [[2, "근거리 묶음"], [2, "근거리 묶음"]]);
});

test("route 근거가 필요 없는 legacy 두 번째 배정은 일반 2건 배정으로 표시한다", () => {
  const [result] = assignMeasurementAssignees({
    targets: [target(1)], users: users.slice(0, 1), existing: [{ ...target(100), userId: 1 }],
  });
  assert.equal(result.dailyCount, 2);
  assert.equal(result.reason, "2건 배정");
});

const allowedBatchRoutes = (targetIds: number[], date = "2026-08-25"): MeasurementVehicleRouteEvidence[] =>
  targetIds.flatMap((fromTargetId, fromIndex) => targetIds.slice(fromIndex + 1).map((toTargetId) => ({
    fromTargetId, fromMeasurementDate: date, toTargetId, toMeasurementDate: date,
    source: "vehicle" as const, durationMinutes: 20, allowed: true,
  })));

test("4개 업체 batch는 특별한 정합성 우위가 없으면 1인 1건으로 분산한다", () => {
  const targets = Array.from({ length: 4 }, (_, i) => target(i + 1));
  const result = assignMeasurementAssignees({ targets, users, requireRouteForSecond: true });
  assert.deepEqual(result.map((item) => item.dailyCount), [1, 1, 1, 1]);
  assert.deepEqual(result.map((item) => item.userId), exactMeasurementAssignmentReference({ targets, users })?.ids);
});

test("7개 업체 batch는 전체 관계를 보고 한 건만 2번째로 배정한다", () => {
  const targets = Array.from({ length: 7 }, (_, i) => target(i + 1));
  const routeEvidence = allowedBatchRoutes(targets.map((item) => item.targetId)).map((route) => ({ ...route,
    durationMinutes: route.fromTargetId === 6 && route.toTargetId === 7 ? 5
      : route.fromTargetId === 1 && route.toTargetId === 2 ? 17 : 42 }));
  const result = assignMeasurementAssignees({ targets, users, requireRouteForSecond: true, routeEvidence });
  assert.equal(result.length, 7);
  assert.deepEqual(users.map((user) => result.filter((item) => item.userId === user.id).length).sort((a, b) => b - a), [2, 1, 1, 1, 1, 1]);
  const duplicated = users.map((user) => result.filter((item) => item.userId === user.id))
    .find((items) => items.length === 2)!;
  assert.deepEqual(duplicated.map((item) => item.targetId), [6, 7]);
  assert.deepEqual(result.map((item) => item.userId), exactMeasurementAssignmentReference({ targets, users, evidence: routeEvidence })?.ids);
});

test("8개 업체 batch는 두 건의 중복을 전체 최적화하고 결정론적으로 반환한다", () => {
  const targets = Array.from({ length: 8 }, (_, i) => target(i + 1));
  const routeEvidence = allowedBatchRoutes(targets.map((item) => item.targetId)).map((route) => ({ ...route,
    durationMinutes: route.fromTargetId === 1 && route.toTargetId === 2 ? 5
      : route.fromTargetId === 7 && route.toTargetId === 8 ? 6 : 42 }));
  const input = { targets, users, requireRouteForSecond: true, routeEvidence };
  const first = assignMeasurementAssignees(input);
  const second = assignMeasurementAssignees({ ...input, targets: [...targets].reverse() });
  assert.deepEqual(users.map((user) => first.filter((item) => item.userId === user.id).length).sort((a, b) => b - a), [2, 2, 1, 1, 1, 1]);
  assert.deepEqual(users.map((user) => first.filter((item) => item.userId === user.id).map((item) => item.targetId))
    .filter((items) => items.length === 2).sort((a, b) => a[0] - b[0]), [[1, 2], [7, 8]]);
  assert.deepEqual(first.map((item) => item.userId), exactMeasurementAssignmentReference({ targets, users, evidence: routeEvidence })?.ids);
  assert.deepEqual(first.map((item) => [item.targetId, item.userId]), second.map((item) => [item.targetId, item.userId]));
});

test("route evidence가 없는 2번째 배정은 자동 batch에서 만들지 않는다", () => {
  const targets = Array.from({ length: 7 }, (_, i) => target(i + 1));
  const result = assignMeasurementAssignees({ targets, users, requireRouteForSecond: true });
  assert.equal(result.length, 6);
  assert.equal(result.some((item) => item.dailyCount > 1), false);
});

test("4·7·8개 production optimizer는 독립 exact reference와 같은 해를 선택한다", () => {
  for (const count of [4, 7, 8]) {
    const referenceUsers = users.slice(0, 4);
    const targets = Array.from({ length: count }, (_, index) => ({
      ...target(index + 1), measurementParticipantUserIds: [referenceUsers[index % 4].id],
      reportWriterUserId: referenceUsers[(index + 1) % 4].id,
    }));
    const evidence = allowedBatchRoutes(targets.map((item) => item.targetId));
    const actual = assignMeasurementAssignees({ targets, users: referenceUsers, requireRouteForSecond: true,
      allowThirdWithApproval: false, routeEvidence: evidence });
    assert.deepEqual(actual.map((item) => item.userId), exactMeasurementAssignmentReference({
      targets, users: referenceUsers, evidence,
    })?.ids, `${count}개 exact reference`);
  }
});

test("seeded random small batch 30건은 독립 exact reference optimum과 일치한다", () => {
  let seed = 0x96_15_03;
  const random = () => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  for (let caseIndex = 0; caseIndex < 30; caseIndex += 1) {
    const userCount = 2 + Math.floor(random() * 4);
    const targetCount = 2 + Math.floor(random() * Math.min(6, userCount * 2 - 1));
    const caseUsers = users.slice(0, userCount);
    const targets = Array.from({ length: targetCount }, (_, index) => ({
      ...target(1_000 + caseIndex * 10 + index),
      measurementParticipantUserIds: [caseUsers[Math.floor(random() * userCount)].id],
      reportWriterUserId: caseUsers[Math.floor(random() * userCount)].id,
    }));
    const evidence = targets.flatMap((left, index) => targets.slice(index + 1).map((right) => ({
      fromTargetId: left.targetId, fromMeasurementDate: left.measurementDate,
      toTargetId: right.targetId, toMeasurementDate: right.measurementDate,
      source: "vehicle" as const, durationMinutes: 3 + Math.floor(random() * 50), allowed: true,
    })));
    const expected = exactMeasurementAssignmentReference({ targets, users: caseUsers, evidence });
    const actual = assignMeasurementAssignees({ targets, users: caseUsers, routeEvidence: evidence,
      requireRouteForSecond: true, allowThirdWithApproval: false });
    assert.ok(expected, `seeded case ${caseIndex} reference complete`);
    assert.deepEqual(actual.map((item) => item.userId), expected.ids, `seeded case ${caseIndex}`);
  }
});

test("9개 clean sample은 실제 upstream 주소·참여자·보고서 담당자만 사용한다", () => {
  const rawUpstream = readFileSync(new URL("./fixtures/preliminary-survey-2026-08-21-clean-upstream.json", import.meta.url), "utf8");
  const upstream = JSON.parse(rawUpstream) as { sourceDate: string; users: MeasurementAssigneeUser[]; targets: Array<{
    targetId: number; businessCode: string; businessName: string; address: string;
    coordinate: { latitude: number; longitude: number }; measurementParticipantUserIds: number[]; reportWriterUserId: number;
  }> };
  const matrix = JSON.parse(readFileSync(new URL("./fixtures/preliminary-survey-2026-08-21-route-matrix.json", import.meta.url), "utf8")) as {
    provider: string; capturedAt: string; directionalCalls: number;
    pairs: Array<{ left: string; right: string; effectiveMinutes: number; allowed: boolean }>;
  };
  const targetIdByCode = new Map(upstream.targets.map((item) => [item.businessCode, item.targetId]));
  const targets = upstream.targets.map((item) => ({ ...item, measurementDate: upstream.sourceDate }));
  const routeEvidence = matrix.pairs.map((pair) => ({
    fromTargetId: targetIdByCode.get(pair.left)!, fromMeasurementDate: upstream.sourceDate,
    toTargetId: targetIdByCode.get(pair.right)!, toMeasurementDate: upstream.sourceDate,
    source: "vehicle" as const, durationMinutes: pair.effectiveMinutes, allowed: pair.allowed,
  }));
  const input = { targets, users: upstream.users, requireRouteForSecond: true, allowThirdWithApproval: false, routeEvidence };
  const result = assignMeasurementAssignees(input);
  assert.equal(result.length, 9);
  assert.equal(result.every((item) => item.dailyCount <= 2), true);
  assert.equal(result.filter((item) => targets.find((target) => target.targetId === item.targetId)?.measurementParticipantUserIds?.includes(item.userId)).length, 9);
  assert.equal(targets.some((item) => item.address.startsWith("주소 ")), false);
  assert.equal(matrix.provider, "kakao-mobility-directions-v1");
  assert.equal(matrix.pairs.length, 36);
  assert.equal(matrix.directionalCalls, 72);
  assert.ok(new Set(matrix.pairs.map((pair) => pair.effectiveMinutes)).size > 3,
    "실제 route matrix를 임의의 동일/3단계 synthetic 시간으로 대체하지 않는다");
  assert.equal(/fixedAssignments|measurementAssignments|preliminarySurveyor|publicSample/i.test(rawUpstream), false,
    "clean upstream fixture에는 과거 공시료·예비조사 downstream을 넣지 않는다");
  assert.deepEqual(result.map((item) => item.userId), exactMeasurementAssignmentReference({
    targets, users: upstream.users, evidence: routeEvidence,
  })?.ids);
  assert.deepEqual(result.map((item) => [item.targetId, item.userId]), assignMeasurementAssignees({ ...input, targets: [...targets].reverse() }).map((item) => [item.targetId, item.userId]));
});
