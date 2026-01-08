import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/db/supabase";
import fs from "fs";
import path from "path";

/**
 * 데이터베이스 마이그레이션 실행 API
 * GET /api/migrate
 * 
 * 주의: 프로덕션 환경에서는 이 API를 비활성화하세요!
 */
export async function GET() {
  // 개발 환경에서만 실행 가능
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { success: false, message: "프로덕션 환경에서는 마이그레이션을 실행할 수 없습니다." },
      { status: 403 }
    );
  }

  try {
    const supabase = createServerClient();
    
    // SQL 파일 읽기
    const sqlPath = path.join(process.cwd(), "lib/db/migrations/001_initial_schema.sql");
    const sql = fs.readFileSync(sqlPath, "utf-8");
    
    // SQL을 세미콜론으로 분리하여 각 문장 실행
    const statements = sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("--"));
    
    const results = [];
    
    for (const statement of statements) {
      try {
        // Supabase는 직접 SQL 실행을 지원하지 않으므로
        // 이 방법은 작동하지 않을 수 있습니다.
        // 대신 Supabase SQL Editor를 사용하세요.
        const { data, error } = await supabase.rpc("exec_sql", { sql_query: statement });
        
        if (error) {
          results.push({ statement: statement.substring(0, 50) + "...", error: error.message });
        } else {
          results.push({ statement: statement.substring(0, 50) + "...", success: true });
        }
      } catch (err) {
        results.push({
          statement: statement.substring(0, 50) + "...",
          error: err instanceof Error ? err.message : "알 수 없는 오류",
        });
      }
    }
    
    return NextResponse.json({
      success: true,
      message: "마이그레이션 실행 완료 (Supabase SQL Editor 사용을 권장합니다)",
      results,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: `마이그레이션 실행 중 오류 발생: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
        note: "Supabase SQL Editor를 사용하여 lib/db/migrations/001_initial_schema.sql 파일을 직접 실행하세요.",
      },
      { status: 500 }
    );
  }
}

