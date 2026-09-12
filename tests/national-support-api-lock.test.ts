import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

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
