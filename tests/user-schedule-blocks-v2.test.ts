import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const component = read("components/features/UserScheduleBlockManagement.tsx");
const page = read("app/survey/page.tsx");
const route = read("app/api/user-schedule-blocks/route.ts");
const service = read("lib/preliminary-survey-v2/service.ts");

test("직원 예비조사 제외 일정은 기존 예비조사 화면 탭에 배치", () => {
  assert.match(page, /UserScheduleBlockManagement/);
  assert.match(page, /schedule-blocks/);
  assert.match(page, /직원 예비조사 제외 일정/);
});

test("제외 일정 UI는 다중 직원·유형·기간 필터와 CRUD를 제공", () => {
  for (const label of ["교육", "휴가", "출장", "회의", "건강검진", "개인 일정", "기타"]) {
    assert.match(component, new RegExp(label));
  }
  assert.match(component, /userIds: \[\] as string\[\]/);
  assert.match(component, />\s*전체\s*</);
  assert.match(component, /filterUserId/);
  assert.match(component, /filterStartDate/);
  assert.match(component, /filterEndDate/);
  assert.match(component, /method: form\.id \? "PATCH" : "POST"/);
  assert.match(component, /method: "DELETE"/);
});

test("제외 일정 API는 권한·활성 측정직원 검증과 GET/POST/PATCH/DELETE를 제공", () => {
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /checkPermission\("survey:read"\)/);
  assert.match(route, /checkPermission\("survey:write"\)/);
  assert.match(route, /session\.role === "관리자"/);
  assert.match(route, /session\.userId !== userId/);
  assert.match(route, /user\.job === "측정" && user\.is_active !== false/);
  assert.match(route, /\.insert\(userIds\.map/);
});

test("V2 계산 서비스는 DB 제외일을 HARD BLOCK availability에 연결", () => {
  assert.match(service, /from\("user_schedule_blocks"\)/);
  assert.match(service, /buildScheduleBlockKeys\(blocks \?\? \[\]\)/);
  assert.match(service, /availability: \{ isBlocked: \(userId, date\) => blockedKeys\.has/);
});
