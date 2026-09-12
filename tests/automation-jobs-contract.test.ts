import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  AUTOMATION_JOB_STATUSES,
  documentIdempotencyKey,
  mesManualIdempotencyKey,
  mesScheduledIdempotencyKey,
  nationalSupportIdempotencyKey,
  terminalAutomationStatus,
} from "../lib/automation/jobs";
import {
  hasMeasurementJournalForTarget,
  nationalSupportCompatibilityStatus,
} from "../lib/national-support/automation-contract";

test("automation job status contract has only the approved states", () => {
  assert.deepEqual(AUTOMATION_JOB_STATUSES, [
    "PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCEL_REQUESTED", "CANCELLED", "CONFIRM_REQUIRED",
  ]);
  assert.equal(terminalAutomationStatus("COMPLETED"), true);
  assert.equal(terminalAutomationStatus("CONFIRM_REQUIRED"), true);
  assert.equal(terminalAutomationStatus("RUNNING"), false);
});

test("idempotency keys are stable for one logical request", () => {
  assert.equal(mesManualIdempotencyKey("request-1"), "mes:manual:request-1");
  assert.equal(mesScheduledIdempotencyKey("11:30", "2026-09-11"), "mes:scheduled:2026-09-11:11:30");
  assert.equal(documentIdempotencyKey(4, ["B", "A"], ["v2", "v1"]), documentIdempotencyKey(4, ["A", "B"], ["v1", "v2"]));
  assert.equal(nationalSupportIdempotencyKey("lookup", "100", 2026, "하반기"), "national-support:lookup:100:2026:하반기");
});

test("migration protects payload and uses SKIP LOCKED atomic claim", () => {
  const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260911025729_automation_jobs_common_v1.sql"), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.automation_jobs/);
  assert.match(migration, /UNIQUE \(idempotency_key\)/);
  assert.match(migration, /FOR UPDATE SKIP LOCKED/);
  assert.match(migration, /automation_job_signals/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.automation_jobs FROM anon, authenticated/);
  assert.match(migration, /worker_lease_expires_at/);
  assert.match(migration, /reconcile_stale_automation_jobs/);
  assert.match(migration, /status = 'CONFIRM_REQUIRED'/);
  assert.match(migration, /effect_started_at IS NULL/);
  assert.match(migration, /status = 'PENDING'/);
  assert.match(migration, /effect_confirmed_at IS NOT NULL/);
  assert.match(migration, /claim_next_document_generation_job/);
});

test("Production canonical journal key and compatibility projection are fixed", async () => {
  const calls: Array<[string, unknown]> = [];
  const query: any = {
    select: () => query,
    eq: (column: string, value: unknown) => { calls.push([column, value]); return query; },
    limit: async () => ({ data: [], error: null }),
  };
  const client: any = { from: () => query };
  assert.equal(await hasMeasurementJournalForTarget(client, { code: "A", year: 2026, period: "하반기" }), false);
  assert.deepEqual(calls, [["code", "A"], ["measurement_year", 2026], ["measurement_period", "하반기"]]);
  assert.equal(nationalSupportCompatibilityStatus("SUPPORT"), "성공");
  assert.equal(nationalSupportCompatibilityStatus("NON_SUPPORT"), "성공");
  assert.equal(nationalSupportCompatibilityStatus("OVER_50_RECHECK"), "비대상대기");
  assert.equal(nationalSupportCompatibilityStatus("NO_EMPLOYEE_INFO_RECHECK"), "비대상대기");
  assert.equal(nationalSupportCompatibilityStatus("EMPLOYEE_CHECK_FAILED_RECHECK"), "비대상대기");
  assert.equal(nationalSupportCompatibilityStatus("APPLIED_WAITING_RESULT"), "신청완료대기");
  assert.equal(nationalSupportCompatibilityStatus("ALREADY_APPLIED"), "확인대기");
  assert.equal(nationalSupportCompatibilityStatus("APPLICATION_UNCERTAIN"), "수동확인필요");
});

test("document and national-support boundaries are explicit rather than inferred from display strings", () => {
  const documentWorker = fs.readFileSync(path.join(process.cwd(), "document_worker.py"), "utf8");
  const nationalWorker = fs.readFileSync(path.join(process.cwd(), "lib/automation/local-automation-worker.ts"), "utf8");
  const flow = fs.readFileSync(path.join(process.cwd(), "scratch/national_support_flow_cli.py"), "utf8");
  assert.match(documentWorker, /mark_final_publish_effect\(client, job_id\)/);
  assert.match(documentWorker, /effect-started/);
  assert.match(flow, /worker_boundary\("journal_guard_before_apply"\)/);
  assert.match(flow, /worker_boundary\("effect_started"\)/);
  assert.doesNotMatch(nationalWorker, /includes\(.*result/i);
});

test("MES upload requires explicit database synchronization acknowledgement", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "mes_download.py"), "utf8");
  assert.match(source, /res_data\.get\("syncSuccess"\) is True/);
  assert.match(source, /웹 DB 동기화 확인 실패/);
});

test("durable delayed follow-up uses available_at and one-shot wake, never an idle interval", () => {
  const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260911025729_automation_jobs_common_v1.sql"), "utf8");
  const worker = fs.readFileSync(path.join(process.cwd(), "lib/automation/local-automation-worker.ts"), "utf8");
  assert.match(migration, /available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  assert.match(migration, /status = 'PENDING' AND available_at <= CURRENT_TIMESTAMP/);
  assert.match(migration, /complete_automation_job_with_followup/);
  assert.match(migration, /ON CONFLICT\(idempotency_key\) DO NOTHING/);
  assert.match(worker, /scheduleEarliestFuture/);
  assert.match(worker, /scheduleDelayedWake/);
  assert.match(worker, /setTimeout/);
  assert.doesNotMatch(worker, /setInterval/);
  assert.match(worker, /filter: "job_type=eq\.NATIONAL_SUPPORT"/);
});

test("national-support enqueue serializes active common and legacy work for the target", () => {
  const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260911025729_automation_jobs_common_v1.sql"), "utf8");
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\(p_target_key\)\)/);
  assert.match(migration, /NATIONAL_SUPPORT_LEGACY_JOB_ACTIVE/);
  assert.match(migration, /legacy\.job_type = 'national_support'/);
  assert.match(migration, /status IN \('PENDING','RUNNING','CANCEL_REQUESTED','CONFIRM_REQUIRED'\)/);
  assert.match(migration, /guard_legacy_national_support_enqueue/);
  assert.match(migration, /NATIONAL_SUPPORT_AUTOMATION_JOB_ACTIVE/);
});

test("document common and legacy terminal paths share an ownership-bound transaction", () => {
  const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260911025729_automation_jobs_common_v1.sql"), "utf8");
  const claim = fs.readFileSync(path.join(process.cwd(), "app/api/document-worker/jobs/claim/route.ts"), "utf8");
  const complete = fs.readFileSync(path.join(process.cwd(), "app/api/document-worker/jobs/[id]/complete/route.ts"), "utf8");
  const effect = fs.readFileSync(path.join(process.cwd(), "app/api/document-worker/jobs/[id]/effect-started/route.ts"), "utf8");
  const heartbeat = fs.readFileSync(path.join(process.cwd(), "app/api/document-worker/jobs/[id]/cancel-status/route.ts"), "utf8");
  assert.match(migration, /reconcile_stale_document_automation_jobs/);
  assert.match(migration, /complete_document_automation_job/);
  assert.match(migration, /mark_document_automation_effect_started/);
  assert.match(migration, /DOCUMENT_AUTOMATION_TERMINAL_NOT_OWNED/);
  assert.match(migration, /effect_started_at IS NULL/);
  assert.match(migration, /effect_started_at IS NOT NULL[\s\S]*effect_confirmed_at IS NULL/);
  assert.match(claim, /reconcile_stale_document_automation_jobs/);
  assert.match(complete, /complete_document_automation_job/);
  assert.match(effect, /mark_document_automation_effect_started/);
  assert.match(migration, /renew_document_automation_job_lease/);
  assert.match(migration, /recover_cancelled_document_generation_jobs/);
  assert.match(heartbeat, /renew_document_automation_job_lease/);
});

test("MES effect event is streamed before upload confirmation and classifies failures by the boundary", () => {
  const daemon = fs.readFileSync(path.join(process.cwd(), "mes_daemon.py"), "utf8");
  const download = fs.readFileSync(path.join(process.cwd(), "mes_download.py"), "utf8");
  const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260911025729_automation_jobs_common_v1.sql"), "utf8");
  assert.match(download, /AUTOMATION_EVENT:effect_start_request/);
  assert.match(download, /permission\.get\("allow"\) is not True/);
  assert.match(daemon, /stderr=subprocess\.STDOUT/);
  assert.match(daemon, /effect_started_at=now\(\)[\s\S]*allowed = True/);
  assert.match(daemon, /process\.stdin\.write\(json\.dumps\(\{"allow": allowed\}\)/);
  assert.match(daemon, /output_reader/);
  assert.match(daemon, /CANCEL_REQUESTED_BEFORE_EFFECT/);
  assert.match(daemon, /MES_EFFECT_UNCERTAIN/);
  assert.match(daemon, /update_automation_job_owned/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.update_automation_job_owned/);
  assert.match(migration, /job\.worker_id = p_worker_id/);
});

test("common document confirmation blocks a legacy replay at the database boundary", () => {
  const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260911025729_automation_jobs_common_v1.sql"), "utf8");
  const route = fs.readFileSync(path.join(process.cwd(), "app/api/document-generation/route.ts"), "utf8");
  assert.match(migration, /guard_document_automation_enqueue/);
  assert.match(migration, /DOCUMENT_AUTOMATION_ACTIVE_OR_CONFIRM_REQUIRED/);
  assert.match(migration, /BEFORE INSERT ON public\.document_generation_jobs/);
  assert.match(route, /DOCUMENT_EFFECT_CONFIRM_REQUIRED/);
});

test("MES manual and scheduled requests use one active execution lane", () => {
  const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260911025729_automation_jobs_common_v1.sql"), "utf8");
  const dashboard = fs.readFileSync(path.join(process.cwd(), "components/features/DashboardClient.tsx"), "utf8");
  assert.match(migration, /p_job_type = 'MES_SYNC'/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\('automation:mes-sync'\)\)/);
  assert.match(migration, /WHERE job_type = 'MES_SYNC'/);
  assert.match(dashboard, /mesRequestIdRef\.current \?\? crypto\.randomUUID\(\)/);
  assert.match(dashboard, /mesRequestIdRef\.current = null/);
});

test("14:00 MES post-sync action is enqueued once by the verified terminal transition", () => {
  const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260911025729_automation_jobs_common_v1.sql"), "utf8");
  assert.match(migration, /enqueue_mes_final_post_sync_check/);
  assert.match(migration, /OLD\.status <> 'COMPLETED' AND NEW\.status = 'COMPLETED'/);
  assert.match(migration, /NEW\.job_type = 'MES_SYNC'/);
  assert.match(migration, /NEW\.request_payload @> '\{"trigger":"scheduled","slot":"14:00","final_check":true\}'/);
  assert.match(migration, /NEW\.result_payload @> '\{"syncSuccess":true\}'/);
  assert.match(migration, /ON CONFLICT \(idempotency_key\) DO NOTHING/);
  assert.match(migration, /process_mes_post_sync_checks/);
  assert.match(migration, /INSERT INTO public\.notifications/);
});

test("MES 후속 작업은 공통 스키마와 ACL·Realtime 비공개 경계를 유지한다", () => {
  const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260911025729_automation_jobs_common_v1.sql"), "utf8");
  const section = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.run_mes_final_post_sync_check"));
  assert.match(migration, /status TEXT NOT NULL DEFAULT 'PENDING'/);
  assert.match(migration, /request_payload JSONB NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(migration, /available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  assert.match(migration, /CONSTRAINT automation_jobs_idempotency_key_unique UNIQUE \(idempotency_key\)/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.automation_jobs FROM anon, authenticated/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.automation_job_signals \([\s\S]*?result_code TEXT,[\s\S]*?\);/);
  const signals = migration.slice(migration.indexOf("CREATE TABLE IF NOT EXISTS public.automation_job_signals"), migration.indexOf("ALTER TABLE public.automation_job_signals"));
  assert.doesNotMatch(signals, /request_payload|result_payload|error_message|requested_by/);
  for (const name of ["run_mes_final_post_sync_check(UUID)", "enqueue_mes_final_post_sync_check()", "process_mes_post_sync_checks(INTEGER)"]) {
    assert.ok(section.includes(`REVOKE ALL ON FUNCTION public.${name} FROM PUBLIC`));
  }
  assert.match(section, /GRANT EXECUTE ON FUNCTION public\.process_mes_post_sync_checks\(INTEGER\) TO service_role/);
  assert.doesNotMatch(section, /GRANT EXECUTE ON FUNCTION public\.process_mes_post_sync_checks\(INTEGER\) TO (?:anon|authenticated)/);
  assert.equal((section.match(/SECURITY DEFINER SET search_path = public/g) ?? []).length, 3);
  assert.match(section, /WHERE job_type = 'MES_POST_SYNC_CHECK' AND status = 'PENDING'/);
  assert.match(section, /FOR UPDATE SKIP LOCKED LIMIT p_limit/);
  assert.match(section, /EXCEPTION WHEN OTHERS THEN[\s\S]*status=CASE WHEN attempts >= 3 THEN 'FAILED' ELSE 'PENDING' END/);
});

test("건강디딤돌 종료와 호환 표시값은 소유권 경계에서 원자 갱신하고 follow-up 경로를 보존한다", () => {
  const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260911025729_automation_jobs_common_v1.sql"), "utf8");
  const worker = fs.readFileSync(path.join(process.cwd(), "lib/automation/local-automation-worker.ts"), "utf8");
  const terminal = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.complete_national_support_automation_job"), migration.indexOf("REVOKE ALL ON FUNCTION public.complete_national_support_automation_job"));
  const followup = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.complete_automation_job_with_followup"), migration.indexOf("REVOKE ALL ON FUNCTION public.complete_automation_job_with_followup"));
  for (const sql of [terminal, followup]) {
    assert.match(sql, /job_type='NATIONAL_SUPPORT'/);
    assert.match(sql, /worker_id=p_worker_id/);
    assert.match(sql, /request_payload->>'target_id'=p_target_id::text/);
    assert.match(sql, /UPDATE public\.measurement_target_business/);
    assert.match(sql, /SET search_path = public/);
  }
  assert.match(terminal, /status='RUNNING'/);
  assert.match(terminal, /NATIONAL_SUPPORT_TERMINAL_NOT_OWNED/);
  assert.match(terminal, /INSERT INTO public\.national_support_application/);
  assert.match(terminal, /ON CONFLICT \(code, year, period\) DO UPDATE/);
  assert.match(terminal, /UPDATE public\.measurement_journal SET national_support_status/);
  assert.match(followup, /INSERT INTO public\.automation_jobs/);
  assert.match(worker, /rpc\("complete_national_support_automation_job"/);
  assert.match(worker, /rpc\("complete_automation_job_with_followup"/);
  assert.doesNotMatch(worker, /projectCompatibility|projectFailure/);
});
