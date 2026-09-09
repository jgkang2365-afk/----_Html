import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DOCUMENT_GENERATION_POLL_INTERVAL_MS,
  DOCUMENT_GENERATION_STATUS_LABELS,
  documentGenerationPollDelay,
  isDocumentGenerationRunning,
  shouldApplyDocumentGenerationResponse,
} from "../lib/document-generation/polling";

const component = readFileSync("components/features/NewBusinessDocumentGeneration.tsx", "utf8");
const route = readFileSync("app/api/document-generation/route.ts", "utf8");

test("문서 생성 상태 7종은 실행 여부와 버튼 문구를 정확히 표시한다", () => {
  const expectations = [
    ["NOT_REQUESTED", false, "문서 생성"],
    ["PENDING", true, "문서 생성 중"],
    ["PROCESSING", true, "문서 생성 중"],
    ["COMPLETED", false, "문서 재생성"],
    ["PARTIAL_SUCCESS", false, "다시 생성"],
    ["FAILED", false, "다시 생성"],
    ["CANCELLED", false, "다시 생성"],
  ] as const;

  for (const [status, running, label] of expectations) {
    assert.equal(isDocumentGenerationRunning(status), running);
    assert.equal(DOCUMENT_GENERATION_STATUS_LABELS[status], label);
  }
});

test("Case 1: 활성 상태만 30초 polling하며 terminal 상태는 예약하지 않는다", () => {
  assert.equal(DOCUMENT_GENERATION_POLL_INTERVAL_MS, 30000);
  assert.equal(documentGenerationPollDelay("PENDING"), 30000);
  assert.equal(documentGenerationPollDelay("PROCESSING"), 30000);
  assert.equal(isDocumentGenerationRunning("PROCESSING"), true);
  assert.equal(documentGenerationPollDelay("COMPLETED"), null);
  assert.equal(isDocumentGenerationRunning("COMPLETED"), false);
});

test("Case 2: NOT_REQUESTED·모든 terminal·알 수 없는 상태는 polling을 예약하지 않는다", () => {
  for (const status of ["NOT_REQUESTED", "COMPLETED", "PARTIAL_SUCCESS", "FAILED", "CANCELLED", "UNKNOWN"]) {
    assert.equal(documentGenerationPollDelay(status), null);
  }
});

test("Case 3: 최초 조회는 visible 탭에서만 시작한다", () => {
  assert.match(component, /document\.visibilityState !== "visible"/);
  assert.match(component, /if \(document\.visibilityState === "visible"\) \{\s+loadWhenVisible\(\);/);
  assert.match(component, /document\.addEventListener\("visibilitychange", loadWhenVisible\)/);
});

test("Case 4: hidden 전환은 polling timer를 중단한다", () => {
  assert.match(component, /if \(!isPageVisible\(\)\) \{\s+clearTimer\(\);\s+return;/);
});

test("Case 5: visible 복귀는 즉시 상태를 조회하고 다음 polling을 예약한다", () => {
  assert.match(component, /window\.addEventListener\("focus", refreshWhenVisible\)/);
  assert.match(component, /document\.addEventListener\("visibilitychange", handleVisibilityChange\)/);
  assert.match(component, /refreshWhenVisible\(\);/);
  assert.match(component, /window\.setTimeout\(\(\) => void poll\(\), delay\)/);
});

test("Case 6: focus와 visibilitychange 연속 이벤트는 단일 polling 요청으로 제한한다", () => {
  assert.match(component, /if \(cancelled \|\| !isPageVisible\(\) \|\| pollingInFlight\) return;/);
});

test("Case 7: terminal 응답은 polling listener와 timer를 남기지 않는다", () => {
  assert.match(component, /if \(delay === null\) return;/);
  assert.match(component, /window\.removeEventListener\("focus", refreshWhenVisible\)/);
  assert.match(component, /document\.removeEventListener\("visibilitychange", handleVisibilityChange\)/);
  assert.match(component, /clearTimer\(\);/);
});

test("Case 8: unmount는 요청 자원을 정리하고 수동 새로고침은 유지한다", () => {
  assert.match(component, /requestSequence\.current \+= 1;/);
  assert.match(component, /requestController\.current\?\.abort\(\)/);
  assert.match(component, /const refreshStatus = async \(\) => \{[\s\S]*?await load\(true\);/);
  assert.match(component, /onClick=\{\(\) => void refreshStatus\(\)\}/);
});

test("취소 요청이 확인되면 자동 polling과 생성 spinner를 중단한다", () => {
  assert.match(component, /if \(isCancellationRequested\) return;/);
  assert.match(component, /isRunning && !isCancellationRequested/);
  assert.match(component, /cancel_requested_at/);
  assert.match(component, /문서 생성 취소 요청이 접수되었습니다\./);
  assert.match(component, /문서 생성이 취소되었습니다\./);
});

test("ESC와 생성 중단 버튼은 중복 방지된 동일 취소 API 함수를 사용한다", () => {
  assert.match(component, /const requestCancellation = useCallback/);
  assert.match(component, /cancellationRequestInFlight\.current/);
  assert.match(component, /event\.key !== "Escape"/);
  assert.match(component, /event\.preventDefault\(\)/);
  assert.match(component, /event\.stopPropagation\(\)/);
  assert.match(component, /void requestCancellation\(\)/);
  assert.match(component, /\{cancelling \? "취소 요청 중\.\.\." : "생성 중단"\}/);
  assert.match(component, /\/api\/document-generation\/jobs\/\$\{jobId\}\/cancel/);
});

test("진행 중이 아닐 때는 ESC listener를 등록하지 않는다", () => {
  assert.match(component, /if \(!isRunning \|\| isCancellationRequested\) return;/);
  assert.match(component, /window\.addEventListener\("keydown", handleEscape, true\)/);
  assert.match(component, /window\.removeEventListener\("keydown", handleEscape, true\)/);
});

test("늦게 도착한 PROCESSING 응답은 최신 COMPLETED 응답을 덮어쓰지 않는다", () => {
  const firstProcessingSequence = 1;
  const secondCompletedSequence = 2;
  let latestSequence = firstProcessingSequence;
  let status = "NOT_REQUESTED";

  if (shouldApplyDocumentGenerationResponse(firstProcessingSequence, latestSequence)) {
    status = "PROCESSING";
  }
  latestSequence = secondCompletedSequence;
  if (shouldApplyDocumentGenerationResponse(secondCompletedSequence, latestSequence)) {
    status = "COMPLETED";
  }
  if (shouldApplyDocumentGenerationResponse(firstProcessingSequence, latestSequence)) {
    status = "PROCESSING";
  }

  assert.equal(status, "COMPLETED");
});

test("polling 요청은 이전 조회와 unmount를 정리하고 job 객체 전체에 의존하지 않는다", () => {
  assert.match(component, /requestController\.current\?\.abort\(\)/);
  assert.match(
    component,
    /shouldApplyDocumentGenerationResponse\(sequence, requestSequence\.current\)/
  );
  assert.match(component, /window\.setTimeout\(\(\) => void poll\(\), delay\)/);
  assert.doesNotMatch(component, /\[context\?\.job, load\]/);
});

test("GET은 최신 작업의 진단 필드를 명시적으로 no-store 응답한다", () => {
  for (const field of [
    "id",
    "status",
    "requested_at",
    "started_at",
    "completed_at",
    "updated_at",
    "worker_id",
    "attempt_count",
  ]) {
    assert.match(route, new RegExp(`\\b${field}\\b`));
  }
  assert.match(route, /\.order\("created_at", \{ ascending: false \}\)/);
  assert.match(route, /"Cache-Control": "no-store, max-age=0"/);
});
