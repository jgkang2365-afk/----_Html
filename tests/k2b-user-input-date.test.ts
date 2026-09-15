import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { K2B_FUTURE_SEND_DATE_ERROR, validateUserEnteredK2BSendDate } from '@/lib/k2b/user-input-date';

test('사용자 K2B 전송일은 KST 오늘 이후만 거부하고 빈 값은 허용한다', () => {
  assert.equal(validateUserEnteredK2BSendDate('', '2026-09-15'), null);
  assert.equal(validateUserEnteredK2BSendDate('2026-09-15', '2026-09-15'), null);
  assert.equal(validateUserEnteredK2BSendDate('2026-09-16', '2026-09-15'), K2B_FUTURE_SEND_DATE_ERROR);
  assert.equal(validateUserEnteredK2BSendDate('2026-02-30', '2026-09-15'), 'K2B 전송일 형식을 확인해주세요.');
});

test('미래 날짜 경계는 사용자 생성·수정·업로드에만 있고 워커와 실제결과 승인에는 없다', () => {
  for (const file of ['app/api/journal/route.ts', 'app/api/journal/[id]/route.ts', 'app/api/summary/[id]/route.ts', 'app/api/journal/upload/route.ts']) {
    assert.match(readFileSync(file, 'utf8'), /validateUserEnteredK2BSendDate/);
  }
  assert.doesNotMatch(readFileSync('lib/automation/worker-daemon.ts', 'utf8'), /validateUserEnteredK2BSendDate/);
  assert.doesNotMatch(readFileSync('app/api/report-processing/approve-k2b-verification/route.ts', 'utf8'), /validateUserEnteredK2BSendDate/);
});
