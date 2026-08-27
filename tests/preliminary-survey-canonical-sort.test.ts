import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareCanonicalTargetBusinesses } from "../lib/business/target-business-sort";

const fixture = [
  { code: "D", isRegisteredText: "실시", measurementMonth: 1 },
  { code: "C", isRegisteredText: "미실시", measurementMonth: 2 },
  { code: "E", isRegisteredText: "거래종료", measurementMonth: 1 },
  { code: "B", isRegisteredText: "미실시", measurementMonth: 1 },
  { code: "A", isRegisteredText: "미실시", measurementMonth: 1 },
];

describe("측정대상 canonical 기본 정렬", () => {
  it("측정대상·예비조사 계획·목록이 같은 comparator를 사용한다", () => {
    const expected = ["A", "B", "C", "D", "E"];
    for (const rows of [fixture, [...fixture], [...fixture]]) {
      assert.deepEqual(rows.sort(compareCanonicalTargetBusinesses).map((row) => row.code), expected);
    }
  });
  it("필터 후에도 남은 행의 상대순서를 유지한다", () => {
    const sorted = [...fixture].sort(compareCanonicalTargetBusinesses);
    assert.deepEqual(sorted.filter((row) => ["A", "C", "E"].includes(row.code)).map((row) => row.code), ["A", "C", "E"]);
  });
});
