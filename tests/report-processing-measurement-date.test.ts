import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  matchesReportProcessingMeasurementDate,
  isReportProcessingTargetActive,
  measurementDatesForReportProcessing,
  reportProcessingMeasurementDateLabel,
} from '@/lib/report-processing/measurement-dates';

test('보고서 처리 측정일은 실시 target의 단일 실제 일자를 사용한다', () => {
  const dates = measurementDatesForReportProcessing({
    is_registered: '실시',
    measurement_date: '2026-03-25',
    daily_staff: null,
  });

  assert.deepEqual(dates, ['2026-03-25']);
  assert.equal(matchesReportProcessingMeasurementDate(dates, '2026-03-25'), true);
  assert.equal(matchesReportProcessingMeasurementDate(dates, '2026-03-26'), false);
  assert.equal(reportProcessingMeasurementDateLabel(dates), '2026-03-25');
});

test('다일 측정은 daily_staff에 명시된 비연속 실제 일자만 필터·표시한다', () => {
  const dates = measurementDatesForReportProcessing({
    is_registered: '확정',
    measurement_date: '2026-03-25',
    daily_staff: [
      { date: '2026-03-27' },
      { date: '2026-03-25' },
      { date: '2026-03-27' },
    ],
  });

  assert.deepEqual(dates, ['2026-03-25', '2026-03-27']);
  assert.equal(matchesReportProcessingMeasurementDate(dates, '2026-03-26'), false);
  assert.equal(matchesReportProcessingMeasurementDate(dates, '2026-03-27'), true);
  assert.equal(reportProcessingMeasurementDateLabel(dates), '2026-03-25 외 1일');
});

test('측정일이 없거나 실시 상태가 아닌 target은 날짜 검색에 포함되지 않는다', () => {
  assert.equal(isReportProcessingTargetActive({ is_registered: '실시' }), true);
  assert.equal(isReportProcessingTargetActive({ is_registered: '미실시' }), false);
  assert.equal(isReportProcessingTargetActive({ is_registered: '거래종료' }), false);
  assert.deepEqual(measurementDatesForReportProcessing({ is_registered: '미실시', measurement_date: '2026-03-25' }), []);
  assert.deepEqual(measurementDatesForReportProcessing({ is_registered: '실시', measurement_date: null }), []);
  assert.deepEqual(measurementDatesForReportProcessing({
    is_registered: '실시',
    measurement_date: '2026-03-25',
    daily_staff: [{ date: 'not-a-date' }],
  }), []);
  assert.deepEqual(measurementDatesForReportProcessing(null), []);
  assert.equal(reportProcessingMeasurementDateLabel([]), '-');
});

test('보고서 처리 API는 target 일정을 batch 조회하고 측정일을 정확히 필터한다', () => {
  const route = readFileSync('app/api/report-processing/route.ts', 'utf8');

  assert.match(route, /searchParams\.get\('measurementDate'\)/);
  assert.match(route, /measurementDate && !isValidDateString\(measurementDate\)/);
  assert.match(route, /from\('measurement_target_business'\)/);
  assert.match(route, /\.in\('code', codes\)/);
  assert.match(route, /measurementDatesForReportProcessing/);
  assert.match(route, /if \(target && !isReportProcessingTargetActive\(target\)\) return \[\];/);
  assert.match(route, /matchesReportProcessingMeasurementDate\(measurement_dates, measurementDate\)/);
  assert.doesNotMatch(route, /for \(const record of data\)[\s\S]*?measurement_target_business/);
});

test('보고서 처리 화면은 측정일을 조회 순서와 결과 표에 표시하고 현재 페이지만 선택한다', () => {
  const page = readFileSync('app/(dashboard)/report-processing/page.tsx', 'utf8');

  assert.match(page, /label="측정일"/);
  assert.match(page, /type="date"/);
  assert.match(page, /<TableHead className="w-32 text-center">측정일<\/TableHead>/);
  assert.match(page, /reportProcessingMeasurementDateLabel\(record\.measurement_dates\)/);
  assert.match(page, /const visibleRecordKeys = visibleRecords\.map/);
  assert.match(page, /setSelectedKeys\(\(current\) => Array\.from\(new Set\(\[\.\.\.current, \.\.\.visibleRecordKeys\]\)\)\)/);
  assert.match(page, /current\.filter\(\(key\) => !visibleRecordKeys\.includes\(key\)\)/);
});
