import assert from "node:assert/strict";
import test from "node:test";
import { filterResultSearchRows } from "../lib/custom-query/result-search";
import { normalizeSortRules, sortResultRows, templateSortPatch } from "../lib/custom-query/result-sort";

test("no sort preserves the original array and order", () => {
  const rows = [{ code: "H02" }, { code: "H01" }];
  assert.strictEqual(sortResultRows(rows, []), rows);
  assert.deepEqual(rows.map((row) => row.code), ["H02", "H01"]);
});

test("priority, direction and stable ties apply to hidden fields too", () => {
  const rows = [
    { code: "A", designated_office: "천안", manager_name: "가" },
    { code: "B", designated_office: "보령", manager_name: "나" },
    { code: "C", designated_office: "천안", manager_name: "다" },
    { code: "D", designated_office: "천안", manager_name: "다" },
  ];
  const rules = [{ field: "designated_office", direction: "asc" }, { field: "manager_name", direction: "desc" }] as const;
  assert.deepEqual(sortResultRows(rows, rules).map((row) => row.code), ["B", "C", "D", "A"]);
  assert.deepEqual(rows.map((row) => row.code), ["A", "B", "C", "D"]);
});

test("third-level condition breaks ties left by the first two", () => {
  const rows = [
    { code: "H02", measurement_year: 2026, designated_office: "천안" },
    { code: "H01", measurement_year: 2026, designated_office: "천안" },
    { code: "H00", measurement_year: 2025, designated_office: "천안" },
  ];
  const rules = [
    { field: "designated_office", direction: "asc" },
    { field: "measurement_year", direction: "desc" },
    { field: "code", direction: "asc" },
  ];
  assert.deepEqual(sortResultRows(rows, rules).map((row) => row.code), ["H01", "H02", "H00"]);
  assert.deepEqual(sortResultRows(rows, [rules[2], rules[1], rules[0]]).map((row) => row.code), ["H00", "H01", "H02"]);
});

test("Korean strings and leading-zero identifiers are compared as text", () => {
  const rows = [
    { code: "H10", business_name: "하늘" },
    { code: "H002", business_name: "가람" },
    { code: "H01", business_name: "나무" },
  ];
  assert.deepEqual(sortResultRows(rows, [{ field: "business_name", direction: "asc" }]).map((row) => row.code), ["H002", "H01", "H10"]);
  assert.deepEqual(sortResultRows(rows, [{ field: "code", direction: "asc" }]).map((row) => row.code), ["H002", "H01", "H10"]);
});

test("numeric size, dates, blanks and malformed values are handled safely", () => {
  const rows = [
    { code: "A", measurement_fee_total: "1,200", measurement_start_date: "2026-02-01" },
    { code: "B", measurement_fee_total: 20, measurement_start_date: "2025-12-01" },
    { code: "C", measurement_fee_total: "003", measurement_start_date: "2026-01-01" },
    { code: "D", measurement_fee_total: null, measurement_start_date: null },
    { code: "E", measurement_fee_total: "bad", measurement_start_date: "2026-02-31" },
  ];
  assert.deepEqual(sortResultRows(rows, [{ field: "measurement_fee_total", direction: "asc" }]).map((row) => row.code), ["C", "B", "A", "D", "E"]);
  assert.deepEqual(sortResultRows(rows, [{ field: "measurement_fee_total", direction: "desc" }]).map((row) => row.code), ["A", "B", "C", "D", "E"]);
  assert.deepEqual(sortResultRows(rows, [{ field: "measurement_start_date", direction: "asc" }]).map((row) => row.code), ["B", "C", "A", "D", "E"]);
  assert.deepEqual(sortResultRows(rows, [{ field: "measurement_start_date", direction: "desc" }]).map((row) => row.code), ["A", "C", "B", "D", "E"]);
});

test("duplicate or unknown template fields are discarded consistently", () => {
  assert.deepEqual(normalizeSortRules([
    { field: "measurement_year", direction: "desc" },
    { field: "measurement_year", direction: "asc" },
    { field: "unknown", direction: "asc" },
    { field: "toString", direction: "asc" },
    { field: "code", direction: "invalid" },
  ]), [{ field: "measurement_year", direction: "desc" }]);
  assert.deepEqual(normalizeSortRules(undefined), []);
});

test("legacy template update omits sorts while explicit clear persists empty array", () => {
  assert.deepEqual(templateSortPatch({ name: "old client" }), {});
  assert.deepEqual(templateSortPatch({ sorts: [] }), { sorts: [] });
  assert.deepEqual(templateSortPatch({ sorts: [
    { field: "code", direction: "desc" },
    { field: "code", direction: "asc" },
  ] }), { sorts: [{ field: "code", direction: "desc" }] });
  assert.equal(templateSortPatch({ sorts: null }), null);
});

test("quick search precedes sorting; the resulting array can drive table and XLSX", () => {
  const rows = [
    { code: "H03", business_name: "한강", measurement_year: 2025 },
    { code: "H01", business_name: "한별", measurement_year: 2026 },
    { code: "H02", business_name: "다른", measurement_year: 2024 },
  ];
  const filtered = rows.filter((row) => row.measurement_year >= 2025);
  const displayed = sortResultRows(filterResultSearchRows(filtered, "한", ["business_name"]), [
    { field: "measurement_year", direction: "desc" },
  ]);
  assert.deepEqual(displayed.map((row) => row.code), ["H01", "H03"]);
  assert.deepEqual(rows.map((row) => row.code), ["H03", "H01", "H02"]);
});
