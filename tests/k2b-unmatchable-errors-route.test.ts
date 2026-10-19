import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const requireLocal = createRequire(import.meta.url);
const source = readFileSync("app/api/report-processing/k2b-unmatchable-errors/route.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

test("K2B 오류 GET은 권한과 PASSED를 100건 제한 전에 걸러 원본을 조회만 한다", async () => {
  const passedRows = Array.from({ length: 101 }, (_, index) => ({
    id: `passed-${index}`, review_state: "PASSED", submitter_user_id: 7,
    last_seen_at: `2026-10-19T${String(index % 24).padStart(2, "0")}:00:00Z`,
  }));
  const activeRows = [
    { id: "waiting-own", review_state: "WAITING", submitter_user_id: 7, last_seen_at: "2026-10-01T00:00:00Z" },
    { id: "review-own", review_state: "REVIEW_REQUIRED", submitter_user_id: 7, last_seen_at: "2026-10-02T00:00:00Z" },
    { id: "waiting-other", review_state: "WAITING", submitter_user_id: 8, last_seen_at: "2026-10-03T00:00:00Z" },
  ];

  for (const role of ["관리자", "사용자"]) {
    const calls: string[] = [];
    const actor = { id: 7, name: "검수자", role };
    const from = (table: string) => {
      let rows: Record<string, unknown>[] = table === "k2b_unmatchable_errors"
        ? [...passedRows, ...activeRows] : table === "users" ? [actor] : [];
      const query = {
        select() { calls.push(`${table}.select`); return this; },
        eq(column: string, value: unknown) { calls.push(`${table}.eq:${column}`); rows = rows.filter((row) => row[column] === value); return this; },
        neq(column: string, value: unknown) { calls.push(`${table}.neq:${column}`); rows = rows.filter((row) => row[column] !== value); return this; },
        in(column: string, values: unknown[]) { calls.push(`${table}.in:${column}`); rows = rows.filter((row) => values.includes(row[column])); return this; },
        order(column: string, options: { ascending: boolean }) {
          calls.push(`${table}.order:${column}`);
          rows.sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (options.ascending ? 1 : -1));
          return this;
        },
        limit(count: number) { calls.push(`${table}.limit`); rows = rows.slice(0, count); return this; },
        async maybeSingle() { return { data: rows[0] ?? null, error: null }; },
        then(resolve: (value: { data: Record<string, unknown>[]; error: null }) => unknown) {
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return query;
    };
    const exports: { GET?: () => Promise<{ body: { errors: { id: string }[] }; status: number }> } = {};
    runInNewContext(compiled, {
      exports,
      require: (id: string) => {
        if (id === "next/server") return { NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) } };
        if (id === "@/lib/auth/session") return { getSession: async () => ({ userId: 7 }) };
        if (id === "@/lib/auth/check-permission") return { checkPermission: async (permission: string) => assert.equal(permission, "journal:read") };
        if (id === "@/lib/supabase/admin") return { createAdminClient: () => ({ from }) };
        return requireLocal(id);
      },
    });

    const response = await exports.GET!();
    assert.equal(response.status, 200);
    assert.deepEqual(Array.from(response.body.errors, (row) => row.id), role === "관리자"
      ? ["waiting-other", "review-own", "waiting-own"] : ["review-own", "waiting-own"]);
    const filter = calls.indexOf("k2b_unmatchable_errors.neq:review_state");
    const limit = calls.indexOf("k2b_unmatchable_errors.limit");
    assert.ok(filter >= 0 && filter < limit);
    if (role !== "관리자") assert.ok(calls.indexOf("k2b_unmatchable_errors.eq:submitter_user_id") < limit);
    assert.ok(calls.every((call) => /\.(select|eq|neq|in|order|limit):?/.test(call)));
  }
});
