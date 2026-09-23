import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { businessSyncTriggers } from "../lib/google/business-sync-triggers";

test("Calendar 표시 필드 단독 변경은 일정 투영 없이 동기화한다", () => {
  for (const field of ["address", "manager_name", "manager_mobile", "notes", "is_registered"]) {
    assert.deepEqual(businessSyncTriggers({ [field]: null }), {
      projectSchedule: false,
      syncCalendar: true,
    }, field);
  }
  assert.deepEqual(businessSyncTriggers({ manager_email: "test@example.com" }), {
    projectSchedule: false,
    syncCalendar: false,
  });
});

test("일정 필드는 투영을 유지하고 표시 필드와 함께 저장해도 동기화 신호는 하나다", () => {
  for (const field of ["measurement_date", "measurer_id", "collaborators", "daily_staff", "business_name"]) {
    assert.deepEqual(businessSyncTriggers({ [field]: null }), {
      projectSchedule: true,
      syncCalendar: true,
    }, field);
  }
  assert.deepEqual(businessSyncTriggers({ measurement_date: "2026-09-23", address: "새 주소" }), {
    projectSchedule: true,
    syncCalendar: true,
  });
});

test("PATCH는 일정 투영 분기 밖에서 Calendar를 한 번만 호출한다", () => {
  const route = readFileSync("app/api/businesses/route.ts", "utf8");
  const integrated = route.slice(route.indexOf("// === [Integrated Sync Logic] ==="), route.indexOf("// [New Feature] Sync 'Business Category'"));
  assert.match(integrated, /if \(syncCalendar && code && year && period\)/);
  assert.match(integrated, /if \(projectSchedule\)/);
  assert.equal((integrated.match(/await syncBusinessToCalendar\(/g) || []).length, 1);
  assert.ok(integrated.indexOf("await syncBusinessToCalendar") > integrated.indexOf("Preliminary surveys and summary updated"));
});

test("상태 변경은 기존 Calendar 엔진의 삭제 및 생성 경로에 도달한다", () => {
  assert.deepEqual(businessSyncTriggers({ is_registered: "미실시" }), { projectSchedule: false, syncCalendar: true });
  assert.deepEqual(businessSyncTriggers({ is_registered: "실시" }), { projectSchedule: false, syncCalendar: true });
  assert.deepEqual(businessSyncTriggers({ is_registered: "확정" }), { projectSchedule: false, syncCalendar: true });
  const service = readFileSync("lib/google/sync-service.ts", "utf8");
  assert.match(service, /targetBiz\.is_registered === "확정" \|\| targetBiz\.is_registered === "실시"/);
  assert.match(service, /if \(!isConfirmedStatus \|\| !survey\.measurement_date\) \{[\s\S]*?deleteSurveyEvent\(survey\.google_event_id\)/);
  assert.match(service, /if \(survey\.google_event_id\) \{[\s\S]*?getSurveyEvent\(survey\.google_event_id\)[\s\S]*?updateSurveyEvent\(survey\.google_event_id, eventData\)[\s\S]*?createSurveyEvent\(eventData\)/);
  assert.match(service, /update\(\{ google_event_id: created\.id \}\)/);
});
