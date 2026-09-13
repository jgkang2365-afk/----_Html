import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { matchesNationalSupportTargetKey, nationalSupportApplyOutcome, NATIONAL_SUPPORT_TARGET_KEY_MISMATCH } from "../lib/national-support/apply-boundaries";

const route = fs.readFileSync(
  path.join(
    process.cwd(),
    "app/api/businesses/national-support/apply/route.ts",
  ),
  "utf8",
);

test("건강디딤돌 요청은 공통 idempotency enqueue로 한 번만 등록한다", () => {
  assert.match(route, /enqueueAutomationJob/);
  assert.match(route, /nationalSupportIdempotencyKey/);
  assert.doesNotMatch(route, /sync_status\.is\.null/);
  assert.doesNotMatch(route, /sync_status\.not\.in/);
});

test("enqueue 실패 응답은 오류 코드와 correlationId를 제공한다", () => {
  assert.match(route, /correlationId/);
  assert.match(route, /NATIONAL_SUPPORT_API_FAILED/);
  assert.match(route, /NATIONAL_SUPPORT_ALREADY_RUNNING/);
});

test("다른 사용자 또는 requested_by 없는 활성 작업은 job 데이터 없는 409로 응답한다", () => {
  const guard = route.slice(route.indexOf("if (automationJob.requested_by !== Number(user.id))"), route.indexOf("return NextResponse.json({\n      success: true,", route.indexOf("if (automationJob.requested_by !== Number(user.id))")));
  assert.match(guard, /status: 409/);
  assert.match(guard, /NATIONAL_SUPPORT_ALREADY_RUNNING/);
  assert.doesNotMatch(guard, /jobId|request_payload|automationJob\.id/);
  const isOtherOwner = (requestedBy: number | null, userId: number) => requestedBy !== userId;
  assert.equal(isOtherOwner(2, 1), true);
  assert.equal(isOtherOwner(null, 1), true);
  assert.equal(isOtherOwner(1, 1), false);
});

test("구조화 로그에는 요청 식별자만 기록하고 신청 개인정보는 제외한다", () => {
  const logStart = route.indexOf('console.error("[NationalSupportQueue] API 처리 오류"');
  const logEnd = route.indexOf("});", logStart);
  const logBlock = route.slice(logStart, logEnd);
  assert.match(logBlock, /correlationId/);
  assert.doesNotMatch(logBlock, /contact_name|contact_phone|sanjae|commencement/);
});

test("target_id의 canonical code/year/period가 다르면 409이고 guard·payload는 DB 값을 쓴다", () => {
  const canonical = { code: "A", year: 2026, period: "하반기" };
  assert.equal(matchesNationalSupportTargetKey(canonical, canonical), true);
  for (const altered of [
    { ...canonical, code: "B" }, { ...canonical, year: 2025 },
    { ...canonical, period: "상반기" }, { ...canonical, year: "invalid" },
  ]) assert.equal(matchesNationalSupportTargetKey(altered, canonical), false);
  const binding = route.slice(route.indexOf("const { data: canonicalTarget"), route.indexOf("const normalizedSanjae"));
  assert.match(binding, /\.eq\("id", target_id\)\.maybeSingle\(\)/);
  assert.match(binding, /matchesNationalSupportTargetKey/);
  assert.match(binding, /status: 409/);
  assert.match(route, /errorCode: NATIONAL_SUPPORT_TARGET_KEY_MISMATCH/);
  assert.equal(NATIONAL_SUPPORT_TARGET_KEY_MISMATCH, "NATIONAL_SUPPORT_TARGET_KEY_MISMATCH");
  assert.match(route, /const \{ id: canonicalTargetId, code, year, period \} = canonicalTarget/);
  assert.match(route, /hasMeasurementJournalForTarget\(createAdminClient\(\), \{[\s\S]*?code: String\(code\), year: Number\(year\), period: String\(period\)/);
  assert.match(route, /target_id: canonicalTargetId/);
  assert.match(route, /targetKey: `national-support:\$\{canonicalTargetId\}`/);
});

test("JOURNAL_REGISTERED_SKIP는 네 UI 호출 경로 모두 제외로 분류하며 작업 대기로 표시하지 않는다", () => {
  assert.equal(nationalSupportApplyOutcome({ resultCode: "JOURNAL_REGISTERED_SKIP" }), "excluded");
  assert.equal(nationalSupportApplyOutcome({ resultCode: "JOURNAL_REGISTERED_SKIP", instantSync: true }), "excluded");
  assert.equal(nationalSupportApplyOutcome({ instantSync: true }), "instant");
  assert.equal(nationalSupportApplyOutcome({}), "queued");
  const management = fs.readFileSync(path.join(process.cwd(), "components/features/MeasurementTargetBusinessManagement.tsx"), "utf8");
  const users = fs.readFileSync(path.join(process.cwd(), "components/features/UserManagement.tsx"), "utf8");
  assert.equal((management.match(/nationalSupportApplyOutcome\([^)]*\) === "excluded"/g) ?? []).length, 3);
  assert.equal((users.match(/nationalSupportApplyOutcome\([^)]*\) === "excluded"/g) ?? []).length, 1);
  assert.match(management, /\[제외\].*측정일지가 등록되어/);
  assert.match(users, /\[제외\].*측정일지가 등록되어/);
});
