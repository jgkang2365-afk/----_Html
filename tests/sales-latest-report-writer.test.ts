import assert from "node:assert/strict";
import test from "node:test";
import { latestReportWriters, matchesLatestReportWriter, type ReportWriterSurvey } from "../lib/sales/latest-report-writer";

const staff = ["강종구", "이주형"];
const survey = (code: string, year: number, period: string, date: string, writer: string | null): ReportWriterSurvey => ({
  code, year, period, measurement_date: date, end_date: date, sequence_number: 1, report_writer: writer,
});

test("latest survey assigns every old unpaid period of the same code, including when latest is fully paid", () => {
  const writers = latestReportWriters([
    survey("A", 2024, "하반기", "2024-11-01", "이주형"),
    survey("A", 2025, "상반기", "2025-04-01", "이주형"),
    survey("A", 2025, "하반기", "2025-10-01", "강종구"),
    survey("A", 2026, "하반기", "2026-10-01", "강종구"),
  ], staff);
  for (const year of [2024, 2025]) {
    const oldUnpaid = { type: "measurement" as const, code: "A", year };
    assert.equal(matchesLatestReportWriter("강종구", oldUnpaid, writers), true);
    assert.equal(matchesLatestReportWriter("이주형", oldUnpaid, writers), false);
  }
});

test("same-name businesses never join across codes; other revenue remains visible only for all", () => {
  const writers = latestReportWriters([
    survey("A", 2026, "하반기", "2026-10-01", "강종구"),
    survey("B", 2026, "하반기", "2026-10-01", "이주형"),
  ], staff);
  assert.equal(matchesLatestReportWriter("강종구", { type: "measurement", code: "B" }, writers), false);
  assert.equal(matchesLatestReportWriter("", { type: "measurement", code: "B" }, writers), true);
  assert.equal(matchesLatestReportWriter("강종구", { type: "other" }, writers), false);
  assert.equal(matchesLatestReportWriter("", { type: "other" }, writers), true);
});

test("latest empty, unknown, ambiguous or conflicting assignment cannot inherit an old writer", () => {
  const writers = latestReportWriters([
    survey("A", 2025, "하반기", "2025-10-01", "이주형"),
    survey("A", 2026, "하반기", "2026-10-01", null),
    survey("B", 2026, "하반기", "2026-10-01", "unknown"),
    survey("C", 2026, "하반기", "2026-10-01", "강종구, 이주형"),
    survey("D", 2026, "상반기", "2026-04-01", "강종구"),
    survey("D", 2026, "상반기", "2026-04-01", "이주형"),
    survey("E", 2026, "상반기", "2026-04-01", "강종구"),
    { ...survey("E", 2026, "", "2026-10-01", "이주형") },
  ], staff);
  for (const code of ["A", "B", "C", "D", "E"]) assert.equal(writers[code], null);
  assert.equal(matchesLatestReportWriter("이주형", { type: "measurement", code: "" }, writers), false);
});

test("year, half/quarter/on-demand period and measurement date order determine latest", () => {
  const writers = latestReportWriters([
    survey("A", 2025, "하반기", "2025-12-30", "이주형"),
    survey("A", 2026, "1분기", "2026-03-01", "강종구"),
    survey("A", 2026, "수시", "2026-09-01", "이주형"),
    survey("A", 2026, "하반기", "2026-10-01", "강종구"),
  ], staff);
  assert.equal(writers.A, "강종구");
});
