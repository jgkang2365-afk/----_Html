import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";
import { toShortName } from "@/lib/constants/designated-offices";

const VALID_STATUSES = new Set(["접수", "미접수"]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await checkPermission("journal:write");
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }
    if (user.role !== "관리자" && !user.is_designated_office_report_manager) {
      return NextResponse.json(
        { error: "지정기관선정신고서 상태는 지정기관신고서 담당자만 변경할 수 있습니다." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const requestedStatus = String(body.status || "").trim();
    if (!VALID_STATUSES.has(requestedStatus)) {
      return NextResponse.json({ error: "접수 또는 미접수만 선택할 수 있습니다." }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: journal, error: fetchError } = await supabase
      .from("measurement_journal")
      .select("id, designated_office")
      .eq("id", params.id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!journal) {
      return NextResponse.json({ error: "측정일지를 찾을 수 없습니다." }, { status: 404 });
    }

    const isCheonan = toShortName(journal.designated_office || "") === "천안";
    const status = isCheonan ? requestedStatus : "미접수";
    const { data: updated, error: updateError } = await supabase
      .from("measurement_journal")
      .update({
        designated_office_report_status: status,
        updated_at: new Date().toISOString(),
        updated_by: user.name,
      })
      .eq("id", params.id)
      .select("id, designated_office_report_status")
      .single();

    if (updateError) throw updateError;
    return NextResponse.json({ success: true, data: updated });
  } catch (error: any) {
    console.error("지정기관선정신고서 접수 상태 변경 오류:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "상태 변경 중 오류가 발생했습니다." },
      { status: error?.message === "Forbidden" ? 403 : 500 }
    );
  }
}