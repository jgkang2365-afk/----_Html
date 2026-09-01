import { NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";

export const dynamic = "force-dynamic";

/** 구형 묶음 추천은 새 fixed-assignee workflow와 혼용하지 않는다. */
export async function GET() {
  try {
    await checkPermission("survey:read");
    return NextResponse.json({
      enabled: false,
      code: "LEGACY_WORKBENCH_DISABLED",
      message: "구형 묶음 추천은 중지되었습니다. 측정자 고정형 역산 플래너를 사용해 주세요.",
      groups: [],
      blocked: [],
      targetCount: 0,
    }, { status: 410 });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "GROUP_RECOMMENDATION_FORBIDDEN";
    return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 403 });
  }
}
