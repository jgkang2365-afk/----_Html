import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { inspectMeasurementTargetIntegrity } from "@/lib/measurement-target-integrity";
import { loadLaborOfficeDirectory } from "@/lib/labor-offices/address-resolver";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** 읽기 전용 진단. 기존 sync/verification 저장 경로와 독립적이다. */
export async function GET(request: NextRequest) {
  try {
    await checkPermission("journal:read");
    const { searchParams } = new URL(request.url);
    const year = Number(searchParams.get("year"));
    const period = String(searchParams.get("period") ?? "").trim();
    if (!Number.isInteger(year) || !period) {
      return NextResponse.json({ error: "측정년도와 측정주기는 필수입니다." }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: targets, error: targetError } = await supabase
      .from("measurement_target_business")
      .select("code, business_name, business_number, address, office_jurisdiction, latitude, longitude, geocoding_status, geocoding_error, measurement_date, measurement_end_date, year, period, sync_status")
      .eq("year", year)
      .eq("period", period)
      .order("code", { ascending: true });
    if (targetError) throw targetError;

    const codes = (targets || []).map((row: any) => row.code).filter(Boolean);
    const [infoResult, journalResult, laborOfficeDirectory] = await Promise.all([
      codes.length
        ? supabase.from("business_info").select("code, business_name, business_number, address1, address2, latitude, longitude, geocoded_address, geocoded_source_address, geocoding_status, geocoding_error, geocoded_at, geocode_provider, coordinate_locked").in("code", codes)
        : Promise.resolve({ data: [], error: null }),
      codes.length
        ? supabase.from("measurement_journal").select("code, measurement_year, measurement_period").in("code", codes)
        : Promise.resolve({ data: [], error: null }),
      loadLaborOfficeDirectory(supabase),
    ]);
    if (infoResult.error) throw infoResult.error;
    if (journalResult.error) throw journalResult.error;

    const issues = inspectMeasurementTargetIntegrity({
      targets: targets || [],
      businessInfos: infoResult.data || [],
      journals: journalResult.data || [],
      laborOfficeDirectory,
    });
    return NextResponse.json({ issues, count: issues.length }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "정합성 점검에 실패했습니다.";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
