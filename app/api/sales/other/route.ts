import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getUser } from "@/lib/auth/get-user";

/**
 * 기타 매출 CRUD API
 * POST: 기타 매출 등록
 * GET: 기타 매출 조회
 */
export async function POST(request: NextRequest) {
  try {
    await checkPermission("sales:write");
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const body = await request.json();
    const {
      item_name,
      invoice_date,
      supply_amount,
      vat_amount,
      total_amount,
      deposit_date,
      deposit_amount,
      notes,
      revenue_year,
      revenue_period,
    } = body;

    // 필수 필드 검증
    if (!item_name || !item_name.trim()) {
      return NextResponse.json(
        { error: "품명은 필수입니다." },
        { status: 400 }
      );
    }

    if (!total_amount || total_amount <= 0) {
      return NextResponse.json(
        { error: "합계금액은 0보다 큰 값이어야 합니다." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // 숫자 타입 변환 (이미 숫자일 수도 있고 문자열일 수도 있음)
    const insertData: any = {
      item_name,
      invoice_date: invoice_date || null,
      supply_amount: supply_amount !== null && supply_amount !== undefined
        ? (typeof supply_amount === 'number' ? supply_amount : parseFloat(supply_amount.toString()))
        : null,
      vat_amount: vat_amount !== null && vat_amount !== undefined
        ? (typeof vat_amount === 'number' ? vat_amount : parseFloat(vat_amount.toString()))
        : null,
      total_amount: typeof total_amount === 'number' ? total_amount : parseFloat(total_amount.toString()),
      deposit_date: deposit_date || null,
      deposit_amount: deposit_amount !== null && deposit_amount !== undefined
        ? (typeof deposit_amount === 'number' ? deposit_amount : parseFloat(deposit_amount.toString()))
        : null,
      notes: notes || null,
      revenue_year: revenue_year !== null && revenue_year !== undefined
        ? (typeof revenue_year === 'number' ? revenue_year : parseInt(revenue_year.toString()))
        : null,
      revenue_period: revenue_period || null,
      created_by: user.name || user.id,
      updated_by: user.name || user.id,
    };

    console.log("기타 매출 등록 데이터:", insertData);

    const { data, error } = await supabase
      .from("other_revenue")
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error("기타 매출 등록 오류:", error);
      return NextResponse.json(
        { error: "기타 매출을 등록하는 중 오류가 발생했습니다.", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error("기타 매출 등록 오류:", error);
    return NextResponse.json(
      { error: error.message || "기타 매출을 등록하는 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    await checkPermission("sales:read");

    const { searchParams } = new URL(request.url);
    const year = searchParams.get("year")?.trim() || null;
    const period = searchParams.get("period")?.trim() || null;
    const office = searchParams.get("office")?.trim() || null;

    const supabase = await createClient();
    let query = supabase.from("other_revenue").select("*").order("created_at", { ascending: false });

    if (year) {
      query = query.eq("revenue_year", parseInt(year));
    }
    if (period) {
      query = query.eq("revenue_period", period);
    }
    if (office) {
      query = query.eq("designated_office", office);
    }

    const { data, error } = await query;

    if (error) {
      console.error("기타 매출 조회 오류:", error);
      return NextResponse.json(
        { error: "기타 매출을 조회하는 중 오류가 발생했습니다.", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error: any) {
    console.error("기타 매출 조회 오류:", error);
    return NextResponse.json(
      { error: error.message || "기타 매출을 조회하는 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
