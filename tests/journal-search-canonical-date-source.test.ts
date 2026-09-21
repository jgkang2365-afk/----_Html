import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  journalMatchesMeasurementDate,
  journalSearchKey,
  targetMatchesJournalMeasurementDate,
} from "../lib/journal/search-date-filter";

const route = readFileSync(
  resolve(process.cwd(), "app/api/journal/search/route.ts"),
  "utf8",
);

test("측정일 검색은 canonical target의 단일/다일 일정을 사용한다", () => {
  assert.equal(targetMatchesJournalMeasurementDate({
    code: "H0001",
    year: 2026,
    period: "하반기",
    measurement_date: "2026-09-21",
    daily_staff: null,
  }, "2026-09-21"), true);

  assert.equal(targetMatchesJournalMeasurementDate({
    code: "H0002",
    year: 2026,
    period: "하반기",
    measurement_date: "2026-09-20",
    daily_staff: [
      { date: "2026-09-20", measurer_id: 1, collaborators: [] },
      { date: "2026-09-21", measurer_id: 2, collaborators: [] },
    ],
  }, "2026-09-21"), true);

  assert.equal(targetMatchesJournalMeasurementDate({
    code: "H0003",
    year: 2026,
    period: "하반기",
    measurement_date: "2026-09-20",
    daily_staff: null,
  }, "2026-09-21"), false);
});

test("등록된 journal은 자체 시작일 또는 canonical 다일 일정으로 날짜 검색된다", () => {
  const keys = new Set([journalSearchKey("H0002", 2026, "하반기")]);

  assert.equal(journalMatchesMeasurementDate({
    code: "H0001",
    measurement_year: 2026,
    measurement_period: "하반기",
    measurement_start_date: "2026-09-21",
  }, "2026-09-21", new Set()), true);

  assert.equal(journalMatchesMeasurementDate({
    code: "H0002",
    measurement_year: 2026,
    measurement_period: "하반기",
    measurement_start_date: "2026-09-20",
  }, "2026-09-21", keys), true);

  assert.equal(journalMatchesMeasurementDate({
    code: "H0535",
    measurement_year: 2026,
    measurement_period: "하반기",
    measurement_start_date: null,
  }, "2026-09-21", new Set()), false);
});

test("journal search는 preliminary_survey로 가상 등록 후보를 만들지 않는다", () => {
  assert.match(route, /measurement_target_business/);
  assert.match(route, /dateMatchedTargetKeys/);
  assert.match(route, /b\.is_registered === "확정" \|\| b\.is_registered === "실시"/);
  assert.doesNotMatch(route, /validSurveys/);
  assert.doesNotMatch(route, /_isFromSurvey/);
  assert.doesNotMatch(route, /예비조사 데이터 중 아직 결과에 없는 것 추가/);
});
