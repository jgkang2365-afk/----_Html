import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectStoredK2BVerificationApprovalRows } from "@/lib/automation/k2b-verification-approval";
import { shouldSyncK2BCalendarForJournalChange } from "@/lib/automation/k2b-calendar-sync-policy";
import { syncBusinessToCalendar } from "@/lib/google/sync-service";

/** 저장된 verification job의 관측값만 사용해 선택 일지의 날짜+상태를 반영한다. */
export async function POST(request: NextRequest) {
  try {
    await checkPermission("journal:write");
    const body: unknown = await request.json();
    const { jobId, journalIds } = body && typeof body === "object" && !Array.isArray(body)
      ? body as { jobId?: unknown; journalIds?: unknown }
      : {};
    if (typeof jobId !== "string") {
      return NextResponse.json({ error: "검증 작업과 선택 일지를 확인해주세요." }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: job, error } = await admin.from("background_jobs")
      .select("id, job_type, status, execution_result").eq("id", jobId).eq("job_type", "k2b_verify").maybeSingle();
    if (error) throw error;
    if (!job || job.status !== "success" || !job.execution_result || typeof job.execution_result !== "object") {
      return NextResponse.json({ error: "완료된 K2B 검증 결과를 찾을 수 없습니다." }, { status: 409 });
    }
    const selected = selectStoredK2BVerificationApprovalRows(job.execution_result, journalIds);
    if (!selected) {
      return NextResponse.json({ error: "선택 건은 저장된 승인 필요 검증 결과와 일치해야 합니다." }, { status: 409 });
    }

    const selectedIds = selected.map((row) => row.journalId);
    const { data: currentRows, error: currentError } = await admin.from("measurement_journal")
      .select("id, code, measurement_year, measurement_period, k2b_send_date, k2b_status")
      .in("id", selectedIds);
    if (currentError) throw currentError;
    const currentById = new Map((currentRows || []).map((row) => [row.id, row]));

    const applied: number[] = [];
    const calendarTargets = new Map<string, { code: string; year: number; period: string }>();
    for (const row of selected) {
      const current = currentById.get(row.journalId);
      if (!current) {
        return NextResponse.json({ error: "반영 대상 일지를 찾을 수 없습니다." }, { status: 409 });
      }

      const update = {
        k2b_send_date: row.actualSubmissionDate,
        k2b_status: row.actualStatus,
      };
      const changed = current.k2b_send_date !== update.k2b_send_date
        || current.k2b_status !== update.k2b_status;
      const calendarRelevantChange = shouldSyncK2BCalendarForJournalChange(current, update);
      if (changed) {
        const { data: updated, error: updateError } = await admin.from("measurement_journal")
          .update(update).eq("id", row.journalId).select("id");
        if (updateError) throw updateError;
        if (updated?.length !== 1) {
          return NextResponse.json({ error: "반영 대상 일지를 찾을 수 없습니다." }, { status: 409 });
        }
      }
      applied.push(row.journalId);

      if (calendarRelevantChange) {
        const key = [current.code, current.measurement_year, current.measurement_period].join("\u0000");
        calendarTargets.set(key, {
          code: current.code,
          year: current.measurement_year,
          period: current.measurement_period,
        });
      }
    }

    const calendarErrors: string[] = [];
    for (const target of calendarTargets.values()) {
      try {
        await syncBusinessToCalendar(admin, target.code, target.year, target.period);
      } catch (error) {
        calendarErrors.push(`${target.code}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return NextResponse.json({
      success: true,
      applied,
      calendarSyncFailed: calendarErrors.length,
      calendarErrors,
      message: calendarErrors.length > 0
        ? "K2B 실제결과는 반영됐으나 일부 캘린더 동기화를 확인해야 합니다."
        : "선택한 K2B 실제결과를 반영했습니다.",
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "K2B 승인 반영 실패" }, { status: 500 });
  }
}
