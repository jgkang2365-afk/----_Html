import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  deriveK2BReconciliationUpdate,
  reconcileK2BSubmissionResults,
  selectChangedK2BReconciliationUpdate,
} from "../lib/k2b-verification";
import { parseK2BSubmissionGrid } from "../lib/automation/k2b-original-sync";
import { presentK2BBusinessStatus, presentK2BConsistency } from "../lib/report-processing/k2b-result-presentation";

const target = {
  journalId: 7, code: "T", businessName: "합성 사업장", resultDate: "2026-08-23",
  industrialAccidentNumber: "123-45", commencementNumber: "00001", measurementYear: 2026,
  measurementPeriod: "하반기", internalK2BStatus: "업로드 완료", internalK2BSendDate: "2026-08-19",
};
const receipt = (overrides: Record<string, unknown> = {}) => ({
  managementNumber: "12345", commencementNumber: "00001", businessYear: "2026", half: "하반기",
  submissionDate: "2026-08-23", status: "정상처리", submissionNumber: "R-23", ...overrides,
});
const complete = { completeness: "COMPLETE" as const };
const reconcile = (rows: Record<string, unknown>[], targetOverride: Record<string, unknown> = {}) =>
  reconcileK2BSubmissionResults([{ ...target, ...targetOverride }], rows, complete)[0];
const journal = { internalK2BSendDate: "2026-08-19", k2bStatus: "업로드 완료" };

test("1. 단일 정상은 최신 실제 결과로 선택한다", () => assert.equal(reconcile([receipt()]).verdict, "정상"));
test("2. 과거 정상 + 최신 반송은 반송을 선택한다", () => assert.equal(reconcile([receipt({ submissionDate: "2026-08-19" }), receipt({ submissionDate: "2026-08-22", submissionNumber: "반송파일" })]).verdict, "사용자반송"));
test("3. 과거 정상 + 반송 + 최신 정상은 최신 정상으로 복구한다", () => assert.equal(reconcile([receipt({ submissionDate: "2026-08-19" }), receipt({ submissionDate: "2026-08-22", submissionNumber: "반송파일" }), receipt()]).verdict, "정상"));
test("4. 같은 날 오류 하단 + 정상 상단이면 상단 정상을 선택한다", () => assert.equal(reconcile([receipt(), receipt({ status: "체크오류", errorDetail: "오류" })]).verdict, "정상"));
test("5. 같은 날 정상 하단 + 오류 상단이면 상단 오류를 선택한다", () => assert.equal(reconcile([receipt({ status: "체크오류", errorDetail: "오류" }), receipt()]).verdict, "오류"));
test("6. 서로 다른 접수일은 가장 최근 접수일을 선택한다", () => assert.equal(reconcile([receipt({ submissionDate: "2026-08-24", status: "체크오류", errorDetail: "오류" }), receipt()]).match?.submissionDate, "2026-08-24"));
test("7. 우측 순번은 최신성에 영향이 없다", () => assert.equal(reconcile([receipt({ sequenceNumber: "1" }), receipt({ sequenceNumber: "999", status: "체크오류", errorDetail: "오류" })]).verdict, "정상"));
test("8. 파일명 후행 숫자는 최신성에 영향이 없다", () => assert.equal(reconcile([receipt({ fileName: "청구_1.xml" }), receipt({ fileName: "청구_999.xml", status: "체크오류", errorDetail: "오류" })]).verdict, "정상"));
test("9. parser는 Grid 원본 행 순서와 raw receipt를 보존한다", () => {
  const headers = ["청구 파일명", "사업장명", "접수일", "사업년도", "반기", "지원구분", "접수번호", "산재관리번호", "개시번호", "순번", "처리상태", "오류내용"];
  const rows = [["a_2.xml", "합성 사업장", "2026-08-23", "2026", "하반기", "국고", "R-top", "12345", "00001", "9", "정상처리", ""], ["a_1.xml", "합성 사업장", "2026-08-23", "2026", "하반기", "국고", "R-bottom", "12345", "00001", "1", "체크오류", "실제 오류"]];
  const parsed = parseK2BSubmissionGrid(headers, rows, { expectedRowCount: 2, collectedUniqueRowCount: 2, readMethod: "nexacro_dataset", completeness: "COMPLETE" });
  assert.equal(parsed.rows[0].submissionNumber, "R-top");
  assert.equal(parsed.rows[1].raw["오류내용"], "실제 오류");
});
test("10. 정상처리 + 정상 접수번호 + 오류 없음만 NORMAL이다", () => assert.deepEqual([reconcile([receipt()]).verdict, reconcile([receipt()]).state], ["정상", "GREEN"]));
test("11. 반송파일은 USER_RETURN이다", () => assert.deepEqual([reconcile([receipt({ submissionNumber: "반송파일" })]).verdict, reconcile([receipt({ submissionNumber: "반송파일" })]).state], ["사용자반송", "YELLOW"]));
test("12. 오류보기/오류내용은 ERROR_REVIEW이다", () => assert.deepEqual([reconcile([receipt({ errorViewAvailable: true })]).verdict, reconcile([receipt({ errorViewAvailable: true })]).state], ["오류", "YELLOW"]));
test("13. source 불완전은 NEEDS_CONFIRMATION이다", () => {
  const [item] = reconcileK2BSubmissionResults([target], [receipt()], { completeness: "INCOMPLETE" });
  assert.deepEqual([item.verdict, item.state], ["확인 필요", "RED"]);
});
test("14. NORMAL patch는 실제 접수일을 저장한다", () => assert.equal(deriveK2BReconciliationUpdate(reconcile([receipt()]), journal, "now").k2b_send_date, "2026-08-23"));
test("15. 반송 patch는 send_date를 null로 비운다", () => assert.equal(deriveK2BReconciliationUpdate(reconcile([receipt({ submissionNumber: "반송파일" })]), journal, "now").k2b_send_date, null));
test("16. 오류 patch는 send_date를 null로 비운다", () => assert.equal(deriveK2BReconciliationUpdate(reconcile([receipt({ errorDetail: "오류" })]), journal, "now").k2b_send_date, null));
test("17. 확인 필요 patch는 기존 send_date를 omit하여 보존한다", () => {
  const [item] = reconcileK2BSubmissionResults([target], [receipt()], { completeness: "UNKNOWN" });
  const update = deriveK2BReconciliationUpdate(item, journal, "now");
  assert.equal(Object.hasOwn(update, "k2b_send_date"), false);
  assert.equal(journal.internalK2BSendDate, "2026-08-19");
});
test("17b. 기존 null의 판정불가는 date write 없이 material idempotency를 유지한다", () => {
  const [item] = reconcileK2BSubmissionResults([{ ...target, internalK2BSendDate: null }], [receipt()], { completeness: "INCOMPLETE" });
  const first = deriveK2BReconciliationUpdate(item, { internalK2BSendDate: null, k2bStatus: "결과 확인 필요" }, "now");
  assert.equal(Object.hasOwn(first, "k2b_send_date"), false);
  assert.equal(selectChangedK2BReconciliationUpdate(item, { internalK2BSendDate: null, k2bStatus: "결과 확인 필요", ...first }, "later"), null);
});
test("17c. INCOMPLETE exact 결과는 최종 update에서 기존 접수일 key를 보존한다", () => {
  const [item] = reconcileK2BSubmissionResults([target], [receipt()], { completeness: "INCOMPLETE" });
  const update = deriveK2BReconciliationUpdate(item, journal, "now");

  assert.deepEqual([item.matchMethod, item.verdict, item.state], ["exact_keys", "확인 필요", "RED"]);
  assert.equal(update.k2b_status, "결과 확인 필요");
  assert.equal(Object.prototype.hasOwnProperty.call(update, "k2b_send_date"), false);
  assert.equal(journal.internalK2BSendDate, "2026-08-19");
});
test("17d. AMBIGUOUS canonical 결과는 최종 update에서 기존 접수일 key를 보존한다", () => {
  const [item] = reconcileK2BSubmissionResults(
    [target, { ...target, journalId: 8, code: "T-duplicate" }],
    [receipt()],
    complete,
  );
  const update = deriveK2BReconciliationUpdate(item, journal, "now");

  assert.deepEqual([item.matchMethod, item.verdict, item.state], ["AMBIGUOUS", "확인 필요", "YELLOW"]);
  assert.equal(update.k2b_status, "결과 확인 필요");
  assert.equal(Object.prototype.hasOwnProperty.call(update, "k2b_send_date"), false);
  assert.equal(journal.internalK2BSendDate, "2026-08-19");
});
test("17e. MISSING_KEY 결과는 최종 update에서 기존 접수일 key를 보존한다", () => {
  const [item] = reconcileK2BSubmissionResults(
    [{ ...target, industrialAccidentNumber: null }],
    [receipt()],
    complete,
  );
  const update = deriveK2BReconciliationUpdate(item, journal, "now");

  assert.deepEqual([item.matchMethod, item.verdict, item.state], ["MISSING_KEY", "확인 필요", "RED"]);
  assert.equal(update.k2b_status, "결과 확인 필요");
  assert.equal(Object.prototype.hasOwnProperty.call(update, "k2b_send_date"), false);
  assert.equal(journal.internalK2BSendDate, "2026-08-19");
});
test("18. 08/19 정상 → 08/22 반송은 기존 날짜를 제거한다", () => assert.deepEqual(deriveK2BReconciliationUpdate(reconcile([receipt({ submissionDate: "2026-08-19" }), receipt({ submissionDate: "2026-08-22", submissionNumber: "반송파일" })]), journal, "now"), { k2b_verified_status: "YELLOW", k2b_verified_at: "now", k2b_consistency_status: "YELLOW", k2b_consistency_note: "K2B 실제결과 사용자반송", k2b_verification_error: null, k2b_verification_attempted_at: "now", k2b_status: "사용자반송", k2b_send_date: null, k2b_verified_send_date: "2026-08-22", k2b_verified_result_date: "2026-08-22", k2b_verified_remote_status: "정상처리" }));
test("19. 이후 08/23 정상은 최신 날짜로 다시 저장한다", () => assert.equal(deriveK2BReconciliationUpdate(reconcile([receipt({ submissionDate: "2026-08-22", submissionNumber: "반송파일" }), receipt()]), journal, "now").k2b_send_date, "2026-08-23"));
test("20. 같은 계산결과 반복 실행은 DB patch를 만들지 않는다", () => {
  const item = reconcile([receipt()]);
  const first = deriveK2BReconciliationUpdate(item, journal, "first");
  assert.equal(selectChangedK2BReconciliationUpdate(item, { ...journal, ...first }, "second"), null);
});
test("21. 정상 UI는 K2B 상태 공란 / 녹색 신호다", () => assert.deepEqual([presentK2BBusinessStatus("정상처리").label, presentK2BConsistency("GREEN").icon, presentK2BConsistency("GREEN").label], [null, "🟢", "정상"]));
test("22. 반송 UI는 사용자반송 / 노랑 확인 필요다", () => assert.deepEqual([presentK2BBusinessStatus("사용자반송").label, presentK2BConsistency("YELLOW").icon, presentK2BConsistency("YELLOW").label], ["사용자반송", "🟡", "확인 필요"]));
test("23. 오류 UI는 오류/파일 재검토 / 노랑 확인 필요다", () => assert.deepEqual([presentK2BBusinessStatus("오류/파일 재검토").label, presentK2BConsistency("YELLOW").label], ["오류/파일 재검토", "확인 필요"]));
test("24. 판정불가 UI는 결과 확인 필요 / 빨강 확인 필요다", () => assert.deepEqual([presentK2BBusinessStatus("결과 확인 필요").label, presentK2BConsistency("RED").icon, presentK2BConsistency("RED").label], ["결과 확인 필요", "🔴", "확인 필요"]));
test("25. 보고서 처리 K2B 상태에 진행 (업로드 완료)을 노출하지 않는다", () => {
  const source = readFileSync("app/(dashboard)/report-processing/page.tsx", "utf8");
  assert.equal(presentK2BBusinessStatus("업로드 완료").label, null);
  assert.doesNotMatch(source, /진행 \(업로드 완료\)/);
});
