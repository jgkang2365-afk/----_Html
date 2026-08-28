import { Client } from "pg";

const databaseUrl =
  process.env.LOCAL_SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:55322/postgres";

const localPostgresUrl = new URL(databaseUrl);
if (
  !["postgres:", "postgresql:"].includes(localPostgresUrl.protocol) ||
  !["localhost", "127.0.0.1"].includes(localPostgresUrl.hostname.toLowerCase())
) {
  throw new Error("LOCAL_PRIVILEGE_VERIFY_REMOTE_POSTGRES_BLOCKED");
}

const expectedTablePrivileges = [
  ["preliminary_survey_v2_plans", true, false, false, false],
  ["preliminary_survey_v2_measurement_assignments", true, false, false, false],
  ["preliminary_survey_v2_history_recovery_batches", true, false, false, false],
  ["preliminary_survey_v2_history_recovery_audit", true, false, false, false],
  ["preliminary_survey_v2_document_repair_audit", true, true, false, false],
] as const;

const forbiddenFunctions = [
  "public.is_preliminary_survey_v2_true_confirmed(bigint)",
  "public.guard_true_confirmed_preliminary_survey_v2_plan()",
  "public.guard_true_confirmed_preliminary_survey_v2_measurement_assignment()",
  "public.validate_preliminary_survey_v2_measurement_assignment()",
  "public.admin_repair_preliminary_survey_connection_unlocked(bigint,jsonb,jsonb,integer,text,text)",
  "public.persist_preliminary_survey_v2_plan_unlocked(bigint,date,integer,integer,jsonb,jsonb,text,text,text,integer,text,text,jsonb,jsonb,jsonb)",
  "public.persist_preliminary_survey_v2_plan_batch_unlocked(jsonb)",
  "public.persist_preliminary_survey_v2_plan_and_measurement_assignments(jsonb,jsonb,jsonb,boolean,integer)",
] as const;

async function main() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (const [table, select, insert, update, remove] of expectedTablePrivileges) {
      const { rows } = await client.query<{
        select: boolean;
        insert: boolean;
        update: boolean;
        delete: boolean;
      }>(
        `select
           has_table_privilege('service_role', $1, 'SELECT') as select,
           has_table_privilege('service_role', $1, 'INSERT') as insert,
           has_table_privilege('service_role', $1, 'UPDATE') as update,
           has_table_privilege('service_role', $1, 'DELETE') as delete`,
        [`public.${table}`]
      );
      const actual = rows[0];
      if (
        actual.select !== select ||
        actual.insert !== insert ||
        actual.update !== update ||
        actual.delete !== remove
      ) {
        throw new Error(`SERVICE_ROLE_TABLE_PRIVILEGE_MISMATCH:${table}`);
      }
    }

    for (const signature of forbiddenFunctions) {
      const { rows } = await client.query<{ allowed: boolean }>(
        "select has_function_privilege('service_role', $1, 'EXECUTE') as allowed",
        [signature]
      );
      if (rows[0].allowed) {
        throw new Error(`SERVICE_ROLE_INTERNAL_FUNCTION_EXPOSED:${signature}`);
      }
    }

    console.log(JSON.stringify({
      database: "local",
      protectedTables: expectedTablePrivileges.length,
      internalFunctionsBlocked: forbiddenFunctions.length,
      result: "PASS",
    }));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "LOCAL_PRIVILEGE_VERIFY_FAILED");
  process.exitCode = 1;
});
