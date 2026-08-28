import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveLaborOfficeByAddress } from "@/lib/labor-offices/address-resolver";
import { createClient } from "@/lib/supabase/server";

/**
 * 주소를 기준으로 소재지 관할청과 지정한계_관할지청을 자동으로 결정하는 API
 * POST /api/journal/auto-fill
 */
export async function POST(request: NextRequest) {
  try {
    await checkPermission("journal:read");
    const body = await request.json();
    const { address } = body;

    if (!address || typeof address !== "string") {
      return NextResponse.json(
        { error: "주소가 필요합니다." },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const result = await resolveLaborOfficeByAddress(supabase, address);

    return NextResponse.json({
      status: result.status,
      office_code: result.officeCode,
      office_jurisdiction: result.officeJurisdictionPersistence,
      office_jurisdiction_display: result.officeJurisdictionDisplay,
      designated_office: result.designatedOffice,
    });
  } catch (error) {
    console.error("자동 입력 API 오류:", error);
    return NextResponse.json(
      {
        error: "자동 입력 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
