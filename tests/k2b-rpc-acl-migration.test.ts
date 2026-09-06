import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "supabase/migrations/20260906075441_harden_k2b_security_definer_acl_v051.sql";
const verificationPath = "supabase/verification/20260906_verify_k2b_rpc_acl.sql";

const migration = readFileSync(migrationPath, "utf8");
const verification = readFileSync(verificationPath, "utf8");

const migrationSignatures = [
  "enqueue_k2b_automation_job(TEXT, JSONB)",
  "enqueue_k2b_verify_job(DATE, BIGINT)",
  "enqueue_k2b_upload_job(JSONB)",
];

const catalogSignatures = [
  "public.enqueue_k2b_automation_job(text,jsonb)",
  "public.enqueue_k2b_verify_job(date,bigint)",
  "public.enqueue_k2b_upload_job(jsonb)",
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("forward ACL migration은 세 K2B RPC를 service_role 전용으로 고정한다", () => {
  for (const signature of migrationSignatures) {
    const escapedSignature = escapeRegExp(signature);
    assert.match(
      migration,
      new RegExp(
        `REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${escapedSignature}\\s+FROM\\s+PUBLIC,\\s*anon,\\s*authenticated\\s*;`,
        "i"
      ),
      `${signature}: PUBLIC/anon/authenticated REVOKE 누락`
    );
    assert.match(
      migration,
      new RegExp(
        `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${escapedSignature}\\s+TO\\s+service_role\\s*;`,
        "i"
      ),
      `${signature}: service_role GRANT 누락`
    );
  }

  assert.equal((migration.match(/REVOKE\s+ALL\s+ON\s+FUNCTION/gi) ?? []).length, 3);
  assert.equal((migration.match(/GRANT\s+EXECUTE\s+ON\s+FUNCTION/gi) ?? []).length, 3);
  assert.doesNotMatch(migration, /GRANT\s+EXECUTE[\s\S]*?TO\s+(?:PUBLIC|anon|authenticated)\b/i);
});

test("verification SQL은 누락 signature도 포함해 정확히 세 RPC를 조회한다", () => {
  for (const signature of catalogSignatures) {
    assert.equal(
      verification.split(`'${signature}'`).length - 1,
      1,
      `${signature}: expected 목록에 정확히 한 번 있어야 함`
    );
  }

  assert.match(verification, /LEFT\s+JOIN\s+pg_catalog\.pg_proc/i);
  assert.match(verification, /pg_catalog\.to_regprocedure\(expected\.signature\)/i);
  assert.match(verification, /LEFT\s+JOIN\s+pg_catalog\.pg_namespace/i);
  assert.match(verification, /function_oid\s+IS\s+NOT\s+NULL\s+AS\s+function_exists/i);
  assert.match(verification, /ORDER\s+BY\s+signature\s*;/i);
});

test("verification SQL은 catalog 기반 ACL과 SECURITY DEFINER 속성을 함께 판정한다", () => {
  assert.match(verification, /pg_catalog\.aclexplode\s*\(/i);
  assert.match(verification, /pg_catalog\.acldefault\s*\(\s*'f'/i);
  assert.match(verification, /acl\.grantee\s*=\s*0/i);
  assert.match(verification, /acl\.privilege_type\s*=\s*'EXECUTE'/i);

  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.match(
      verification,
      new RegExp(
        `has_function_privilege\\s*\\(\\s*pg_catalog\\.to_regrole\\('${role}'\\),\\s*procedure\\.oid,\\s*'EXECUTE'`,
        "i"
      ),
      `${role}: 유효 EXECUTE 권한 조회 누락`
    );
  }

  assert.match(
    verification,
    /pg_catalog\.pg_get_userbyid\(procedure\.proowner\)\s+AS\s+owner_name/i
  );
  assert.match(verification, /procedure\.prosecdef/i);
  assert.match(verification, /procedure\.proconfig/i);
  assert.match(verification, /search_path\s*=\s*expected_search_path/i);
  assert.match(verification, /NOT\s+public_execute/i);
  assert.match(verification, /NOT\s+anon_execute/i);
  assert.match(verification, /NOT\s+authenticated_execute/i);
  assert.match(verification, /service_role_execute/i);
  assert.match(verification, /AS\s+verification_passed/i);
});
