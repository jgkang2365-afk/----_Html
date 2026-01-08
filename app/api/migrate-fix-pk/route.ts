/**
 * measurement_business 테이블 PRIMARY KEY 수정 마이그레이션
 * GET /api/migrate-fix-pk
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readFileSync } from "fs";
import { join } from "path";

export async function GET() {
  try {
    const supabase = await createClient();
    
    // 마이그레이션 SQL 파일 읽기
    const migrationPath = join(process.cwd(), "lib/db/migrations/002_fix_measurement_business_pk.sql");
    const migrationSQL = readFileSync(migrationPath, "utf-8");
    
    // SQL 문을 세미콜론으로 분리
    const statements = migrationSQL
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("--"));
    
    const results = [];
    
    for (const statement of statements) {
      try {
        const { error } = await supabase.rpc("exec_sql", {
          sql_query: statement,
        });
        
        if (error) {
          // exec_sql 함수가 없을 수 있으므로, 직접 SQL 실행 시도
          // Supabase에서는 직접 SQL 실행이 제한적이므로, 
          // Supabase SQL Editor에서 직접 실행하는 것을 권장
          results.push({
            statement: statement.substring(0, 50) + "...",
            error: error.message,
            note: "Supabase SQL Editor에서 직접 실행하세요",
          });
        } else {
          results.push({
            statement: statement.substring(0, 50) + "...",
            success: true,
          });
        }
      } catch (err) {
        results.push({
          statement: statement.substring(0, 50) + "...",
          error: err instanceof Error ? err.message : String(err),
          note: "Supabase SQL Editor에서 직접 실행하세요",
        });
      }
    }
    
    return NextResponse.json({
      success: true,
      message: "마이그레이션 실행 완료 (Supabase SQL Editor 사용을 권장합니다)",
      results,
      manualSteps: [
        "1. Supabase 대시보드 → SQL Editor로 이동",
        "2. lib/db/migrations/002_fix_measurement_business_pk.sql 파일 내용을 복사",
        "3. SQL Editor에 붙여넣고 실행",
      ],
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: `마이그레이션 실행 중 오류 발생: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
        note: "Supabase SQL Editor를 사용하여 lib/db/migrations/002_fix_measurement_business_pk.sql 파일을 직접 실행하세요.",
      },
      { status: 500 }
    );
  }
}

