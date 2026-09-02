import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { canManagePreliminarySurvey } from "@/lib/preliminary-survey-v2/access";
import { buildConfirmedDocumentRepairPreview } from "@/lib/preliminary-survey-v2/confirmed-document-repair";

export const dynamic = "force-dynamic";

function targetIdsFrom(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.map(Number);
  return ids.length && ids.every((id) => Number.isInteger(id) && id > 0) && new Set(ids).size === ids.length ? ids : null;
}

async function guard() {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }) };
  const supabase = await createClient();
  if (!await canManagePreliminarySurvey(supabase, session)) {
    return { response: NextResponse.json({ error: "예비조사 담당자 또는 관리자만 누락정보를 보정할 수 있습니다." }, { status: 403 }) };
  }
  return { session, supabase };
}

export async function POST(request: NextRequest) {
  try {
    const access = await guard();
    if ("response" in access) return access.response;
    const body = await request.json();
    const targetIds = targetIdsFrom(body.targetIds);
    if (!targetIds) return NextResponse.json({ error: "INVALID_TARGET_IDS" }, { status: 400 });
    const preview = await buildConfirmedDocumentRepairPreview(access.supabase, targetIds);
    if (body.action === "preview") return NextResponse.json({ success: true, ...preview });
    if (body.action !== "apply") return NextResponse.json({ error: "UNSUPPORTED_ACTION" }, { status: 400 });

    const submitted = (Array.isArray(body.drafts) ? body.drafts : [])
      .sort((left: { targetId: number }, right: { targetId: number }) => Number(left.targetId) - Number(right.targetId));
    const canonical = preview.drafts.filter((draft) => draft.classification === "MISSING_DOCUMENTARY_INFO")
      .sort((left, right) => left.targetId - right.targetId);
    if (JSON.stringify(submitted) !== JSON.stringify(canonical)) {
      return NextResponse.json({ error: "원천값이 변경되었습니다. 누락정보 보정안을 다시 생성해 주세요.", code: "REPAIR_SOURCE_CHANGED" }, { status: 409 });
    }
    if (!canonical.length) return NextResponse.json({ success: true, repairedCount: 0 });
    const participantIds = [...new Set(canonical.flatMap((draft) => draft.participantUserIds.map(Number)))];
    const { data: participantUsers, error: participantError } = await access.supabase
      .from("users")
      .select("id, is_preliminary_survey_experienced")
      .in("id", participantIds);
    if (participantError) throw participantError;
    const experiencedIds = new Set((participantUsers ?? [])
      .filter((user: { is_preliminary_survey_experienced?: boolean | null }) => user.is_preliminary_survey_experienced === true)
      .map((user: { id: number }) => Number(user.id)));
    const invalidRoleDrafts = canonical.filter((draft) =>
      !draft.participantUserIds.some((userId) => experiencedIds.has(Number(userId))),
    );
    if (invalidRoleDrafts.length) {
      return NextResponse.json({
        error: "비경력자 단독 예비조사 조합은 자동 보정할 수 없습니다.",
        code: "REPAIR_CANONICAL_ROLE_INVALID",
        targetIds: invalidRoleDrafts.map((draft) => draft.targetId),
        repairedCount: 0,
      }, { status: 409 });
    }
    const { data, error } = await access.supabase.rpc("repair_true_confirmed_preliminary_v2_missing_batch", {
      p_repairs: canonical,
      p_changed_by_user_id: access.session.userId,
    });
    if (error) {
      const status = /SOURCE_CHANGED|NON_NULL_OVERWRITE|PROTECTED|TRUE_CONFIRMED/.test(error.message) ? 409 : 400;
      return NextResponse.json({ error: error.message, code: error.message }, { status });
    }
    return NextResponse.json({ success: true, repairedCount: Number(data) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "CONFIRMED_REPAIR_FAILED" }, { status: 500 });
  }
}
