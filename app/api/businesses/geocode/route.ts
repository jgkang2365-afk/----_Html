import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import {
  ensureBusinessCoordinate,
  selectCoordinateAddress,
  type BusinessCoordinateResult,
} from "@/lib/business-coordinates/service";
import { normalizeAddressForGeocoding } from "@/lib/naver-map/geocoding";

export const dynamic = "force-dynamic";
const MAX_BATCH_SIZE = 10;

export async function GET() {
  try {
    await checkPermission("journal:write");
    const supabase = await createClient();
    const { data: targets, error: targetError } = await supabase.from("measurement_target_business").select("code");
    if (targetError) throw targetError;

    const codes = Array.from(new Set((targets || []).map((row: any) => row.code).filter(Boolean)));
    const { data: infos, error: infoError } = codes.length
      ? await supabase.from("business_info").select("code, latitude, longitude").in("code", codes)
      : { data: [], error: null };
    if (infoError) throw infoError;

    const infoMap = new Map((infos || []).map((row: any) => [row.code, row]));
    let valid = 0;
    let invalid = 0;
    let missing = 0;
    for (const code of codes) {
      const row: any = infoMap.get(code);
      const latitude = Number(row?.latitude);
      const longitude = Number(row?.longitude);
      const present = row?.latitude !== null && row?.latitude !== undefined && row?.longitude !== null && row?.longitude !== undefined;
      const inRange = Number.isFinite(latitude) && Number.isFinite(longitude)
        && latitude >= 33 && latitude <= 39 && longitude >= 124 && longitude <= 132;
      if (inRange) valid += 1;
      else if (present) invalid += 1;
      else missing += 1;
    }

    return NextResponse.json({ total: codes.length, valid, missing, invalid, pending: missing + invalid });
  } catch (error) {
    console.error("[BusinessCoordinates] 현황 조회 실패:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "좌표 현황을 조회하지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await checkPermission("journal:write");
    const body = await request.json();
    const businessIds = body.businessIds;
    const forceRefetch = body.forceRefetch === true;

    if (!Array.isArray(businessIds)) {
      return NextResponse.json({ error: "사업장 ID 목록(businessIds)이 배열 형태여야 합니다." }, { status: 400 });
    }
    if (businessIds.length === 0) return NextResponse.json({ results: [] });
    if (businessIds.length > MAX_BATCH_SIZE) {
      return NextResponse.json({ error: `한 번에 최대 ${MAX_BATCH_SIZE}개의 사업장만 요청할 수 있습니다.` }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: businesses, error: selectError } = await supabase
      .from("measurement_target_business")
      .select("id, code, business_name, address")
      .in("id", businessIds);
    if (selectError) throw selectError;
    if (!businesses?.length) {
      return NextResponse.json({ error: "요청한 사업장 정보를 찾을 수 없습니다." }, { status: 404 });
    }

    const codes = Array.from(new Set(businesses.map((row: any) => row.code).filter(Boolean)));
    const { data: infos, error: infoError } = await supabase
      .from("business_info")
      .select("code, address1, address2")
      .in("code", codes);
    if (infoError) throw infoError;
    const infoMap = new Map((infos || []).map((row: any) => [row.code, row]));

    const resultByCode = new Map<string, BusinessCoordinateResult>();
    const resultByAddress = new Map<string, BusinessCoordinateResult>();
    const results: Array<Record<string, any>> = [];

    for (const business of businesses) {
      const codeResult = resultByCode.get(business.code);
      if (codeResult) {
        results.push({ ...codeResult, id: business.id, business_name: business.business_name, skipped: true });
        continue;
      }

      const address = selectCoordinateAddress(infoMap.get(business.code) || null, business.address);
      const addressKey = normalizeAddressForGeocoding(address);
      const addressResult = addressKey ? resultByAddress.get(addressKey) : undefined;
      let coordinate: BusinessCoordinateResult;

      if (addressResult) {
        const payload = {
          latitude: addressResult.latitude,
          longitude: addressResult.longitude,
          geocoded_address: addressResult.geocoded_address,
          geocoded_source_address: address,
          geocoding_status: addressResult.geocoding_status,
          geocoding_error: addressResult.geocoding_error,
          geocoded_at: new Date().toISOString(),
        };
        await supabase.from("business_info").update(payload).eq("code", business.code);
        await supabase.from("measurement_target_business").update(payload).eq("code", business.code).eq("coordinate_locked", false);
        coordinate = { ...addressResult, code: business.code, geocoded_source_address: address, skipped: true };
      } else {
        coordinate = await ensureBusinessCoordinate(supabase, {
          code: business.code,
          businessName: business.business_name,
          fallbackAddress: business.address,
          force: forceRefetch,
        });
        if (addressKey) resultByAddress.set(addressKey, coordinate);
      }

      resultByCode.set(business.code, coordinate);
      results.push({ ...coordinate, id: business.id, business_name: business.business_name });
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error("[BusinessCoordinates] 일괄 처리 실패:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "좌표 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}