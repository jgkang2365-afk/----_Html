import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as ranges from '../lib/automation/k2b-original-sync';
import * as scope from '../lib/report-processing/scope';

// API/Worker 본문을 그대로 실행하고 인증·DB·원격 조회 경계만 합성으로 격리한다.
function loadModule(file: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  runInNewContext(compiled, { exports, URL, console, process,
    require: (id: string) => dependencies[id] ?? {},
  });
  return exports;
}
const copy = (value: unknown) => JSON.parse(JSON.stringify(value));

test('일반 7일 및 관리자 1일/2일/31일과 32일 경계를 유지한다', () => {
  assert.deepEqual(ranges.buildGeneralK2BVerificationRange('2026-09-29'), { fromDate: '2026-09-23', toDate: '2026-09-29' });
  for (const fromDate of ['2026-09-29', '2026-09-28', '2026-08-30']) {
    assert.deepEqual(ranges.assertAdminK2BVerificationRange(fromDate, '2026-09-29'), { fromDate, toDate: '2026-09-29' });
  }
  assert.throws(() => ranges.assertAdminK2BVerificationRange('2026-08-29', '2026-09-29'), /OVER_31/);
});

async function invokeRoute(body: unknown, role = '관리자') {
  const jobs: any[] = [];
  const route = loadModule('app/api/report-processing/verify-k2b/route.ts', {
    'next/server': { NextResponse: { json: (body: unknown, options?: { status: number }) => ({ body: copy(body), status: options?.status ?? 200 }) } },
    '@/lib/auth/check-permission': { checkPermission: async () => {} },
    '@/lib/auth/session': { getSession: async () => ({ role, userId: 'synthetic-admin' }) },
    '@/lib/utils/date-utils': { getKSTDateString: () => '2026-09-29' },
    '@/lib/automation/k2b-original-sync': ranges,
    '@/lib/supabase/admin': { createAdminClient: () => ({ rpc: async (name: string, args: unknown) => {
      jobs.push({ name, ...copy(args) }); return { data: 'synthetic-job', error: null };
    } }) },
  });
  const response = await route.POST({ json: async () => body, url: 'http://localhost:3100/api/report-processing/verify-k2b' });
  return { response, jobs };
}

test('실제 API 본문은 관리자 명시 기간을 enqueue RPC payload에 보존한다', async () => {
  for (const fromDate of ['2026-09-29', '2026-09-28', '2026-08-30']) {
    const { response, jobs } = await invokeRoute({ fromDate, toDate: '2026-09-29' });
    assert.equal(response.status, 200);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].name, 'enqueue_k2b_automation_job');
    assert.equal(jobs[0].p_job_type, 'k2b_verify');
    assert.deepEqual(jobs[0].p_payload, {
      fromDate, toDate: '2026-09-29', resultDate: '2026-09-29', trigger: 'manual', requestedBy: 'synthetic-admin',
      serializationDisposition: 'accepted_without_active_k2b', calendarSyncApiUrl: 'http://localhost:3100/api/report-processing/calendar-sync',
    });
    assert.match(response.body.message, /관리자 지정기간/);
    assert.doesNotMatch(response.body.message, /최근 7일/);
  }
});

test('일반 API는 서버 KST 오늘 기준이며 관리자 권한·31일 제한은 enqueue 전에 검사한다', async () => {
  const general = await invokeRoute({});
  assert.deepEqual(general.response.body.range, { fromDate: '2026-09-23', toDate: '2026-09-29' });
  assert.equal(general.jobs[0].p_payload.fromDate, undefined);
  assert.equal(general.jobs[0].p_payload.resultDate, '2026-09-29');
  assert.match(general.response.body.message, /최근 7일/);
  const forbidden = await invokeRoute({ fromDate: '2026-09-29', toDate: '2026-09-29' }, '사용자');
  assert.equal(forbidden.response.status, 403); assert.equal(forbidden.jobs.length, 0);
  const tooLong = await invokeRoute({ fromDate: '2026-08-29', toDate: '2026-09-29' });
  assert.notEqual(tooLong.response.status, 200); assert.equal(tooLong.jobs.length, 0);
  const incomplete = await invokeRoute({ fromDate: '2026-09-29' });
  assert.equal(incomplete.response.status, 400); assert.equal(incomplete.jobs.length, 0);
});

test('실제 Worker 본문은 명시 기간을 DB 후보와 원격 조회에 사용하고 검색조건 증거를 저장한다', async () => {
  for (const explicit of [true, false]) {
    const fromDate = explicit ? '2026-09-29' : '2026-09-23';
    const filters: unknown[][] = [], queries: unknown[][] = [], saved: any[] = [], statuses: unknown[][] = [];
    const query: any = { then: (resolve: (value: unknown) => void) => resolve({ data: [], error: null }) };
    for (const name of ['select', 'gte', 'lte', 'in', 'not', 'is']) query[name] = (...args: unknown[]) => { filters.push([name, ...args]); return query; };
    const snapshot = { fromDate: { domValue: fromDate.replaceAll('-', ''), componentValue: fromDate.replaceAll('-', '') }, toDate: { domValue: '20260929', componentValue: '20260929' } };
    const evidence = { beforeInput: snapshot, afterInput: snapshot, beforeSearch: snapshot, afterSearch: snapshot };
    const { WorkerDaemon } = loadModule('lib/automation/worker-daemon.ts', {
      '../supabase/server': { createClient: async () => ({ from: () => query }) },
      './k2b-original-sync': ranges, '../report-processing/scope': scope,
      '../utils/date-utils': { getKSTISOString: () => '2026-09-29T10:00:00+09:00' },
      './k2b-verification-service': { querySubmissionResultsForRange: async (...args: unknown[]) => {
        queries.push(args);
        return { rows: [], expectedRowCount: 0, completeness: 'COMPLETE', readMethod: 'nexacro_dataset', searchRange: evidence };
      } },
    });
    const worker = new WorkerDaemon();
    worker.updateK2BExecutionResult = async (_id: string, value: unknown) => { saved.push(copy(value)); };
    worker.updateJobStatus = async (...args: unknown[]) => { statuses.push(args); };
    await worker.processK2BVerifyJob({ id: 'synthetic-job', payload: {
      resultDate: '2026-09-29', trigger: 'manual', ...(explicit ? { fromDate: '2026-09-29', toDate: '2026-09-29' } : {}),
    } });
    assert.deepEqual(copy(queries), [[fromDate, '2026-09-29']]);
    assert.ok(filters.some(filter => filter[0] === 'gte' && filter[1] === 'k2b_send_date' && filter[2] === fromDate));
    assert.ok(filters.some(filter => filter[0] === 'lte' && filter[1] === 'k2b_send_date' && filter[2] === '2026-09-29'));
    assert.equal(saved.at(-1).fromDate, fromDate); assert.equal(saved.at(-1).toDate, '2026-09-29');
    assert.deepEqual(saved.at(-1).searchRange, evidence);
    assert.deepEqual(saved.at(-1).queriedDates, [fromDate, '2026-09-29']);
    assert.deepEqual(copy(statuses), [['synthetic-job', 'success', null]]);
  }
});
