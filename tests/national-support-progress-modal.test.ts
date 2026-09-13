import assert from "node:assert/strict";
import test from "node:test";
import { nationalSupportProgressDetails, nationalSupportProgressView } from "../components/features/AutomationProgressModal";

const processingMessage = "깡통컴에서 건강디딤돌 조회를 처리 중입니다";

test("정상 NO_RESULT는 기술 실패 없이 미신청 결과로 표시한다", () => {
  const view = nationalSupportProgressView({ status: "COMPLETED", progress_percent: 100, result_code: "LOOKUP_NO_RESULT", effect_started_at: null }, processingMessage);
  assert.equal(view.heading, "건강디딤돌 조회 결과가 없습니다");
  assert.match(view.detail, /신청은 진행하지 않았습니다/);
  assert.doesNotMatch(view.detail, /Stacktrace|chromedriver/i);
});

test("NO_RESULT 기록 뒤 브라우저 오류는 결과 확인 실패로 우선 표시하고 원문을 노출하지 않는다", () => {
  const view = nationalSupportProgressView({ status: "FAILED", progress_percent: 40, result_code: "LOOKUP_NO_RESULT", effect_started_at: null }, processingMessage);
  assert.equal(view.heading, "건강디딤돌 조회 결과를 확인하지 못했습니다");
  assert.match(view.detail, /신청은 진행하지 않았습니다/);
  assert.doesNotMatch(`${view.heading}\n${view.detail}`, /Stacktrace|chromedriver|GetHandleVerifier/i);
});

test("일반 브라우저 자동화 실패는 기계 오류 원문 대신 사용자 안내를 표시한다", () => {
  const view = nationalSupportProgressView({ status: "FAILED", progress_percent: 20, result_code: null, effect_started_at: null }, processingMessage);
  assert.match(view.detail, /잠시 후 다시 시도/);
  assert.doesNotMatch(`${view.heading}\n${view.detail}`, /Stacktrace|chromedriver|GetHandleVerifier/i);
});

test("CONFIRM_REQUIRED는 신청 여부를 미신청으로 단정하지 않고 확인을 안내한다", () => {
  const view = nationalSupportProgressView({ status: "CONFIRM_REQUIRED", progress_percent: 80, result_code: "APPLICATION_UNCERTAIN", effect_started_at: "2026-09-13T00:00:00Z" }, processingMessage);
  assert.match(view.heading, /결과 확인이 필요/);
  assert.doesNotMatch(view.detail, /신청은 진행하지 않았습니다/);
});

test("effect_started_at이 있는 FAILED는 미신청으로 단정하지 않고 확인 필요로 표시한다", () => {
  const view = nationalSupportProgressView({ status: "FAILED", progress_percent: 80, result_code: null, effect_started_at: "2026-09-13T00:00:00Z" }, processingMessage);
  assert.match(view.heading, /결과 확인이 필요/);
  assert.doesNotMatch(view.detail, /신청은 진행하지 않았습니다/);
});

test("사용자 상세정보에는 구조화 메타데이터만 포함하고 원본 오류 메시지는 포함하지 않는다", () => {
  const details = nationalSupportProgressDetails({ id: "job-123", status: "FAILED", progress_stage: "공단 조회", error_code: "NATIONAL_SUPPORT_WORKER_ERROR", finished_at: "2026-09-13T00:00:00Z", updated_at: "2026-09-13T00:00:00Z" });
  assert.deepEqual(details.map(({ label }) => label), ["발생 시각", "작업 ID", "작업 단계", "오류 코드"]);
  assert.doesNotMatch(JSON.stringify(details), /Stacktrace|chromedriver|GetHandleVerifier/i);
});

test("정상 NO_RESULT는 오류 상세 보기를 표시하지 않는다", () => {
  const details = nationalSupportProgressDetails({ id: "job-123", status: "COMPLETED", progress_stage: "결과 확인", error_code: null, finished_at: "2026-09-13T00:00:00Z", updated_at: "2026-09-13T00:00:00Z" });
  assert.deepEqual(details, []);
});
