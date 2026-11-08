import { createAdminClient } from "@/lib/supabase/admin";
import { SupabaseClient } from "@supabase/supabase-js";
import { VerificationIssue } from "./excel-sync";
import { getKSTISOString } from "@/lib/utils/date-utils";

type DbRow = Record<string, any>;
type DbResult = { data: DbRow[] | null; error: { message: string } | null };
const PAGE_SIZE = 1000;
const MANAGED_TYPES = new Set([
  "MISSING_IN_BUSINESS_INFO",
  "MISMATCH_NAME",
  "MISMATCH_REPRESENTATIVE",
]);
const NOTE_PREFIX = "[데이터 불일치] ";

async function readAll(
  label: string,
  page: (from: number, to: number) => PromiseLike<DbResult>,
): Promise<DbRow[]> {
  const rows: DbRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${label} 조회 실패: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

// Only explicit period labels are interpreted. A bare "2" is ambiguous
// (second quarter or second half) and cannot establish a comparison period.
export function parseMeasurementHalf(period: unknown): 1 | 2 | null {
  if (typeof period !== "string") return null;
  const value = period.trim();
  if (/상반기/.test(value)) return 1;
  if (/하반기/.test(value)) return 2;
  const quarter = value.match(/(?:^|[^\d])([1-4])\s*분기/);
  if (quarter) return Number(quarter[1]) <= 2 ? 1 : 2;
  return null;
}

function newerMeasurement(left: DbRow, right: DbRow): DbRow {
  const yearDifference = Number(left.year) - Number(right.year);
  if (yearDifference !== 0) return yearDifference > 0 ? left : right;
  const halfDifference =
    (parseMeasurementHalf(left.period) || 0) -
    (parseMeasurementHalf(right.period) || 0);
  if (halfDifference !== 0) return halfDifference > 0 ? left : right;
  // This selects a display reference for the missing-code issue only.
  // Dates are never treated as proof of a business-name change.
  return String(left.measurement_end_date || "") >=
    String(right.measurement_end_date || "")
    ? left
    : right;
}

function issueKey(issue: DbRow): string {
  return JSON.stringify([issue.code, issue.issue_type, issue.description]);
}

function generatedNote(line: string, previousDescriptions: Set<string>): boolean {
  if (!line.startsWith(NOTE_PREFIX)) return false;
  const description = line.slice(NOTE_PREFIX.length);
  if (previousDescriptions.has(description)) return true;
  // Legacy runs could delete issue rows before updating the journal. Recognize
  // only the exact old generator's descriptions, not arbitrary tagged user text.
  return (
    description.startsWith("사업장명 불일치: 측정사업장(최신)(measurement_business)") ||
    description.startsWith("대표자명 불일치: 측정사업장(최신)(measurement_business)") ||
    description.startsWith(
      "측정사업장(최신)(measurement_business)에는 존재하지만 사업장 정보(business_info)에는 없는 사업장입니다.",
    )
  );
}

async function syncIssueNotes(
  supabase: SupabaseClient,
  issues: VerificationIssue[],
  previousIssues: DbRow[],
) {
  const previousDescriptions = new Set(
    previousIssues
      .filter((issue) => MANAGED_TYPES.has(issue.issue_type))
      .map((issue) => String(issue.description)),
  );
  const byCode = new Map<string, VerificationIssue[]>();
  for (const issue of issues) {
    const group = byCode.get(issue.code) || [];
    group.push(issue);
    byCode.set(issue.code, group);
  }

  // Read candidates before updating them, so offset pagination cannot skip
  // rows when a note ceases to match the filter.
  const tagged = await readAll("측정일지 자동 특이사항", (from, to) =>
    supabase
      .from("measurement_journal")
      .select("id, code, special_notes")
      .like("special_notes", "%[데이터 불일치]%")
      .order("id")
      .range(from, to),
  );
  const journals = new Map<number, DbRow>(
    tagged.map((row) => [Number(row.id), row]),
  );
  const latestIdByCode = new Map<string, number>();
  for (const code of byCode.keys()) {
    const { data, error } = await supabase
      .from("measurement_journal")
      .select("id, code, special_notes")
      .eq("code", code)
      .order("measurement_year", { ascending: false })
      .order("id", { ascending: false })
      .limit(1);
    if (error) throw new Error(`측정일지 조회 실패 (${code}): ${error.message}`);
    if (data?.length) {
      const journal = data[0];
      journals.set(Number(journal.id), journal);
      latestIdByCode.set(code, Number(journal.id));
    }
  }

  for (const journal of journals.values()) {
    const oldNotes = String(journal.special_notes || "");
    const lines = oldNotes.split(/\r?\n/);
    const generated = lines.some((line) => generatedNote(line, previousDescriptions));
    const active = latestIdByCode.get(journal.code) === Number(journal.id)
      ? byCode.get(journal.code) || []
      : [];
    if (!generated && active.length === 0) continue;
    const remaining = lines.filter(
      (line) => !generatedNote(line, previousDescriptions),
    );
    const newNotes = [
      ...active.map((issue) => `${NOTE_PREFIX}${issue.description}`),
      ...remaining,
    ].filter(Boolean).join("\n");
    if (newNotes === oldNotes) continue;
    // Optimistic guard prevents replacing a user's concurrent edit.
    let update = supabase
      .from("measurement_journal")
      .update({ special_notes: newNotes, updated_at: getKSTISOString() })
      .eq("id", journal.id);
    update = journal.special_notes == null
      ? update.is("special_notes", null)
      : update.eq("special_notes", oldNotes);
    const { data, error } = await update.select("id");
    if (error || !data?.length) {
      throw new Error(`측정일지 특이사항 갱신 실패 (id=${journal.id}): ${error?.message || "동시 수정"}`);
    }
  }
}

export async function verifyDataConsistency(
  externalSupabaseClient?: SupabaseClient<any, "public", any>,
) {
  const supabase = externalSupabaseClient || createAdminClient();
  try {
    const [businessInfos, measurements, exclusions, previousIssues] =
      await Promise.all([
        readAll("사업장 정보", (from, to) =>
          supabase.from("business_info")
            .select("code, business_name, representative_name")
            .order("code").range(from, to)),
        readAll("완료 측정사업장", (from, to) =>
          supabase.from("measurement_business")
            .select("code, business_name, representative_name, year, period, measurement_end_date")
            .eq("completion_status", "완료")
            .gte("year", 2024)
            .order("code").order("year").order("period")
            .range(from, to)),
        readAll("검증 제외", (from, to) =>
          supabase.from("data_verification_exclusions")
            .select("code, issue_type").order("code").range(from, to)),
        readAll("기존 검증 이슈", (from, to) =>
          supabase.from("data_verification_issues")
            .select("id, code, issue_type, description")
            .order("id").range(from, to)),
      ]);

    const businessByCode = new Map(
      businessInfos.filter((row) => row.code).map((row) => [row.code, row]),
    );
    const latestByCode = new Map<string, DbRow>();
    for (const measurement of measurements) {
      if (!measurement.code) continue; // Cannot persist an issue without a code.
      const previous = latestByCode.get(measurement.code);
      latestByCode.set(
        measurement.code,
        previous ? newerMeasurement(measurement, previous) : measurement,
      );
    }
    const excluded = new Set(
      exclusions.map((row) => `${row.code}:${row.issue_type}`),
    );
    const issues: VerificationIssue[] = [];
    for (const [code, measurement] of latestByCode) {
      const current = businessByCode.get(code);
      const name = String(measurement.business_name || "");
      if (name.includes("번외") || name.includes("별지") ||
          String(current?.business_name || "").includes("별지")) continue;
      if (!current && code.startsWith("H") &&
          !excluded.has(`${code}:MISSING_IN_BUSINESS_INFO`)) {
        issues.push({
          code,
          business_name: name,
          issue_type: "MISSING_IN_BUSINESS_INFO",
          description: `측정사업장(최신)(measurement_business)에는 존재하지만 사업장 정보(business_info)에는 없는 사업장입니다. (기준: ${measurement.year}년 ${measurement.period})`,
        });
      }
      // business_info holds current values and has no effective-date history.
      // Neither its updated_at nor the measurement import's created_at proves
      // that the two names were authoritative at the same measurement time.
    }

    const desired = new Set(issues.map(issueKey));
    const present = new Set<string>();
    const obsoleteIds: number[] = [];
    for (const issue of previousIssues) {
      if (!MANAGED_TYPES.has(issue.issue_type)) continue;
      const key = issueKey(issue);
      if (!desired.has(key) || present.has(key)) obsoleteIds.push(Number(issue.id));
      else present.add(key);
    }
    const missing = issues.filter((issue) => !present.has(issueKey(issue)));
    // Insert first; if an insert fails, no previously valid issue is deleted.
    for (let i = 0; i < missing.length; i += PAGE_SIZE) {
      const { error } = await supabase.from("data_verification_issues")
        .insert(missing.slice(i, i + PAGE_SIZE));
      if (error) throw new Error(`검증 이슈 등록 실패: ${error.message}`);
    }
    // Reconcile notes before deleting old rows. A note write failure leaves
    // the previous issue evidence available for a safe retry.
    await syncIssueNotes(supabase, issues, previousIssues);
    for (let i = 0; i < obsoleteIds.length; i += PAGE_SIZE) {
      const { error } = await supabase.from("data_verification_issues")
        .delete().in("id", obsoleteIds.slice(i, i + PAGE_SIZE));
      if (error) throw new Error(`기존 검증 이슈 정리 실패: ${error.message}`);
    }
    return { success: true, issueCount: issues.length };
  } catch (error) {
    console.error("[Verification] 데이터 정합성 검증 실패:", error);
    return { success: false, error };
  }
}
