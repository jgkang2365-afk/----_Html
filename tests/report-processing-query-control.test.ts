import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clearReportProcessingSearchFilters, shouldRunInitialReportProcessingQuery } from "../lib/report-processing/query-control";

const source = readFileSync("app/(dashboard)/report-processing/page.tsx", "utf8");

test("보고서 처리 필터는 최초 진입 한 번만 자동 조회하고 입력 중에는 기존 결과를 유지한다", () => {
  assert.equal(shouldRunInitialReportProcessingQuery(false, false), false);
  assert.equal(shouldRunInitialReportProcessingQuery(true, false), true);
  assert.equal(shouldRunInitialReportProcessingQuery(true, true), false);
  assert.match(source, /initialQueryDoneRef/);
  assert.match(source, /shouldRunInitialReportProcessingQuery\(filtersReady, initialQueryDoneRef\.current\)/);
  assert.doesNotMatch(source, /\[filters\.year, filters\.period, filters\.measurementDate, filtersReady\]/);
  assert.match(source, /setRecords\(enrichedRecords\)/);
});

test("초기화는 year/period를 보존한 명시적 next filter로 정확히 한 번 조회한다", () => {
  assert.deepEqual(clearReportProcessingSearchFilters({ year: "2026", period: "하반기", measurementDate: "2026-09-09", search: "알파" }), { year: "2026", period: "하반기", measurementDate: "", search: "" });
  assert.match(source, /const next = clearReportProcessingSearchFilters\(filters\);/);
  assert.match(source, /setFilters\(next\);\s*void fetchRecords\(false, next\);/);
  assert.doesNotMatch(source, /setTimeout\(\(\) => void fetchRecords\(\), 0\)/);
});
