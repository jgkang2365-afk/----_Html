import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { recommendAndPersistV2 } from "@/lib/preliminary-survey-v2/service";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (session.role !== "관리자") {
    return NextResponse.json({ error: "관리자만 V2 추천을 생성할 수 있습니다." }, { status: 403 });
  }
  try {
    const body = await request.json();
    const targetIds = Array.isArray(body.targetIds) ? body.targetIds.map(Number).filter(Number.isFinite) : [];
    if (!targetIds.length) return NextResponse.json({ error: "추천 대상이 없습니다." }, { status: 400 });
    const result = await recommendAndPersistV2(await createClient(), targetIds);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "V2_RECOMMENDATION_FAILED";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
