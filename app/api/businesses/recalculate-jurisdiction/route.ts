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
    await checkPermission("system:settings");

    const supabase = await createClient();

    let updatedCount = 0;
    let skippedCount = 0;
    const errors: Array<{ id: string; error: string }> = [];
    const changes: Array<{ id: string; year: number; period: string; business_name: string; address: string; before: string; after: string }> = [];

    // 1. measurement_target_business (측정사업장) 처리
    const { data: targetBusinesses, error: targetError } = await supabase
      .from("measurement_target_business")
      .select("id, year, period, business_name, address, office_jurisdiction")
      .not("address", "is", null)
      .neq("address", "");

    if (targetError) throw targetError;

    for (const biz of (targetBusinesses || [])) {
      try {
        const newOffice = findOfficeByAddress(biz.address);
        if (newOffice && biz.office_jurisdiction !== newOffice) {
          const { error: updateError } = await supabase.from("measurement_target_business").update({ office_jurisdiction: newOffice }).eq("id", biz.id);
          if (updateError) throw updateError;

          changes.push({
            id: biz.id,
            year: biz.year || 0,
            period: biz.period || "",
            business_name: `[사업장] ${biz.business_name || "(없음)"}`,
            address: biz.address,
            before: biz.office_jurisdiction || "(없음)",
            after: newOffice,
          });
          updatedCount++;
        } else {
          skippedCount++;
        }
      } catch (err: any) {
        errors.push({ id: biz.id, error: err.message });
      }
    }

    // 2. measurement_journal (측정일지) 처리
    const { data: journals, error: journalError } = await supabase
      .from("measurement_journal")
      .select("id, measurement_year, measurement_period, business_name, address, office_jurisdiction")
      .not("address", "is", null)
      .neq("address", "");

    if (journalError) throw journalError;

    for (const journal of (journals || [])) {
      try {
        const newOffice = findOfficeByAddress(journal.address);
        if (newOffice && journal.office_jurisdiction !== newOffice) {
          const { error: updateError } = await supabase.from("measurement_journal").update({ office_jurisdiction: newOffice }).eq("id", journal.id);
          if (updateError) throw updateError;

          changes.push({
            id: journal.id,
            year: journal.measurement_year || 0,
            period: journal.measurement_period || "",
            business_name: `[일지] ${journal.business_name || "(없음)"}`,
            address: journal.address,
            before: journal.office_jurisdiction || "(없음)",
            after: newOffice,
          });
          updatedCount++;
        } else {
          skippedCount++;
        }
      } catch (err: any) {
        errors.push({ id: journal.id, error: err.message });
      }
    }

    return NextResponse.json({
      message: `관할청 재계산 완료`,
      total: updatedCount + skippedCount,
      updated: updatedCount,
      skipped: skippedCount,
      errorCount: errors.length,
      changes: changes.slice(0, 100),
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
