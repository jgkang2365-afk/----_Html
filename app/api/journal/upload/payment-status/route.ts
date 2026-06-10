import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    // 일지 담당자 권한 확인
    if (!user.is_journal_manager) {
      return NextResponse.json({ error: "권한이 없습니다. 일지 담당자만 가능합니다." }, { status: 403 });
    }

    const supabase = await createClient();

    const body = await req.json();
    const { 
      measurement_year, 
      measurement_period, 
      industrial_accident_number, 
      deposit_date_national, 
      deposit_amount_national 
    } = body;

    // 1. 필수 값 확인
    if (!measurement_year || !measurement_period || !industrial_accident_number || !deposit_date_national || deposit_amount_national === undefined) {
      return NextResponse.json({ error: "필수 정보가 누락되었습니다." }, { status: 400 });
    }

    // 2. 해당 데이터 조회 (5개 항목 매칭용)
    const { data: journals, error: fetchError } = await supabase
      .from("measurement_journal")
      .select("id, measurement_fee_national, national_support_status, deposit_amount_business, deposit_amount_business_2")
      .eq("measurement_year", measurement_year)
      .eq("measurement_period", measurement_period)
      .eq("industrial_accident_number", industrial_accident_number);

    if (fetchError) {
      return NextResponse.json({ error: "데이터 조회 중 오류가 발생했습니다." }, { status: 500 });
    }

    if (!journals || journals.length === 0) {
      return NextResponse.json({ error: "일치하는 측정일지 데이터를 찾을 수 없습니다." }, { status: 404 });
    }

    if (journals.length > 1) {
      return NextResponse.json({ error: "중복된 데이터가 존재합니다. 산재관리번호를 확인해주세요." }, { status: 400 });
    }

    const journal = journals[0];

    // 3. 국고지원 대상 여부 확인
    if (journal.national_support_status !== "대상" && journal.national_support_status !== "지원") {
      return NextResponse.json({ error: `국고지원 대상이 아닙니다. (현재 상태: ${journal.national_support_status || "없음"})` }, { status: 400 });
    }

    // 4. 금액 일치 여부 확인 (가장 중요)
    const dbFee = Number(journal.measurement_fee_national || 0);
    const excelFee = Number(deposit_amount_national);

    if (dbFee !== excelFee) {
      return NextResponse.json({ 
        error: `금액이 일치하지 않습니다. (DB: ${dbFee.toLocaleString()}원 vs 엑셀: ${excelFee.toLocaleString()}원)` 
      }, { status: 400 });
    }

    // 5. 업데이트 수행
    const biz1 = Number(journal.deposit_amount_business || 0);
    const biz2 = Number(journal.deposit_amount_business_2 || 0);
    const newTotal = biz1 + biz2 + excelFee;

    const { error: updateError } = await supabase
      .from("measurement_journal")
      .update({
        deposit_date_national,
        deposit_amount_national: excelFee,
        deposit_total: newTotal,
        updated_at: new Date().toISOString(),
        updated_by: user.name
      })
      .eq("id", journal.id);

    if (updateError) {
      return NextResponse.json({ error: "데이터 업데이트 중 오류가 발생했습니다." }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "정산 완료", id: journal.id });

  } catch (err: any) {
    console.error("Payment status upload API error:", err);
    return NextResponse.json({ error: "서버 내부 오류가 발생했습니다." }, { status: 500 });
  }
}
