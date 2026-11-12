import assert from "node:assert/strict";
import test from "node:test";
import { filterResultSearchRows, normalizeResultSearchFields } from "../lib/custom-query/result-search";

const columns = ["code", "business_name", "manager_name", "designated_office", "measurement_year"];
const rows = [
  { code: "H0541", business_name: "삼성메디코스", manager_name: "김민수", designated_office: "천안", measurement_year: 2026 },
  { code: "H0486", business_name: "한결화학", manager_name: "한기문", designated_office: "보령", measurement_year: 2025 },
  { code: "H0231", business_name: "동서건설", manager_name: null, designated_office: "천안", measurement_year: 2026 },
];

test("설정이 없거나 유효하지 않으면 기존 사업장명 검색으로 시작한다", () => {
  assert.deepEqual(normalizeResultSearchFields(null, columns), ["business_name"]);
  assert.deepEqual(normalizeResultSearchFields(["unknown"], columns), ["business_name"]);
  assert.deepEqual(normalizeResultSearchFields(["business_name", "business_name", "code", 123], columns),
    ["business_name", "code"]);
});

test("단일 필드를 변경하면 지정한 열만 검색한다", () => {
  assert.deepEqual(filterResultSearchRows(rows, "H0541", ["code"]).map((r) => r.code), ["H0541"]);
  assert.deepEqual(filterResultSearchRows(rows, "H0541", ["business_name"]), []);
  assert.deepEqual(filterResultSearchRows(rows, "천안", ["designated_office"]).map((r) => r.code), ["H0541", "H0231"]);
});

test("여러 검색 대상과 여러 검색어는 OR로 결합하고 대소문자를 무시한다", () => {
  assert.deepEqual(
    filterResultSearchRows(rows, "h0541, 한기문", ["code", "manager_name"]).map((r) => r.code),
    ["H0541", "H0486"],
  );
  assert.deepEqual(
    filterResultSearchRows(rows, "서경\nH0231", ["business_name", "code"]).map((r) => r.code),
    ["H0231"],
  );
});

test("숨겨진 열과 숫자 값도 검색하며 NULL은 오탐되지 않는다", () => {
  assert.deepEqual(filterResultSearchRows(rows, "2025", ["measurement_year"]).map((r) => r.code), ["H0486"]);
  assert.deepEqual(filterResultSearchRows(rows, "null", ["manager_name"]), []);
  assert.deepEqual(filterResultSearchRows(rows, "없는상호", ["business_name"]), []);
});

test("검색어가 없으면 원본 필터 결과를 그대로 유지해 다운로드 대상도 바꾸지 않는다", () => {
  assert.strictEqual(filterResultSearchRows(rows, " , \n ", ["business_name"]), rows);
  assert.strictEqual(filterResultSearchRows(rows, "", ["code", "manager_name"]), rows);
});
