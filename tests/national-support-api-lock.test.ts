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

test("건강디딤돌 요청은 RPC로 조회중 락과 큐를 원자 등록한다", () => {
  assert.match(route, /\.rpc\(\s*"enqueue_national_support_job"/);
  assert.doesNotMatch(route, /sync_status\.is\.null/);
  assert.doesNotMatch(route, /sync_status\.not\.in/);
});

test("락 실패 응답은 오류 코드와 correlationId를 제공한다", () => {
  assert.match(route, /classifyNationalSupportQueueError/);
  assert.match(route, /correlationId/);
  assert.match(route, /dbError:\s*\{[\s\S]*code:[\s\S]*message:[\s\S]*details:[\s\S]*hint:/);
  assert.match(route, /existing_sync_status: currentPlan\.sync_status/);
});

test("구조화 로그에는 요청 식별자와 mode만 기록하고 신청 개인정보는 제외한다", () => {
  const logStart = route.indexOf('console.error("[NationalSupportQueue] 원자적 락/큐 등록 실패"');
  const logEnd = route.indexOf("});", logStart);
  const logBlock = route.slice(logStart, logEnd);
  assert.match(logBlock, /target_id/);
  assert.match(logBlock, /mode: jobMode/);
  assert.doesNotMatch(logBlock, /contact_name|contact_phone|sanjae|commencement/);
});
