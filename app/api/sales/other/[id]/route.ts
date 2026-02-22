import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getUser } from "@/lib/auth/get-user";

/**
 * 기타 매출 수정/삭제 API
 * PATCH: 기타 매출 수정
 * DELETE: 기타 매출 삭제
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await checkPermission("sales:write");
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const id = parseInt(params.id);
    if (isNaN(id)) {
      return NextResponse.json({ error: "유효하지 않은 ID입니다." }, { status: 400 });
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

    const supabase = await createClient();

    const updateData: any = {
      updated_by: user.name || user.id,
      updated_at: new Date().toISOString(),
    };

    if (item_name !== undefined) updateData.item_name = item_name;
    if (invoice_date !== undefined) updateData.invoice_date = invoice_date || null;
    if (supply_amount !== undefined) {
      updateData.supply_amount = supply_amount !== null && supply_amount !== undefined
        ? parseFloat(supply_amount.toString())
        : null;
    }
    if (vat_amount !== undefined) {
      updateData.vat_amount = vat_amount !== null && vat_amount !== undefined
        ? parseFloat(vat_amount.toString())
        : null;
    }
    if (total_amount !== undefined) {
      updateData.total_amount = parseFloat(total_amount.toString());
    }
    if (deposit_date !== undefined) updateData.deposit_date = deposit_date || null;
    if (deposit_amount !== undefined) {
      updateData.deposit_amount = deposit_amount !== null && deposit_amount !== undefined
        ? parseFloat(deposit_amount.toString())
        : null;
    }
    if (notes !== undefined) updateData.notes = notes || null;
    if (revenue_year !== undefined) {
      updateData.revenue_year = revenue_year !== null && revenue_year !== undefined
        ? parseInt(revenue_year.toString())
        : null;
    }
    if (revenue_period !== undefined) updateData.revenue_period = revenue_period || null;

    const { data, error } = await supabase
      .from("other_revenue")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("기타 매출 수정 오류:", error);
      return NextResponse.json(
        { error: "기타 매출을 수정하는 중 오류가 발생했습니다.", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error("기타 매출 수정 오류:", error);
    return NextResponse.json(
      { error: error.message || "기타 매출을 수정하는 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await checkPermission("sales:write");
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const id = parseInt(params.id);
    if (isNaN(id)) {
      return NextResponse.json({ error: "유효하지 않은 ID입니다." }, { status: 400 });
    }

    const supabase = await createClient();

    const { error } = await supabase.from("other_revenue").delete().eq("id", id);

    if (error) {
      console.error("기타 매출 삭제 오류:", error);
      return NextResponse.json(
        { error: "기타 매출을 삭제하는 중 오류가 발생했습니다.", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("기타 매출 삭제 API 오류:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        error: "기타 매출을 삭제하는 중 오류가 발생했습니다.",
        details: errorMessage,
        success: false
      },
      { status: 500 }
    );
  }
}
