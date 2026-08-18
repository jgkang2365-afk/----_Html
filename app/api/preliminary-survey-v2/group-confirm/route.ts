import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { confirmGroupRecommendation } from "@/lib/preliminary-survey-v2/service";

export const dynamic = "force-dynamic";

/**
 * 예비조사 묶음 추천 확정(저장) API (관리자 전용)
 *
 * - 클라이언트는 추천 날짜와 선택 target IDs만 보낸다. participants/link는 서버가 재검증해 결정한다.
 * - 확정 직전 현재 DB를 다시 읽어 sequence_number / manual plan / 실제 측정자 / 측정일 변경을 재검증한다.
 * - 원자적으로 처리되며(전부 성공 또는 전부 rollback), 실패 시 사업장별 사유를 반환한다.
 * - 제외된 사업장은 변경하지 않는다.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (session.role !== "관리자") {
    return NextResponse.json({ error: "관리자만 묶음 추천을 확정할 수 있습니다." }, { status: 403 });
  }
  try {
    const body = await request.json();
    const date = typeof body.date === "string" ? body.date : null;
    const targetIds = Array.isArray(body.targetIds) ? body.targetIds.map(Number).filter(Number.isFinite) : [];
    const linkOverrides = body.linkOverrides && typeof body.linkOverrides === "object"
      ? Object.fromEntries(Object.entries(body.linkOverrides).map(([key, value]) => [Number(key), Number(value)]))
      : undefined;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "INVALID_DATE" }, { status: 400 });
    }
    if (targetIds.length === 0) {
      return NextResponse.json({ error: "확정할 사업장을 선택해 주세요." }, { status: 400 });
    }
    if (new Set(targetIds).size !== targetIds.length) {
      return NextResponse.json({ error: "중복된 사업장이 포함되어 있습니다." }, { status: 400 });
    }

    const supabase = await createClient();
    const result = await confirmGroupRecommendation(supabase, { date, targetIds, linkOverrides });

    if (result.failed.length > 0) {
      return NextResponse.json({ success: false, ...result }, { status: 400 });
    }
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GROUP_CONFIRM_FAILED";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
