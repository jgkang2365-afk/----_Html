import assert from "node:assert/strict";
import test from "node:test";
import {
  parseMeasurementHalf,
  verifyDataConsistency,
} from "../lib/sync/verification";

type Row = Record<string, any>;
type Store = Record<string, Row[]>;

function fakeDb(initial: Store, failRead?: string, failUpdate?: string) {
  const store: Store = structuredClone(initial);
  let nextId = 100;
  class Query implements PromiseLike<{ data: Row[] | null; error: { message: string } | null }> {
    private filters: ((row: Row) => boolean)[] = [];
    private sorting: { key: string; ascending: boolean }[] = [];
    private window: [number, number] | null = null;
    private action: "read" | "insert" | "delete" | "update" = "read";
    private payload: any;
    constructor(private table: string) {}
    select(_columns: string) { return this; }
    eq(key: string, value: any) {
      this.filters.push((row) => row[key] === value);
      return this;
    }
    is(key: string, value: null) {
      this.filters.push((row) => row[key] == value);
      return this;
    }
    gte(key: string, value: any) {
      this.filters.push((row) => row[key] >= value);
      return this;
    }
    like(key: string, value: string) {
      const needle = value.replaceAll("%", "");
      this.filters.push((row) => String(row[key] || "").includes(needle));
      return this;
    }
    in(key: string, values: any[]) {
      this.filters.push((row) => values.includes(row[key]));
      return this;
    }
    order(key: string, options?: { ascending?: boolean }) {
      this.sorting.push({ key, ascending: options?.ascending !== false });
      return this;
    }
    range(from: number, to: number) {
      this.window = [from, to];
      return this;
    }
    limit(count: number) {
      this.window = [0, count - 1];
      return this;
    }
    insert(payload: Row[]) {
      this.action = "insert";
      this.payload = payload;
      return this;
    }
    delete() {
      this.action = "delete";
      return this;
    }
    update(payload: Row) {
      this.action = "update";
      this.payload = payload;
      return this;
    }
    then<TResult1 = { data: Row[] | null; error: { message: string } | null }, TResult2 = never>(
      onfulfilled?: ((value: { data: Row[] | null; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      return Promise.resolve().then(() => {
        if (this.action === "read" && this.table === failRead) {
          return { data: null, error: { message: "synthetic read failure" } };
        }
        if (this.action === "update" && this.table === failUpdate) {
          return { data: null, error: { message: "synthetic write failure" } };
        }
        const rows = store[this.table] ||= [];
        const matches = (row: Row) => this.filters.every((filter) => filter(row));
        if (this.action === "insert") {
          for (const row of this.payload) rows.push({ id: nextId++, ...row });
          return { data: null, error: null };
        }
        if (this.action === "delete") {
          const removed = rows.filter(matches);
          store[this.table] = rows.filter((row) => !matches(row));
          return { data: removed, error: null };
        }
        if (this.action === "update") {
          const changed = rows.filter(matches);
          for (const row of changed) Object.assign(row, this.payload);
          return { data: changed, error: null };
        }
        let result = rows.filter(matches);
        for (const sort of this.sorting.reverse()) {
          result = result.toSorted((a, b) =>
            (a[sort.key] < b[sort.key] ? -1 : a[sort.key] > b[sort.key] ? 1 : 0) *
            (sort.ascending ? 1 : -1));
        }
        if (this.window) result = result.slice(this.window[0], this.window[1] + 1);
        return { data: structuredClone(result), error: null };
      }).then(onfulfilled, onrejected);
    }
  }
  return { store, client: { from: (name: string) => new Query(name) } };
}

test("quarter labels map to the correct half without guessing bare values", () => {
  assert.equal(parseMeasurementHalf("2026년 1분기"), 1);
  assert.equal(parseMeasurementHalf("2분기"), 1);
  assert.equal(parseMeasurementHalf("3분기"), 2);
  assert.equal(parseMeasurementHalf("4분기"), 2);
  assert.equal(parseMeasurementHalf("상반기"), 1);
  assert.equal(parseMeasurementHalf("하반기"), 2);
  assert.equal(parseMeasurementHalf("2"), null);
});

test("old and same-half completed measurements do not conflict with current names; sync cleans only generated warnings", async () => {
  const oldDescription =
    "대표자명 불일치: 측정사업장(최신)(measurement_business)_2026/07/01(옛대표) vs 사업장 정보(business_info)_2026/10/01(새대표) (날짜: 데이터 생성/수정일)";
  const oldName =
    "사업장명 불일치: 측정사업장(최신)(measurement_business)_2026/07/01(옛상호) vs 사업장 정보(business_info)_2026/10/01(새상호) (날짜: 데이터 생성/수정일)";
  const db = fakeDb({
    business_info: [
      { code: "H1000", business_name: "새상호", representative_name: "새대표", updated_at: "2026-10-01" },
    ],
    measurement_business: [
      { code: "H1000", year: 2026, period: "상반기", completion_status: "완료", measurement_end_date: "2026-05-10", business_name: "옛상호", representative_name: "옛대표" },
      { code: "H1000", year: 2026, period: "3분기", completion_status: "완료", measurement_end_date: "2026-07-10", business_name: "옛상호", representative_name: "옛대표" },
      { code: "H1000", year: 2026, period: "하반기", completion_status: "완료", measurement_end_date: "2026-08-10", business_name: "옛상호", representative_name: "옛대표" },
      { code: "H1001", year: 2025, period: "4분기", completion_status: "완료", measurement_end_date: "2025-10-10", business_name: "누락업체" },
      { code: "H1002", year: 2026, period: "2분기", completion_status: "완료", measurement_end_date: "2026-04-10", business_name: "제외업체" },
      { code: null, year: 2026, period: "상반기", completion_status: "완료", business_name: "코드 없음" },
    ],
    data_verification_exclusions: [
      { code: "H1000", issue_type: "MISMATCH_REPRESENTATIVE" },
      { code: "H1002", issue_type: "MISSING_IN_BUSINESS_INFO" },
    ],
    data_verification_issues: [
      { id: 1, code: "H1000", issue_type: "MISMATCH_REPRESENTATIVE", description: oldDescription },
      { id: 2, code: "H1000", issue_type: "MISMATCH_NAME", description: oldName },
      { id: 3, code: "H1000", issue_type: "OTHER_WARNING", description: "기타 경고" },
    ],
    measurement_journal: [
      { id: 10, code: "H1000", measurement_year: 2026, special_notes: `[데이터 불일치] ${oldDescription}\n[데이터 불일치] ${oldName}\n[데이터 불일치] 사용자가 직접 남긴 경고\n사용자 특이사항`, representative_name: "옛대표" },
      { id: 11, code: "H1001", measurement_year: 2025, special_notes: null },
    ],
  });
  const first = await verifyDataConsistency(db.client as any);
  assert.deepEqual(first, { success: true, issueCount: 1 });
  assert.deepEqual(db.store.data_verification_issues.map((row) => row.issue_type).sort(),
    ["MISSING_IN_BUSINESS_INFO", "OTHER_WARNING"]);
  assert.equal(db.store.measurement_journal[0].special_notes,
    "[데이터 불일치] 사용자가 직접 남긴 경고\n사용자 특이사항");
  assert.equal(db.store.measurement_journal[0].representative_name, "옛대표");
  assert.match(db.store.measurement_journal[1].special_notes, /측정사업장\(최신\)/);
  const snapshot = structuredClone(db.store);
  const second = await verifyDataConsistency(db.client as any);
  assert.deepEqual(second, first);
  assert.deepEqual(db.store, snapshot);
});

test("failed source read leaves existing issues and notes untouched", async () => {
  const db = fakeDb({
    business_info: [],
    measurement_business: [],
    data_verification_exclusions: [],
    data_verification_issues: [{ id: 1, code: "H1", issue_type: "MISMATCH_NAME", description: "old" }],
    measurement_journal: [{ id: 1, code: "H1", special_notes: "[데이터 불일치] old" }],
  }, "measurement_business");
  const snapshot = structuredClone(db.store);
  const result = await verifyDataConsistency(db.client as any);
  assert.equal(result.success, false);
  assert.deepEqual(db.store, snapshot);
});

test("failed note update keeps old mismatch issue for retry", async () => {
  const description =
    "대표자명 불일치: 측정사업장(최신)(measurement_business)_2026/07/01(옛대표) vs 사업장 정보(business_info)_2026/10/01(새대표) (날짜: 데이터 생성/수정일)";
  const db = fakeDb({
    business_info: [{ code: "H1", business_name: "현재", representative_name: "새대표" }],
    measurement_business: [{ code: "H1", year: 2026, period: "하반기", completion_status: "완료", business_name: "과거", representative_name: "옛대표" }],
    data_verification_exclusions: [],
    data_verification_issues: [{ id: 1, code: "H1", issue_type: "MISMATCH_REPRESENTATIVE", description }],
    measurement_journal: [{ id: 1, code: "H1", measurement_year: 2026, special_notes: `[데이터 불일치] ${description}\n사용자 메모` }],
  }, undefined, "measurement_journal");
  const snapshot = structuredClone(db.store);
  const result = await verifyDataConsistency(db.client as any);
  assert.equal(result.success, false);
  assert.deepEqual(db.store, snapshot);
});
