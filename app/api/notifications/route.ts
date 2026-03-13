/**
 * 알림 목록 조회 API
 * GET /api/notifications
 * PATCH /api/notifications: 알림 읽음 처리
 */

import { NextRequest, NextResponse } from "next/server";
export const dynamic = 'force-dynamic';

import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";

/**
 * 알림 목록 조회
 * GET /api/notifications
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const supabase = await createClient();

    const { data: notifications, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", session.userId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json(
        { error: "알림을 불러오는 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({ notifications: notifications || [] });
  } catch (error) {
    console.error("Get notifications error:", error);
    return NextResponse.json(
      { error: "알림을 불러오는 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

/**
 * 알림 읽음 처리
 * PATCH /api/notifications
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const body = await request.json();
    const { id, all } = body;

    const supabase = await createClient();

    let query = supabase.from("notifications").update({ is_read: true });

    if (all) {
      query = query.eq("user_id", session.userId).eq("is_read", false);
    } else if (id) {
      query = query.eq("id", id).eq("user_id", session.userId);
    } else {
      return NextResponse.json({ error: "식별자가 필요합니다." }, { status: 400 });
    }

    const { error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Patch notification error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
