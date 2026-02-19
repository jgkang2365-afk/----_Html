/**
 * Vercel Cron Jobs를 위한 Excel 동기화 엔드포인트
 * 일일 2회 실행 (오전 9시, 오후 6시)
 * 
 * Vercel Cron Jobs 설정 (vercel.json):
 * {
 *   "crons": [
 *     {
 *       "path": "/api/cron/sync",
 *       "schedule": "0 9,18 * * *"
 *     }
 *   ]
 * }
 */

import { NextRequest, NextResponse } from "next/server";
export const dynamic = 'force-dynamic';
import { syncAllFiles } from "@/lib/sync/excel-sync";
import { headers } from "next/headers";

/**
 * Vercel Cron Jobs에서 호출하는 엔드포인트
 * Authorization 헤더로 보호
 */
export async function GET(request: Request) {
  try {
    // Vercel Cron Jobs는 Authorization 헤더를 통해 보호됩니다
    const authHeader = headers().get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 모든 Excel 파일 동기화
    const results = await syncAllFiles();

    const hasError = results.some((r) => !r.success);

    return NextResponse.json(
      {
        success: !hasError,
        results,
        timestamp: new Date().toISOString(),
      },
      { status: hasError ? 500 : 200 }
    );
  } catch (error) {
    console.error("Cron 동기화 오류:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "동기화 중 오류가 발생했습니다.",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

