import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { resolveMeasurementPublicSampleDisplay } from "../lib/preliminary-survey-v2/public-sample-display";

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
    supabase.from("users").select("id,name,survey_code").eq("job", "측정"),
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

  const assignmentByTargetDate = new Map<string, typeof assignments[number]>();
  for (const assignment of assignments) {
    const plan = planById.get(String(assignment.plan_id));
    const target = plan ? targetById.get(String(plan.measurement_target_business_id)) : undefined;
    if (!target) continue;
    assignmentByTargetDate.set(`${target.id}|${assignment.measurement_date}`, assignment);
  }

  const auditByTargetDate = new Map<string, typeof audits[number]>();
  for (const row of audits) {
    auditByTargetDate.set(`${row.measurement_target_business_id}|${row.measurement_date}`, row);
  }

  const displayFor = (targetId: unknown, measurementDate: string) => {
    const key = `${targetId}|${measurementDate}`;
    const assignment = assignmentByTargetDate.get(key);
    const reconciliation = auditByTargetDate.get(key);
    return resolveMeasurementPublicSampleDisplay({
      v2Assignment: assignment ? {
        assigneeUserId: Number(assignment.assignee_user_id),
        surveyCode: assignment.survey_code,
      } : null,
      v2AssignmentId: assignment?.id ?? null,
      reconciliation: reconciliation ? {
        measurer: reconciliation.legacy_public_sample_measurer,
        surveyCode: reconciliation.legacy_survey_code_raw,
        appliedAssignmentId: reconciliation.applied_assignment_id,
      } : null,
      trueConfirmed: false,
      legacyAssignment: null,
      userNameById: new Map(users.map((row) => [Number(row.id), row.name])),
    });
  };
  const resolveExpected = (expected: Record<string, string>, dates: Record<string, string>) => {
    const actual = Object.fromEntries(Object.keys(expected).map((code) => {
      const plan = plans.find((row) => targetById.get(String(row.measurement_target_business_id))?.code === code);
      return [code, plan ? displayFor(plan.measurement_target_business_id, dates[code]).label : "-"];
    }));
    return { expected, actual, mismatch: Object.keys(expected).filter((code) => actual[code] !== expected[code]) };
  };
  const legacy8 = resolveExpected(legacyExpected, Object.fromEntries(Object.keys(legacyExpected).map((code) => [code, "2026-08-03"])));
  const v2Six = resolveExpected(v2Expected, {
    H0048: "2026-08-28", H0035: "2026-08-28", H0034: "2026-08-28", H0016: "2026-08-28",
    H0102: "2026-09-14", H0527: "2026-08-28",
  });

  const sourceBackedAudits = audits.filter((row) =>
    String(row.legacy_public_sample_measurer ?? "").trim()
      && String(row.legacy_survey_code_raw ?? "").trim(),
  );
  const sourceBackedDash = sourceBackedAudits.filter((row) => {
    return displayFor(row.measurement_target_business_id, row.measurement_date).label === "-";
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
