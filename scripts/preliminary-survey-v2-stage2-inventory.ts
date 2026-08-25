import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { measurementDayFormsFrom } from "../lib/business/measurement-day-form";
import { recommendationDatesForBusinessType, type PhaseBBusinessType } from "../lib/preliminary-survey-v2/calendar";
import {
  buildPreliminarySurveyV2CleanInput,
  canonicalReplayCandidateUsers,
  canonicalReplayScheduleBlocks,
  replayJournalKey,
  replaySourceFingerprint,
  STAGE2_PROTECTED_CODES,
} from "../lib/preliminary-survey-v2/historical-replay";

config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const FROM_DATE = "2026-08-01";
const baselineArg = process.argv.find((value) => value.startsWith("--baseline-date="));
const BASELINE_DATE = baselineArg?.slice("--baseline-date=".length) ||
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const outputArg = process.argv.find((value) => value.startsWith("--output="));
const outputPath = resolve(outputArg?.slice("--output=".length) ||
  "C:/Users/USER/Downloads/2026-08-23_stage2-1-production-inventory.json");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_ENV_MISSING");
if (/localhost|127\.0\.0\.1/.test(new URL(url).hostname)) throw new Error("PRODUCTION_URL_REQUIRED");
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function select<T = any>(query: PromiseLike<{ data: T[] | null; error: any }>, label: string) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}:${error.code ?? ""}:${error.message}`);
  return data ?? [];
}

function assignmentDates(row: any): string[] | null {
  const start = String(row.measurement_date ?? "");
  const end = String(row.measurement_end_date ?? start);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  if (!end || end === start) return [start];
  if (!Array.isArray(row.daily_staff) || row.daily_staff.length < 2) return null;
  const dates = row.daily_staff.map((day: any) => String(day?.date ?? "")).sort();
  if (dates.some((date: string) => !/^\d{4}-\d{2}-\d{2}$/.test(date)) || new Set(dates).size !== dates.length) return null;
  return dates[0] === start && dates.at(-1) === end ? dates : null;
}

function currentMeasurementAssignment(plan: any, date: string) {
  const reason = plan?.recommendation_reason;
  const candidates = [reason?.measurementAssignments, reason?.evidence?.measurementAssignments,
    reason?.measurementAssignment, reason?.measurementAssignee];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const item = candidate.find((entry: any) => String(entry?.measurementDate ?? entry?.measurement_date ?? "") === date);
      if (item) return Number(item.userId ?? item.assigneeUserId ?? item.assignee_user_id) || null;
    } else if (candidate && typeof candidate === "object") {
      return Number(candidate.userId ?? candidate.assigneeUserId ?? candidate.assignee_user_id) || null;
    }
  }
  return null;
}

async function tableDigest(client: SupabaseClient, table: string, columns: string, orderColumn: string) {
  const rows = await select<any>((client.from(table).select(columns) as any).order(orderColumn), `SNAPSHOT_${table}`);
  return { table, count: rows.length, digest: replaySourceFingerprint(rows) };
}

async function main() {
  const targets = await select<any>(supabase.from("measurement_target_business").select(
    "id,code,year,period,business_name,address,measurement_date,measurement_end_date,measurer_id,link_measurer_id,collaborators,daily_staff,created_at,updated_at,business_type,process_changed,preliminary_survey_rule_type,requires_field_preliminary_survey",
  ).gte("measurement_date", FROM_DATE).order("measurement_date").order("id"), "TARGETS");
  const targetIds = targets.map((row) => Number(row.id));
  const codes = [...new Set(targets.map((row) => String(row.code)))];
  const users = await select<any>(supabase.from("users").select(
    "id,name,role,job,survey_code,is_active,is_preliminary_survey_experienced,is_preliminary_survey_support_assignable,is_preliminary_survey_manager",
  ).eq("job", "측정").order("id"), "USERS");
  const journals = await select<any>(supabase.from("measurement_journal").select(
    "id,code,measurement_year,measurement_period,note,business_name,designated_office,completion_status,created_at,updated_at",
  ).in("code", codes).order("id"), "JOURNALS");
  const businessInfo = await select<any>(supabase.from("business_info").select(
    "code,business_name,latitude,longitude",
  ).in("code", codes).order("code"), "BUSINESS_INFO");
  const blocks = await select<any>(supabase.from("user_schedule_blocks").select(
    "id,user_id,start_date,end_date,block_type,created_at,updated_at",
  ).order("id"), "SCHEDULE_BLOCKS");
  const v2Plans = await select<any>(supabase.from("preliminary_survey_v2_plans").select(
    "id,measurement_target_business_id,recommended_date,responsible_user_id,experienced_reviewer_id,participant_user_ids,participant_names,status,plan_origin,source_measurement_date,source_responsible_user_id,source_rule_type,survey_method,recommendation_reason,route_evidence,warnings,created_at,updated_at",
  ).order("measurement_target_business_id"), "V2_PLANS");
  const measurementAssignments = await select<any>(supabase.from("preliminary_survey_v2_measurement_assignments")
    .select("id,plan_id,measurement_date,assignee_user_id,survey_code,survey_code_source")
    .order("plan_id").order("measurement_date"), "V2_MEASUREMENT_ASSIGNMENTS");
  const v1Plans = targetIds.length ? await select<any>(supabase.from("preliminary_survey_plans").select("*")
    .in("measurement_target_business_id", targetIds).order("measurement_target_business_id"), "V1_PLANS") : [];
  const policyRows = await select<any>(supabase.from("preliminary_survey_policy_settings").select(
    "policy_key,enabled,effective_start_year,effective_start_period,effective_start_measurement_date",
  ).eq("policy_key", "process_changed_preliminary_survey"), "POLICY");
  const cleanInput = buildPreliminarySurveyV2CleanInput({ targets, users, journals, businessInfo, blocks, policyRows });
  const cleanTargetById = new Map(cleanInput.targets.map((target) => [target.id, target]));

  const before = await Promise.all([
    tableDigest(supabase, "measurement_target_business", "id,updated_at", "id"),
    tableDigest(supabase, "preliminary_survey_v2_plans", "id,updated_at", "id"),
    tableDigest(supabase, "preliminary_survey_plans", "id,updated_at,row_version", "id"),
    tableDigest(supabase, "measurement_journal", "id,updated_at", "id"),
    tableDigest(supabase, "user_schedule_blocks", "id,updated_at", "id"),
  ]);
  const journalKeys = new Set(journals.map((row) => replayJournalKey(row.code, row.measurement_year, row.measurement_period)));
  const planByTargetId = new Map(v2Plans.map((row) => [Number(row.measurement_target_business_id), row]));
  const assignmentByPlanAndDate = new Map(measurementAssignments.map((row) => [
    `${String(row.plan_id)}|${String(row.measurement_date)}`,
    row.assignee_user_id == null ? null : Number(row.assignee_user_id),
  ]));
  const v1ByTargetId = new Map(v1Plans.map((row) => [Number(row.measurement_target_business_id), row]));
  const userIdByName = new Map(users.map((row) => [String(row.name).trim(), Number(row.id)]));
  const coordinateByCode = new Map(businessInfo.map((row) => [String(row.code), row]));
  const candidateUserStates = canonicalReplayCandidateUsers(users);
  const candidateUserIds = users.filter((user) => user.is_active !== false).map((user) => Number(user.id));

  const manifest = targets.map((row) => {
    const targetId = Number(row.id);
    const plan = planByTargetId.get(targetId);
    const dates = assignmentDates(row);
    const trueConfirmed = journalKeys.has(replayJournalKey(row.code, row.year, row.period));
    const isProtected = STAGE2_PROTECTED_CODES.has(String(row.code));
    const pastDueUnmeasured = !trueConfirmed && String(row.measurement_date) <= BASELINE_DATE;
    const dayForms = measurementDayFormsFrom({
      dailyStaff: row.daily_staff, measurementDate: row.measurement_date,
      measurerId: row.measurer_id == null ? null : Number(row.measurer_id), collaborators: row.collaborators,
    });
    const staff = dayForms.map((day) => ({
      date: day.date,
      reportWriterUserId: day.measurerId,
      measurementParticipantUserIds: day.collaborators.flatMap((name) => userIdByName.get(name.trim()) ?? []),
      unresolvedParticipantNames: day.collaborators.filter((name) => !userIdByName.has(name.trim())),
    }));
    const missing: string[] = [];
    if (!dates) missing.push("measurement_assignment_dates");
    if (!row.business_type || !["existing", "first_measurement", "external_new"].includes(row.business_type)) missing.push("business_type");
    // 기존 V2/측정 역할의 일정 충돌은 CLEAN_INPUT 자격이나 계산에 영향을 주지 않는다.
    const scheduleConflict = false;
    const exclusionReason = trueConfirmed ? "excluded_true_confirmed"
      : isProtected ? "protected_manual_correction"
        : pastDueUnmeasured ? "past_due_unmeasured"
        : missing.length ? "source_incomplete" : null;
    const preliminaryCandidateDates = row.business_type && ["existing", "first_measurement", "external_new"].includes(row.business_type)
      ? recommendationDatesForBusinessType(row.measurement_date, row.business_type as PhaseBBusinessType).map((item) => item.date)
      : [];
    const relevantScheduleDates = [...new Set([...preliminaryCandidateDates, ...(dates ?? [])])];
    const cleanTarget = cleanTargetById.get(targetId);
    const source = {
      target: cleanTarget,
      candidateUsers: candidateUserStates,
      scheduleBlocks: canonicalReplayScheduleBlocks({ blocks, candidateUserIds, relevantDates: relevantScheduleDates }),
      trueConfirmed,
    };
    return {
      target_id: targetId, code: row.code, year: Number(row.year), period: row.period,
      business_name: row.business_name, business_type: row.business_type,
      measurement_date: row.measurement_date, measurement_assignment_dates: dates,
      current_v2_preliminary_date: plan?.recommended_date ?? null,
      current_v2_responsible: plan ? Number(plan.responsible_user_id) : null,
      current_v2_reviewer: plan?.experienced_reviewer_id == null ? null : Number(plan.experienced_reviewer_id),
      current_v2_participants: Array.isArray(plan?.participant_user_ids) ? plan.participant_user_ids.map(Number) : [],
      current_measurement_assignee: (dates ?? []).map((date) => ({
        date,
        user_id: plan && assignmentByPlanAndDate.has(`${String(plan.id)}|${date}`)
          ? assignmentByPlanAndDate.get(`${String(plan.id)}|${date}`)
          : currentMeasurementAssignment(plan, date),
      })),
      current_report_writer: staff.map((day) => ({ date: day.date, user_id: day.reportWriterUserId })),
      current_measurement_participants: staff.map((day) => ({ date: day.date, user_ids: day.measurementParticipantUserIds })),
      true_confirmed: trueConfirmed, protected: isProtected,
      past_due_unmeasured: pastDueUnmeasured,
      manual_v2: plan?.plan_origin === "manual", automatic_v2: plan?.plan_origin === "automatic",
      schedule_conflict: scheduleConflict, source_complete: missing.length === 0,
      source_incomplete_fields: missing, replay_eligible: exclusionReason == null,
      exclusion_reason: exclusionReason,
      ignored_v1_preliminary_date: v1ByTargetId.get(targetId)?.recommended_date ?? null,
      source_fingerprint: replaySourceFingerprint(source),
    };
  });
  const after = await Promise.all([
    tableDigest(supabase, "measurement_target_business", "id,updated_at", "id"),
    tableDigest(supabase, "preliminary_survey_v2_plans", "id,updated_at", "id"),
    tableDigest(supabase, "preliminary_survey_plans", "id,updated_at,row_version", "id"),
    tableDigest(supabase, "measurement_journal", "id,updated_at", "id"),
    tableDigest(supabase, "user_schedule_blocks", "id,updated_at", "id"),
  ]);
  const summary = {
    totalTargets: manifest.length,
    trueConfirmed: manifest.filter((row) => row.true_confirmed).length,
    protected: manifest.filter((row) => row.protected).length,
    v2PlanExists: manifest.filter((row) => row.manual_v2 || row.automatic_v2).length,
    v2PlanMissing: manifest.filter((row) => !row.manual_v2 && !row.automatic_v2).length,
    manualV2: manifest.filter((row) => row.manual_v2).length,
    automaticV2: manifest.filter((row) => row.automatic_v2).length,
    measurementAssignmentRows: measurementAssignments.length,
    existingSurveyorSource: manifest.filter((row) => row.current_v2_responsible != null).length,
    scheduleBlockAffected: manifest.filter((row) => row.schedule_conflict).length,
    multiDay: manifest.filter((row) => (row.measurement_assignment_dates?.length ?? 0) > 1).length,
    sourceIncomplete: manifest.filter((row) => !row.source_complete).length,
    replayEligible: manifest.filter((row) => row.replay_eligible).length,
    pastDueUnmeasured: manifest.filter((row) => row.past_due_unmeasured && !row.protected).length,
  };
  const payload = {
    generatedAt: new Date().toISOString(), source: "production-read-only", fromMeasurementDate: FROM_DATE,
    baselineDate: BASELINE_DATE,
    productionHost: new URL(url).hostname, summary, snapshots: { before, after, unchanged: JSON.stringify(before) === JSON.stringify(after) },
    schema: { measurementAssignmentTablePresent: true, processChangedEnabled: policyRows[0]?.enabled ?? null },
    inventory: manifest,
    cleanInput,
    diagnosticSource: {
      v2Plans,
      v1Plans,
      persistenceSourceContexts: targets.map((target) => ({
        id: Number(target.id), address: target.address ?? null,
        measurer_id: target.measurer_id == null ? null : Number(target.measurer_id),
        collaborators: target.collaborators ?? null, daily_staff: target.daily_staff ?? null,
      })),
    },
  };
  writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath, summary, productionUnchanged: payload.snapshots.unchanged,
    sha256: replaySourceFingerprint(payload) }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
