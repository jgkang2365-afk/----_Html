import { NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getMeasurementIntegrityOrchestrationTraceWithCurrentState } from "@/lib/measurement-integrity-orchestration-trace";

export const dynamic = "force-dynamic";

/** Git으로 versioning되는 K2B orchestration 근거를 읽기 전용으로 제공한다. */
export async function GET() {
  try {
    await checkPermission("journal:read");
    return NextResponse.json(await getMeasurementIntegrityOrchestrationTraceWithCurrentState(), {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "오케스트레이션 이력을 불러오지 못했습니다.";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
