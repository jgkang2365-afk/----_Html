import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { geocodeAddress, normalizeAddressForGeocoding } from "@/lib/naver-map/geocoding";

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // 1. 관리자 권한 및 쓰기 권한 검증
    await checkPermission("journal:write");

    // 2. 요청 Body 파싱 및 검증
    const body = await request.json();
    const { businessIds } = body;

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

    // 결과를 담을 배열
    const results = [];
    
    // 이번 요청 내에서 주소별로 Geocoding 결과를 임시 저장할 캐시 맵
    // 동일한 정규화 주소에 대한 중복 API 호출을 방지합니다.
    const geocodeCache = new Map<string, any>();

    for (const biz of businesses) {
      const bizId = biz.id;
      const currentAddress = biz.address || "";
      const normalizedCurrent = normalizeAddressForGeocoding(currentAddress);

      // 이미 수동 수정으로 잠금 처리된 경우 자동 변환은 패스하고 기존 정보를 그대로 반환
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
      if (!currentAddress || normalizedCurrent === "") {
        // 주소 없음 처리
        const updateData = {
          geocoding_status: "ADDRESS_MISSING",
          geocoding_error: "주소가 등록되어 있지 않습니다.",
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
          geocoding_error: "주소가 등록되어 있지 않습니다.",
          coordinate_locked: false
        });
        continue;
      }

      // 기존 좌표의 유효성 검사:
      // 이미 SUCCESS 상태이고, 위/경도가 존재하며, 기존에 변환했던 주소(geocoded_source_address)와 현재 주소가 동일하다면 재변환하지 않고 재사용.
      const normalizedSource = normalizeAddressForGeocoding(biz.geocoded_source_address);
      if (
        biz.geocoding_status === "SUCCESS" &&
        biz.latitude !== null &&
        biz.longitude !== null &&
        normalizedCurrent === normalizedSource
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

      // 4. Geocoding 호출 (캐싱 활용)
      let geocodeResult;
      if (geocodeCache.has(normalizedCurrent)) {
        geocodeResult = geocodeCache.get(normalizedCurrent);
      } else {
        // 실제 API 호출
        geocodeResult = await geocodeAddress(currentAddress);
        geocodeCache.set(normalizedCurrent, geocodeResult);
      }

      // 5. DB 업데이트
      const updateData = {
        latitude: geocodeResult.latitude,
        longitude: geocodeResult.longitude,
        geocoded_address: geocodeResult.geocoded_address,
        geocoded_source_address: currentAddress, // 원본 주소 저장
        geocoding_status: geocodeResult.geocoding_status,
        geocoded_at: geocodeResult.geocoded_at,
        geocoding_error: geocodeResult.geocoding_error
      };

      const { error: updateError } = await supabase
        .from("measurement_target_business")
        .update(updateData)
        .eq("id", bizId)
        .eq("coordinate_locked", false); // 안전장치: lock이 걸리지 않은 경우만 업데이트

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
    console.error("Geocoding API Route error:", error);
    // 보안을 위해 내부 에러 메시지를 가급적 숨기고 정규화된 오류 반환
    return NextResponse.json(
      { error: "서버 내부 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
