import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  buildExpectedCalendarDays,
  summarizeCalendarResyncActions,
  validateCalendarProjection,
} from "@/lib/google/calendar-resync";

describe("관리자 캘린더 재동기화", () => {
  it("측정대상사업장의 일자·보고서 담당자·측정참여자를 원천 기준으로 정규화한다", () => {
    const expected = buildExpectedCalendarDays(
      {
        daily_staff: null,
        measurement_date: "2026-09-02",
        measurer_id: 13,
        collaborators: "김민영, 이주형",
      },
      [{ id: 13, name: "이주형" }],
    );

    assert.deepEqual(expected, [{
      date: "2026-09-02",
      reportWriter: "이주형",
      participants: ["김민영", "이주형"],
    }]);
  });

  it("측정대상사업장과 예비조사 원천의 날짜가 다르면 재동기화를 차단한다", () => {
    const result = validateCalendarProjection(
      [{ date: "2026-09-09", reportWriter: "한기문", participants: ["한기문"] }],
      [{
        id: 706,
        measurement_date: "2026-09-03",
        report_writer: "한기문",
        actual_measurer: "한기문",
        google_event_id: null,
      }],
    );

    assert.equal(result.valid, false);
    assert.deepEqual(result.details, {
      expectedDates: ["2026-09-09"],
      surveyDates: ["2026-09-03"],
    });
  });

  it("날짜가 같아도 참여자 또는 보고서 담당자가 다르면 재동기화를 차단한다", () => {
    const result = validateCalendarProjection(
      [{ date: "2026-10-13", reportWriter: "이주형", participants: ["김민영", "이주형"] }],
      [{
        id: 762,
        measurement_date: "2026-10-13",
        report_writer: "이주형",
        actual_measurer: "이주형",
        google_event_id: "event-old",
      }],
    );

    assert.equal(result.valid, false);
    assert.match(result.message || "", /측정참여자/);
  });

  it("기존 ID 유지·신규 생성·삭제 일정 재생성을 구분한다", () => {
    const before = [
      { id: 1, measurement_date: "2026-09-02", report_writer: "이주형", actual_measurer: "이주형", google_event_id: "same" },
      { id: 2, measurement_date: "2026-09-09", report_writer: "한기문", actual_measurer: "한기문", google_event_id: null },
      { id: 3, measurement_date: "2026-09-10", report_writer: "고유빈", actual_measurer: "고유빈", google_event_id: "deleted" },
    ];
    const after = [
      { ...before[0], google_event_id: "same" },
      { ...before[1], google_event_id: "new" },
      { ...before[2], google_event_id: "replacement" },
    ];

    assert.deepEqual(
      summarizeCalendarResyncActions(before, after).map(({ date, action }) => ({ date, action })),
      [
        { date: "2026-09-02", action: "updated" },
        { date: "2026-09-09", action: "created" },
        { date: "2026-09-10", action: "recreated" },
      ],
    );
  });

  it("API와 화면 모두 관리자 전용이며 성공 후 실제 이벤트 날짜를 재검증한다", () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), "app/api/businesses/calendar-resync/route.ts"),
      "utf8",
    );
    const page = fs.readFileSync(path.join(process.cwd(), "app/businesses/page.tsx"), "utf8");

    assert.match(route, /session\.role !== "관리자"/);
    assert.match(route, /CALENDAR_SOURCE_MISMATCH/);
    assert.match(route, /getSurveyEvent\(survey\.google_event_id\)/);
    assert.match(route, /eventDate !== survey\.measurement_date/);
    assert.match(page, /session\.role === "관리자" \? <CalendarResyncAdminPanel \/>/);
  });
});
