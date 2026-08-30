import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { collectMeasurementStaffNames } from "@/lib/business/link-measurer";
import { operationalMeasurementUsers } from "@/lib/business/operational-measurement-user";
import { canManagePreliminarySurvey } from "@/lib/preliminary-survey-v2/access";

export const dynamic = "force-dynamic";

/**
 * 관리자 전용 예비조사 예외 정비 API
 *
 * GET  - 정비 화면 비교 정보 반환 (target/V2 plan/실제 측정자/legacy/확정 여부)
 * POST - 관리자 예외 정비 저장 (V2 예비조사자 정정 + link_measurer_id 지정 + 감사기록)
 *
 * measurement_journal row가 존재하는 찐확정 데이터의 예외 수정 경로로, 관리자만 사용할 수 있다.
 * 실제 측정자·보고서 담당자·legacy 값은 이 API에서 변경하지 않는다.
 */

async function adminGuard(supabase: any, session: { role: "관리자" | "사용자"; userId: number } | null) {
  if (!session) return { error: "로그인이 필요합니다.", status: 401 };
  if (!await canManagePreliminarySurvey(supabase, session)) {
    return { error: "예비조사 담당자 또는 관리자만 예비조사 예외 정비를 수행할 수 있습니다.", status: 403 };
  }
  return null;
}

function friendlyRpcError(message: string): string {
  const known: Record<string, string> = {
    REASON_REQUIRED: "변경 사유를 입력해 주세요.",
    INVALID_PARTICIPANTS: "예비조사자 목록이 올바르지 않습니다.",
    TARGET_NOT_FOUND: "측정 대상 사업장을 찾을 수 없습니다.",
    V2_PLAN_NOT_FOUND: "예비조사 V2 계획이 존재하지 않습니다.",
    SEQUENCE_NUMBER_NOT_CONFIRMED: "측정일지 연번이 부여되지 않아 확정 상태가 아닙니다. 예외 정비는 확정 데이터만 가능합니다.",
    PARTICIPANT_MISMATCH: "예비조사자 정보가 사용자 정보와 일치하지 않습니다.",
    PARTICIPANT_DUPLICATE: "예비조사자에 중복된 인원이 있습니다.",
    LINK_MEASURER_REQUIRED: "예·측을 선택해 주세요.",
    LINK_MEASURER_NOT_FOUND: "예·측으로 선택한 사용자를 찾을 수 없습니다.",
    LINK_MEASURER_NOT_IN_PARTICIPANTS: "예·측은 정정 후 예비조사자에 포함되어야 합니다.",
    LINK_MEASURER_NOT_IN_STAFF: "예·측은 실제 측정 인원에 포함되어야 합니다.",
  };
  const code = Object.keys(known).find((key) => message.includes(key));
  return code ? known[code] : message;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  const supabase = await createClient();
  const denied = await adminGuard(supabase, session);
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  try {
    const targetIdText = new URL(request.url).searchParams.get("targetId");
    const targetId = targetIdText ? Number(targetIdText) : null;
    if (!targetId || !Number.isInteger(targetId)) {
      return NextResponse.json({ error: "INVALID_TARGET_ID" }, { status: 400 });
    }

    const { data: target, error: targetError } = await supabase
      .from("measurement_target_business")
      .select(
        "id, code, year, period, business_name, measurement_date, measurement_end_date, measurer_id, link_measurer_id, collaborators, daily_staff",
      )
      .eq("id", targetId)
      .maybeSingle();
    if (targetError || !target) {
      return NextResponse.json({ error: "TARGET_NOT_FOUND" }, { status: 404 });
    }

    const { data: plan, error: planError } = await supabase
      .from("preliminary_survey_v2_plans")
      .select(
        "id, measurement_target_business_id, recommended_date, responsible_user_id, experienced_reviewer_id, participant_user_ids, participant_names, status, plan_origin, source_measurement_date, source_rule_type, survey_method",
      )
      .eq("measurement_target_business_id", targetId)
      .maybeSingle();

    const [legacyResult, journalResult, usersResult] = await Promise.all([
      supabase
        .from("preliminary_survey")
        .select(
          "id, code, year, period, measurement_date, end_date, business_name, measurer, survey_code, preliminary_surveyor, actual_measurer, report_writer, notes, updated_at",
        )
        .eq("code", target.code)
        .eq("year", target.year)
        .eq("period", target.period)
        .order("updated_at", { ascending: false })
        .order("measurement_date", { ascending: false }),
      supabase
        .from("measurement_journal")
        .select("id, sequence_number, measurement_start_date, measurement_end_date")
        .eq("code", target.code)
        .eq("measurement_year", target.year)
        .like("measurement_period", `${String(target.period).trim().replace("(수시)", "")}%`)
        .limit(1)
        .maybeSingle(),
      supabase.from("users").select("id, name, job, is_active"),
    ]);
    if (planError) throw planError;
    if (legacyResult.error) throw legacyResult.error;
    if (journalResult.error) throw journalResult.error;
    if (usersResult.error) throw usersResult.error;

    // 같은 측정일의 legacy 기록 우선, 없으면 최신 기록
    const legacyRows = (legacyResult.data || []) as any[];
    const legacy =
      legacyRows.find((row) => String(row.measurement_date) === String(target.measurement_date)) ??
      legacyRows[0] ??
      null;

    const staffNames = collectMeasurementStaffNames({
      collaborators: target.collaborators,
      dailyStaff: target.daily_staff,
    });

    return NextResponse.json({
      target: {
        id: Number(target.id),
        code: target.code,
        year: Number(target.year),
        period: target.period,
        business_name: target.business_name,
        measurement_date: target.measurement_date,
        measurement_end_date: target.measurement_end_date,
        measurer_id: target.measurer_id,
        link_measurer_id: target.link_measurer_id,
      },
      plan: plan || null,
      staffNames,
      legacy: legacy
        ? {
            preliminary_surveyor: legacy.preliminary_surveyor || null,
            actual_measurer: legacy.actual_measurer || null,
            report_writer: legacy.report_writer || null,
            measurer: legacy.measurer || null,
            survey_code: legacy.survey_code || null,
            measurement_date: legacy.measurement_date || null,
            end_date: legacy.end_date || null,
          }
        : null,
      sequenceNumber: journalResult.data?.sequence_number ?? null,
      users: operationalMeasurementUsers(usersResult.data).map((user: any) => ({
        id: Number(user.id),
        name: user.name,
        job: user.job,
        is_active: user.is_active,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ADMIN_REPAIR_CONTEXT_FAILED";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  try {
    const supabase = await createClient();
    const denied = await adminGuard(supabase, session);
    if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });
    if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    const body = await request.json();
    const targetId = Number(body.targetId);
    const participantUserIds = Array.isArray(body.participantUserIds)
      ? [...new Set(body.participantUserIds.map(Number).filter(Number.isFinite))]
      : [];
    const participantNames = Array.isArray(body.participantNames)
      ? body.participantNames.map((name: unknown) => String(name).trim()).filter(Boolean)
      : [];
    const linkMeasurerId = body.linkMeasurerId == null || body.linkMeasurerId === ""
      ? null
      : Number(body.linkMeasurerId);
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";

    if (!Number.isInteger(targetId)) {
      return NextResponse.json({ error: "INVALID_TARGET_ID" }, { status: 400 });
    }
    if (!reason) {
      return NextResponse.json({ error: "변경 사유를 입력해 주세요." }, { status: 400 });
    }
    if (participantUserIds.length === 0 || participantNames.length === 0) {
      return NextResponse.json({ error: "정정 후 예비조사자를 선택해 주세요." }, { status: 400 });
    }
    if (participantUserIds.length !== participantNames.length) {
      return NextResponse.json({ error: "예비조사자 정보가 올바르지 않습니다." }, { status: 400 });
    }
    if (linkMeasurerId == null) {
      return NextResponse.json({ error: "예·측을 선택해 주세요." }, { status: 400 });
    }

    const selectedUserIds = [...new Set<number>([
      ...participantUserIds.map(Number),
      Number(linkMeasurerId),
    ])].filter(Number.isInteger);
    const { data: selectedUsers, error: selectedUserError } = await supabase
      .from("users")
      .select("id, job, is_active")
      .in("id", selectedUserIds);
    if (selectedUserError) throw selectedUserError;
    const operationalUserIds = new Set(operationalMeasurementUsers(selectedUsers).map((user) => Number(user.id)));
    if (!selectedUserIds.every((id) => operationalUserIds.has(id))) {
      return NextResponse.json({ error: "INELIGIBLE_OPERATIONAL_USER" }, { status: 400 });
    }
    const { data, error } = await supabase.rpc("admin_repair_preliminary_survey_connection", {
      p_target_id: targetId,
      p_participant_user_ids: participantUserIds,
      p_participant_names: participantNames,
      p_link_measurer_id: linkMeasurerId,
      p_reason: reason,
      p_changed_by: session.name || "관리자",
    });
    if (error) {
      return NextResponse.json(
        { error: friendlyRpcError(error.message) },
        { status: 400 },
      );
    }

    return NextResponse.json({
      success: true,
      plan: Array.isArray(data) ? data[0] : data,
      message: "예비조사 예외 정비가 완료되었습니다.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ADMIN_REPAIR_FAILED";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
