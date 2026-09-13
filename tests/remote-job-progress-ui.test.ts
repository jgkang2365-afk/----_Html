import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync("components/features/RemoteJobProgressDialog.tsx", "utf8");
const health = readFileSync("components/features/MeasurementTargetBusinessManagement.tsx", "utf8");
const report = readFileSync("app/(dashboard)/report-processing/page.tsx", "utf8");
const dashboard = readFileSync("components/features/DashboardClient.tsx", "utf8");

test("공통 shell은 기준 4단계와 현재 단계까지만 색칠하는 연결선을 가진다", () => {
  assert.match(shell, /"요청 전달", "깡통컴에서 처리 중", "결과 확인", "완료"/);
  assert.match(shell, /index <= view\.step \? "bg-emerald-500" : "bg-slate-200"/);
  assert.match(shell, /진행 화면을 닫아도 작업은 백그라운드에서 계속됩니다/);
});

test("건강디딤돌 단건 queued 응답은 취소 없는 common adapter로 표시한다", () => {
  assert.match(health, /setNationalSupportJob\(\{ id: resData\.jobId/);
  assert.match(health, /<AutomationProgressModal jobId=\{nationalSupportJob\.id\}/);
  assert.doesNotMatch(health.slice(health.indexOf("nationalSupportJob &&"), health.indexOf("nationalSupportJob &&") + 500), /onCancel=/);
});

test("보고서 처리의 이메일·K2B·검증은 legacy polling을 유지하면서 동일 shell을 사용한다", () => {
  assert.match(report, /api\/report-processing\/job-status/);
  assert.match(report, /api\/report-processing\/cancel-job/);
  assert.match(report, /email: \{ title:/);
  assert.match(report, /k2b: \{ title:/);
  assert.match(report, /k2b_verify: \{ title:/);
  assert.match(report, /<RemoteJobProgressDialog/);
});

test("MES와 보고서 처리에서 X는 화면만 닫고 백그라운드 작업 식별자는 보존한다", () => {
  assert.match(dashboard, /const \[showMesProgress, setShowMesProgress\] = useState\(false\)/);
  assert.match(dashboard, /onClose=\{\(\) => setShowMesProgress\(false\)\}/);
  assert.match(report, /onClose=\{\(\) => setShowRemoteJobProgress\(false\)\}/);
});

test("보고서 처리 취소 요청 중에는 공통 모달과 상단 중단 액션을 다시 실행하지 않는다", () => {
  assert.match(report, /status: 'pending' \| 'processing' \| 'cancel_requested'/);
  assert.match(report, /data\.status === 'cancel_requested'/);
  assert.match(report, /cancelPending=\{activeJob\.status === 'cancel_requested'\}/);
  assert.match(report, /disabled=\{activeJob\.status === 'cancel_requested'\}/);
  assert.match(report, /current\.status === 'cancel_requested' && status !== 'cancel_requested'/);
});

test("K2B 재검증도 등록 직후부터 기존 작업 상태 모니터를 사용한다", () => {
  assert.match(report, /monitorJob\(body\.jobId, 'k2b_verify'\)/);
  assert.match(report, /monitorJob\(jobId, 'k2b_verify'\)/);
  assert.match(report, /if \(jobType === 'k2b_verify'\) return;/);
});
