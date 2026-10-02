import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MEASUREMENT_PARTICIPANT_PRIORITY,
  formatMeasurementParticipants,
  orderMeasurementParticipants,
  resolveLeadMeasurementParticipant,
} from "../lib/business/measurement-participant-display";
import {
  CALENDAR_MEASUREMENT_PARTICIPANT_PRIORITY,
  formatCalendarMeasurementParticipants,
  resolveCalendarLeadParticipant,
} from "../lib/google/calendar-staff-display";
import { formatMeasurementParticipantsForDisplay } from "../lib/preliminary-survey-v2/participant-display";

test("공통 표시순서에서 실제 참여 보고서 담당만 선두에 두고 원천 배열은 보존한다", () => {
  const source = [" 김민영 ", "이주형", "김민영"];
  assert.deepEqual(orderMeasurementParticipants(source, "이주형"), ["이주형", "김민영"]);
  assert.deepEqual(source, [" 김민영 ", "이주형", "김민영"]);
  assert.equal(formatMeasurementParticipants(["한기문", "김민영"], "김민영"), "김민영, 한기문");
});

test("보고서 담당이 미참여이면 확정 우선순위와 기타 인원의 입력 순서를 따른다", () => {
  assert.deepEqual(MEASUREMENT_PARTICIPANT_PRIORITY, ["한기문", "이주형", "강종구", "고유빈", "김민영"]);
  assert.equal(formatMeasurementParticipants("김민영, 강종구, 이주형", "한기문"), "이주형, 강종구, 김민영");
  assert.equal(formatMeasurementParticipants("박신규, 김민영, 최지원, 박신규", "한기문"), "김민영, 박신규, 최지원");
  assert.equal(resolveLeadMeasurementParticipant("김민영, 이주형", "한기문"), "이주형");
  assert.equal(formatMeasurementParticipants(null, "한기문"), "미지정");
});

test("Calendar와 예비조사는 같은 공통 contract의 화면별 구분자와 빈값을 사용한다", () => {
  assert.equal(CALENDAR_MEASUREMENT_PARTICIPANT_PRIORITY, MEASUREMENT_PARTICIPANT_PRIORITY);
  assert.equal(formatCalendarMeasurementParticipants("김민영, 이주형", "이주형"), "이주형, 김민영");
  assert.equal(formatCalendarMeasurementParticipants("-", null), "미지정");
  assert.equal(resolveCalendarLeadParticipant("-", null), null);
  assert.equal(resolveCalendarLeadParticipant("김민영, 이주형", "이주형"), "이주형");
  assert.equal(formatMeasurementParticipantsForDisplay(["김민영", "이주형"], "이주형"), "이주형 · 김민영");
  assert.equal(formatMeasurementParticipantsForDisplay([], "이주형"), "-");
  assert.equal(formatMeasurementParticipantsForDisplay("-", "이주형"), "-");
});

test("측정일지·요약 read-only 표시 모델과 요약 fallback도 공통 contract에 연결한다", () => {
  const display = readFileSync("lib/preliminary-survey-v2/display-model.ts", "utf8");
  const summary = readFileSync("components/features/SummaryTable.tsx", "utf8");
  assert.match(display, /formatMeasurementParticipantsForDisplay\(source\?\.measurementParticipants, source\?\.reportWriter/);
  assert.match(summary, /formatMeasurementParticipants\(entry\.actual_measurer, entry\.report_writer/);
});
