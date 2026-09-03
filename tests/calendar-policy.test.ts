import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPLETED_CALENDAR_COLOR_ID,
  isCalendarWorkCompleted,
  resolveCalendarColorId,
} from "../lib/google/calendar-policy";
import {
  CALENDAR_MEASUREMENT_PARTICIPANT_PRIORITY,
  formatCalendarMeasurementParticipants,
  resolveCalendarLeadParticipant,
} from "../lib/google/calendar-staff-display";

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

test("K2B 전송 전에는 일자별 대표 측정참여자 색상을 사용한다", () => {
  const journal = {
    k2b_send_date: null,
    electronic_invoice_date: "2026-06-16",
    measurement_fee_business: 300000,
  };

  assert.equal(isCalendarWorkCompleted(journal), false);
  assert.equal(resolveCalendarColorId("강종구", journal), "9");
  assert.equal(resolveCalendarColorId("이주형", journal), "5");
});

test("K2B 완료 상태에서는 측정참여자 대표자가 바뀌어도 완료 색상이 우선한다", () => {
  const completedJournal = {
    k2b_send_date: "2026-09-03",
    electronic_invoice_date: "2026-09-03",
    measurement_fee_business: 250000,
  };

  assert.equal(resolveCalendarColorId("한기문", completedJournal), COMPLETED_CALENDAR_COLOR_ID);
  assert.equal(resolveCalendarColorId("이주형", completedJournal), COMPLETED_CALENDAR_COLOR_ID);
  assert.equal(resolveCalendarColorId("김민영", completedJournal), COMPLETED_CALENDAR_COLOR_ID);
});

test("보고서 담당자가 측정 참여자에 포함되면 보고서 담당자를 최우선 표시한다", () => {
  assert.equal(formatCalendarMeasurementParticipants("김민영, 한기문", "한기문"), "한기문, 김민영");
  assert.equal(formatCalendarMeasurementParticipants("한기문, 김민영", "김민영"), "김민영, 한기문");
  assert.equal(resolveCalendarLeadParticipant("한기문, 김민영", "김민영"), "김민영");
});

test("보고서 담당자가 참여하지 않으면 승인된 측정참여자 우선순위로 표시한다", () => {
  assert.deepEqual(CALENDAR_MEASUREMENT_PARTICIPANT_PRIORITY, [
    "한기문",
    "이주형",
    "강종구",
    "고유빈",
    "김민영",
  ]);
  assert.equal(
    formatCalendarMeasurementParticipants("김민영, 고유빈, 강종구, 이주형, 한기문", "배윤민"),
    "한기문, 이주형, 강종구, 고유빈, 김민영",
  );
  assert.equal(
    resolveCalendarLeadParticipant("김민영, 강종구, 이주형", "한기문"),
    "이주형",
  );
});

test("우선순위에 없는 측정참여자는 승인 우선순위 인원 뒤에서 기존 입력 순서를 유지한다", () => {
  assert.equal(
    formatCalendarMeasurementParticipants("박신규, 김민영, 최지원", "한기문"),
    "김민영, 박신규, 최지원",
  );
});

test("보고서 담당자 미참여 시 표시 선두와 캘린더 색상 기준이 동일하다", () => {
  const lead = resolveCalendarLeadParticipant("강종구, 이주형, 김민영", "한기문");
  assert.equal(lead, "이주형");
  assert.equal(resolveCalendarColorId(lead, null), "5");
});

test("legacy 중복·공백은 표시에서만 정규화하고 참여자가 없으면 미지정이다", () => {
  assert.equal(formatCalendarMeasurementParticipants("한기문, 김민영, 한기문 ", "한기문"), "한기문, 김민영");
  assert.equal(formatCalendarMeasurementParticipants(null, "한기문"), "미지정");
  assert.equal(resolveCalendarLeadParticipant(null, "한기문"), null);
});
