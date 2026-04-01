import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";

export async function GET(request: NextRequest) {
    try {
        const session = await getSession();
        if (!session) {
            return NextResponse.json({ error: "인증되지 않은 사용자입니다." }, { status: 401 });
        }

        const supabase = await createClient();
        
        // is_shared = true 이거나 (user_id = 현재사용자) 인 건들만 조회
        const { data, error } = await supabase
            .from("quota_memos")
            .select("*")
            .or(`is_shared.eq.true,user_id.eq.${session.userId}`)
            .order("created_at", { ascending: false });

        if (error) throw error;

        return NextResponse.json({ success: true, data: data || [] });
    } catch (error: any) {
        console.error("메모 조회 오류:", error);
        return NextResponse.json(
            { error: error.message || "메모를 불러오는 중 오류가 발생했습니다." },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        const session = await getSession();
        if (!session) {
            return NextResponse.json({ error: "인증되지 않은 사용자입니다." }, { status: 401 });
        }

        const body = await request.json();
        const { content, is_shared } = body;

        if (!content) {
            return NextResponse.json({ error: "내용을 입력해주세요." }, { status: 400 });
        }

        const supabase = await createClient();

        const { data, error } = await supabase
            .from("quota_memos")
            .insert({
                content,
                is_shared: is_shared !== undefined ? is_shared : true,
                user_id: session.userId,
                user_name: session.name,
            })
            .select()
            .single();

        if (error) throw error;

        return NextResponse.json({ success: true, data });
    } catch (error: any) {
        console.error("메모 등록 오류:", error);
        return NextResponse.json(
            { error: error.message || "메모 등록 중 오류가 발생했습니다." },
            { status: 500 }
        );
    }
}

export async function PUT(request: NextRequest) {
    try {
        const session = await getSession();
        if (!session) {
            return NextResponse.json({ error: "인증되지 않은 사용자입니다." }, { status: 401 });
        }

        const body = await request.json();
        const { id, content, is_shared } = body;

        if (!id || !content) {
            return NextResponse.json({ error: "필수 정보가 누락되었습니다." }, { status: 400 });
        }

        const supabase = await createClient();
        const isAdmin = session.role === "관리자";

        // 쿼리 빌드
        let query = supabase
            .from("quota_memos")
            .update({
                content,
                is_shared,
                updated_at: new Date().toISOString()
            })
            .eq("id", id);
        
        // 관리자가 아니면 본인 글만 수정 가능
        if (!isAdmin) {
            query = query.eq("user_id", session.userId);
        }

        const { data, error } = await query.select().single();

        if (error) throw error;

        return NextResponse.json({ success: true, data });
    } catch (error: any) {
        console.error("메모 수정 오류:", error);
        return NextResponse.json(
            { error: error.message || "메모 수정 중 오류가 발생했습니다." },
            { status: 500 }
        );
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const session = await getSession();
        if (!session) {
            return NextResponse.json({ error: "인증되지 않은 사용자입니다." }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const id = searchParams.get("id");

        if (!id) {
            return NextResponse.json({ error: "메모 ID가 누락되었습니다." }, { status: 400 });
        }

        const supabase = await createClient();
        const isAdmin = session.role === "관리자";

        // 쿼리 빌드
        let query = supabase
            .from("quota_memos")
            .delete()
            .eq("id", id);
        
        // 관리자가 아니면 본인 글만 삭제 가능
        if (!isAdmin) {
            query = query.eq("user_id", session.userId);
        }

        const { error } = await query;

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error("메모 삭제 오류:", error);
        return NextResponse.json(
            { error: error.message || "메모 삭제 중 오류가 발생했습니다." },
            { status: 500 }
        );
    }
}
