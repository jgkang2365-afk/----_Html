import assert from "node:assert/strict";
import test from "node:test";
import {
  assignMeasurementAssignees,
  collectMeasurementVehicleRouteEvidence,
  type MeasurementVehicleRouteEvidence,
} from "../lib/preliminary-survey-v2/measurement-assignment";

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

test("6개 업체는 측정자 6명에게 1개씩 균등 배정한다", () => {
  const result = assignMeasurementAssignees({ targets: users.map((_, index) => target(index + 1)), users });
  assert.deepEqual(result.map((item) => item.dailyCount), [1, 1, 1, 1, 1, 1]);
  assert.equal(new Set(result.map((item) => item.userId)).size, 6);
});

test("8개 업체는 2/2/1/1/1/1이고 세 번째 배정은 승인 필요다", () => {
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
