import assert from "node:assert/strict";
import test from "node:test";
import {
  assignMeasurementAssignees,
  buildMeasurementAssignmentTargets,
  collectMeasurementVehicleRouteEvidence,
  MEASUREMENT_ASSIGNMENT_CAPACITY_CODE,
  MeasurementAssignmentDailyLimitError,
  type MeasurementVehicleRouteEvidence,
} from "../lib/preliminary-survey-v2/measurement-assignment";
import {
  canonicalizeWorkbenchDraft,
  sameCanonicalWorkbenchDraft,
} from "../lib/preliminary-survey-v2/draft-canonical";

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
    preliminarySurveyorUserIds: [user.id],
  }));
  const result = assignMeasurementAssignees({ targets: [...targets].reverse(), users });
  assert.equal(new Set(result.map((item) => item.userId)).size, 6);
  assert.deepEqual(result.map((item) => [item.targetId, item.userId]), targets.map((item) => [item.targetId, item.reportWriterUserId]));
});

test("역할이 일부 직원에게 몰려도 6명 첫 순환이 역할 일치보다 우선한다", () => {
  const result = assignMeasurementAssignees({
    targets: users.map((_, index) => ({
      ...target(index + 1), reportWriterUserId: 1,
      measurementParticipantUserIds: [1], preliminarySurveyorUserIds: [1],
    })),
    users,
  });
  assert.equal(new Set(result.map((item) => item.userId)).size, 6);
});

test("실제 6개 업체 역할 충돌에서도 A/B/C/D/F/G를 한 번씩 사용한다", () => {
  const result = assignMeasurementAssignees({
    targets: [
      { ...target(290), businessCode: "H0290", reportWriterUserId: 2, measurementParticipantUserIds: [2], preliminarySurveyorUserIds: [2] },
      { ...target(200), businessCode: "H0200", reportWriterUserId: 3, measurementParticipantUserIds: [3], preliminarySurveyorUserIds: [1] },
      // 두 이름 표시 중 책임 예비조사자만 preference에 넣고 reviewer는 제외한다.
      { ...target(226), businessCode: "H0226", reportWriterUserId: 3, measurementParticipantUserIds: [3], preliminarySurveyorUserIds: [3] },
      { ...target(188), businessCode: "H0188", reportWriterUserId: 5, measurementParticipantUserIds: [5], preliminarySurveyorUserIds: [4] },
      // 두 이름 표시 중 책임 예비조사자만 preference에 넣고 reviewer는 제외한다.
      { ...target(100), businessCode: "H0100", reportWriterUserId: 5, measurementParticipantUserIds: [5], preliminarySurveyorUserIds: [5] },
      { ...target(101), businessCode: "H0101", reportWriterUserId: 5, measurementParticipantUserIds: [5], preliminarySurveyorUserIds: [6] },
    ].map((item) => ({ ...item, measurementDate: "2026-08-24" })),
    users,
  });
  assert.deepEqual(result.map((item) => [item.targetId, item.userId, item.publicSampleCode]), [
    [100, 5, "F"], [101, 6, "G"], [188, 4, "D"], [200, 1, "A"], [226, 3, "C"], [290, 2, "B"],
  ]);
  assert.equal(result.find((item) => item.targetId === 200)?.userId, 1,
    "H0200은 참여자/보고서 담당자 강종구보다 예비조사 책임자 이태환(A) 연계를 우선해야 한다");
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
  const recommendationTargets = buildMeasurementAssignmentTargets({ target: source, preliminarySurveyorUserIds: [1, 2] });
  const applyTargets = buildMeasurementAssignmentTargets({ target: { ...source }, preliminarySurveyorUserIds: [1, 2] });

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
    preliminarySurveyorUserIds: [1, 2],
  });
});

test("공시료 후보는 첫 순환 균등 뒤 예비조사자 일치만 우선하고 참여자·보고서 담당자는 점수에 섞지 않는다", () => {
  const [result] = assignMeasurementAssignees({
    targets: [{
      ...target(1), preliminarySurveyorUserIds: [2],
      measurementParticipantUserIds: [1], reportWriterUserId: 1,
    }],
    users: users.slice(0, 2),
  });
  assert.equal(result.userId, 2);
  assert.equal(result.dailyCount, 1);
  assert.equal(result.approvalRequired, false);
});

test("예비조사 책임자가 불가 일정이어도 첫 순환 균등 후보를 우선한다", () => {
  const [result] = assignMeasurementAssignees({
    targets: [{
      ...target(1), preliminarySurveyorUserIds: [3],
      measurementParticipantUserIds: [2], reportWriterUserId: 1,
    }],
    users: users.slice(0, 3),
    availability: { isBlocked: (userId) => userId === 3 },
  });
  assert.equal(result.userId, 1);
});

test("동일주소 target별 예비조사 책임자 X/Y를 공시료 배정 preference로 각각 유지한다", () => {
  const address = "충남 천안시 동일주소 20";
  const result = assignMeasurementAssignees({
    targets: [
      { ...target(1, address), preliminarySurveyorUserIds: [1] },
      { ...target(2, address), preliminarySurveyorUserIds: [2] },
    ],
    users: users.slice(0, 2),
  });
  assert.deepEqual(result.map((item) => [item.targetId, item.userId]), [[1, 1], [2, 2]]);
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
    preliminarySurveyorUserIds: [6, 7],
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
      preliminarySurveyorUserIds: [responsibleId],
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

test("8개 업체는 2/2/1/1/1/1로 자동 배정하고 3건째 자동 생성은 차단한다", () => {
  const result = assignMeasurementAssignees({ targets: Array.from({ length: 8 }, (_, index) => target(index + 1)), users });
  const counts = users.map((user) => result.filter((item) => item.userId === user.id).length).sort((a, b) => b - a);
  assert.deepEqual(counts, [2, 2, 1, 1, 1, 1]);
  assert.equal(result.some((item) => item.approvalRequired), false);
  assert.throws(() => assignMeasurementAssignees({ targets: [target(20)], users, existing: users.flatMap((user, index) => [
    { ...target(100 + index), userId: user.id }, { ...target(200 + index), userId: user.id },
  ]) }), MeasurementAssignmentDailyLimitError);
});

test("공시료 soft preference는 책임자 한 명이 아니라 전체 예비조사자와의 일치를 사용한다", () => {
  const [result] = assignMeasurementAssignees({
    targets: [{
      ...target(1),
      preliminarySurveyorUserIds: [1, 2],
      measurementParticipantUserIds: [3],
      reportWriterUserId: 3,
    }],
    users: users.slice(0, 3),
  });
  assert.equal(result.userId, 1, "예비조사자 배열에 포함된 후보가 참여자·보고서 담당자보다 우선한다");
});

test("다일 사업장은 전체 예비조사자 배열을 각 측정일에 적용하고 전일 불일치도 hard fail하지 않는다", () => {
  const result = assignMeasurementAssignees({
    targets: [
      { ...target(1, "첫째날", "2026-08-25"), preliminarySurveyorUserIds: [1, 2] },
      { ...target(1, "둘째날", "2026-08-26"), preliminarySurveyorUserIds: [1, 2] },
      { ...target(2, "불일치", "2026-08-27"), preliminarySurveyorUserIds: [9] },
    ],
    users: users.slice(0, 3),
  });
  assert.deepEqual(result.map((item) => [item.measurementDate, item.userId]), [
    ["2026-08-25", 1], ["2026-08-26", 1], ["2026-08-27", 1],
  ]);
  assert.equal(result.length, 3, "어느 측정일에도 예비조사자와 일치하지 않아도 배정을 막지 않는다");
});

test("관리자 명시 예외에서만 3번째 공시료 코드를 CCC로 부여한다", () => {
  const [result] = assignMeasurementAssignees({
    targets: [target(20)], users: [users[2]],
    existing: [1, 2].map((id) => ({ ...target(100 + id), userId: users[2].id })),
    allowAdminThirdAssignment: true,
  });
  assert.equal(result.publicSampleCode, "CCC");
  assert.equal(result.approvalRequired, true);
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
