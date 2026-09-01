import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** 직접 호출해도 구형 추천 확정이 업무 데이터를 변경하지 않도록 서버에서 차단한다. */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (session.role !== "관리자") {
    return NextResponse.json({ error: "관리자만 묶음 추천을 확정할 수 있습니다." }, { status: 403 });
  }
  return NextResponse.json({
    error: "LEGACY_WORKBENCH_DISABLED",
    message: "구형 묶음 추천 확정은 중지되었습니다. 측정자 고정형 역산 플래너를 사용해 주세요.",
  }, { status: 410 });
}
