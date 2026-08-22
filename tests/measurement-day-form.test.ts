import assert from "node:assert/strict";
import test from "node:test";
import {
  measurementDayFormsFrom,
  serializeMeasurementDayForms,
  swapMeasurerForMeasurementDateTransition,
} from "../lib/business/measurement-day-form";

test("단일일 legacy 값은 trim/dedup된 하나의 날짜 폼으로 변환한다", () => {
  assert.deepEqual(measurementDayFormsFrom({
    measurementDate: "2026-08-20",
    measurerId: 7,
    collaborators: " 김민영,김민영, 한기문 ,, ",
  }), [{ date: "2026-08-20", measurerId: 7, collaborators: ["김민영", "한기문"] }]);
});

test("여러 날짜는 earliest/latest를 재계산하고 참여자를 날짜별로 정규화한다", () => {
  assert.deepEqual(serializeMeasurementDayForms([
    { date: "2026-08-22", measurerId: 2, collaborators: [" 한기문 ", "한기문"] },
    { date: "2026-08-20", measurerId: 7, collaborators: ["김민영", " 김민영"] },
  ]), {
    daily_staff: [
      { date: "2026-08-22", measurer_id: 2, collaborators: ["한기문"] },
      { date: "2026-08-20", measurer_id: 7, collaborators: ["김민영"] },
    ],
    measurement_date: "2026-08-20",
    measurement_end_date: "2026-08-22",
    measurer_id: 7,
    collaborators: "김민영",
  });
});

test("다일에서 하루만 남기면 단일일 legacy serializer 형식으로 돌아간다", () => {
  assert.deepEqual(serializeMeasurementDayForms([
    { date: "2026-08-20", measurerId: 7, collaborators: ["김민영"] },
  ]), {
    daily_staff: null,
    measurement_date: "2026-08-20",
    measurement_end_date: "2026-08-20",
    measurer_id: 7,
    collaborators: "김민영",
  });
});

test("전환일을 넘겨 날짜를 수정하면 해당 일자의 담당·참여자와 link 담당을 기존 규칙으로 교체한다", () => {
  assert.deepEqual(swapMeasurerForMeasurementDateTransition(
    { date: "2026-06-08", measurerId: 14, collaborators: ["배윤민", "한기문"] },
    "2026-06-08",
    "2026-06-09",
    14,
  ), {
    day: { date: "2026-06-08", measurerId: 20, collaborators: ["한기문", "김민영"] },
    linkMeasurerId: 20,
  });
});

test("전환일 이전으로 되돌리면 기존 참여자 이외의 역할을 추론하지 않고 역방향으로만 교체한다", () => {
  assert.deepEqual(swapMeasurerForMeasurementDateTransition(
    { date: "2026-06-09", measurerId: 20, collaborators: ["김민영", "강종구"] },
    "2026-06-09",
    "2026-06-08",
    20,
  ), {
    day: { date: "2026-06-09", measurerId: 14, collaborators: ["강종구", "배윤민"] },
    linkMeasurerId: 14,
  });
});
