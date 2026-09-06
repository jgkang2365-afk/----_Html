import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("보고서 처리 조회조건은 복원 완료 후 조회하고 변경될 때 저장한다", () => {
  const source = readFileSync("app/(dashboard)/report-processing/page.tsx", "utf8");

  assert.match(source, /REPORT_PROCESSING_FILTERS_STORAGE_KEY = 'reportProcessingFilters'/);
  assert.match(source, /localStorage\.getItem\(REPORT_PROCESSING_FILTERS_STORAGE_KEY\)/);
  assert.match(source, /localStorage\.setItem\(REPORT_PROCESSING_FILTERS_STORAGE_KEY, JSON\.stringify\(filters\)\)/);
  assert.match(source, /if \(!filtersReady\) return;[\s\S]*?fetchRecords\(\)/);
  assert.match(source, /\[filters\.year, filters\.period, filters\.measurementDate, filtersReady\]/);
  assert.match(source, /measurementDate: filters\.measurementDate/);
});

test("손상되거나 일부 누락된 저장값은 안전한 기본값을 사용한다", () => {
  const source = readFileSync("app/(dashboard)/report-processing/page.tsx", "utf8");

  assert.match(source, /try \{[\s\S]*?JSON\.parse\(value\)[\s\S]*?\} catch \{[\s\S]*?DEFAULT_REPORT_PROCESSING_FILTERS/);
  assert.match(source, /typeof saved\.year === 'string'/);
  assert.match(source, /typeof saved\.period === 'string'/);
  assert.match(source, /typeof saved\.measurementDate === 'string'/);
  assert.match(source, /typeof saved\.search === 'string'/);
});
