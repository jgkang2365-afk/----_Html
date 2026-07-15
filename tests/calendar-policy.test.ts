import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPLETED_CALENDAR_COLOR_ID,
  isCalendarWorkCompleted,
  resolveCalendarColorId,
} from "../lib/google/calendar-policy";

test("K2B 전송일과 계산서 발행일이 있으면 완료 색상을 사용한다", () => {
  const journal = {
    k2b_send_date: "2026-07-15",
    electronic_invoice_date: "2026-06-16",
    measurement_fee_business: 300000,
  };

  assert.equal(isCalendarWorkCompleted(journal), true);
  assert.equal(resolveCalendarColorId("강종구", journal), COMPLETED_CALENDAR_COLOR_ID);
});

test("사업장 부담금이 0원이면 계산서 발행일 없이 완료 처리한다", () => {
  const journal = {
    k2b_send_date: "2026-07-15",
    electronic_invoice_date: null,
    measurement_fee_business: 0,
  };

  assert.equal(resolveCalendarColorId("강종구", journal), COMPLETED_CALENDAR_COLOR_ID);
});

test("K2B 전송 전에는 보고서 담당자 색상을 유지한다", () => {
  const journal = {
    k2b_send_date: null,
    electronic_invoice_date: "2026-06-16",
    measurement_fee_business: 300000,
  };

  assert.equal(isCalendarWorkCompleted(journal), false);
  assert.equal(resolveCalendarColorId("강종구", journal), "9");
});
