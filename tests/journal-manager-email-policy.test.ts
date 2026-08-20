import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeJournalManagerEmailForSave,
  resolveJournalManagerEmail,
  resolveJournalManagerEmailUpdate,
} from "../lib/journal/manager-email-policy";

test("기존 측정일지는 빈 담당자 메일을 전회 및 요약정보로 보완하지 않는다", () => {
  assert.equal(
    resolveJournalManagerEmail({
      isEditMode: true,
      currentValue: "",
      fallbackValues: ["old@example.com", "summary@example.com"],
    }),
    "",
  );
});

test("기존 측정일지는 현재 담당자 메일을 유지한다", () => {
  assert.equal(
    resolveJournalManagerEmail({
      isEditMode: true,
      currentValue: "current@example.com",
      fallbackValues: ["old@example.com"],
    }),
    "current@example.com",
  );
});

test("신규 측정일지는 현재값이 비어 있을 때 전회 담당자 메일을 자동입력한다", () => {
  assert.equal(
    resolveJournalManagerEmail({
      isEditMode: false,
      currentValue: "",
      fallbackValues: ["old@example.com"],
    }),
    "old@example.com",
  );
});

test("계산서 메일은 기존 측정일지의 담당자 메일 fallback에 포함하지 않는다", () => {
  const invoiceEmail = "invoice@example.com";
  const managerEmail = resolveJournalManagerEmail({
    isEditMode: true,
    currentValue: "",
    fallbackValues: [],
  });

  assert.equal(managerEmail, "");
  assert.equal(invoiceEmail, "invoice@example.com");
});

test("담당자 메일 삭제값을 저장 payload와 업데이트에 명시적으로 반영한다", () => {
  const payload = {
    manager_email: normalizeJournalManagerEmailForSave(""),
  };

  assert.deepEqual(payload, { manager_email: null });
  assert.equal(
    resolveJournalManagerEmailUpdate(payload, "old@example.com"),
    null,
  );
  assert.equal(
    resolveJournalManagerEmailUpdate({}, "old@example.com"),
    "old@example.com",
  );
});
