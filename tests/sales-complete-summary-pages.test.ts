import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  SALES_SUMMARY_PAGE_SIZE,
  fetchCompleteSalesSummaryRows,
} from "../lib/sales/complete-summary-pages";

interface FixtureRow {
  id: number;
  measurement_year: number;
  measurement_period: "상반기" | "하반기";
  measurement_fee_total: number;
  deposit_total: number;
}

function fixturePages<T extends { id: number }>(data: T[]) {
  const windows: Array<[number, number]> = [];
  const fetchPage = async (from: number, to: number) => {
    windows.push([from, to]);
    // Supabase/PostgREST limits individual responses to 1,000 rows.
    return { data: data.slice(from, Math.min(to + 1, from + 1000)), error: null };
  };
  return { fetchPage, windows };
}

test("빈 데이터 또는 999건은 한 페이지에서 완료된다", async () => {
  for (const count of [0, 999]) {
    const rows = Array.from({ length: count }, (_, i) => ({ id: i + 1 }));
    const pages = fixturePages(rows);
    assert.deepEqual(await fetchCompleteSalesSummaryRows(pages.fetchPage), rows);
    assert.deepEqual(pages.windows, [[0, SALES_SUMMARY_PAGE_SIZE - 1]]);
  }
});

test("정확히 1000건이면 다음 빈 페이지로 종료하고, 1001건이면 두 번째 페이지를 포함한다", async () => {
  for (const count of [1000, 1001]) {
    const rows = Array.from({ length: count }, (_, i) => ({ id: i + 1 }));
    const pages = fixturePages(rows);
    const result = await fetchCompleteSalesSummaryRows(pages.fetchPage);
    assert.equal(result.length, count);
    assert.deepEqual(result.map((r) => r.id), rows.map((r) => r.id));
    assert.deepEqual(pages.windows, [[0, 999], [1000, 1999]]);
  }
});

test("2,000건 경계 및 2,001건에서 누락·중복이 없다", async () => {
  for (const count of [2000, 2001]) {
    const rows = Array.from({ length: count }, (_, i) => ({ id: i + 1 }));
    const pages = fixturePages(rows);
    const result = await fetchCompleteSalesSummaryRows(pages.fetchPage);
    assert.equal(result.length, count);
    assert.equal(new Set(result.map((r) => r.id)).size, count);
    assert.deepEqual(pages.windows, [[0, 999], [1000, 1999], [2000, 2999]]);
  }
});

test("후속 페이지 오류가 나면 부분 합계를 반환하지 않고 즉시 실패한다", async () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1 }));
  await assert.rejects(
    fetchCompleteSalesSummaryRows(async (from) => (
      from === 0 ? { data: rows, error: null } : { data: null, error: { message: "backend error" } }
    )),
    /1000행부터.*backend error/,
  );
  await assert.rejects(
    fetchCompleteSalesSummaryRows(async () => ({ data: null, error: null })),
    /응답 형식 오류/,
  );
});

test("페이지 간 중복 또는 식별자 누락을 조용히 집계하지 않는다", async () => {
  const first = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1 }));
  await assert.rejects(
    fetchCompleteSalesSummaryRows(async (from) => ({
      data: from === 0 ? first : [{ id: 1000 }],
      error: null,
    })),
    /중복된 행/,
  );
  await assert.rejects(
    fetchCompleteSalesSummaryRows(async () => ({ data: [{ id: null as unknown as number }], error: null })),
    /식별자가 없습니다/,
  );
});

test("2025년 155건·238,393,350원 누락을 복원하고 2026년 자료도 보존한다", async () => {
  // Latest-year-first ordering as used by /api/sales:
  // 2026: 593 rows; 2025: 407 included in page 1 and 155 omitted in old code.
  const makeRow = (id: number, year: number, period: "상반기" | "하반기", fee: number, deposit: number): FixtureRow =>
    ({ id, measurement_year: year, measurement_period: period, measurement_fee_total: fee, deposit_total: deposit });
  const y2026 = Array.from({ length: 593 }, (_, i) => makeRow(2000 + i, 2026, "하반기", i === 0 ? 737_768_620 : 0, 0));
  const y2025H2 = Array.from({ length: 273 }, (_, i) => makeRow(1000 + i, 2025, "하반기", i === 0 ? 354_801_720 : 0, i === 0 ? 354_801_720 : 0));
  const y2025H1Page1 = Array.from({ length: 134 }, (_, i) => makeRow(400 + i, 2025, "상반기", i === 0 ? 105_878_360 : 0, i === 0 ? 104_558_360 : 0));
  const y2025H1Page2 = Array.from({ length: 155 }, (_, i) => makeRow(100 + i, 2025, "상반기", i === 0 ? 238_393_350 : 0, i === 0 ? 238_393_350 : 0));
  const all = [...y2026, ...y2025H2, ...y2025H1Page1, ...y2025H1Page2];
  const pages = fixturePages(all);
  const allFetched = await fetchCompleteSalesSummaryRows(pages.fetchPage);
  assert.equal(allFetched.length, 1155);
  const only2025 = allFetched.filter((r) => r.measurement_year === 2025);
  assert.equal(only2025.length, 562);
  assert.equal(only2025.filter((r) => r.measurement_period === "상반기").length, 289);
  assert.equal(only2025.filter((r) => r.measurement_period === "하반기").length, 273);
  const sum = (rows: FixtureRow[], field: "measurement_fee_total" | "deposit_total") =>
    rows.reduce((acc, row) => acc + row[field], 0);
  assert.equal(sum(only2025, "measurement_fee_total"), 699_073_430);
  assert.equal(sum(only2025, "deposit_total"), 697_753_430);
  assert.equal(sum(only2025.filter((r) => r.measurement_period === "상반기"), "measurement_fee_total"), 344_271_710);
  assert.equal(sum(only2025.filter((r) => r.measurement_period === "하반기"), "measurement_fee_total"), 354_801_720);
  assert.equal(sum(only2025, "measurement_fee_total") + 103_157_000, 802_230_430);
  assert.equal(sum(allFetched.filter((r) => r.measurement_year === 2026), "measurement_fee_total"), 737_768_620);
  assert.deepEqual(pages.windows, [[0, 999], [1000, 1999]]);
  assert.equal(sum(all.slice(0, 1000).filter((r) => r.measurement_year === 2025), "measurement_fee_total"), 460_680_080);
});

test("일반 조회와 미수금 담당자 조회 모두 같은 전체 페이지 조회를 사용한다", () => {
  const source = readFileSync(path.join(process.cwd(), "app/api/sales/route.ts"), "utf8");
  assert.match(source, /fetchCompleteSalesSummaryRows/);
  assert.match(source, /applyFilters\(makeMeasurementSummaryQuery\(\), false, true, false\)/);
  assert.match(source, /applyFilters\(makeOtherSummaryQuery\(\), true, true, false\)/);
  assert.doesNotMatch(source, /\.limit\(50000\)/);
  assert.doesNotMatch(source, /const loadRemaining\s*=/);
  assert.match(source, /if\s*\(includeUnpaidWriters\)/);
  assert.match(source, /\.range\(offset, offset \+ limit - 1\)/);
});
