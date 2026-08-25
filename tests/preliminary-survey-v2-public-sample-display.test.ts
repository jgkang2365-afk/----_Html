import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLegacyMeasurementPublicSampleLookup,
  resolveMeasurementPublicSampleDisplay,
} from "../lib/preliminary-survey-v2/public-sample-display";

const users = new Map<number, string>([[1, "이태환"], [2, "한기문"], [3, "강종구"], [4, "이주형"], [5, "고유빈"], [6, "김민영"]]);

test("V2 assignment가 찐확정 legacy 값보다 우선한다", () => {
  assert.deepEqual(resolveMeasurementPublicSampleDisplay({
    v2Assignment: { assigneeUserId: 1, surveyCode: "A" },
    trueConfirmed: true,
    legacyAssignment: { measurer: "김민영", surveyCode: "GG" },
    userNameById: users,
  }), { label: "이태환(A)", source: "v2" });
});

test("찐확정이고 V2 assignment가 없을 때만 legacy 값을 표시한다", () => {
  assert.deepEqual(resolveMeasurementPublicSampleDisplay({
    v2Assignment: null, trueConfirmed: true,
    legacyAssignment: { measurer: "한기문", surveyCode: "B" }, userNameById: users,
  }), { label: "한기문(B)", source: "legacy_true_confirmed" });
  assert.deepEqual(resolveMeasurementPublicSampleDisplay({
    v2Assignment: null, trueConfirmed: false,
    legacyAssignment: { measurer: "한기문", surveyCode: "B" }, userNameById: users,
  }), { label: "-", source: "none" });
  assert.deepEqual(resolveMeasurementPublicSampleDisplay({
    v2Assignment: null, trueConfirmed: true, legacyAssignment: null, userNameById: users,
  }), { label: "-", source: "none" });
});

test("legacy historical survey_code FF/GG를 변환하지 않는다", () => {
  for (const [measurer, surveyCode] of [["김민영", "GG"], ["고유빈", "FF"]] as const) {
    assert.equal(resolveMeasurementPublicSampleDisplay({
      v2Assignment: null, trueConfirmed: true, legacyAssignment: { measurer, surveyCode }, userNameById: users,
    }).label, `${measurer}(${surveyCode})`);
  }
});

test("신규 V2 6개 공시료 코드는 legacy와 무관하게 그대로 표시한다", () => {
  const assignments = [[1, "A", "이태환(A)"], [5, "F", "고유빈(F)"], [2, "B", "한기문(B)"],
    [6, "G", "김민영(G)"], [1, "A", "이태환(A)"], [3, "C", "강종구(C)"]] as const;
  for (const [assigneeUserId, surveyCode, expected] of assignments) {
    const result = resolveMeasurementPublicSampleDisplay({
      v2Assignment: { assigneeUserId, surveyCode }, trueConfirmed: false,
      legacyAssignment: { measurer: "과거담당자", surveyCode: "GG" }, userNameById: users,
    });
    assert.equal(result.label, expected);
    assert.equal(result.source, "v2");
  }
});

test("legacy 연결은 exact 복합키 우선이며 모호한 정규화 후보는 사용하지 않는다", () => {
  const lookup = buildLegacyMeasurementPublicSampleLookup([
    { code: "H0001", year: 2026, period: "하반기", measurementDate: "2026-08-03", measurer: "이태환", surveyCode: "A" },
    { code: "H0002", year: 2026, period: "하반기(수시)", measurementDate: "2026-08-03", measurer: "한기문", surveyCode: "B" },
    { code: "H0003", year: 2026, period: "하반기", measurementDate: "2026-08-03", measurer: "강종구", surveyCode: "C" },
    { code: "H0003", year: 2026, period: "하반기(수시)", measurementDate: "2026-08-03", measurer: "이주형", surveyCode: "D" },
  ]);
  assert.equal(lookup({ code: "H0001", year: 2026, period: "하반기", measurementDate: "2026-08-03" })?.measurer, "이태환");
  assert.equal(lookup({ code: "H0002", year: 2026, period: "하반기", measurementDate: "2026-08-03" })?.measurer, "한기문");
  assert.equal(lookup({ code: "H0003", year: 2026, period: "하반기", measurementDate: "2026-08-03" })?.measurer, "강종구");
  assert.equal(lookup({ code: "H0003", year: 2026, period: "하반기 (수시)", measurementDate: "2026-08-03" }), null);
});
