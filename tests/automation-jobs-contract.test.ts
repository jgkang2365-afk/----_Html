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
  supportsGenericAutomationCancellation,
  DOCUMENT_CANCEL_USE_DOCUMENT_ENDPOINT,
  NATIONAL_SUPPORT_CANCEL_NOT_SUPPORTED,
  unsupportedCancellationCode,
} from "../lib/automation/jobs";
import {
  hasMeasurementJournalForTarget,
  nationalSupportCompatibilityStatus,
} from "../lib/national-support/automation-contract";
import { forEachAscendingIdPage } from "../lib/scheduler/id-pages";
import { getNationalSupportDisplayStatus } from "../lib/national-support/eligibility";
import { LocalAutomationWorker } from "../lib/automation/local-automation-worker";

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
  assert.equal(nationalSupportCompatibilityStatus("JOURNAL_REGISTERED_SKIP"), "일지 등록 · 제외");
  assert.equal(getNationalSupportDisplayStatus({ period: "하반기", sync_status: "일지 등록 · 제외", national_support_status: null, industrial_accident_number: "1", commencement_number: "2", representative_name: "대표" } as any), "일지 등록 · 제외");
});

test("Health drain 중 도착한 wake는 다음 reconcile 요청으로 보존한다", async () => {
  const worker: any = Object.create(LocalAutomationWorker.prototype);
  worker.draining = true;
  worker.wakeRequested = false;
  await worker.drain();
  assert.equal(worker.wakeRequested, true);
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
  assert.match(claim, /claim_next_document_automation_job/);
  assert.doesNotMatch(claim, /claimNextAutomationJob/);
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
  assert.match(daemon, /allowed = self\.allow_effect_start\(str\(self\.current_job_id\)\)/);
  assert.match(daemon, /process\.stdin\.write\(json\.dumps\(\{"allow": allowed\}\)/);
  assert.match(daemon, /output_reader/);
  assert.match(daemon, /CANCEL_REQUESTED_BEFORE_EFFECT/);
  assert.match(daemon, /MES_EFFECT_UNCERTAIN/);
  assert.match(daemon, /update_automation_job_owned/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.update_automation_job_owned/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.mark_mes_automation_effect_started/);
  assert.match(migration, /job\.worker_id = p_worker_id/);
  assert.equal((download.match(/AUTOMATION_EVENT:effect_start_request/g) || []).length, 1);
});

test("Guard2 distinguishes a registered journal from a database/protocol error", () => {
  const worker = fs.readFileSync(path.join(process.cwd(), "lib/automation/local-automation-worker.ts"), "utf8");
  const flow = fs.readFileSync(path.join(process.cwd(), "건강디딤돌_접수_자동화.py"), "utf8");
  const cli = fs.readFileSync(path.join(process.cwd(), "scratch/national_support_flow_cli.py"), "utf8");
  assert.match(worker, /reason: "JOURNAL_REGISTERED"/);
  assert.match(worker, /reason: "GUARD_ERROR"/);
  assert.match(flow, /guard_reason == "JOURNAL_REGISTERED"/);
  assert.match(flow, /return "GUARD_ERROR"/);
  assert.match(flow, /guard_result\.get\("allow"\) is True/);
  assert.match(flow, /effect_result\.get\("allow"\) is True/);
  assert.match(cli, /"JOURNAL_REGISTERED_SKIP": "JOURNAL_REGISTERED_SKIP"/);
  assert.match(cli, /"GUARD_ERROR": "GUARD_ERROR"/);
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
  assert.match(migration, /request_payload->>'scheduled_date_kst'/);
  assert.match(migration, /INSERT INTO public\.notifications/);
});

test("scheduled MES slot은 활성 lane에서도 별도 PENDING intent로 남고 claim만 직렬화된다", () => {
  const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260911025729_automation_jobs_common_v1.sql"), "utf8");
  const enqueue = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.enqueue_automation_job"), migration.indexOf("REVOKE ALL ON FUNCTION public.claim_next_automation_job"));
  const claim = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.claim_next_automation_job"), migration.indexOf("CREATE OR REPLACE FUNCTION public.reconcile_stale_automation_jobs"));
  assert.match(enqueue, /p_request_payload->>'trigger' IS DISTINCT FROM 'scheduled'/);
  assert.match(enqueue, /ON CONFLICT \(idempotency_key\) DO UPDATE/);
  assert.match(claim, /pg_advisory_xact_lock\(hashtext\('automation:mes-sync'\)\)/);
  assert.match(claim, /active\.status IN \('RUNNING', 'CANCEL_REQUESTED', 'CONFIRM_REQUIRED'\)/);
  for (const slot of ["11:30", "12:00", "14:00"]) {
    assert.equal(mesScheduledIdempotencyKey(slot, "2026-09-12"), `mes:scheduled:2026-09-12:${slot}`);
  }
});

test("MES 취소 lease 만료는 무효과 취소·불확실 확인·syncSuccess 확인 완료로 나뉜다", () => {
  const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260911025729_automation_jobs_common_v1.sql"), "utf8");
  const recovery = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.reconcile_stale_automation_jobs"), migration.indexOf("CREATE OR REPLACE FUNCTION public.renew_automation_job_lease"));
  assert.match(recovery, /status = 'CANCELLED'[\s\S]*status = 'CANCEL_REQUESTED' AND job_type = 'MES_SYNC'[\s\S]*effect_started_at IS NULL/);
  assert.match(recovery, /status = 'COMPLETED'[\s\S]*status IN \('RUNNING', 'CANCEL_REQUESTED'\)[\s\S]*effect_confirmed_at IS NOT NULL[\s\S]*job_type = 'MES_SYNC' AND result_payload @> '\{"syncSuccess": true\}'/);
  assert.match(recovery, /status = 'CONFIRM_REQUIRED'[\s\S]*status IN \('RUNNING', 'CANCEL_REQUESTED'\)[\s\S]*effect_started_at IS NOT NULL/);
});

test("generic DELETE는 MES만 취소하고 문서·건강디딤돌은 명시 코드 409로 거절한다", () => {
  assert.equal(supportsGenericAutomationCancellation("MES_SYNC"), true);
  for (const type of ["DOCUMENT_GENERATION", "NATIONAL_SUPPORT"]) {
    assert.equal(supportsGenericAutomationCancellation(type), false);
  }
  assert.equal(unsupportedCancellationCode("DOCUMENT_GENERATION"), DOCUMENT_CANCEL_USE_DOCUMENT_ENDPOINT);
  assert.equal(unsupportedCancellationCode("NATIONAL_SUPPORT"), NATIONAL_SUPPORT_CANCEL_NOT_SUPPORTED);
  const route = fs.readFileSync(path.join(process.cwd(), "app/api/automation-jobs/[id]/route.ts"), "utf8");
  const deletion = route.slice(route.indexOf("export async function DELETE"));
  assert.ok(deletion.indexOf("supportsGenericAutomationCancellation(owned.job_type)") < deletion.indexOf(".update({ status: \"CANCELLED\""));
  assert.match(deletion, /errorCode: unsupportedCancellationCode\(owned\.job_type\)[\s\S]*status: 409/);
  assert.match(deletion, /\.eq\("job_type", "MES_SYNC"\)\.eq\("status", "PENDING"\)/);
  assert.match(deletion, /\.eq\("job_type", "MES_SYNC"\)\.eq\("status", "RUNNING"\)/);
});

test("17시 Health scheduler는 id ASC keyset으로 모든 페이지를 처리하고 MES slot은 고정된다", async () => {
  const source = fs.readFileSync(path.join(process.cwd(), "lib/scheduler/background-tasks.ts"), "utf8");
  const pages: number[] = [];
  const visited: number[] = [];
  await forEachAscendingIdPage(500, async (after, limit) => {
    pages.push(after);
    return Array.from({ length: 1101 }, (_, index) => ({ id: index + 1 }))
      .filter(row => row.id > after).slice(0, limit);
  }, async row => { visited.push(row.id); });
  assert.deepEqual(pages, [0, 500, 1000]);
  assert.equal(visited.length, 1101);
  assert.equal(new Set(visited).size, 1101);
  assert.match(source, /\.gt\('id', lastId\)\.order\('id', \{ ascending: true \}\)\.limit\(limit\)/);
  assert.match(source, /forEachAscendingIdPage\(pageSize/);
  for (const slot of ["11:30", "12:00", "14:00"]) {
    assert.match(source, new RegExp(`runMesDownloadScript\\('${slot}'\\)`));
  }
  assert.doesNotMatch(source, /toLocaleTimeString\('en-GB'/);
});

test("17시 페이지 안의 한 대상 enqueue 실패는 다음 대상과 다음 페이지를 막지 않는다", async () => {
  const visited: number[] = [];
  const failed: number[] = [];
  await forEachAscendingIdPage(2,
    async after => [{ id: 1 }, { id: 2 }, { id: 3 }].filter(row => row.id > after).slice(0, 2),
    async row => { visited.push(row.id); if (row.id === 2) throw new Error("enqueue"); },
    row => { failed.push(row.id); },
  );
  assert.deepEqual(visited, [1, 2, 3]);
  assert.deepEqual(failed, [2]);
});

test("문서 heartbeat는 두 lease 중 하나라도 소유하지 못하면 트랜잭션을 롤백한다", () => {
  const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260911025729_automation_jobs_common_v1.sql"), "utf8");
  const lease = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.renew_document_automation_job_lease"), migration.indexOf("CREATE OR REPLACE FUNCTION public.recover_cancelled_document_generation_jobs"));
  assert.equal((lease.match(/IF NOT FOUND THEN RAISE EXCEPTION 'DOCUMENT_AUTOMATION_LEASE_NOT_OWNED'/g) ?? []).length, 2);
  assert.match(lease, /job\.request_payload->>'document_generation_job_id' = p_legacy_job_id::text/);
  assert.match(lease, /RETURN QUERY SELECT renewed_legacy\.status/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.renew_document_automation_job_lease\(UUID,UUID,TEXT,UUID,JSONB\) FROM PUBLIC/);
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
