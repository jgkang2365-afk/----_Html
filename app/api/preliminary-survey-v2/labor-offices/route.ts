import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { createClient } from "@/lib/supabase/server";
import { lookupLaborOffices } from "@/lib/labor-offices/lookup";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await checkPermission("survey:read");
    const query = new URL(request.url).searchParams.get("query")?.trim() ?? "";
    if (!query) return NextResponse.json({ status: "unmatched", results: [] });
    const supabase = await createClient();
    const [officeResult, aliasResult] = await Promise.all([
      supabase.from("labor_offices")
        .select("office_code, current_official_name, current_short_name, jurisdiction_reference, phone, fax, is_active")
        .eq("is_active", true),
      supabase.from("labor_office_aliases")
        .select("office_code, business_office_name, document_office_name, mapping_note, is_active")
        .eq("is_active", true),
    ]);
    if (officeResult.error || aliasResult.error) throw officeResult.error || aliasResult.error;
    const lookup = lookupLaborOffices(query, {
      offices: (officeResult.data ?? []) as any,
      aliases: (aliasResult.data ?? []) as any,
    });
    return NextResponse.json({
      status: lookup.status,
      results: lookup.candidates.map((office) => ({
        officeCode: office.office_code,
        officeName: office.current_official_name || office.current_short_name || "-",
        jurisdictionReference: office.jurisdiction_reference || "-",
        phone: office.phone || "-",
        fax: office.fax || "-",
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "노동관서 조회 실패";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
