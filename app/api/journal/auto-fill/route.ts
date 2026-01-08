import { NextRequest, NextResponse } from "next/server";
import {
  findOfficeByAddress,
  classifyDesignatedOffice,
  getDesignatedOfficeByAddress,
} from "@/lib/utils/jurisdiction-matcher";

/**
 * 주소를 기준으로 소재지 관할청과 지정한계_관할지청을 자동으로 결정하는 API
 * POST /api/journal/auto-fill
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address } = body;

    if (!address || typeof address !== "string") {
      return NextResponse.json(
        { error: "주소가 필요합니다." },
        { status: 400 }
      );
    }

    // 소재지 관할청 찾기
    const officeJurisdiction = findOfficeByAddress(address);

    // 지정한계_관할지청 자동 분류
    const designatedOffice = getDesignatedOfficeByAddress(address);

    return NextResponse.json({
      office_jurisdiction: officeJurisdiction,
      designated_office: designatedOffice,
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
