import assert from "node:assert/strict";
import test from "node:test";
import {
  collectWorkbenchRecommendationTargetIds,
  matchesMeasurementDateRange,
  matchesWorkbenchSearch,
  matchesWorkbenchSearchTerm,
  parseWorkbenchSearchTerms,
} from "../lib/preliminary-survey-v2/workbench-search";

test("작업대 검색어는 쉼표와 줄바꿈으로 분리하고 공백 및 중복을 제거한다", () => {
  assert.deepEqual(
    parseWorkbenchSearchTerms(" H001,\n\n 한결  \r\n h001 , , 한결 "),
    ["h001", "한결"],
  );
  assert.deepEqual(parseWorkbenchSearchTerms("   \n , "), []);
  assert.deepEqual(parseWorkbenchSearchTerms(null), []);
});

test("코드는 대소문자와 공백을 정규화해 정확 및 부분 일치한다", () => {
  const row = { code: " H-001 ", businessName: "한결작업환경컨설팅" };
  assert.equal(matchesWorkbenchSearchTerm(row, "h-001"), true);
  assert.equal(matchesWorkbenchSearchTerm(row, "-00"), true);
  assert.equal(matchesWorkbenchSearchTerm(row, "H-999"), false);
});

test("사업장명은 정확 및 부분 일치하며 내부 공백 차이도 안전하게 처리한다", () => {
  const row = { code: "H001", businessName: "한결  작업환경 컨설팅" };
  assert.equal(matchesWorkbenchSearchTerm(row, "한결 작업환경 컨설팅"), true);
  assert.equal(matchesWorkbenchSearchTerm(row, "작업환경"), true);
  assert.equal(matchesWorkbenchSearchTerm(row, "다른사업장"), false);
});

test("여러 검색어는 OR로 적용하고 빈 검색은 모든 행을 포함한다", () => {
  const row = { code: "H001", businessName: "한결작업환경컨설팅" };
  assert.equal(matchesWorkbenchSearch(row, "H999, 한결"), true);
  assert.equal(matchesWorkbenchSearch(row, ["H999", "H998"]), false);
  assert.equal(matchesWorkbenchSearch(row, "  ,\n"), true);
  assert.equal(matchesWorkbenchSearch({ code: null, businessName: null }, "한결"), false);
});

test("추천 대상은 확정된 검색 결과 전체 또는 검색 결과와 선택 대상의 교집합이다", () => {
  const displayedRows = [{ targetId: 1 }, { targetId: 2 }, { targetId: 3 }];
  assert.deepEqual(collectWorkbenchRecommendationTargetIds(displayedRows, new Set()), [1, 2, 3]);
  assert.deepEqual(collectWorkbenchRecommendationTargetIds(displayedRows, new Set([2, 4])), [2]);
});

test("계획 검색은 측정예정일의 시작일과 종료일을 모두 포함해 필터한다", () => {
  assert.equal(matchesMeasurementDateRange("2026-08-03", "2026-08-03", "2026-08-03"), true);
  assert.equal(matchesMeasurementDateRange("2026-08-05", "2026-08-03", "2026-08-07"), true);
  assert.equal(matchesMeasurementDateRange("2026-08-02", "2026-08-03", "2026-08-07"), false);
  assert.equal(matchesMeasurementDateRange("2026-08-08", "2026-08-03", "2026-08-07"), false);
  assert.equal(matchesMeasurementDateRange(null, "2026-08-03", "2026-08-07"), false);
});
