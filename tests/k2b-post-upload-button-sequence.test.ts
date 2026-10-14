import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkerDaemon } from '../lib/automation/worker-daemon';

const target = (code: string) => ({
  code, business_name: code, year: 2026, period: '하반기',
  industrial_accident_number: '12345', commencement_number: '00001',
});

const completeGrid = {
  completeness: 'COMPLETE' as const,
  rows: [{
    managementNumber: '12345', commencementNumber: '00001', businessYear: '2026',
    half: '하반기', status: '정상처리', actualSubmissionDate: '2026-10-14',
    submissionNumber: 'receipt-1', sourceKey: 'k2b:submission:receipt-1',
  }],
};

function fixture(targets: ReturnType<typeof target>[], uploads: boolean[], grids: unknown[], existingKeys: string[] = [], priorKeys: string[] = []) {
  const daemon = WorkerDaemon.getInstance() as any;
  const actions: string[] = [];
  let uploadIndex = 0;
  let gridIndex = 0;
  let syncedGrid: unknown = null;
  const journal = {
    code: targets[0]?.code, measurement_year: 2026, measurement_period: '하반기',
    k2b_status: '정상처리', k2b_send_date: '2026-10-14', k2b_sender: '대표계정',
  };
  const query: any = {
    in: () => query,
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: [journal], error: null }).then(resolve, reject),
  };
  daemon.createK2BJobSupabaseClient = async () => ({
    from: () => ({ select: () => query }),
  });
  daemon.createK2BJobService = () => ({
    init: async () => undefined, login: async () => undefined, quit: async () => undefined,
    logBusinessBoundaryState: async () => undefined,
    uploadReport: async () => {
      actions.push(`upload:${uploadIndex + 1}`);
      const success = uploads[uploadIndex++];
      return { success, status: success ? '업로드 완료' : '첨부 실패', error: success ? undefined : '파일 없음' };
    },
    queryPostUploadSubmissionResultsForDate: async () => {
      actions.push('click:query');
      const value = grids[gridIndex++];
      if (value instanceof Error) throw value;
      return value;
    },
  });
  daemon.findK2BJobReportFiles = () => ({ dataFile: { path: 'fixture.xml' }, drawings: [] });
  daemon.loadK2BSourceKeysForDate = async () => new Set(existingKeys);
  daemon.loadPriorK2BTargetKeysForDate = async () => new Set(priorKeys);
  daemon.waitForK2BPostUploadGrid = async (ms: number) => { actions.push(`wait:${ms}`); };
  daemon.isCancelRequested = async () => false;
  daemon.processK2BOriginalSyncJob = async (_job: unknown, input: { grid: unknown }) => {
    syncedGrid = input.grid;
  };
  daemon.updateJobStatus = async () => undefined;
  daemon.createInAppNotification = async () => undefined;
  daemon.notifyAllManagers = async () => undefined;
  daemon.syncCalendarAfterK2BJournalChange = async () => ({ attempted: false });
  return {
    actions,
    get syncedGrid() { return syncedGrid; },
    run: () => daemon.processK2BJob({ id: 'button-sequence', payload: { requestUser: { id: 'tester' }, targets } }),
  };
}

test('모든 업체 전송 종료 후에만 5초 대기와 첫 조회 버튼 클릭', async () => {
  const run = fixture([target('A'), target('B'), target('C')], [true, true, true], [
    { completeness: 'INCOMPLETE', rows: [] },
    { completeness: 'INCOMPLETE', rows: [] },
  ]);
  await run.run();
  assert.deepEqual(run.actions, [
    'upload:1', 'upload:2', 'upload:3', 'wait:5000', 'click:query', 'wait:5000', 'click:query',
  ]);
  assert.equal(run.syncedGrid, null);
});

test('첫 조회가 완전하고 요청 결과가 최종이면 두 번째 버튼 클릭 없음', async () => {
  const run = fixture([target('A')], [true], [completeGrid]);
  await run.run();
  assert.deepEqual(run.actions, ['upload:1', 'wait:5000', 'click:query']);
  assert.equal(run.syncedGrid, completeGrid);
});

test('첫 조회 오류 뒤 5초를 더 기다려 한 번만 재클릭', async () => {
  const run = fixture([target('A')], [true], [
    new Error('K2B_GRID_SCHEMA_MISMATCH:invalid_required_row_0:missing_status'), completeGrid,
  ]);
  await run.run();
  assert.deepEqual(run.actions, ['upload:1', 'wait:5000', 'click:query', 'wait:5000', 'click:query']);
  assert.equal(run.syncedGrid, completeGrid);
});

test('모든 전송 실패 시 조회 버튼을 누르지 않음', async () => {
  const run = fixture([target('A'), target('B')], [false, false], []);
  await run.run();
  assert.deepEqual(run.actions, ['upload:1', 'upload:2']);
  assert.equal(run.syncedGrid, null);
});

test('첫 Grid가 COMPLETE여도 과거 접수만 보이면 5초 후 두 번째 조회', async () => {
  const run = fixture([target('A')], [true], [completeGrid, completeGrid], ['k2b:submission:receipt-1']);
  await run.run();
  assert.deepEqual(run.actions, ['upload:1', 'wait:5000', 'click:query', 'wait:5000', 'click:query']);
});

test('처리 중인 결과만 보이면 두 번째 조회까지만 클릭', async () => {
  const processing = { ...completeGrid, rows: [{ ...completeGrid.rows[0], status: '처리중' }] };
  const run = fixture([target('A')], [true], [processing, processing]);
  await run.run();
  assert.deepEqual(run.actions, ['upload:1', 'wait:5000', 'click:query', 'wait:5000', 'click:query']);
});

test('같은 대상의 앞선 작업이 있으면 COMPLETE라도 추가 조회는 한 번까지만', async () => {
  const run = fixture([target('A')], [true], [completeGrid, completeGrid], [], ['A\u00002026\u0000하반기']);
  await run.run();
  assert.deepEqual(run.actions, ['upload:1', 'wait:5000', 'click:query', 'wait:5000', 'click:query']);
});
