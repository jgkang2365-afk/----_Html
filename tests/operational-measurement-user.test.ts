import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isOperationalMeasurementUser,
  operationalMeasurementUsers,
} from "../lib/business/operational-measurement-user";
import { validateMeasurementDayAvailability } from "../lib/business/measurement-day-availability";

test("업무 측정 후보는 활성 측정 사용자만 허용하고 staging QA ID 대역을 제외한다", () => {
  const users = [
    { id: 12, job: "측정", is_active: true },
    { id: 13, job: "측정", is_active: false },
    { id: 14, job: "관리", is_active: true },
    { id: 9001, job: "측정", is_active: true },
    { id: 9101, job: "측정", is_active: true },
    { id: 9999, job: "측정", is_active: true },
    { id: 10000, job: "측정", is_active: true },
    { id: 15, job: "측정", is_active: null },
  ];

  assert.equal(isOperationalMeasurementUser(users[0]), true);
  assert.deepEqual(operationalMeasurementUsers(users).map((user) => user.id), [12, 10000]);
});

test("서버 저장 검증도 제외된 QA 사용자를 보고서 담당·측정 참여자로 거부한다", () => {
  const result = validateMeasurementDayAvailability({
    days: [{ date: "2026-08-31", measurerId: 9001, collaborators: ["QA 사용자"] }],
    users: [{ id: 12, name: "운영 측정자" }],
    blockedKeys: new Set(),
  });

  assert.equal(result.valid, false);
  if (!result.valid) assert.match(result.message, /업무 측정 후보가 아닙니다/);
});

test("보고서담당·V2 조사자/검토자·공시료/용량/경로 후보가 단일 helper를 사용한다", () => {
  for (const file of [
    "app/api/businesses/route.ts",
    "components/features/MeasurementTargetBusinessManagement.tsx",
    "lib/preliminary-survey-v2/service.ts",
    "app/api/preliminary-survey-v2/workbench/route.ts",
    "app/api/preliminary-survey-v2/admin-repair/route.ts",
    "lib/utils/survey-assignment.ts",
  ]) {
    assert.match(readFileSync(file, "utf8"), /operationalMeasurementUsers|isOperationalMeasurementUser/);
  }
  const usersApi = readFileSync("app/api/users/route.ts", "utf8");
  assert.doesNotMatch(usersApi, /operationalMeasurementUsers|isOperationalMeasurementUser/);
});
