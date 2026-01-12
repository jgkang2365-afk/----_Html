/**
 * 최초 비밀번호 설정 필요 여부 확인 API
 * GET /api/auth/check-initial-setup?name=사용자이름
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get("name");

    if (!name) {
      return NextResponse.json(
        { error: "이름을 입력해주세요." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // 사용자 조회
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, name, password_hash")
      .eq("name", name)
      .single();

    if (userError || !user) {
      return NextResponse.json({ needsSetup: false });
    }

    // 비밀번호가 설정되어 있지 않으면 최초 설정 필요
    return NextResponse.json({
      needsSetup: !user.password_hash,
      userName: user.name,
    });
  } catch (error) {
    console.error("Check initial setup error:", error);
    return NextResponse.json({ needsSetup: false });
  }
}
