import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { geocodeAddress, normalizeAddressForGeocoding, isValidAddress } from "@/lib/naver-map/geocoding";

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // 1. 관리자 권한 및 쓰기 권한 검증
    await checkPermission("journal:write");

    // 2. 요청 Body 파싱 및 검증
    const body = await request.json();
    const { businessIds, forceRefetch } = body;

    if (!businessIds || !Array.isArray(businessIds)) {
      return NextResponse.json(
        { error: "사업장 ID 목록(businessIds)이 배열 형태여야 합니다." },
        { status: 400 }
      );
    }

    if (businessIds.length === 0) {
      return NextResponse.json({ results: [] });
    }

    if (businessIds.length > 10) {
      return NextResponse.json(
        { error: "한 번에 최대 10개의 사업장만 요청할 수 있습니다." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // 3. 대상 사업장 목록 DB 조회
    const { data: businesses, error: selectError } = await supabase
      .from("measurement_target_business")
      .select("*")
      .in("id", businessIds);

    if (selectError) {
      console.error("Geocoding 대상 사업장 조회 실패:", selectError);
      return NextResponse.json(
        { error: "DB 조회 중 에러가 발생했습니다." },
        { status: 500 }
      );
    }

    if (!businesses || businesses.length === 0) {
      return NextResponse.json(
        { error: "요청한 사업장 정보를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // 4. 주소 우선순위 적용을 위한 사업장 정보(business_info) 조회
    const codes = Array.from(new Set(businesses.map((b: any) => b.code).filter(Boolean)));
    const businessInfoMap = new Map<string, { address1?: string | null; address2?: string | null }>();

    if (codes.length > 0) {
      const { data: infoData } = await supabase
        .from("business_info")
        .select("code, address1, address2")
        .in("code", codes);

      if (infoData) {
        infoData.forEach((info: any) => {
          businessInfoMap.set(info.code, info);
        });
      }
    }

    // 결과를 담을 배열
    const results = [];
    
    // 이번 요청 내에서 주소별로 Geocoding 결과를 임시 저장할 캐시 맵
    const geocodeCache = new Map<string, any>();

    for (const biz of businesses) {
      const bizId = biz.id;
      const bInfo = businessInfoMap.get(biz.code);

      // 주소 선택 우선순위 결정:
      // 1. 도로명주소 (business_info.address1)
      // 2. 지번주소 (business_info.address2)
      // 3. 기존 통합 주소 (measurement_target_business.address)
      let targetAddress = "";
      const addr1 = normalizeAddressForGeocoding(bInfo?.address1);
      const addr2 = normalizeAddressForGeocoding(bInfo?.address2);
      const mainAddr = normalizeAddressForGeocoding(biz.address);

      if (isValidAddress(addr1)) {
        targetAddress = addr1;
      } else if (isValidAddress(addr2)) {
        targetAddress = addr2;
      } else if (isValidAddress(mainAddr)) {
        targetAddress = mainAddr;
      }

      const normalizedTarget = normalizeAddressForGeocoding(targetAddress);

      // 이미 수동 수정으로 잠금 처리된 경우 자동 변환은 패스하고 기존 정보 유지
      if (biz.coordinate_locked) {
        results.push({
          id: bizId,
          business_name: biz.business_name,
          code: biz.code,
          latitude: biz.latitude,
          longitude: biz.longitude,
          geocoding_status: biz.geocoding_status,
          geocoded_address: biz.geocoded_address,
          geocoding_error: biz.geocoding_error,
          coordinate_locked: true,
          message: "수동 고정된 좌표입니다."
        });
        continue;
      }

      // 주소 검증
      if (!targetAddress || normalizedTarget === "") {
        const updateData = {
          latitude: null,
          longitude: null,
          geocoding_status: "ADDRESS_MISSING",
          geocoding_error: "등록된 유효 주소가 없습니다.",
          geocoded_at: new Date().toISOString()
        };

        await supabase
          .from("measurement_target_business")
          .update(updateData)
          .eq("id", bizId)
          .eq("coordinate_locked", false);

        results.push({
          id: bizId,
          business_name: biz.business_name,
          code: biz.code,
          latitude: null,
          longitude: null,
          geocoding_status: "ADDRESS_MISSING",
          geocoded_address: null,
          geocoding_error: "등록된 유효 주소가 없습니다.",
          coordinate_locked: false
        });
        continue;
      }

      // 기존 좌표의 재사용 조건:
      // forceRefetch가 false이고, 이미 SUCCESS 상태이며, 위/경도가 존재하고, 이전 변환 원본 주소와 현재 대상 주소가 동일할 때
      const normalizedSource = normalizeAddressForGeocoding(biz.geocoded_source_address);
      if (
        !forceRefetch &&
        biz.geocoding_status === "SUCCESS" &&
        biz.latitude !== null &&
        biz.longitude !== null &&
        normalizedTarget === normalizedSource
      ) {
        results.push({
          id: bizId,
          business_name: biz.business_name,
          code: biz.code,
          latitude: biz.latitude,
          longitude: biz.longitude,
          geocoding_status: biz.geocoding_status,
          geocoded_address: biz.geocoded_address,
          geocoding_error: null,
          coordinate_locked: false,
          message: "기존 좌표 재사용"
        });
        continue;
      }

      // Geocoding API 호출 (캐싱 활용)
      let geocodeResult;
      if (geocodeCache.has(normalizedTarget)) {
        geocodeResult = geocodeCache.get(normalizedTarget);
      } else {
        geocodeResult = await geocodeAddress(targetAddress);
        geocodeCache.set(normalizedTarget, geocodeResult);
      }

      // DB 업데이트 데이터 객체 (이전 회차 결과 재사용 방지를 위해 독립 생성)
      const updateData: any = {
        latitude: geocodeResult.latitude,
        longitude: geocodeResult.longitude,
        geocoded_address: geocodeResult.geocoded_address,
        geocoded_source_address: targetAddress,
        geocoding_status: geocodeResult.geocoding_status,
        geocoded_at: geocodeResult.geocoded_at,
        geocoding_error: geocodeResult.geocoding_error,
        geocode_provider: geocodeResult.geocode_provider
      };

      const { error: updateError } = await supabase
        .from("measurement_target_business")
        .update(updateData)
        .eq("id", bizId)
        .eq("coordinate_locked", false);

      if (updateError) {
        console.error(`사업장 ID ${bizId} 좌표 저장 실패:`, updateError);
        results.push({
          id: bizId,
          business_name: biz.business_name,
          code: biz.code,
          latitude: null,
          longitude: null,
          geocoding_status: "FAILED",
          geocoded_address: null,
          geocoding_error: "DB 업데이트 실패",
          coordinate_locked: false
        });
      } else {
        results.push({
          id: bizId,
          business_name: biz.business_name,
          code: biz.code,
          latitude: geocodeResult.latitude,
          longitude: geocodeResult.longitude,
          geocoding_status: geocodeResult.geocoding_status,
          geocoded_address: geocodeResult.geocoded_address,
          geocoding_error: geocodeResult.geocoding_error,
          coordinate_locked: false
        });
      }
    }

    return NextResponse.json({ results });
  } catch (error: any) {
    console.error("Geocoding API 라우트 예외 발생:", error);
    return NextResponse.json(
      { error: "서버 내부 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
