import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  normalizeJournalManagerEmailForSave,
  resolveJournalManagerContact,
  resolveJournalManagerEmail,
  resolveJournalManagerEmailUpdate,
} from "../lib/journal/manager-email-policy";

const journalFormSource = readFileSync("components/features/JournalEditForm.tsx", "utf8");

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

test("신규 측정일지는 현재 담당자 정보가 비어 있을 때 전회 세 필드를 사용한다", () => {
  assert.deepEqual(
    resolveJournalManagerContact({
      isEditMode: false,
      currentValues: {
        manager_name: "",
        manager_mobile: null,
        manager_email: undefined,
      },
      fallbackValues: [{
        manager_name: "전회 담당자",
        manager_mobile: "010-1234-5678",
        manager_email: "previous@example.com",
      }],
    }),
    {
      manager_name: "전회 담당자",
      manager_mobile: "010-1234-5678",
      manager_email: "previous@example.com",
    },
  );
});

test("기존 측정일지는 빈 담당자 세 필드에 전회값을 자동삽입하지 않는다", () => {
  assert.deepEqual(
    resolveJournalManagerContact({
      isEditMode: true,
      currentValues: {
        manager_name: "",
        manager_mobile: null,
        manager_email: undefined,
      },
      fallbackValues: [{
        manager_name: "전회 담당자",
        manager_mobile: "010-1234-5678",
        manager_email: "previous@example.com",
      }],
    }),
    {
      manager_name: "",
      manager_mobile: "",
      manager_email: "",
    },
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

test("계산서 메일만 있어도 신규 담당자 메일로 복사하지 않는다", () => {
  const contact = resolveJournalManagerContact({
    isEditMode: false,
    currentValues: { invoice_email: "current-invoice@example.com" } as any,
    fallbackValues: [
      { invoice_email: "previous-invoice@example.com" } as any,
    ],
  });

  assert.equal(contact.manager_email, "");
});

test("신규·편집 폼의 현재값과 fallback은 담당자 세 필드 공통 정책을 사용한다", () => {
  assert.equal(
    (journalFormSource.match(/resolveJournalManagerContact\(\{/g) || []).length,
    3,
  );
  assert.doesNotMatch(
    journalFormSource,
    /updated\.manager_name\s*=\s*updated\.manager_name\s*\|\|\s*pName/,
  );
  assert.doesNotMatch(
    journalFormSource,
    /updated\.manager_mobile\s*=\s*updated\.manager_mobile\s*\|\|\s*data\.previousData\.manager_mobile/,
  );
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
