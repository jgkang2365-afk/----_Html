import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** DB-only server action; the Windows MES and Health workers never claim it. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data, error } = await createAdminClient().rpc("process_mes_post_sync_checks", { p_limit: 100 });
  if (error) return NextResponse.json({ error: "MES_POST_SYNC_DRAIN_FAILED" }, { status: 500 });
  return NextResponse.json({ processed: data }, { headers: { "Cache-Control": "no-store" } });
}
