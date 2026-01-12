import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import fs from "fs";
import path from "path";

/**
 * other_revenue 테이블 생성 마이그레이션 실행 API
 * GET /api/migrate-other-revenue
 */
export async function GET() {
  try {
    // 권한 체크 (관리자만 실행 가능)
    await checkPermission("system:settings");

    const supabase = await createClient();

    // SQL 파일 읽기
    const sqlPath = path.join(process.cwd(), "lib/db/migrations/005_create_other_revenue_table.sql");
    
    if (!fs.existsSync(sqlPath)) {
      return NextResponse.json(
        { success: false, error: "마이그레이션 파일을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const sql = fs.readFileSync(sqlPath, "utf-8");

    // SQL을 세미콜론으로 분리하여 각 문장 실행
    const statements = sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("--"));

    const results = [];

    for (const statement of statements) {
      if (!statement) continue;
      
      try {
        // Supabase는 직접 SQL 실행을 지원하지 않으므로
        // RPC 함수를 사용하거나, Supabase SQL Editor를 사용해야 합니다.
        // 여기서는 에러 메시지를 반환하고 수동 실행을 안내합니다.
        
        // 대신 테이블 존재 여부만 확인
        const { data: tableExists, error: checkError } = await supabase
          .from("other_revenue")
          .select("id")
          .limit(1);

        if (!checkError || checkError.code !== "42P01") {
          // 테이블이 이미 존재함
          return NextResponse.json({
            success: true,
            message: "other_revenue 테이블이 이미 존재합니다.",
          });
        }
      } catch (err) {
        // 테이블이 없으면 계속 진행
      }
    }

    return NextResponse.json({
      success: false,
      message: "Supabase는 직접 SQL 실행을 지원하지 않습니다.",
      instruction: "다음 단계를 따라주세요:",
      steps: [
        "1. Supabase 대시보드에 접속하세요",
        "2. SQL Editor를 열어주세요",
        "3. lib/db/migrations/005_create_other_revenue_table.sql 파일의 내용을 복사하여 붙여넣으세요",
        "4. Run 버튼을 클릭하여 실행하세요",
      ],
      sql: sql,
    });
  } catch (error: any) {
    console.error("마이그레이션 확인 오류:", error);
    
    // 권한 오류인 경우
    if (error.message?.includes("Forbidden") || error.message?.includes("권한")) {
      return NextResponse.json(
        {
          success: false,
          error: "권한이 없습니다.",
          instruction: "Supabase SQL Editor에서 직접 실행해주세요.",
        },
        { status: 403 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error.message || "마이그레이션 확인 중 오류가 발생했습니다.",
        instruction: "Supabase SQL Editor에서 직접 실행해주세요.",
      },
      { status: 500 }
    );
  }
}
