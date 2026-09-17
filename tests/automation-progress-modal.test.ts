import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AUTOMATION_PROGRESS_FALLBACK_POLL_MS, automationProgressView, handleVisibleAutomationEscape, mesProgressDetails, mesProgressView } from "../components/features/AutomationProgressModal";

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

test("Realtime 누락 시 열린 실행 모달만 5초 안전 조회하고 terminal에서 즉시 중단한다", () => {
  const component = readFileSync("components/features/AutomationProgressModal.tsx", "utf8");
  assert.equal(AUTOMATION_PROGRESS_FALLBACK_POLL_MS, 5000);
  assert.match(component, /if \(props\.visible === false \|\| !running\) return/);
  assert.match(component, /document\.visibilityState !== "visible"/);
  assert.match(component, /window\.setTimeout\(async \(\) => \{/);
  assert.match(component, /AUTOMATION_PROGRESS_FALLBACK_POLL_MS/);
  assert.match(component, /window\.clearTimeout\(timer\)/);
  assert.match(component, /document\.removeEventListener\("visibilitychange", handleVisibilityChange\)/);
  assert.match(component, /sequence !== refreshSequence\.current/);
});

test("문서 진행 모달 terminal 확인 시 목록 상태를 즉시 다시 읽는다", () => {
  const component = readFileSync("components/features/NewBusinessDocumentGeneration.tsx", "utf8");
  assert.match(component, /onTerminal=\{\(\) => \{/);
  assert.match(component, /setShowProgress\(false\);\s+void load\(true\);/);
});

test("MES 실패와 확인 필요는 traceback 대신 사용자 메시지와 구조화 상세를 사용한다", () => {
  const rawTrace = "Traceback (most recent call last): C:\\Users\\USER\\mes_download.py chromedriver!GetHandleVerifier";
  const failed = mesProgressView({ status: "FAILED", progress_percent: 25, effect_started_at: null, error_message: rawTrace } as any, processingMessage);
  assert.equal(failed.heading, "MES 자동화 실행에 실패했습니다");
  assert.equal(failed.detail.includes("Traceback"), false);
  assert.equal(failed.detail.includes("C:\\Users"), false);
  const uncertain = mesProgressView({ status: "FAILED", progress_percent: 80, effect_started_at: "2026-09-13T00:00:00Z", error_message: rawTrace } as any, processingMessage);
  assert.equal(uncertain.heading, "MES 동기화 결과 확인이 필요합니다");
  assert.equal(uncertain.detail.includes("시작되지 않았습니다"), false);
  assert.deepEqual(mesProgressDetails({ id: "job-1", status: "FAILED", progress_stage: "MES_LOGIN", error_code: rawTrace, finished_at: null, updated_at: null } as any).map(({ label }) => label), ["작업 ID", "작업 단계"]);
  const component = readFileSync("components/features/AutomationProgressModal.tsx", "utf8");
  assert.match(component, /export function mesProgressView/);
  assert.match(component, /props\.nationalSupport \|\| props\.mes \? mesProgressDetails\(job\) : \[\]/);
  assert.match(component, /MES 자동화 실행에 실패했습니다/);
  assert.match(component, /MES 동기화 결과 확인이 필요합니다/);
  assert.doesNotMatch(component, /props\.mes.*error_message/);
});

test("실행 중 ESC만 기존 취소 handler를 한 번 연결하고 terminal에는 취소 action을 넘기지 않는다", () => {
  let cancelled = 0;
  const visibleEvent = { key: "Escape", preventDefault() {}, stopPropagation() {} };
  assert.equal(handleVisibleAutomationEscape(visibleEvent, { visible: true, running: true, cancelDisabled: false }, () => { cancelled += 1; }), true);
  assert.equal(cancelled, 1);
  assert.equal(handleVisibleAutomationEscape(visibleEvent, { visible: true, running: false, cancelDisabled: false }, () => { cancelled += 1; }), false);
  assert.equal(cancelled, 1);
  const component = readFileSync("components/features/AutomationProgressModal.tsx", "utf8");
  assert.match(component, /const cancelAction = running \? props\.onCancel : undefined/);
  assert.match(component, /if \(!props\.visible \|\| !running \|\| !cancelAction \|\| props\.cancelDisabled\) return/);
  assert.match(component, /window\.addEventListener\("keydown", handleEscape, true\)/);
  assert.match(component, /onCancel=\{cancelAction\}/);
  assert.match(component, /\^\[A-Z\]\[A-Z0-9_\]\{1,63\}\$/);
});
