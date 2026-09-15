import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const refreshPath = new URL("../scripts/refresh-local-from-production.mjs", import.meta.url);
const configurePath = new URL("../scripts/configure-local-supabase-env.mjs", import.meta.url);

describe("Local Production snapshot safety", () => {
  it("Production source is fixed and export path is SELECT-only", async () => {
    const source = await readFile(refreshPath, "utf8");
    assert.match(source, /xjxqbwvcgffunqnkmoqw/);
    assert.match(source, /\.from\(table\)\.select\("\*"\)/);
    assert.doesNotMatch(source, /client\.from\([^\n]+\)\.(?:insert|update|upsert|delete)\(/);
    assert.doesNotMatch(source, /client\.rpc\(/);
  });

  it("local import refuses remote PostgreSQL targets", async () => {
    const source = await readFile(refreshPath, "utf8");
    assert.match(source, /LOCAL_SNAPSHOT_REMOTE_DB_BLOCKED/);
    assert.match(source, /127\.0\.0\.1/);
    assert.match(source, /localhost/);
  });

  it("credentials are sanitized and effectful queue tables are not copied", async () => {
    const source = await readFile(refreshPath, "utf8");
    assert.match(source, /SECRET_COLUMN/);
    for (const table of ["automation_jobs", "background_jobs", "mes_sync_queue", "k2b_sync_state"]) {
      assert.doesNotMatch(source, new RegExp(`\\"${table}\\"`));
    }
  });

  it("local env configuration switches both browser and server URLs together", async () => {
    const source = await readFile(configurePath, "utf8");
    assert.match(source, /NEXT_PUBLIC_APP_ENV:\s*"local"/);
    assert.match(source, /NEXT_PUBLIC_SUPABASE_URL:\s*values\.API_URL/);
    assert.match(source, /SUPABASE_URL:\s*values\.API_URL/);
    assert.match(source, /LOCAL_SUPABASE_DB_URL:\s*values\.DB_URL/);
  });
});
