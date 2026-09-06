import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateOrchestrationTrace } from "../lib/measurement-integrity-orchestration-trace";

const trace = JSON.parse(
  readFileSync("data/measurement-integrity-k2b-orchestration-trace.v0.5.json", "utf8")
);

test("v0.1/v0.2/v0.4/v0.5/v0.5.1/v0.5.2 trace는 근거·결정·carry-forward를 보존한다", () => {
  assert.doesNotThrow(() => validateOrchestrationTrace(trace));
  assert.deepEqual(
    trace.entries.map((entry: any) => entry.experimentVersion),
    ["v0.1", "v0.2", "v0.4", "v0.5", "v0.5.1", "v0.5.2"]
  );
  const v05 = trace.entries.find((entry: any) => entry.experimentVersion === "v0.5");
  assert.equal(v05.runId, "K2B-V05-20260906-01");
  assert.ok(
    v05.roles.every(
      (role: any) =>
        role.requestedModel &&
        role.requestedEffort &&
        role.permission &&
        role.dependency &&
        role.status
    )
  );
  assert.ok(v05.decisions.some((decision: any) => decision.action === "MODEL_ESCALATION"));
  assert.ok(v05.delta.changes.some((change: string) => change.includes("pg_proc ACL")));
  assert.ok(v05.carryForward.length > 0);
});

test("v0.5.1은 STAGING ACL 실패에서 보정·독립 검증까지 추적한다", () => {
  const v051 = trace.entries.find((entry: any) => entry.experimentVersion === "v0.5.1");
  assert.equal(v051.runId, "K2B-V051-20260906-01");
  assert.equal(v051.parentExperimentVersion, "v0.5");
  assert.equal(v051.environment, "STAGING");
  assert.equal(v051.incident, "TEST_VALIDATION_FAILURE");
  assert.equal(v051.productionImpact, "NONE");
  assert.equal(v051.previousFailure, "source-text only / no actual ACL");
  assert.equal(v051.discoverer, "DB Security Verifier");
  assert.equal(v051.migration.rootCause, "DB_PERMISSION/SECURITY_DEFINER");
  assert.equal(v051.migration.status, "APPLIED_AND_ACTUAL_ACL_VERIFIED");
  assert.deepEqual(v051.migration.preApplyAcl.execute, {
    PUBLIC: false,
    anon: true,
    authenticated: true,
    service_role: true,
  });
  assert.deepEqual(v051.migration.postApplyAcl.execute, {
    PUBLIC: false,
    anon: false,
    authenticated: false,
    service_role: true,
  });
  assert.equal(v051.migration.postApplyAcl.verificationPassed, true);
  assert.equal(v051.migration.securityAdvisor.afterTargetWarnings, 0);
  assert.deepEqual(v051.migration.preliminaryServiceOnlyRpc, {
    PUBLIC: false,
    anon: false,
    authenticated: false,
    service_role: true,
  });
  assert.equal(v051.workspacePath, "/tmp/measurement-integrity-k2b-v02-integration");
  assert.equal(v051.currentWorkspaceMismatch, false);
  assert.equal(v051.finalStatus, "HOLD");
  assert.match(v051.verifierResult, /DB Security Verifier PASS/);
  assert.equal(v051.reassignmentCount, 1);
  assert.ok(
    v051.roles.some(
      (role: any) =>
        role.name === "Independent DB Security Verifier" &&
        role.requestedEffort === "high" &&
        role.status === "PASS"
    )
  );
  assert.ok(
    v051.roles.some(
      (role: any) =>
        role.name === "Trace\/Observability Worker" && role.requestedEffort === "medium"
    )
  );
  assert.ok(v051.decisions.some((decision: any) => decision.action === "REASSIGN_AND_ESCALATE"));
});

test("v0.5.1 Staging 종료 Gate는 release candidate를 보존하고 잔존물을 분류한다", () => {
  const v051 = trace.entries.find((entry: any) => entry.experimentVersion === "v0.5.1");
  assert.deepEqual(v051.stagingCloseout.classification.testData, []);
  assert.deepEqual(v051.stagingCloseout.classification.temporarySchema, []);
  assert.equal(v051.stagingCloseout.backgroundJobsCreatedSinceRunStart, 0);
  assert.equal(v051.stagingCloseout.productionResyncRequired, false);
  assert.equal(v051.stagingCloseout.productionDatabaseChanges, 0);
  assert.ok(
    v051.stagingCloseout.retainedSchemaChanges.includes("K2B SECURITY DEFINER ACL correction")
  );
  assert.ok(
    v051.decisions.some((decision: any) => decision.action === "RETAIN_AND_NO_CLEANUP_WRITE")
  );
});

test("v0.5.1 test accounting은 공식 ENV_BLOCKED와 대체 runner 결과를 분리하고 합계가 일치한다", () => {
  const accounting = trace.entries.find((entry: any) => entry.experimentVersion === "v0.5.1").testAccounting;
  for (const result of [
    accounting.focusedRegression,
    accounting.traceAndAclFocused,
    accounting.alternativeFullRunner,
  ]) {
    assert.equal(result.total, result.pass + result.fail + result.skip);
  }
  assert.equal(accounting.officialNpmTest.status, "ENV_BLOCKED");
  assert.equal(
    accounting.officialNpmTest.total,
    accounting.officialNpmTest.pass +
      accounting.officialNpmTest.fail +
      accounting.officialNpmTest.skip +
      accounting.officialNpmTest.envBlocked
  );
  assert.equal(accounting.officialNpmTest.total, 1);
  assert.equal(accounting.officialNpmTest.envBlocked, 1);
  assert.deepEqual(accounting.alternativeFullRunner, {
    total: 88,
    pass: 84,
    fail: 4,
    skip: 0,
  });
});

test("v0.5.2는 historical workspace recovery와 requested/actual runtime을 분리한다", () => {
  assert.match(trace.policy.version, /^UNKNOWN/);
  assert.equal(trace.workspaceRecovery.workspaceMismatchDetected, true);
  assert.equal(trace.workspaceRecovery.recoveryResult, "RECOVERED");
  assert.equal(trace.workspaceRecovery.currentWorkspaceMismatch, false);
  const v052 = trace.entries.find((entry: any) => entry.experimentVersion === "v0.5.2");
  assert.equal(v052.runId, "K2B-V052-20260906-01");
  assert.equal(v052.orchestrationStatus, "HOLD");
  assert.ok(v052.roles.every((role: any) => role.requestedModel && role.requestedEffort));
  assert.ok(v052.roles.every((role: any) => role.actualModel === "UNVERIFIABLE" && role.actualEffort === "UNVERIFIABLE"));
  assert.ok(v052.roles.every((role: any) => Array.isArray(role.runtimeEvidence) && role.runtimeEvidence.length > 0));
  assert.equal(trace.currentState.lastObservation.statusAtObservation.githubActions, "N/A");
});

test("trace validator는 민감 key와 잘못된 schema/status를 거부한다", () => {
  const withSecret = structuredClone(trace);
  withSecret.entries[0].credentials = "never";
  assert.throws(() => validateOrchestrationTrace(withSecret), /민감정보 key/);
  assert.throws(() => validateOrchestrationTrace({ ...trace, schemaVersion: 1 }), /지원하지 않는/);
  const badStatus = structuredClone(trace);
  badStatus.entries[0].finalStatus = "DONE";
  assert.throws(() => validateOrchestrationTrace(badStatus), /허용되지 않은/);
  const prematurePass = structuredClone(trace);
  prematurePass.entries.find((entry: any) => entry.experimentVersion === "v0.5.2").finalStatus = "PASS";
  assert.throws(() => validateOrchestrationTrace(prematurePass), /필수 Gate가 HOLD/);
  const missingExecutionId = structuredClone(trace);
  const firstV052Role = missingExecutionId.entries.find((entry: any) => entry.experimentVersion === "v0.5.2").roles[0];
  firstV052Role.actualModel = "gpt-5.6-sol";
  firstV052Role.actualEffort = "high";
  assert.throws(() => validateOrchestrationTrace(missingExecutionId), /actual runtime execution ID/);
});

test("trace API와 UI는 read-only/no-store이며 Version Delta를 먼저 표시한다", () => {
  const route = readFileSync("app/api/businesses/integrity/trace/route.ts", "utf8");
  const panel = readFileSync("components/features/MeasurementTargetIntegrityPanel.tsx", "utf8");
  assert.match(route, /checkPermission\("journal:read"\)/);
  assert.match(route, /Cache-Control.*no-store/);
  assert.doesNotMatch(route, /\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
  assert.match(panel, /버전별 오케스트레이션 변화/);
  assert.match(panel, /Coordinator 판단/);
  assert.match(panel, /다음 버전 전달/);
  assert.match(panel, /requestedModel/);
  assert.match(panel, /actualModel/);
  assert.match(panel, /현재 상태 조회/);
  assert.match(panel, /historical workspaceMismatch/);
  assert.match(panel, /환경 \/ 영향/);
  assert.match(panel, /이전 실패 \/ 발견자/);
  assert.match(panel, /Migration \/ 원인/);
  assert.match(panel, /Final status/);
  assert.match(panel, /Staging 종료 상태/);
  assert.match(panel, /Production 재동기화/);
});

test("ACL migration은 기존 세 RPC의 PUBLIC/anon/authenticated를 회수하고 service_role만 부여한다", () => {
  const migration = readFileSync(
    "supabase/migrations/20260906075441_harden_k2b_security_definer_acl_v051.sql",
    "utf8"
  );
  for (const signature of [
    "enqueue_k2b_automation_job(TEXT, JSONB)",
    "enqueue_k2b_verify_job(DATE, BIGINT)",
    "enqueue_k2b_upload_job(JSONB)",
  ]) {
    assert.match(
      migration,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${signature.replace(/[()]/g, "\\$&")}`)
    );
  }
  assert.equal((migration.match(/FROM PUBLIC, anon, authenticated/g) || []).length, 3);
  assert.equal((migration.match(/TO service_role/g) || []).length, 3);
});

test("legacy claim RPC도 exact signature와 service_role 전용 ACL로 actual verification 대상에 포함한다", () => {
  const migration = readFileSync(
    "supabase/migrations/20260906162000_serialize_legacy_k2b_direct_upload.sql",
    "utf8"
  );
  const verification = readFileSync(
    "supabase/verification/20260906_verify_k2b_rpc_acl.sql",
    "utf8"
  );
  assert.match(migration, /SECURITY DEFINER SET search_path = public/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.claim_k2b_legacy_direct_job\(JSONB\)/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.claim_k2b_legacy_direct_job\(JSONB\)\s+TO service_role/);
  assert.match(verification, /public\.claim_k2b_legacy_direct_job\(jsonb\)/);
});

test("K2B 실행상태는 remote read/집계/DB 저장 근거를 구조화해 노출한다", () => {
  const worker = readFileSync("lib/automation/worker-daemon.ts", "utf8");
  const statusRoute = readFileSync(
    "app/api/report-processing/k2b-execution-status/route.ts",
    "utf8"
  );
  const statusPanel = readFileSync("components/features/K2BExecutionStatusPanel.tsx", "utf8");
  assert.match(worker, /remoteK2BReadExecuted: false/);
  assert.match(worker, /remoteK2BReadAttempted: false/);
  assert.match(worker, /executionResult\.remoteK2BReadExecuted = true/);
  assert.match(worker, /databaseSaveCompleted/);
  assert.match(worker, /uploadExecuted: false/);
  assert.match(worker, /\.select\('id'\)/);
  assert.match(statusRoute, /execution_result/);
  assert.match(statusRoute, /requestedJobId/);
  assert.match(statusRoute, /serializationDisposition/);
  assert.match(statusRoute, /job\.payload\?\.trigger === "scheduled" \|\| job\.payload\?\.trigger === "manual"/);
  assert.doesNotMatch(statusRoute, /requestedBy == null/);
  assert.match(statusPanel, /실제 K2B remote read/);
  assert.match(statusPanel, /DB 저장/);
  assert.match(statusPanel, /🟢/);
});

test("legacy 직접 업로드는 동기 계약을 유지하며 공통 K2B guard와 권한 검사를 사용한다", () => {
  const migration = readFileSync(
    "supabase/migrations/20260906162000_serialize_legacy_k2b_direct_upload.sql",
    "utf8"
  );
  const route = readFileSync("app/api/report-processing/upload-k2b/route.ts", "utf8");
  assert.match(migration, /claim_k2b_legacy_direct_job/);
  assert.match(migration, /job_type IN \('k2b', 'k2b_verify', 'k2b_legacy_direct'\)/);
  assert.match(migration, /updated_at < CURRENT_TIMESTAMP - INTERVAL '30 minutes'/);
  assert.match(migration, /FROM PUBLIC, anon, authenticated/);
  assert.match(route, /checkPermission\('journal:write'\)/);
  assert.match(route, /admin\.rpc\('claim_k2b_legacy_direct_job'/);
  assert.match(route, /guardHeartbeat = setInterval/);
  assert.match(route, /cleanupError/);
  assert.match(route, /status: successCount > 0 \? 'success' : 'failed'/);
  assert.match(route, /return NextResponse\.json\(\{\s*message:/);
  assert.doesNotMatch(route, /status:\s*202/);
});
