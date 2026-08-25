import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPLETED_CALENDAR_COLOR_ID,
  isCalendarWorkCompleted,
  resolveCalendarColorId,
} from "../lib/google/calendar-policy";
import { formatCalendarMeasurementParticipants } from "../lib/google/calendar-staff-display";

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

test("보고서 담당자가 측정 참여자에 포함되면 이름을 우선 표시한다", () => {
  assert.equal(formatCalendarMeasurementParticipants("김민영, 한기문", "한기문"), "한기문, 김민영");
});

test("보고서 담당자가 참여하지 않으면 실제 측정 참여자만 표시한다", () => {
  assert.equal(formatCalendarMeasurementParticipants("강종구, 김민영", "한기문"), "강종구, 김민영");
});

test("legacy 중복·공백은 표시에서만 정규화하고 참여자가 없으면 미지정이다", () => {
  assert.equal(formatCalendarMeasurementParticipants("한기문, 김민영, 한기문 ", "한기문"), "한기문, 김민영");
  assert.equal(formatCalendarMeasurementParticipants(null, "한기문"), "미지정");
});
