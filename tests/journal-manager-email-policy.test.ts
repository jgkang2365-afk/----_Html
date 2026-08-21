import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  normalizeJournalManagerEmailForSave,
  resolveJournalManagerContact,
  resolveJournalManagerEmailUpdate,
} from "../lib/journal/manager-email-policy";

const journalFormSource = readFileSync("components/features/JournalEditForm.tsx", "utf8");
const previousDataRouteSource = readFileSync("app/api/journal/previous-data/route.ts", "utf8");
const createJournalRouteSource = readFileSync("app/api/journal/route.ts", "utf8");
const updateJournalRouteSource = readFileSync("app/api/journal/[id]/route.ts", "utf8");

test("신규 측정일지는 최신 담당자값이 없으면 전회값이 있어도 입력칸을 비워 둔다", () => {
  const previousContact = {
    manager_name: "전회 담당자",
    manager_mobile: "010-1234-5678",
    manager_email: "previous@example.com",
  };

  assert.deepEqual(
    resolveJournalManagerContact({
      isEditMode: false,
      currentValues: {
        manager_name: "다른 소스 담당자",
        manager_mobile: "010-0000-0000",
        manager_email: "other-source@example.com",
      },
      latestValues: {
        manager_name: null,
        manager_mobile: null,
        manager_email: null,
      },
    }),
    {
      manager_name: "",
      manager_mobile: "",
      manager_email: "",
    },
  );
  assert.equal(previousContact.manager_email, "previous@example.com");
});

test("신규 측정일지는 현재 입력이 비어 있으면 measurement_business 최신 담당자값을 사용한다", () => {
  assert.deepEqual(
    resolveJournalManagerContact({
      isEditMode: false,
      currentValues: {
        manager_name: "",
        manager_mobile: null,
        manager_email: undefined,
      },
      latestValues: {
        manager_name: "최신 담당자",
        manager_mobile: "010-9999-9999",
        manager_email: "latest@example.com",
      },
    }),
    {
      manager_name: "최신 담당자",
      manager_mobile: "010-9999-9999",
      manager_email: "latest@example.com",
    },
  );
});

test("기존 측정일지는 최신 measurement_business 값이 있어도 빈 담당자 입력을 보완하지 않는다", () => {
  assert.deepEqual(
    resolveJournalManagerContact({
      isEditMode: true,
      currentValues: {
        manager_name: "",
        manager_mobile: null,
        manager_email: undefined,
      },
      latestValues: {
        manager_name: "최신 담당자",
        manager_mobile: "010-9999-9999",
        manager_email: "latest@example.com",
      },
    }),
    {
      manager_name: "",
      manager_mobile: "",
      manager_email: "",
    },
  );
});

test("계산서 메일만 있어도 신규 담당자 메일로 복사하지 않는다", () => {
  const contact = resolveJournalManagerContact({
    isEditMode: false,
    currentValues: { invoice_email: "current-invoice@example.com" } as any,
    latestValues: { invoice_email: "latest-invoice@example.com" } as any,
  });

  assert.equal(contact.manager_email, "");
});

test("신규·수정 저장 API는 계산서 메일을 담당자 메일 fallback으로 사용하지 않는다", () => {
  assert.match(
    createJournalRouteSource,
    /manager_email:\s*body\.manager_email\s*\|\|\s*businessData\.manager_email\s*\|\|\s*null/,
  );
  assert.match(
    updateJournalRouteSource,
    /manager_email:\s*resolveJournalManagerEmailUpdate\(bodyClean, existingJournal\.manager_email\)/,
  );
  assert.doesNotMatch(createJournalRouteSource, /manager_email:\s*[^\r\n]*invoice_email/);
  assert.doesNotMatch(updateJournalRouteSource, /manager_email:\s*[^\r\n]*invoice_email/);
});

test("폼은 현재 measurement_business 담당자값만 입력에 반영하고 전회·요약값을 자동삽입하지 않는다", () => {
  assert.equal(
    (journalFormSource.match(/resolveJournalManagerContact\(\{/g) || []).length,
    1,
  );
  assert.match(journalFormSource, /latestValues:\s*data\.currentManagerContact\s*\|\|\s*\{\}/);
  assert.doesNotMatch(journalFormSource, /fallbackValues:/);
});

test("전회 담당자명·휴대폰·이메일은 각 입력칸 하단 참고값으로만 표시한다", () => {
  assert.match(journalFormSource, /manager_name:\s*pName\s*\|\|\s*null/);
  assert.match(journalFormSource, /manager_mobile:\s*data\.previousData\.manager_mobile\s*\|\|\s*null/);
  assert.match(journalFormSource, /manager_email:\s*data\.previousData\.manager_email\s*\|\|\s*null/);
  assert.match(journalFormSource, /전회:\s*\{previousContactInfo\.manager_name\}/);
  assert.match(journalFormSource, /전회:\s*\{previousContactInfo\.manager_mobile\}/);
  assert.match(journalFormSource, /전회:\s*\{previousContactInfo\.manager_email\}/);
});

test("담당자 입력 원천은 현재 연도·주기의 measurement_business 직접 조회값이다", () => {
  assert.match(
    previousDataRouteSource,
    /\.from\("measurement_business"\)[\s\S]*?\.select\("manager_name, manager_mobile, manager_email"\)[\s\S]*?\.eq\("year", measurementYear\)[\s\S]*?\.eq\("period", period\)/,
  );
  assert.match(previousDataRouteSource, /currentManagerContact,/);
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
