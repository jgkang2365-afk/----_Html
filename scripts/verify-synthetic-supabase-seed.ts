import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  assertSupabaseEnvironment,
  SUPABASE_PROJECT_REFS,
} from "../lib/supabase/environment-guard";

const appEnvironment = process.env.NEXT_PUBLIC_APP_ENV;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) throw new Error("SYNTHETIC_SEED_VERIFY_ENV_MISSING");
if (appEnvironment !== "local" && appEnvironment !== "staging") {
  throw new Error("SYNTHETIC_SEED_VERIFY_REQUIRES_LOCAL_OR_STAGING");
}
assertSupabaseEnvironment({
  appEnvironment,
  databaseUrl: url,
  productionProjectRef: SUPABASE_PROJECT_REFS.production,
  stagingProjectRef: SUPABASE_PROJECT_REFS.staging,
});

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sources = [
  ["users", "id, name, role, job, is_active, is_preliminary_survey_manager, is_preliminary_survey_experienced"],
  ["business_info", "code, business_name, business_type"],
  ["measurement_target_business", "id, code, business_type, measurement_date, measurer_id"],
  ["preliminary_survey_v2_plans", "id, measurement_target_business_id, recommended_date, responsible_user_id, participant_user_ids, status, plan_origin"],
  ["preliminary_survey_v2_measurement_assignments", "id, plan_id, measurement_date, assignee_user_id, approval_required, approval_group_fingerprint, approved_by_user_id"],
  ["measurement_journal", "code, measurement_year, measurement_period"],
  ["preliminary_survey_v2_legacy_reconciliation", "id, measurement_target_business_id, applied_plan_id"],
] as const;

async function main() {
  const snapshot: Record<string, unknown[]> = {};
  for (const [table, columns] of sources) {
    let query = supabase.from(table).select(columns);
    if (table === "users") query = query.gte("id", 9001).lte("id", 9106);
    else if (table === "business_info") query = query.like("code", "SYN%");
    else if (table === "measurement_journal") query = query.like("code", "SYN%");
    else if (table === "measurement_target_business") query = query.gte("id", 10001).lte("id", 10025);
    else if (table === "preliminary_survey_v2_plans") query = query.gte("measurement_target_business_id", 10001).lte("measurement_target_business_id", 10025);

    const { data, error } = await query.order(table === "users" || table === "measurement_target_business" ? "id" : columns.split(",", 1)[0].trim());
    if (error) throw error;
    snapshot[table] = data ?? [];
  }

  const counts = Object.fromEntries(Object.entries(snapshot).map(([table, rows]) => [table, rows.length]));
  const expectedCounts = {
    users: 8,
    business_info: 25,
    measurement_target_business: 25,
    preliminary_survey_v2_plans: 15,
    preliminary_survey_v2_measurement_assignments: 11,
    measurement_journal: 3,
    preliminary_survey_v2_legacy_reconciliation: 1,
  };
  if (JSON.stringify(counts) !== JSON.stringify(expectedCounts)) {
    throw new Error(`SYNTHETIC_SEED_COUNT_MISMATCH:${JSON.stringify(counts)}`);
  }

  const digest = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  console.log(JSON.stringify({ appEnvironment, counts, digest }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "SYNTHETIC_SEED_VERIFY_FAILED");
  process.exitCode = 1;
});
