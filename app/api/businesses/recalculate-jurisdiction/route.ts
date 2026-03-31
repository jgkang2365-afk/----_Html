import { NextRequest, NextResponse } from "next/server";
export const dynamic = 'force-dynamic';
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { findOfficeByAddress } from "@/lib/utils/jurisdiction-matcher";

/**
 * 기존 사업장 데이터의 office_jurisdiction을 주소 기반으로 일괄 재계산하는 API
 * POST /api/businesses/recalculate-jurisdiction
 */
export async function POST(request: NextRequest) {
  try {
    await checkPermission("survey:admin");

    const supabase = await createClient();

    // measurement_target_business 테이블에서 주소가 있는 모든 레코드 조회
    const { data: businesses, error: fetchError } = await supabase
      .from("measurement_target_business")
      .select("id, address, office_jurisdiction")
      .not("address", "is", null)
      .neq("address", "");

    if (fetchError) {
      return NextResponse.json(
        { error: "데이터 조회 실패", details: fetchError.message },
        { status: 500 }
      );
    }

    if (!businesses || businesses.length === 0) {
      return NextResponse.json({ message: "업데이트할 레코드가 없습니다.", updated: 0 });
    }

    let updatedCount = 0;
    let skippedCount = 0;
    const errors: Array<{ id: string; error: string }> = [];
    const changes: Array<{ id: string; address: string; before: string; after: string }> = [];

    for (const biz of businesses) {
      const newOffice = findOfficeByAddress(biz.address);

      if (!newOffice) {
        skippedCount++;
        continue;
      }

      // 기존 값과 다를 때만 업데이트
      if (biz.office_jurisdiction !== newOffice) {
        const { error: updateError } = await supabase
          .from("measurement_target_business")
          .update({ office_jurisdiction: newOffice })
          .eq("id", biz.id);

        if (updateError) {
          errors.push({ id: biz.id, error: updateError.message });
        } else {
          changes.push({
            id: biz.id,
            address: biz.address,
            before: biz.office_jurisdiction || "(없음)",
            after: newOffice,
          });
          updatedCount++;
        }
      } else {
        skippedCount++;
      }
    }

    return NextResponse.json({
      message: `관할청 재계산 완료`,
      total: businesses.length,
      updated: updatedCount,
      skipped: skippedCount,
      errorCount: errors.length,
      changes: changes.slice(0, 50),
      errors: errors.slice(0, 10),
    });
  } catch (error) {
    console.error("관할청 재계산 API 오류:", error);

    if (error instanceof Error) {
      if (error.message.includes("Unauthorized")) {
        return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
      }
      if (error.message.includes("Forbidden")) {
        return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
      }
    }

    return NextResponse.json(
      { error: "관할청 재계산 중 오류 발생", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
