import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import {
  MES_MANAGER_CONTACT_FIELDS,
  normalizeMesManagerContactFields,
} from "../lib/sync/mes-manager-contact-policy";

test("MES 담당자 세 필드는 최신값이 있으면 그대로 사용한다", () => {
  assert.deepEqual(
    normalizeMesManagerContactFields({
      manager_name: "김담당",
      manager_mobile: "010-1234-5678",
      manager_email: "manager@example.com",
    }),
    {
      manager_name: "김담당",
      manager_mobile: "010-1234-5678",
      manager_email: "manager@example.com",
    },
  );
});

test("MES 담당자 세 필드는 빈값을 모두 명시적 null로 만든다", () => {
  const normalized = normalizeMesManagerContactFields({
    manager_name: "   ",
    manager_mobile: undefined,
    manager_email: null,
  });

  assert.deepEqual(normalized, {
    manager_name: null,
    manager_mobile: null,
    manager_email: null,
  });
  for (const field of MES_MANAGER_CONTACT_FIELDS) {
    assert.equal(Object.hasOwn(normalized, field), true);
  }
});

test("mixed bulk upsert에서도 모든 행이 담당자 세 필드를 명시적으로 전송한다", async () => {
  let requestUrl = "";
  let requestBody = "";
  const supabase = createClient("http://127.0.0.1:54321", "test-anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        requestUrl = String(input);
        requestBody = String(init?.body ?? "");
        return new Response("[]", {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  });
  const rows = [
    {
      code: "H0001",
      year: 2026,
      period: "상반기",
      ...normalizeMesManagerContactFields({}),
    },
    {
      code: "H0002",
      year: 2026,
      period: "상반기",
      ...normalizeMesManagerContactFields({
        manager_name: "최신담당",
        manager_mobile: "010-9999-9999",
        manager_email: "latest@example.com",
      }),
    },
  ];

  const { error } = await supabase.from("measurement_business").upsert(rows, {
    onConflict: "code,year,period",
    ignoreDuplicates: false,
  });

  assert.equal(error, null);
  const sentRows = JSON.parse(requestBody);
  assert.deepEqual(sentRows[0], rows[0]);
  assert.deepEqual(sentRows[1], rows[1]);
  for (const row of sentRows) {
    for (const field of MES_MANAGER_CONTACT_FIELDS) {
      assert.equal(Object.hasOwn(row, field), true);
    }
  }
  const columns = new URL(requestUrl).searchParams.get("columns") ?? "";
  for (const field of MES_MANAGER_CONTACT_FIELDS) {
    assert.match(columns, new RegExp(`"${field}"`));
  }
});

test("MES 동기화 범위와 bulk 크기 및 측정대상 담당자 보호 정책은 유지한다", () => {
  const excelSyncSource = readFileSync("lib/sync/excel-sync.ts", "utf8");
  const mesDownloadSource = readFileSync("mes_download.py", "utf8");

  assert.match(
    excelSyncSource,
    /Object\.assign\(fullRow, normalizeMesManagerContactFields\(row\)\)/,
  );
  assert.match(excelSyncSource, /const upsertBatchSize = 100/);
  assert.match(excelSyncSource, /hasUserValue\(existing\.manager_name\)/);
  assert.match(excelSyncSource, /hasUserValue\(existing\.manager_mobile\)/);
  assert.match(excelSyncSource, /hasUserValue\(existing\.manager_email\)/);
  assert.match(excelSyncSource, /\.upsert\(protectedBatch/);
  assert.match(mesDownloadSource, /timedelta\(days=90\)/);
});
