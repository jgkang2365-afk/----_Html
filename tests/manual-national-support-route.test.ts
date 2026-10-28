import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { handleManualNationalSupportStatus } from "../lib/national-support/manual-status-handler";

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/businesses/national-support/manual-status", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

function fixture(role: "관리자" | "사용자" | null, period = "상반기") {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const query = {
    eq() { return query; },
    async maybeSingle() { return { data: { id: 10, period }, error: null }; },
  };
  const database = {
    from(table: string) {
      assert.equal(table, "measurement_target_business");
      return { select() { return query; } };
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return { data: { id: 10, national_support_status: args.p_status }, error: null };
    },
  };
  const dependencies = {
    getUser: async () => role ? { id: "1", role } : null,
    createAdminClient: () => database,
  } as unknown as Parameters<typeof handleManualNationalSupportStatus>[1];
  return { calls, dependencies };
}

for (const role of ["사용자", "관리자"] as const) {
  test(`${role}는 기존 사업장 국고지원 상태를 수동 저장한다`, async () => {
    const { calls, dependencies } = fixture(role);
    const status = role === "사용자" ? "대상" : "비대상";
    const response = await handleManualNationalSupportStatus(
      request({ id: 10, national_support_status: status }), dependencies,
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).success, true);
    assert.deepEqual(calls, [{ name: "set_manual_national_support_status", args: { p_target_id: 10, p_status: status } }]);
  });
}

test("미로그인 사용자는 401이며 RPC를 호출하지 않는다", async () => {
  const { calls, dependencies } = fixture(null);
  const response = await handleManualNationalSupportStatus(
    request({ id: 10, national_support_status: "대상" }), dependencies,
  );
  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

test("허용되지 않은 상태값은 400이며 RPC를 호출하지 않는다", async () => {
  const { calls, dependencies } = fixture("사용자");
  const response = await handleManualNationalSupportStatus(
    request({ id: 10, national_support_status: "지원" }), dependencies,
  );
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test("수시 주기 대상 확정은 400이며 RPC를 호출하지 않는다", async () => {
  const { calls, dependencies } = fixture("사용자", "상반기(수시)");
  const response = await handleManualNationalSupportStatus(
    request({ id: 10, national_support_status: "대상" }), dependencies,
  );
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});
