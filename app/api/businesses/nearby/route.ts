import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { createClient } from "@/lib/supabase/server";
import {
  isValidKoreanCoordinate,
  NEARBY_PAGE_SIZE,
} from "@/lib/measurement-map/types";

export const dynamic = "force-dynamic";

interface CandidateRow {
  id: string | number;
  code: string;
  year: number;
  period: string;
  business_name: string;
  address: string | null;
  is_registered: string | null;
  management_status: string | null;
  measurement_date: string | null;
  latitude: number | null;
  longitude: number | null;
}

function haversineKm(
  first: { latitude: number; longitude: number },
  second: { latitude: number; longitude: number },
) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const latDelta = radians(second.latitude - first.latitude);
  const lngDelta = radians(second.longitude - first.longitude);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(radians(first.latitude)) *
      Math.cos(radians(second.latitude)) *
      Math.sin(lngDelta / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function GET(request: NextRequest) {
  try {
    await checkPermission("journal:read");
    const params = request.nextUrl.searchParams;
    const year = Number(params.get("year"));
    const period = params.get("period")?.trim();
    const baseId = params.get("baseId");
    const page = Math.max(0, Number(params.get("page") || 0));
    const includeScheduled = params.get("includeScheduled") === "true";
    const excludedIds = new Set(
      (params.get("excludeIds") || "").split(",").map((id) => id.trim()).filter(Boolean),
    );

    if (!Number.isInteger(year) || !period || !baseId || !Number.isInteger(page)) {
      return NextResponse.json({ error: "연도, 주기, 기준 사업장 정보가 올바르지 않습니다." }, { status: 400 });
    }

    const supabase = await createClient();
    const fields =
      "id, code, year, period, business_name, address, is_registered, management_status, measurement_date, latitude, longitude";
    const { data: base, error: baseError } = await supabase
      .from("measurement_target_business")
      .select(fields)
      .eq("id", baseId)
      .eq("year", year)
      .eq("period", period)
      .maybeSingle();

    if (baseError) {
      console.error("[NearbyBusinesses] 기준 사업장 조회 실패:", baseError.code);
      return NextResponse.json({ error: "기준 사업장을 조회하지 못했습니다." }, { status: 500 });
    }
    const baseBusiness = base as unknown as CandidateRow | null;
    if (
      !baseBusiness ||
      !isValidKoreanCoordinate(baseBusiness.latitude, baseBusiness.longitude)
    ) {
      return NextResponse.json({ error: "기준 사업장의 유효한 좌표가 없습니다." }, { status: 422 });
    }

    const { data, error } = await supabase
      .from("measurement_target_business")
      .select(fields)
      .eq("year", year)
      .eq("period", period)
      .neq("id", baseId)
      .eq("is_registered", "미실시");

    if (error) {
      console.error("[NearbyBusinesses] 후보 조회 실패:", error.code);
      return NextResponse.json({ error: "주변 사업장을 조회하지 못했습니다." }, { status: 500 });
    }

    const candidates = ((data || []) as unknown as CandidateRow[])
      .filter((business) => {
        const managementStatus = (business.management_status || "").replace(/\s/g, "");
        const inactive =
          managementStatus === "거래종료" ||
          managementStatus === "종료" ||
          managementStatus === "transaction_ended";
        return (
          !inactive &&
          !excludedIds.has(String(business.id)) &&
          (includeScheduled || !business.measurement_date) &&
          isValidKoreanCoordinate(business.latitude, business.longitude)
        );
      })
      .map((business) => ({
        id: business.id,
        code: business.code,
        year: business.year,
        period: business.period,
        business_name: business.business_name,
        address: business.address,
        latitude: business.latitude,
        longitude: business.longitude,
        is_registered_text: business.is_registered,
        measurement_date: business.measurement_date,
        distanceKm: haversineKm(
          { latitude: baseBusiness.latitude!, longitude: baseBusiness.longitude! },
          { latitude: business.latitude!, longitude: business.longitude! },
        ),
      }))
      .sort((a, b) => a.distanceKm - b.distanceKm);

    const start = page * NEARBY_PAGE_SIZE;
    return NextResponse.json({
      candidates: candidates.slice(start, start + NEARBY_PAGE_SIZE),
      page,
      pageSize: NEARBY_PAGE_SIZE,
      total: candidates.length,
      hasPrevious: page > 0,
      hasNext: start + NEARBY_PAGE_SIZE < candidates.length,
    });
  } catch (error) {
    console.error("[NearbyBusinesses] 처리 실패:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "주변 사업장을 조회하는 중 오류가 발생했습니다." }, { status: 500 });
  }
}
