import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { checkPermission } from "@/lib/auth/check-permission";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function currentUser() {
  const session = await getSession();
  if (!session?.userId) return null;
  const { data, error } = await createAdminClient().from("users")
    .select("id, name, role").eq("id", session.userId).maybeSingle();
  if (error) throw error;
  return data;
}

/** Only managers and a proven originating submitter can see isolated error originals. */
export async function GET() {
  try {
    await checkPermission("journal:read");
    const actor = await currentUser();
    if (!actor) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    const admin = createAdminClient();
    let query = admin.from("k2b_unmatchable_errors")
      .select("id, source_key, actual_submission_date, file_name, k2b_status, error_detail, raw_row, first_seen_at, last_seen_at, submission_job_id, submitter_user_id, review_state, approved_by_user_id, approved_at, approval_reason")
      .order("last_seen_at", { ascending: false }).limit(100);
    if (actor.role !== "관리자") query = query.eq("submitter_user_id", actor.id);
    const { data: rows, error } = await query;
    if (error) throw error;
    const ids = (rows ?? []).map((row) => row.id);
    const history = ids.length ? await admin.from("k2b_unmatchable_error_approvals")
      .select("error_id, actor_user_id, reason, approved_at").in("error_id", ids)
      .order("approved_at", { ascending: true }) : { data: [], error: null };
    if (history.error) throw history.error;
    const userIds = [...new Set((rows ?? []).flatMap((row) => [row.submitter_user_id, row.approved_by_user_id]).filter((id): id is number => typeof id === "number"))];
    const users = userIds.length ? await admin.from("users").select("id, name").in("id", userIds) : { data: [], error: null };
    if (users.error) throw users.error;
    const names = new Map((users.data ?? []).map((user) => [user.id, user.name]));
    return NextResponse.json({ errors: (rows ?? []).map((row) => ({
      ...row,
      submitter_name: row.submitter_user_id ? names.get(row.submitter_user_id) ?? null : null,
      approved_by_name: row.approved_by_user_id ? names.get(row.approved_by_user_id) ?? null : null,
      approval_history: (history.data ?? []).filter((event) => event.error_id === row.id),
    })) }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "K2B 오류 원본 조회 실패";
    return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 });
  }
}

/** Approval is serialized in the database and rechecks the live user role. */
export async function POST(request: NextRequest) {
  try {
    await checkPermission("journal:write");
    const actor = await currentUser();
    if (!actor) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    const body = await request.json();
    const errorId = typeof body?.errorId === "string" ? body.errorId : "";
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (!UUID.test(errorId) || !reason) return NextResponse.json({ error: "오류 원본과 승인 사유를 확인해주세요." }, { status: 400 });
    const { data, error } = await createAdminClient().rpc("approve_k2b_unmatchable_error", {
      p_error_id: errorId, p_actor_user_id: actor.id, p_reason: reason,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 409 });
    return NextResponse.json({ approval: data }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "K2B 오류 패스 실패";
    return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 });
  }
}
