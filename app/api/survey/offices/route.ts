import { NextRequest, NextResponse } from "next/server";
export const dynamic = 'force-dynamic';
import { checkPermission } from "@/lib/auth/check-permission";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * 소재지 관할청 목록 조회 API
 * GET: CSV 파일에서 소재지 관할청 목록 조회
 */
export async function GET(request: NextRequest) {
  try {
    // 권한 체크
    await checkPermission("survey:read");

    try {
      const csvPath = join(process.cwd(), "노동지청별 관할지역.csv");
      const csvContent = readFileSync(csvPath, "utf-8");
      const lines = csvContent.split("\n").filter((line) => line.trim());

      const offices = new Set<string>();

      // 첫 번째 줄은 헤더이므로 건너뜀
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // CSV 파싱 (쉼표로 분리, 따옴표 처리)
        const parts: string[] = [];
        let currentPart = "";
        let inQuotes = false;

        for (let j = 0; j < line.length; j++) {
          const char = line[j];
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === "," && !inQuotes) {
            parts.push(currentPart.trim());
            currentPart = "";
          } else {
            currentPart += char;
          }
        }
        parts.push(currentPart.trim());

        if (parts.length >= 1 && parts[0]) {
          const office = parts[0].trim();
          if (office) {
            offices.add(office);
          }
        }
      }

      const officeList = Array.from(offices).sort();

      return NextResponse.json({ offices: officeList });
    } catch (error) {
      console.error("CSV 파일 읽기 오류:", error);
      // CSV 파일을 읽을 수 없으면 기본 목록 반환
      return NextResponse.json({
        offices: [
          "대전지방고용노동청",
          "대전지방고용노동청 천안지청",
          "중부지방고용노동청",
          "중부지방고용노동청 평택지청",
          "중부지방고용노동청 경기지청",
        ],
      });
    }
  } catch (error) {
    console.error("소재지 관할청 목록 API 오류:", error);

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
        error: "소재지 관할청 목록 조회 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
