import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveLaborOfficeByAddress } from "@/lib/labor-offices/address-resolver";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** 주소 입력 중 사용하는 읽기 전용 판정 API. DB write와 후속 동작을 수행하지 않는다. */
export async function GET(request: NextRequest) {
  try {
    await checkPermission("journal:read");
    const address = new URL(request.url).searchParams.get("address")?.trim() || "";
    if (!address) {
      return NextResponse.json(
        { error: "주소가 필요합니다." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const supabase = await createClient();
    const result = await resolveLaborOfficeByAddress(supabase, address);
    return NextResponse.json(
      {
        status: result.status,
        office_code: result.officeCode,
        office_jurisdiction: result.officeJurisdictionDisplay,
        designated_office: result.designatedOffice,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("노동관서 preview 오류:", error);
    return NextResponse.json(
      { error: "노동관서 판정 중 오류가 발생했습니다." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
