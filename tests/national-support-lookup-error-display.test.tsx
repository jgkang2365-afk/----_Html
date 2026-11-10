import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describeNationalSupportLookupError } from "../lib/national-support/lookup-error-display";
import { MeasurementTargetBusinessFormSections } from "../components/features/MeasurementTargetBusinessFormSections";

const cases = [
  ["ModuleNotFoundError: No module named 'selenium'", "실행환경 오류", "selenium"],
  ["ModuleNotFoundError: No module named 'customtkinter'", "실행환경 오류", "customtkinter"],
  ["session not created: Chrome failed to start", "브라우저 오류", "Chrome"],
  ["net::ERR_CONNECTION_TIMED_OUT", "접속 오류", "공단 사이트"],
  ["NoSuchElementException: no such element", "화면 인식 오류", "항목"],
  ["자동 신청 담당자 휴대전화는 010 번호여야 합니다.", "입력정보 오류", "010 번호"],
  ["공단 근로자 수 확인에 실패해 다음날 재확인합니다.", "근로자수 확인 실패", "근로자수"],
  ["신청 시점 50인 이상 - 사용자가 직접 확인해야 합니다.", "신청조건 불충족·신청 보류", "50인 이상"],
  ["측정일지 등록이 확인되어 신청하지 않았습니다.", "중복 신청 방지·측정일지 등록 제외", "측정일지"],
  ["기존 신청 내역이 확인되어 결과 조회를 대기합니다.", "중복 신청 방지·측정일지 등록 제외", "기존 신청"],
  ["자동 신청 완료 여부를 명확히 확인하지 못했습니다.", "신청 결과 확인 불가", "확정"],
] as const;

test("실제 오류 단서에 따라 한국어 유형·사유·조치를 제공한다", () => {
  for (const [raw, type, reasonFragment] of cases) {
    const display = describeNationalSupportLookupError(raw);
    assert.equal(display.type, type, raw);
    assert.match(display.reason, new RegExp(reasonFragment), raw);
    assert.ok(display.action.length > 10, raw);
    assert.doesNotMatch(`${display.reason} ${display.action}`, /Stacktrace|ModuleNotFoundError|NoSuchElementException/);
  }
});

test("원인을 특정할 수 없는 오류는 안전하게 미분류한다", () => {
  for (const raw of ["TimeoutException: Message:", "연결 오류", "건강디딤돌 조회가 실패했습니다.", "", "예상하지 못한 오류"]) {
    assert.equal(describeNationalSupportLookupError(raw).type, "미분류 시스템 오류", raw);
  }
});

test("상세 폼 실패 상태에만 안내와 접이식 원문을 표시하고 기존 상태 표시를 유지한다", () => {
  const render = (sync_status: string, sync_error_message: string | null) => renderToStaticMarkup(
    <MeasurementTargetBusinessFormSections
      mode="edit"
      value={{ sync_status, sync_error_message, period: "하반기" } as any}
      onChange={() => {}}
      businessCategories={[]}
      planManagerOptions={[]}
      measurers={[]}
      measurementDays={[]}
      blockedKeys={new Set()}
      onMeasurementDaysChange={() => {}}
    />,
  );
  const failed = render("실패", "ModuleNotFoundError: No module named 'selenium'");
  assert.match(failed, /현재 조회 상태:/);
  assert.match(failed, /조회 실패 유형:.*실행환경 오류/);
  assert.match(failed, /<details[^>]*><summary[^>]*>기술 상세<\/summary>/);
  assert.match(failed, /ModuleNotFoundError: No module named/);
  const success = render("성공", "ModuleNotFoundError: No module named 'selenium'");
  assert.match(success, /현재 조회 상태:/);
  assert.doesNotMatch(success, /조회 실패 유형:|기술 상세|ModuleNotFoundError/);
});
