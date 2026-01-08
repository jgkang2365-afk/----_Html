import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * measurement_business 테이블에 담당자 정보 필드 추가 마이그레이션
 * POST /api/migrate-add-manager-fields
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // 마이그레이션 SQL 파일 읽기
    const migrationPath = join(process.cwd(), "lib/db/migrations/003_add_manager_fields_to_measurement_business.sql");
    const migrationSQL = readFileSync(migrationPath, "utf-8");

    // SQL 실행 (각 문장별로 실행)
    const statements = migrationSQL
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("--"));

    for (const statement of statements) {
      const { error } = await supabase.rpc("exec_sql", { sql: statement });
      if (error) {
        // RPC가 없을 수 있으므로 직접 쿼리 실행
        // Supabase는 직접 SQL 실행을 지원하지 않으므로, 각 ALTER 문을 개별적으로 실행
        console.log("RPC 실행 실패, 직접 실행 시도:", error);
      }
    }

    // Supabase는 직접 SQL 실행을 지원하지 않으므로, 
    // Supabase SQL Editor에서 직접 실행하도록 안내
    return NextResponse.json({
      success: true,
      message: "마이그레이션 SQL을 Supabase SQL Editor에서 직접 실행해주세요.",
      sql: migrationSQL,
    });
  } catch (error) {
    console.error("마이그레이션 오류:", error);
    return NextResponse.json(
      {
        success: false,
        error: "마이그레이션 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
