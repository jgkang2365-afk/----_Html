import assert from "node:assert/strict";
import test from "node:test";
import {
  currentAssignmentsForDisplay,
  currentMeasurementDates,
  journalConfirmationKey,
  loadJournalConfirmationKeys,
  postSeptemberMeasurementDates,
} from "../lib/preliminary-survey-v2/current-measurement";
import { storedPlanWorkbenchState } from "../lib/preliminary-survey-v2/workbench-status";

test("H0454 date change displays only the current 2026-10-27 assignment", () => {
  const target = { measurement_date: "2026-10-27", daily_staff: null };
  const assignments = [
    { measurement_date: "2026-10-22", code: "F" },
    { measurement_date: "2026-10-27", code: "A" },
  ];
  assert.deepEqual(currentAssignmentsForDisplay(target, assignments), [assignments[1]]);
  assert.deepEqual(postSeptemberMeasurementDates(target), ["2026-10-27"]);
});

test("multi-day dates remain independent at the September boundary", () => {
  const target = {
    measurement_date: "2026-08-31",
    daily_staff: [{ date: "2026-08-31" }, { date: "2026-09-01" }, { date: "2026-09-03" }],
  };
  assert.deepEqual(currentMeasurementDates(target), ["2026-08-31", "2026-09-01", "2026-09-03"]);
  assert.deepEqual(postSeptemberMeasurementDates(target), ["2026-09-01", "2026-09-03"]);
  assert.deepEqual(currentAssignmentsForDisplay(target, [
    { measurement_date: "2026-08-31" },
    { measurement_date: "2026-09-01" },
    { measurement_date: "2026-09-02" },
    { measurement_date: "2026-09-03" },
  ]).map((row) => row.measurement_date), ["2026-08-31", "2026-09-01", "2026-09-03"]);
});

test("journal confirmation lookup pages beyond 1000 rows and matches all seven cases", async () => {
  const codes = ["H0242", "H0404", "H0457", "H0365", "H0307", "H0362", "H0363"];
  const rows = Array.from({ length: 1060 }, (_, index) => ({
    id: `id-${String(index).padStart(4, "0")}`,
    code: "H0000",
    measurement_year: 2026,
    measurement_period: "하반기",
  }));
  codes.forEach((code, index) => rows.push({
    id: `id-${1060 + index}`,
    code,
    measurement_year: 2026,
    measurement_period: index === 0 ? "하반기(수시)" : "하반기",
  }));
  const pages: number[] = [];
  const supabase = {
    from(table: string) {
      assert.equal(table, "measurement_journal");
      let selectedCodes: string[] = [];
      let selectedYears: number[] = [];
      return {
        select() { return this; },
        in(column: string, values: string[] | number[]) {
          if (column === "code") selectedCodes = values as string[];
          if (column === "measurement_year") selectedYears = values as number[];
          return this;
        },
        order() { return this; },
        async range(start: number, end: number) {
          pages.push(start);
          return { data: rows.filter((row) =>
            selectedCodes.includes(row.code)
            && selectedYears.includes(row.measurement_year)).slice(start, end + 1), error: null };
        },
      };
    },
  };
  const keys = await loadJournalConfirmationKeys(supabase, ["H0000", ...codes], [2026]);
  assert.deepEqual(pages, [0, 1000]);
  for (const code of codes) {
    assert.equal(keys.has(journalConfirmationKey(code, 2026, "하반기")), true);
    assert.equal(storedPlanWorkbenchState({ trueConfirmed: true, stale: false, hasPlan: true,
      planOrigin: "automatic", planStatus: "recommended", preliminaryScheduleBlocked: false,
      measurementScheduleBlocked: false, measurementRoleScheduleBlocked: false }).status, "true_confirmed");
  }
  assert.equal(keys.has(journalConfirmationKey("H0242", 2025, "하반기")), false);
});
