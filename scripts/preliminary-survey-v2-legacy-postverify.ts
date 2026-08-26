import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!apiUrl || !serviceKey) throw new Error("SUPABASE_ENV_REQUIRED");
if (new URL(apiUrl).hostname !== "xjxqbwvcgffunqnkmoqw.supabase.co") {
  throw new Error("PRODUCTION_PROJECT_MISMATCH");
}

const outputPath = resolve(
  process.argv.find((value) => value.startsWith("--output="))?.slice(9)
    ?? "C:/Users/USER/Downloads/2026-08-26_preliminary-survey-v2-legacy-production-postverify.json",
);
const supabase = createClient(apiUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let cancelled = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => { cancelled = true; });
}
const checkpoint = () => {
  if (cancelled) throw new Error("LEGACY_POSTVERIFY_CANCELLED");
};

const legacyExpected = {
  H0051: "이태환(A)", H0052: "한기문(B)", H0055: "김민영(GG)", H0057: "고유빈(F)",
  H0058: "김민영(G)", H0122: "고유빈(FF)", H0508: "강종구(C)", H0515: "이주형(D)",
} as const;
const v2Expected = {
  H0048: "이태환(A)", H0035: "고유빈(F)", H0034: "한기문(B)", H0016: "김민영(G)",
  H0102: "이태환(A)", H0527: "강종구(C)",
} as const;

async function main() {
  checkpoint();
  const [targetResult, planResult, assignmentResult, userResult, auditResult, legacyResult, v1Result] = await Promise.all([
    supabase.from("measurement_target_business").select("id,code,year,period,measurement_date,daily_staff"),
    supabase.from("preliminary_survey_v2_plans").select("id,measurement_target_business_id,status"),
    supabase.from("preliminary_survey_v2_measurement_assignments")
      .select("id,plan_id,measurement_date,assignee_user_id,survey_code,assignment_origin,legacy_survey_code_snapshot"),
    supabase.from("users").select("id,name,survey_code"),
    supabase.from("preliminary_survey_v2_legacy_reconciliation").select("*"),
    supabase.from("preliminary_survey").select("*").eq("year", 2026).gte("measurement_date", "2026-08-01"),
    supabase.from("preliminary_survey_plans").select("id,measurement_target_business_id,recommended_date"),
  ]);
  const error = targetResult.error || planResult.error || assignmentResult.error || userResult.error
    || auditResult.error || legacyResult.error || v1Result.error;
  if (error) throw error;
  checkpoint();

  const targets = targetResult.data ?? [];
  const plans = planResult.data ?? [];
  const assignments = assignmentResult.data ?? [];
  const users = userResult.data ?? [];
  const audits = auditResult.data ?? [];
  const legacyRows = legacyResult.data ?? [];
  const targetById = new Map(targets.map((row) => [String(row.id), row]));
  const userById = new Map(users.map((row) => [String(row.id), row]));
  const planById = new Map(plans.map((row) => [String(row.id), row]));

  const assignmentLabelsByCode = new Map<string, string[]>();
  for (const assignment of assignments) {
    const plan = planById.get(String(assignment.plan_id));
    const target = plan ? targetById.get(String(plan.measurement_target_business_id)) : undefined;
    if (!target) continue;
    const user = userById.get(String(assignment.assignee_user_id));
    const label = `${user?.name ?? "?"}(${assignment.survey_code})`;
    assignmentLabelsByCode.set(target.code, [...(assignmentLabelsByCode.get(target.code) ?? []), label]);
  }

  const reconciledLabelsByCode = new Map<string, string[]>();
  for (const row of audits) {
    const name = String(row.legacy_public_sample_measurer ?? "").trim();
    const code = String(row.legacy_survey_code_raw ?? "").trim();
    if (!name || !code) continue;
    reconciledLabelsByCode.set(row.code, [...(reconciledLabelsByCode.get(row.code) ?? []), `${name}(${code})`]);
  }

  const resolveExpected = (expected: Record<string, string>, source: Map<string, string[]>) => {
    const actual = Object.fromEntries(Object.keys(expected).map((code) => [code, source.get(code)?.[0] ?? "-"]));
    return { expected, actual, mismatch: Object.keys(expected).filter((code) => actual[code] !== expected[code]) };
  };
  const legacy8 = resolveExpected(legacyExpected, reconciledLabelsByCode);
  const v2Six = resolveExpected(v2Expected, assignmentLabelsByCode);

  const sourceBackedAudits = audits.filter((row) =>
    String(row.legacy_public_sample_measurer ?? "").trim()
      && String(row.legacy_survey_code_raw ?? "").trim(),
  );
  const sourceBackedDash = sourceBackedAudits.filter((row) => {
    const v2Labels = assignmentLabelsByCode.get(row.code) ?? [];
    const fallback = `${String(row.legacy_public_sample_measurer).trim()}(${String(row.legacy_survey_code_raw).trim()})`;
    return (v2Labels[0] ?? fallback) === "-";
  });

  const scopedV1NonNull = (v1Result.data ?? []).filter((row) => {
    const target = targetById.get(String(row.measurement_target_business_id));
    return target && String(target.measurement_date) >= "2026-08-01" && row.recommended_date != null;
  });
  const counts = Object.fromEntries([...new Set(audits.map((row) => row.classification))].sort()
    .map((classification) => [classification, audits.filter((row) => row.classification === classification).length]));
  const evidence = {
    generatedAt: new Date().toISOString(),
    productionProject: new URL(apiUrl).hostname,
    counts,
    totalAudit: audits.length,
    plans: plans.length,
    assignments: assignments.length,
    v2Assignments: assignments.filter((row) => row.assignment_origin === "v2").length,
    legacyAssignments: assignments.filter((row) => row.assignment_origin === "legacy_reconciled").length,
    sourceBacked: sourceBackedAudits.length,
    sourceBackedDash: sourceBackedDash.length,
    sourceBackedDashRows: sourceBackedDash.map((row) => ({ code: row.code, measurementDate: row.measurement_date })),
    v1NonNullAllPeriods: (v1Result.data ?? []).filter((row) => row.recommended_date != null).length,
    v1NonNullMeasurementDateFrom20260801: scopedV1NonNull.length,
    legacySourceRows: legacyRows.length,
    rawCodes: Object.fromEntries(["FF", "GG"].map((code) => [code,
      audits.filter((row) => row.legacy_survey_code_raw === code).length])),
    legacy8,
    v2Six,
  };
  checkpoint();
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  const sha256 = createHash("sha256").update(JSON.stringify(evidence, null, 2) + "\n").digest("hex").toUpperCase();
  console.log(JSON.stringify({ outputPath, sha256, ...evidence }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
