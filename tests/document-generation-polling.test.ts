import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DOCUMENT_GENERATION_STATUS_LABELS,
  documentGenerationPollDelay,
  isDocumentGenerationRunning,
  shouldApplyDocumentGenerationResponse,
} from "../lib/document-generation/polling";

const component = readFileSync("components/features/NewBusinessDocumentGeneration.tsx", "utf8");
const route = readFileSync("app/api/document-generation/route.ts", "utf8");

test("문서 생성 상태 6종은 실행 여부와 버튼 문구를 정확히 표시한다", () => {
  const expectations = [
    ["NOT_REQUESTED", false, "문서 생성"],
    ["PENDING", true, "문서 생성 중"],
    ["PROCESSING", true, "문서 생성 중"],
    ["COMPLETED", false, "문서 재생성"],
    ["PARTIAL_SUCCESS", false, "다시 생성"],
    ["FAILED", false, "다시 생성"],
  ] as const;

  for (const [status, running, label] of expectations) {
    assert.equal(isDocumentGenerationRunning(status), running);
    assert.equal(DOCUMENT_GENERATION_STATUS_LABELS[status], label);
  }
});

test("PROCESSING에서 COMPLETED가 되면 polling과 spinner 상태가 함께 종료된다", () => {
  assert.equal(documentGenerationPollDelay("PROCESSING"), 3000);
  assert.equal(isDocumentGenerationRunning("PROCESSING"), true);
  assert.equal(documentGenerationPollDelay("COMPLETED"), null);
  assert.equal(isDocumentGenerationRunning("COMPLETED"), false);
});

test("완료·부분 성공·실패 상태에서는 추가 polling을 예약하지 않는다", () => {
  for (const status of ["COMPLETED", "PARTIAL_SUCCESS", "FAILED"]) {
    assert.equal(documentGenerationPollDelay(status), null);
  }
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
  assert.match(component, /shouldApplyDocumentGenerationResponse\(sequence, requestSequence\.current\)/);
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
