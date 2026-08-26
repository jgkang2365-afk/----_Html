import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  addCalendarDays,
  isWorkingDay,
  recommendationDatesForBusinessType,
  workingDayDistance,
  type PhaseBBusinessType,
} from "../lib/preliminary-survey-v2/calendar";
import { calculateV2Recommendations } from "../lib/preliminary-survey-v2/service";

const argument = (name: string) => process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
const envPath = resolve(argument("--env-file") ?? ".env.local");
const inventoryPath = resolve(argument("--inventory") ?? "C:/Users/USER/Downloads/2026-08-26_preliminary-survey-schedule-audit-inventory.json");
const outputPath = resolve(argument("--output") ?? "C:/Users/USER/Downloads/2026-08-26_preliminary-survey-schedule-audit.json");
const CURRENT_POLICY_EFFECTIVE_DATE = "2026-08-23";
config({ path: envPath, quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_ENV_MISSING");
if (new URL(url).hostname !== "xjxqbwvcgffunqnkmoqw.supabase.co") throw new Error("PRODUCTION_READ_ONLY_PROJECT_REQUIRED");

let cancelled = false;
process.on("SIGINT", () => { cancelled = true; });
process.on("SIGTERM", () => { cancelled = true; });
const checkCancelled = () => {
  if (cancelled) throw new Error("SCHEDULE_AUDIT_CANCELLED");
};

type InventoryRow = {
  target_id: number;
  code: string;
  business_name: string;
  business_type: PhaseBBusinessType;
  measurement_date: string;
  current_v2_preliminary_date: string | null;
  true_confirmed: boolean;
};

async function main() {
  const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
  const plans = new Map<number, any>((inventory.diagnosticSource?.v2Plans ?? [])
    .map((plan: any) => [Number(plan.measurement_target_business_id), plan]));
  const augustMeasurementRows = (inventory.inventory as InventoryRow[]).filter((row) =>
    row.measurement_date?.startsWith("2026-08-") && row.current_v2_preliminary_date,
  );
  const targetIds = augustMeasurementRows.map((row) => row.target_id);
  checkCancelled();

  // 이 경로는 SELECT만 호출한다. 저장 함수/RPC는 사용하지 않는다.
  const client = createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });
  const recalculated = await calculateV2Recommendations(client, {
    targetIds,
    planningDate: "1900-01-01",
    ignoreLegacyAssignmentInputs: true,
    allowExternalRoutes: false,
  });
  checkCancelled();
  const recalculatedByTarget = new Map(recalculated.results.map((result) => [result.targetId, result]));
  const currentPolicyRows = augustMeasurementRows.filter((row) =>
    String(plans.get(row.target_id)?.created_at ?? "").slice(0, 10) >= CURRENT_POLICY_EFFECTIVE_DATE,
  );
  const currentPolicyRecalculated = currentPolicyRows.length
    ? await calculateV2Recommendations(client, {
      targetIds: currentPolicyRows.map((row) => row.target_id),
      planningDate: "2026-08-25",
      ignoreLegacyAssignmentInputs: true,
      allowExternalRoutes: false,
    })
    : { results: [] };
  checkCancelled();
  const currentPolicyByTarget = new Map(currentPolicyRecalculated.results.map((result) => [result.targetId, result]));

  const policyAudit = augustMeasurementRows.map((row) => {
    const plan = plans.get(row.target_id);
    const candidates = recommendationDatesForBusinessType(row.measurement_date, row.business_type);
    const candidateIndex = candidates.findIndex((candidate) => candidate.date === row.current_v2_preliminary_date);
    const clean = recalculatedByTarget.get(row.target_id);
    const currentPolicyResult = currentPolicyByTarget.get(row.target_id);
    const origin = plan?.plan_origin ?? null;
    const classification = candidateIndex < 0
      ? "historical_policy_mismatch"
      : String(plan?.created_at ?? "").slice(0, 10) < CURRENT_POLICY_EFFECTIVE_DATE
        ? "historical_pre_current_policy"
        : currentPolicyResult?.date === row.current_v2_preliminary_date
          ? "current_engine_match"
          : "current_engine_mismatch";
    return {
      targetId: row.target_id,
      code: row.code,
      businessName: row.business_name,
      businessType: row.business_type,
      measurementDate: row.measurement_date,
      preliminaryDate: row.current_v2_preliminary_date,
      surveyMethod: plan?.survey_method ?? null,
      workingDaysBefore: workingDayDistance(row.current_v2_preliminary_date!, row.measurement_date),
      policyCandidateIndex: candidateIndex,
      higherPriorityCandidates: candidateIndex > 0 ? candidates.slice(0, candidateIndex) : [],
      currentCleanRecommendation: clean ? {
        status: clean.status,
        date: clean.date,
        responsibleUserId: clean.responsible.id,
        participantUserIds: clean.participants.map((user) => user.id),
        reason: clean.reason,
      } : null,
      currentPolicyRecommendation: currentPolicyResult ? {
        status: currentPolicyResult.status,
        date: currentPolicyResult.date,
        responsibleUserId: currentPolicyResult.responsible.id,
        participantUserIds: currentPolicyResult.participants.map((user) => user.id),
        reason: currentPolicyResult.reason,
      } : null,
      planOrigin: origin,
      storedReason: plan?.recommendation_reason ?? null,
      createdAt: plan?.created_at ?? null,
      updatedAt: plan?.updated_at ?? null,
      trueConfirmed: row.true_confirmed,
      classification,
    };
  });

  const augustPreliminaryRows = (inventory.inventory as InventoryRow[]).filter((row) =>
    row.current_v2_preliminary_date?.startsWith("2026-08-"),
  );
  const dateCounts = new Map<string, number>();
  for (const row of augustPreliminaryRows) {
    dateCounts.set(row.current_v2_preliminary_date!, (dateCounts.get(row.current_v2_preliminary_date!) ?? 0) + 1);
  }
  const enteredDates = [...dateCounts].map(([date]) => date).sort();
  const lastEnteredDate = enteredDates.at(-1) ?? null;
  const calendar: Array<{ date: string; workingDay: boolean; preliminarySurveyCount: number; status: string }> = [];
  if (lastEnteredDate) {
    for (let date = "2026-08-01"; date <= lastEnteredDate; date = addCalendarDays(date, 1)) {
      const workingDay = isWorkingDay(date);
      const count = dateCounts.get(date) ?? 0;
      calendar.push({
        date,
        workingDay,
        preliminarySurveyCount: count,
        status: workingDay ? (count ? "entered" : "empty_working_day") : "weekend_or_holiday",
      });
    }
  }

  const artifact = {
    generatedAt: new Date().toISOString(),
    productionReadOnly: true,
    inventoryPath,
    inventorySha256: createHash("sha256").update(readFileSync(inventoryPath)).digest("hex"),
    summary: {
      augustPreliminaryDateCount: augustPreliminaryRows.length,
      augustMeasurementDateWithPlanCount: augustMeasurementRows.length,
      firstEnteredDate: enteredDates[0] ?? null,
      lastEnteredDate,
      emptyWorkingDays: calendar.filter((day) => day.status === "empty_working_day").map((day) => day.date),
      policyAuditCount: policyAudit.length,
      historicalPolicyMismatch: policyAudit.filter((row) => row.classification === "historical_policy_mismatch").length,
      historicalPreCurrentPolicy: policyAudit.filter((row) => row.classification === "historical_pre_current_policy").length,
      manualOverride: policyAudit.filter((row) => row.planOrigin === "manual").length,
      currentEngineMatch: policyAudit.filter((row) => row.classification === "current_engine_match").length,
      currentEngineMismatch: policyAudit.filter((row) => row.classification === "current_engine_mismatch").length,
    },
    calendar,
    policyAudit,
    recalculationMissing: recalculated.missing,
  };
  writeFileSync(outputPath, JSON.stringify(artifact, null, 2));
  console.log(JSON.stringify({ outputPath, summary: artifact.summary }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
