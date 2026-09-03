import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  buildExpectedCalendarDays,
  planCalendarProjectionReconciliation,
  summarizeCalendarResyncActions,
} from "@/lib/google/calendar-resync";

describe("관리자 캘린더 재동기화", () => {
  it("측정대상사업장의 일자·보고서 담당자·측정참여자를 Calendar 업무 원천으로 정규화한다", () => {
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

  it("예비조사의 날짜가 달라도 차단하지 않고 기존 ID/google_event_id를 보존해 target 날짜로 이동한다", () => {
    const result = planCalendarProjectionReconciliation(
      [{ date: "2026-09-09", reportWriter: "한기문", participants: ["한기문"] }],
      [{
        id: 706,
        measurement_date: "2026-09-03",
        report_writer: "한기문",
        actual_measurer: "한기문",
        google_event_id: "event-existing",
      }],
    );

    assert.equal(result.valid, true);
    if (!result.valid) return;
    assert.deepEqual(result.updates, [{
      id: 706,
      date: "2026-09-09",
      reportWriter: "한기문",
      participants: ["한기문"],
    }]);
    assert.deepEqual(result.inserts, []);
  });

  it("날짜가 같아도 보고서 담당자·측정참여자가 바뀌면 target 현재값으로 매핑 갱신한다", () => {
    const result = planCalendarProjectionReconciliation(
      [{ date: "2026-10-13", reportWriter: "이주형", participants: ["김민영", "이주형"] }],
      [{
        id: 762,
        measurement_date: "2026-10-13",
        report_writer: "한기문",
        actual_measurer: "고유빈",
        google_event_id: "event-old",
      }],
    );

    assert.equal(result.valid, true);
    if (!result.valid) return;
    assert.deepEqual(result.updates, [{
      id: 762,
      date: "2026-10-13",
      reportWriter: "이주형",
      participants: ["김민영", "이주형"],
    }]);
  });

  it("target 일정 수보다 legacy 연계 행이 많은 구조적 중복만 자동 복구를 중단한다", () => {
    const result = planCalendarProjectionReconciliation(
      [{ date: "2026-09-09", reportWriter: "한기문", participants: ["한기문"] }],
      [
        { id: 1, measurement_date: "2026-09-03", report_writer: "한기문", actual_measurer: "한기문", google_event_id: "a" },
        { id: 2, measurement_date: "2026-09-09", report_writer: "한기문", actual_measurer: "한기문", google_event_id: "b" },
      ],
    );

    assert.equal(result.valid, false);
    if (result.valid) return;
    assert.match(result.message, /중복 연계 행/);
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

  it("재동기화는 기존 sync 엔진을 사용해 K2B/계산서 완료 색상 정책을 그대로 유지한다", () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), "app/api/businesses/calendar-resync/route.ts"),
      "utf8",
    );
    const syncService = fs.readFileSync(path.join(process.cwd(), "lib/google/sync-service.ts"), "utf8");
    const policy = fs.readFileSync(path.join(process.cwd(), "lib/google/calendar-policy.ts"), "utf8");

    assert.match(route, /syncBusinessToCalendar\(supabase, code, year, period\)/);
    assert.match(syncService, /k2b_send_date, electronic_invoice_date, measurement_fee_business/);
    assert.match(syncService, /resolveCalendarColorId\(calendarLead, currentJournal\)/);
    assert.match(policy, /if \(!journal\?\.k2b_send_date\) return false/);
    assert.match(policy, /COMPLETED_CALENDAR_COLOR_ID/);
  });

  it("API와 화면은 관리자 전용이고 성공 후 실제 이벤트 날짜·색상을 다시 읽어 결과로 돌려준다", () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), "app/api/businesses/calendar-resync/route.ts"),
      "utf8",
    );
    const page = fs.readFileSync(path.join(process.cwd(), "app/businesses/page.tsx"), "utf8");

    assert.match(route, /session\.role !== "관리자"/);
    assert.doesNotMatch(route, /CALENDAR_SOURCE_MISMATCH/);
    assert.match(route, /getSurveyEvent\(survey\.google_event_id\)/);
    assert.match(route, /eventDate !== survey\.measurement_date/);
    assert.match(route, /colorId: event\.colorId \|\| null/);
    assert.match(page, /session\.role === "관리자" \? <CalendarResyncAdminPanel \/>/);
  });
});
