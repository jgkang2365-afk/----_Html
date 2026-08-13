import test from "node:test";
import assert from "node:assert/strict";
import { hasPreviousMeasurementValueFromRows } from "../lib/preliminary-survey/classification";

test("전회 측정값이 없으면 기존업체 기준을 충족하지 않는다", () => {
  assert.equal(hasPreviousMeasurementValueFromRows(null, [], 2026, "하반기"), false);
  assert.equal(
    hasPreviousMeasurementValueFromRows(
      null,
      [{ measurement_year: 2026, measurement_period: "상반기" }],
      2026,
      "하반기",
    ),
    false,
  );
});

test("현재 대상 또는 실제 이전 주기에 측정일이 있으면 기존업체 기준을 충족한다", () => {
  assert.equal(
    hasPreviousMeasurementValueFromRows(
      { previous_measurement_date: "2026-01-10" },
      [],
      2026,
      "하반기",
    ),
    true,
  );
  assert.equal(
    hasPreviousMeasurementValueFromRows(
      null,
      [{
        measurement_year: 2026,
        measurement_period: "상반기",
        measurement_end_date: "2026-01-10",
      }],
      2026,
      "하반기",
    ),
    true,
  );
});

test("현재·미래 주기의 측정일은 전회 측정값으로 보지 않는다", () => {
  assert.equal(
    hasPreviousMeasurementValueFromRows(
      null,
      [{
        measurement_year: 2026,
        measurement_period: "하반기",
        measurement_start_date: "2026-08-01",
      }],
      2026,
      "하반기",
    ),
    false,
  );
});
