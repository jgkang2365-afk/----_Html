import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueSerializedK2BUpload } from "@/lib/automation/k2b-job-queue";

export const dynamic = "force-dynamic";

/** 호환 endpoint: 웹 runtime은 Selenium을 실행하지 않고 local Worker durable job만 등록한다. */
export async function POST(request: NextRequest) {
  try {
    await checkPermission("journal:write");
    const { targets } = await request.json();
    if (!Array.isArray(targets) || targets.length === 0) {
      return NextResponse.json({ error: "대상 업체가 없습니다." }, { status: 400 });
    }
    const jobId = await enqueueSerializedK2BUpload(createAdminClient(), { targets });
    return NextResponse.json({ jobId, message: "K2B 업로드를 로컬 작업 대기열에 등록했습니다." }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "K2B 업로드 등록 실패";
    return NextResponse.json({ error: message }, { status: message.includes("ALREADY_ACTIVE") ? 409 : 500 });
  }
}
