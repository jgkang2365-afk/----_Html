import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { combineWorkbenchWarnings, REPORT_WRITER_PARTICIPATION_WARNING, reportWriterParticipationWarning } from "../lib/preliminary-survey-v2/report-writer-participation";

const users = new Map([[1, "보고서"], [2, "참여자"]].map(([id, name]) => [String(name), Number(id)]));

describe("보고서 담당자 측정 참여 경고", () => {
  it("단일일 참여자에 보고서 담당자가 있으면 경고하지 않는다", () => {
    assert.equal(reportWriterParticipationWarning({ source: { measurementDate: "2026-08-27", measurerId: 1, collaborators: ["보고서"] }, userIdByName: users }), null);
  });
  it("단일일 참여자에 보고서 담당자가 없으면 경고한다", () => {
    assert.equal(reportWriterParticipationWarning({ source: { measurementDate: "2026-08-27", measurerId: 1, collaborators: ["참여자"] }, userIdByName: users }), REPORT_WRITER_PARTICIPATION_WARNING);
  });
  it("A: 기준 writer가 어느 날짜에도 참여하지 않으면 일자별 writer가 달라도 경고한다", () => {
    assert.equal(reportWriterParticipationWarning({ source: { measurerId: 1, dailyStaff: [{ date: "2026-08-27", measurer_id: 1, collaborators: ["참여자"] }, { date: "2026-08-28", measurer_id: 2, collaborators: ["참여자"] }] }, userIdByName: users }), REPORT_WRITER_PARTICIPATION_WARNING);
  });
  it("B: 기준 writer가 다일 중 하루라도 참여하면 경고하지 않는다", () => {
    assert.equal(reportWriterParticipationWarning({ source: { measurerId: 1, dailyStaff: [{ date: "2026-08-27", measurer_id: 2, collaborators: ["참여자"] }, { date: "2026-08-28", measurer_id: 2, collaborators: ["보고서"] }] }, userIdByName: users }), null);
  });
  it("다일 전체에서 기준 보고서 담당자가 한 번도 참여하지 않으면 경고한다", () => {
    assert.equal(reportWriterParticipationWarning({ source: { measurerId: 1, dailyStaff: [{ date: "2026-08-27", measurer_id: 1, collaborators: ["참여자"] }, { date: "2026-08-28", measurer_id: 1, collaborators: ["참여자"] }] }, userIdByName: users }), REPORT_WRITER_PARTICIPATION_WARNING);
  });
  it("기존 충돌을 덮어쓰지 않고 결합한다", () => {
    assert.deepEqual(combineWorkbenchWarnings("경력 검토자 미배정", REPORT_WRITER_PARTICIPATION_WARNING), ["경력 검토자 미배정", REPORT_WRITER_PARTICIPATION_WARNING]);
  });
  it("C: 기준 보고서 담당자 미지정은 참여 누락으로 오판하지 않는다", () => {
    assert.equal(reportWriterParticipationWarning({ source: { measurementDate: "2026-08-27", measurerId: null, collaborators: ["참여자"] }, userIdByName: users }), null);
  });
});
