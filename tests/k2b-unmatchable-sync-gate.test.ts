import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkerDaemon } from '../lib/automation/worker-daemon';
import { parseK2BSubmissionGrid, type K2BGridRead } from '../lib/automation/k2b-original-sync';
import { getKSTDateString } from '../lib/utils/date-utils';

const today = getKSTDateString();
const headers = ['청구 파일명', '사업장명', '처리상태', '접수일', '사업년도', '반기', '지원구분', '접수번호', '관리번호', '개시번호', '순번'];
const normal = ['normal.xml', 'H0508 synthetic', '정상처리', today, '2026', '하반기', '국고', 'R-new', '12345', '00001', '1'];
const unrelatedError = ['old-error.xml', '', '파일오류', today, '', '', '', '', '', '', ''];
const ownError = ['normal.xml', '', '파일오류', today, '', '', '', '', '', '', ''];
const complete = (rows: string[][]): K2BGridRead => parseK2BSubmissionGrid(headers, rows, {
  expectedRowCount: rows.length, collectedUniqueRowCount: rows.length,
  readMethod: 'nexacro_dataset', completeness: 'COMPLETE',
});
const jobId = '11111111-1111-4111-8111-111111111111';

function fixture(grid: K2BGridRead, options: { passed?: number; receiptFailure?: boolean; errorFailure?: boolean } = {}) {
  const daemon = WorkerDaemon.getInstance() as any;
  const original = new Map<string, unknown>();
  const override = (key: string, value: unknown) => {
    original.set(key, daemon[key]);
    daemon[key] = value;
  };
  const snapshots: Record<string, any>[] = [];
  const statuses: { status: string; message?: string }[] = [];
  const receiptRows: string[] = [];
  const errorRows: string[] = [];
  const provenSubmissionIds: (string | null)[] = [];
  const journalUpdates: Record<string, unknown>[] = [];
  const cursorDates: string[] = [];
  const journal = {
    id: 508, code: 'H0508', business_name: 'H0508 synthetic',
    industrial_accident_number: '12345', commencement_number: '00001',
    measurement_year: 2026, measurement_period: '하반기', k2b_status: '정상처리',
    k2b_send_date: today, k2b_verified_status: 'GREEN', k2b_verified_send_date: today,
    k2b_verified_remote_status: '정상처리', k2b_consistency_status: 'GREEN',
  };
  const journalQuery = (stale = false): any => ({
    in: () => journalQuery(stale),
    lt: () => journalQuery(true),
    or: () => journalQuery(true),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: stale ? [] : [journal], error: null }).then(resolve, reject),
  });
  const admin = {
    rpc: async (name: string, args: Record<string, any>) => {
      if (name === 'upsert_k2b_unmatchable_error') {
        errorRows.push(args.p_row.sourceKey);
        provenSubmissionIds.push(args.p_submission_job_id);
        if (options.errorFailure) return { data: null, error: new Error('ERROR_ORIGINAL_SAVE_FAILED') };
        return { data: { reviewState: errorRows.length <= (options.passed ?? 0) ? 'PASSED' : 'WAITING' }, error: null };
      }
      if (name === 'upsert_k2b_file_receipt') {
        receiptRows.push(args.p_receipt.sourceKey);
        return options.receiptFailure
          ? { data: null, error: new Error('NORMAL_RECEIPT_SAVE_FAILED') }
          : { data: { disposition: 'inserted' }, error: null };
      }
      if (name === 'advance_k2b_sync_cursor') {
        cursorDates.push(args.p_through_date);
        return { data: null, error: null };
      }
      throw new Error(`unexpected RPC: ${name}`);
    },
    from: (table: string) => {
      if (table === 'k2b_sync_state') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: { last_successful_through_date: '2026-09-21' }, error: null,
      }) }) }) };
      if (table === 'measurement_journal') return {
        select: () => journalQuery(),
        update: (patch: Record<string, unknown>) => {
          journalUpdates.push(patch);
          return { eq: async () => ({ error: null }) };
        },
      };
      throw new Error(`unexpected table: ${table}`);
    },
  };
  override('k2bOriginalSyncAdmin', () => admin);
  override('k2bOriginalSyncReadOnlySession', async (run: (service: unknown) => Promise<unknown>) =>
    run({ querySubmissionResultsForRange: async () => grid }));
  override('updateK2BExecutionResult', async (_id: string, result: Record<string, unknown>) => {
    snapshots.push(structuredClone(result));
  });
  override('updateJobStatus', async (_id: string, status: string, message?: string) => {
    statuses.push({ status, message });
  });
  override('syncCalendarAfterK2BJournalChange', async () => ({ attempted: false }));
  return {
    daemon, admin, snapshots, statuses, receiptRows, errorRows, provenSubmissionIds, journalUpdates, cursorDates, journal, override,
    restore: () => { for (const [key, value] of original) daemon[key] = value; },
    runOriginal: (postUpload = false) => daemon.processK2BOriginalSyncJob(
      { id: jobId, payload: postUpload ? {} : { trigger: 'scheduled' } },
      postUpload ? { grid, date: today, provenErrorSourceKeys: new Set<string>() } : undefined,
    ),
  };
}

test('unrelated errors wait separately while the normal H0508 receipt remains confirmed', async () => {
  const run = fixture(complete([normal, unrelatedError, unrelatedError]));
  try {
    await run.runOriginal(true);
    assert.equal(run.receiptRows.length, 1);
    assert.equal(run.errorRows.length, 2);
    assert.equal(run.snapshots.at(-1)?.databaseSaveCompleted, true);
    assert.equal(run.snapshots.at(-1)?.errorApprovalPending, true);
    assert.equal(run.snapshots.at(-1)?.unmatchableErrorPersistence.awaitingApproval, 2);
    assert.deepEqual(run.cursorDates, []);
    assert.deepEqual(run.statuses, []);
    assert.equal(run.journalUpdates.some((patch) => patch.k2b_verified_status && patch.k2b_verified_status !== 'GREEN'), false);
  } finally { run.restore(); }
});

async function runUpload(grid: K2BGridRead, options: { receiptFailure?: boolean; errorFailure?: boolean } = {}) {
  const run = fixture(grid, options);
  const waits: number[] = [];
  const notifications: string[] = [];
  const journalQuery: any = {
    in: () => journalQuery,
    eq: () => journalQuery,
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: [run.journal], error: null }).then(resolve, reject),
  };
  run.override('createK2BJobSupabaseClient', async () => ({
    from: () => ({
      select: () => journalQuery,
      update: () => ({ eq: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) }),
    }),
  }));
  run.override('createK2BJobService', () => ({
    init: async () => undefined, login: async () => undefined, quit: async () => undefined,
    logBusinessBoundaryState: async () => undefined,
    uploadReport: async () => ({ success: true, status: '업로드 완료' }),
    queryPostUploadSubmissionResultsForDate: async () => grid,
  }));
  run.override('findK2BJobReportFiles', () => ({ dataFile: { path: 'normal.xml', filename: 'normal.xml' }, drawings: [] }));
  run.override('loadK2BPreUploadGrid', async () => complete([]));
  run.override('loadK2BSourceKeysForDate', async () => new Set());
  run.override('loadPriorK2BTargetKeysForDate', async () => new Set());
  run.override('waitForK2BPostUploadGrid', async (ms: number) => { waits.push(ms); });
  run.override('isCancelRequested', async () => false);
  run.override('createInAppNotification', async (_id: number, _type: string, message: string) => { notifications.push(message); });
  run.override('notifyAllManagers', async (_type: string, message: string) => { notifications.push(message); });
  try {
    const results = await run.daemon.processK2BJob({ id: jobId, payload: {
      requestUser: { id: 42 },
      targets: [{ code: 'H0508', business_name: 'H0508 synthetic', year: 2026, period: '하반기',
        industrial_accident_number: '12345', commencement_number: '00001' }],
    } });
    return { results, statuses: run.statuses, receiptRows: run.receiptRows, errorRows: run.errorRows,
      provenSubmissionIds: run.provenSubmissionIds, journalUpdates: run.journalUpdates,
      waits, notifications, snapshots: run.snapshots };
  } finally { run.restore(); }
}

test('one canonical normal upload succeeds despite two unrelated pending file errors', async () => {
  const run = await runUpload(complete([normal, unrelatedError, unrelatedError]));
  assert.equal(run.results?.[0].success, true);
  assert.equal(run.statuses.at(-1)?.status, 'success');
  assert.equal(run.receiptRows.length, 1);
  assert.equal(run.errorRows.length, 2);
  assert.equal(run.snapshots.at(-1)?.errorApprovalPending, true);
  assert.deepEqual(run.provenSubmissionIds, [null, null]);
  assert.deepEqual(run.waits, [5000]);
  assert.equal(run.journalUpdates.some((patch) => patch.k2b_verified_status && patch.k2b_verified_status !== 'GREEN'), false);
});

test('the uploaded file itself with an identity-free error is not reported as a normal receipt', async () => {
  const run = await runUpload(complete([ownError]));
  assert.equal(run.results?.[0].success, false);
  assert.equal(run.statuses.at(-1)?.status, 'failed');
  assert.equal(run.receiptRows.length, 0);
  assert.equal(run.errorRows.length, 1);
  assert.deepEqual(run.provenSubmissionIds, [jobId]);
  assert.deepEqual(run.waits, [5000, 5000]);
});

test('a failed error-original or normal-receipt save fails the upload instead of being masked by a normal Grid result', async () => {
  for (const options of [{ errorFailure: true }, { receiptFailure: true }]) {
    const run = await runUpload(complete([normal, unrelatedError]), options);
    assert.equal(run.statuses.at(-1)?.status, 'failed');
    assert.equal(run.statuses.some((status) => status.status === 'success'), false);
  }
});

test('scheduled cursor waits for both separate errors, then advances only after both pass', async () => {
  for (const passed of [0, 1, 2]) {
    const run = fixture(complete([normal, unrelatedError, unrelatedError]), { passed });
    try {
      await run.runOriginal();
      assert.equal(run.receiptRows.length, 1);
      assert.equal(run.errorRows.length, 2);
      assert.equal(run.snapshots.at(-1)?.unmatchableErrorPersistence.awaitingApproval, 2 - passed);
      assert.equal(run.cursorDates.length, passed === 2 ? 1 : 0);
      assert.equal(run.statuses.at(-1)?.status, passed === 2 ? 'success' : 'failed');
    } finally { run.restore(); }
  }
});

test('incomplete Grid and original persistence failure cannot complete or advance the cursor', async () => {
  const cases = [
    { grid: { ...complete([normal]), completeness: 'INCOMPLETE' as const }, options: {} },
    { grid: complete([normal, unrelatedError]), options: { receiptFailure: true } },
    { grid: complete([normal, unrelatedError]), options: { errorFailure: true } },
  ];
  for (const { grid, options } of cases) {
    const run = fixture(grid as K2BGridRead, options);
    try {
      await run.runOriginal();
      assert.equal(run.statuses.at(-1)?.status, 'failed');
      assert.deepEqual(run.cursorDates, []);
      assert.equal(run.snapshots.at(-1)?.databaseSaveCompleted, false);
    } finally { run.restore(); }
  }
});
