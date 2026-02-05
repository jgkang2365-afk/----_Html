import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";

type RevenueData = {
  measurement_fee_business: number | null;
  deposit_amount_business: number | null;
  deposit_amount_business_2: number | null;
  measurement_fee_national: number | null;
  deposit_amount_national: number | null;
};

/**
 * 사업장명으로 측정비(사업장) 기준 미수금 횟수 확인 API
 * GET /api/sales/check-unpaid?businessName=사업장명
 */
export async function GET(request: NextRequest) {
  try {
    // 권한 체크
    await checkPermission("dashboard:read");

    const { searchParams } = new URL(request.url);
    const businessName = searchParams.get("businessName");

    if (!businessName) {
      return NextResponse.json(
        { error: "사업장명이 필요합니다." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // measurement_journal 테이블에서 해당 사업장의 측정비 데이터 조회
    const { data: revenueData, error } = await supabase
      .from("measurement_journal")
      .select("measurement_fee_business, deposit_amount_business, deposit_amount_business_2, measurement_fee_national, deposit_amount_national")
      .eq("business_name", businessName)
      .returns<RevenueData[]>();

    if (error) {
      console.error("매출 데이터 조회 오류:", error);
      return NextResponse.json(
        { error: "매출 데이터를 조회하는 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    // 미수금 횟수 및 금액 계산
    let businessUnpaidCount = 0;
    let businessUnpaidAmount = 0;
    let nationalUnpaidCount = 0;
    let nationalUnpaidAmount = 0;

    if (revenueData) {
      revenueData.forEach((item) => {
        // 사업장 미수 계산
        const businessFee = item.measurement_fee_business || 0;
        const businessDeposit = item.deposit_amount_business || 0;
        const businessDeposit2 = item.deposit_amount_business_2 || 0;
        const businessUnpaid = businessFee - (businessDeposit + businessDeposit2);

        if (businessUnpaid > 0) {
          businessUnpaidCount++;
          businessUnpaidAmount += businessUnpaid;
        }

        // 국고 미수 계산
        const nationalFee = item.measurement_fee_national || 0;
        const nationalDeposit = item.deposit_amount_national || 0;
        const nationalUnpaid = nationalFee - nationalDeposit;

        if (nationalUnpaid > 0) {
          nationalUnpaidCount++;
          nationalUnpaidAmount += nationalUnpaid;
        }
      });
    }

    return NextResponse.json({
      businessName,
      businessUnpaidCount,
      businessUnpaidAmount,
      nationalUnpaidCount,
      nationalUnpaidAmount,
      hasWarning: businessUnpaidCount > 0 || nationalUnpaidCount > 0,
    });
  } catch (error) {
    console.error("미수금 확인 API 오류:", error);

    if (error instanceof Error) {
      if (error.message.includes("Unauthorized")) {
        return NextResponse.json(
          { error: "로그인이 필요합니다." },
          { status: 401 }
        );
      }
      if (error.message.includes("Forbidden")) {
        return NextResponse.json(
          { error: "권한이 없습니다." },
          { status: 403 }
        );
      }
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "미수금 확인 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}
