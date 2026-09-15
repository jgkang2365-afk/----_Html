import path from "node:path";
import process from "node:process";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { Client as PostgresClient } from "pg";

const root = process.cwd();
dotenv.config({ path: path.join(root, ".env.production-readonly.local") });
dotenv.config({ path: path.join(root, ".env.local"), override: false });

const PRODUCTION_REF = "xjxqbwvcgffunqnkmoqw";
const PAGE_SIZE = 1000;
const INSERT_BATCH_SIZE = 100;

const TABLES = [
  "users",
  "business_category",
  "business_info",
  "measurement_business",
  "measurement_target_business",
  "measurement_journal",
  "measurement_summary",
  "preliminary_survey",
  "preliminary_survey_exception_log",
  "preliminary_survey_policy_settings",
  "preliminary_survey_v2_fixed_assignments",
  "preliminary_survey_v2_legacy_reconciliation",
  "preliminary_survey_v2_measurement_assignments",
  "preliminary_survey_v2_plans",
  "user_schedule_blocks",
  "labor_offices",
  "labor_office_aliases",
  "national_support_application",
  "other_revenue",
  "quota_memos",
  "k2b_file_receipts",
  "data_verification_exclusions",
  "data_verification_issues",
  "journal_number_change_request",
  "document_definitions",
  "document_templates",
  "document_field_mappings",
  "custom_report_templates",
];

const SECRET_COLUMN = /(^|_)(password|password_hash|token|secret|api_key|service_role_key)($|_)/i;

function assertProductionSource(urlValue) {
  if (!urlValue) throw new Error("PRODUCTION_SNAPSHOT_URL_MISSING");
  const url = new URL(urlValue);
  if (url.protocol !== "https:" || url.hostname !== `${PRODUCTION_REF}.supabase.co`) {
    throw new Error("PRODUCTION_SNAPSHOT_SOURCE_MISMATCH");
  }
}
function localDatabaseUrl() {
  const value = process.env.LOCAL_SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("LOCAL_SNAPSHOT_DB_PROTOCOL_INVALID");
  }
  if (!["127.0.0.1", "localhost"].includes(url.hostname.toLowerCase())) {
    throw new Error("LOCAL_SNAPSHOT_REMOTE_DB_BLOCKED");
  }
  return value;
}

function sanitizeRow(row) {
  const sanitized = { ...row };
  for (const key of Object.keys(sanitized)) {
    if (SECRET_COLUMN.test(key)) sanitized[key] = null;
  }
  return sanitized;
}

async function fetchAll(client, table) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client.from(table).select("*").range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`PRODUCTION_READ_FAILED:${table}:${error.message}`);
    const page = (data ?? []).map(sanitizeRow);
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}
async function assertLocalDatabaseReady(connectionString) {
  const postgres = new PostgresClient({ connectionString });
  try {
    await postgres.connect();
    const result = await postgres.query("select current_database() as db, inet_server_addr() as host");
    if (!result.rows[0]?.db) throw new Error("LOCAL_SNAPSHOT_DB_PROBE_FAILED");
  } finally {
    await postgres.end().catch(() => undefined);
  }
}

async function exportProduction() {
  const url = process.env.PROD_SNAPSHOT_SUPABASE_URL;
  const key = process.env.PROD_SNAPSHOT_SERVICE_ROLE_KEY;
  assertProductionSource(url);
  if (!key) throw new Error("PRODUCTION_SNAPSHOT_SERVICE_ROLE_KEY_MISSING");

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const snapshot = new Map();
  for (const table of TABLES) {
    const rows = await fetchAll(client, table);
    snapshot.set(table, rows);
    console.log(`READ_ONLY ${table}: ${rows.length}`);
  }
  return snapshot;
}

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
function toPgValue(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value) || (typeof value === "object" && !(value instanceof Date))) {
    return JSON.stringify(value);
  }
  return value;
}

async function insertRows(postgres, table, rows) {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  for (let offset = 0; offset < rows.length; offset += INSERT_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + INSERT_BATCH_SIZE);
    const values = [];
    const tuples = batch.map((row) => {
      const placeholders = columns.map((column) => {
        values.push(toPgValue(row[column]));
        return `$${values.length}`;
      });
      return `(${placeholders.join(",")})`;
    });
    const sql = `insert into public.${quoteIdent(table)} (${columns.map(quoteIdent).join(",")}) values ${tuples.join(",")}`;
    await postgres.query(sql, values);
  }
}

async function resetIdSequence(postgres, table) {
  const sequence = await postgres.query(
    "select pg_get_serial_sequence($1, 'id') as sequence",
    [`public.${table}`]
  );
  const name = sequence.rows[0]?.sequence;
  if (!name) return;
  const maxResult = await postgres.query(`select max(id)::bigint as max_id from public.${quoteIdent(table)}`);
  const maxId = Number(maxResult.rows[0]?.max_id ?? 0);
  await postgres.query("select setval($1::regclass, greatest($2::bigint, 1), $2::bigint > 0)", [name, maxId]);
}
async function provisionLocalLogin(postgres) {
  const name = process.env.TEST_USER_NAME?.trim();
  const password = process.env.TEST_USER_PASSWORD;
  if (!name || !password) {
    console.log("LOCAL_LOGIN skipped: TEST_USER_NAME/TEST_USER_PASSWORD missing");
    return;
  }
  const user = await postgres.query("select id from public.users where name = $1 order by id limit 1", [name]);
  if (user.rowCount !== 1) {
    throw new Error("LOCAL_LOGIN_USER_NOT_FOUND");
  }
  const hash = await bcrypt.hash(password, 12);
  await postgres.query("update public.users set password_hash = $1 where id = $2", [hash, user.rows[0].id]);
  console.log("LOCAL_LOGIN provisioned for configured test user");
}

async function importLocal(connectionString, snapshot) {
  const postgres = new PostgresClient({ connectionString });
  await postgres.connect();
  try {
    await postgres.query("begin");
    await postgres.query("set local session_replication_role = replica");
    const tablesSql = TABLES.map((table) => `public.${quoteIdent(table)}`).join(", ");
    await postgres.query(`truncate table ${tablesSql} restart identity cascade`);
    for (const table of TABLES) await insertRows(postgres, table, snapshot.get(table) ?? []);
    await provisionLocalLogin(postgres);
    for (const table of TABLES) await resetIdSequence(postgres, table);
    await postgres.query("commit");
  } catch (error) {
    await postgres.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await postgres.end();
  }
}
async function verifyLocalCounts(connectionString, snapshot) {
  const postgres = new PostgresClient({ connectionString });
  await postgres.connect();
  try {
    for (const table of TABLES) {
      const result = await postgres.query(`select count(*)::int as count from public.${quoteIdent(table)}`);
      const localCount = Number(result.rows[0]?.count ?? 0);
      const expected = (snapshot.get(table) ?? []).length;
      if (localCount !== expected) throw new Error(`LOCAL_COUNT_MISMATCH:${table}:${localCount}:${expected}`);
    }
  } finally {
    await postgres.end();
  }
}

async function main() {
  const connectionString = localDatabaseUrl();
  await assertLocalDatabaseReady(connectionString);
  const snapshot = await exportProduction();
  const total = [...snapshot.values()].reduce((sum, rows) => sum + rows.length, 0);
  console.log(`Production READ_ONLY snapshot rows: ${total}`);
  await importLocal(connectionString, snapshot);
  await verifyLocalCounts(connectionString, snapshot);
  console.log("Local Supabase refresh from Production READ_ONLY snapshot: PASS");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "LOCAL_PRODUCTION_REFRESH_FAILED");
  process.exitCode = 1;
});
