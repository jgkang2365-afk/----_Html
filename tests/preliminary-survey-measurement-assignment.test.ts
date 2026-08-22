import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assignMeasurementAssignees, PUBLIC_SAMPLE_CODE_BY_NAME } from "../lib/preliminary-survey-v2/measurement-assignment";

const users = Object.keys(PUBLIC_SAMPLE_CODE_BY_NAME).map((name, index) => ({ id: index + 1, name, active: true }));
const target = (targetId: number, address = `충남 천안시 ${targetId}`) => ({
  targetId, measurementDate: "2026-08-25", address,
  coordinate: { latitude: 36.8 + targetId / 1000, longitude: 127.1 },
});

test("공시료 코드는 사람별 A/B/C/D/F/G 고정이다", () => {
  assert.deepEqual(PUBLIC_SAMPLE_CODE_BY_NAME, {
    "이태환": "A", "한기문": "B", "강종구": "C", "이주형": "D", "고유빈": "F", "김민영": "G",
  });
});

test("6개 업체는 측정자 6명에게 1개씩 균등 배정한다", () => {
  const result = assignMeasurementAssignees({ targets: users.map((_, index) => target(index + 1)), users });
  assert.deepEqual(result.map((item) => item.dailyCount), [1, 1, 1, 1, 1, 1]);
  assert.equal(new Set(result.map((item) => item.userId)).size, 6);
});

test("8개 업체는 2/2/1/1/1/1이고 3건은 자동 승인하지 않는다", () => {
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

test("첫 균등 순환 후 추가 업체는 동일주소를 우선한다", () => {
  const address = "충남 천안시 동일주소 1";
  const existing = users.map((user, index) => ({ ...target(100 + index, index === 2 ? address : `주소${index}`), userId: user.id }));
  const [result] = assignMeasurementAssignees({ targets: [target(1, address)], users, existing });
  assert.equal(result.userId, users[2].id);
  assert.equal(result.reason, "동일주소 묶음");
});

test("legacy participants/report writer/예비조사자에서 측정자를 추론하지 않는다", () => {
  const staff = readFileSync("lib/preliminary-survey-v2/measurement-staff.ts", "utf8");
  const service = readFileSync("lib/preliminary-survey-v2/service.ts", "utf8");
  const workbench = readFileSync("app/api/preliminary-survey-v2/workbench/route.ts", "utf8");
  assert.doesNotMatch(staff, /entry\.main_measurer_id \?\? entry\.measurer_id/);
  assert.doesNotMatch(staff, /entry\.helper_ids \?\? entry\.collaborators/);
  assert.doesNotMatch(service, /!responsible && "link_measurer"/);
  assert.match(workbench, /recommendation_reason\?\.measurementAssignee/);
});

test("찐확정 DB guard는 sequence_number가 아니라 measurement_journal row 존재를 사용한다", () => {
  const migration = readFileSync("supabase/migrations/20260822_enforce_true_confirmed_trigger.sql", "utf8");
  assert.match(migration, /JOIN public\.measurement_journal journal/);
  assert.doesNotMatch(migration, /sequence_number/);
  assert.match(migration, /TRUE_CONFIRMED_LOCKED/);
});
