import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { automationProgressView } from "../components/features/AutomationProgressModal";

const processingMessage = "깡통컴에서 문서를 생성 중입니다";

test("공통 깡통컴 진행 모달은 기존 automation 상태를 고정 4단계로 표시한다", () => {
  assert.equal(automationProgressView({ status: "PENDING", progress_percent: 0, error_message: null } as any, processingMessage).step, 0);
  assert.equal(automationProgressView({ status: "RUNNING", progress_percent: 40, error_message: null } as any, processingMessage).step, 1);
  assert.equal(automationProgressView({ status: "RUNNING", progress_percent: 80, error_message: null } as any, processingMessage).step, 2);
  assert.equal(automationProgressView({ status: "COMPLETED", progress_percent: 100, error_message: null } as any, processingMessage).step, 3);
});

test("취소·실패·확인 필요도 공통 shell 안에서 상태를 구분한다", () => {
  assert.equal(automationProgressView({ status: "CANCEL_REQUESTED", progress_percent: 30, error_message: null } as any, processingMessage).heading, "중단 요청을 전달했습니다");
  assert.equal(automationProgressView({ status: "CANCELLED", progress_percent: 100, error_message: null } as any, processingMessage).heading, "작업이 중단되었습니다");
  assert.equal(automationProgressView({ status: "FAILED", progress_percent: 20, error_message: "처리 실패" } as any, processingMessage).tone, "red");
  assert.equal(automationProgressView({ status: "CONFIRM_REQUIRED", progress_percent: 80, error_message: null } as any, processingMessage).tone, "amber");
});

test("실패 단계는 실제 시작·결과 확인 증거를 따른다", () => {
  assert.equal(automationProgressView({ status: "FAILED", progress_percent: 0, started_at: null, error_message: null } as any, processingMessage).step, 0);
  assert.equal(automationProgressView({ status: "FAILED", progress_percent: 30, started_at: "2026-09-13T00:00:00Z", error_message: null } as any, processingMessage).step, 1);
  assert.equal(automationProgressView({ status: "FAILED", progress_percent: 75, started_at: "2026-09-13T00:00:00Z", error_message: null } as any, processingMessage).step, 2);
});

test("terminal 결과는 열린 진행 모달에 남고, 닫힌 진행 화면만 자동 정리한다", () => {
  const component = readFileSync("components/features/AutomationProgressModal.tsx", "utf8");
  assert.match(component, /terminal\.has\(job\.status\) && props\.visible === false/);
  assert.match(component, /const handleClose = \(\) => \{/);
  assert.match(component, /if \(props\.onTerminal\) props\.onTerminal\(\);/);
  assert.match(component, /else props\.onClose\(\);/);
});
