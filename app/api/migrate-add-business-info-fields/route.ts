/**
 * 사업장정보 테이블에 누락된 필드 추가 마이그레이션 API
 * POST /api/migrate-add-business-info-fields
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readFileSync } from "fs";
import { join } from "path";
import { checkPermission } from "@/lib/auth/check-permission";

export async function POST() {
  try {
    // 권한 체크
    await checkPermission("system:settings");

    const supabase = await createClient();

    // 마이그레이션 SQL 파일 읽기
    const migrationPath = join(process.cwd(), "lib/db/migrations/004_add_missing_business_info_fields.sql");
    const migrationSQL = readFileSync(migrationPath, "utf-8");

    // SQL 문을 세미콜론으로 분리하여 실행
    const statements = migrationSQL
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("--"));

    const results = [];

    for (const statement of statements) {
      try {
        const { error } = await supabase.rpc("exec_sql", { sql_query: statement });
        
        if (error) {
          // RPC가 없는 경우 직접 쿼리 실행 시도
          // Supabase는 직접 SQL 실행을 지원하지 않으므로, 각 ALTER TABLE을 개별적으로 실행
          // 하지만 이는 Supabase의 제한사항이므로, 사용자에게 SQL Editor에서 직접 실행하도록 안내
          results.push({
            statement: statement.substring(0, 100) + "...",
            success: false,
            error: error.message,
            note: "Supabase에서는 직접 SQL 실행이 제한됩니다. Supabase SQL Editor에서 직접 실행해주세요.",
          });
        } else {
          results.push({
            statement: statement.substring(0, 100) + "...",
            success: true,
          });
        }
      } catch (err) {
        results.push({
          statement: statement.substring(0, 100) + "...",
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: "마이그레이션 실행 완료 (일부는 Supabase SQL Editor에서 직접 실행 필요)",
      results,
      migration_sql: migrationSQL,
      instruction: "Supabase Dashboard > SQL Editor에서 위의 migration_sql을 복사하여 실행해주세요.",
    });
  } catch (error) {
    console.error("마이그레이션 실행 오류:", error);

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
        error: "마이그레이션 실행 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
