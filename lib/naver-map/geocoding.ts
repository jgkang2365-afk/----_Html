import { normalizeString } from "@/lib/utils/data-utils";

interface GeocodeResult {
  latitude: number | null;
  longitude: number | null;
  geocoded_address: string | null;
  geocoded_source_address: string;
  geocoding_status: "SUCCESS" | "FAILED" | "ADDRESS_MISSING" | "STALE";
  geocoding_error: string | null;
  geocoded_at: string | null;
}

/**
 * 주소 텍스트를 간략히 정규화합니다.
 * - 앞뒤 공백 제거
 * - 연속된 공백을 하나로 축소
 * - 줄바꿈 제거
 */
export function normalizeAddressForGeocoding(address: string | null | undefined): string {
  if (!address) return "";
  return address
    .replace(/[\r\n]+/g, " ") // 줄바꿈 제거
    .replace(/\s+/g, " ")     // 연속 공백 하나로
    .trim();
}

/**
 * 주소가 유효한지 확인합니다.
 */
export function isValidAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  const normalized = normalizeAddressForGeocoding(address);
  if (!normalized) return false;
  
  const invalidKeywords = ["-", "없음", "미등록", "주소없음", "임시", "n/a", "na"];
  if (invalidKeywords.includes(normalized.toLowerCase())) {
    return false;
  }
  return true;
}

/**
 * 네이버 Maps API를 이용하여 주소를 위/경도 좌표로 변환합니다.
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const normalized = normalizeAddressForGeocoding(address);
  
  if (!isValidAddress(normalized)) {
    return {
      latitude: null,
      longitude: null,
      geocoded_address: null,
      geocoded_source_address: address,
      geocoding_status: "ADDRESS_MISSING",
      geocoding_error: "유효하지 않은 주소 형식입니다.",
      geocoded_at: new Date().toISOString()
    };
  }

  const clientId = process.env.NAVER_MAP_CLIENT_ID;
  const clientSecret = process.env.NAVER_MAP_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("Naver Geocoding API keys are missing in environment variables.");
    return {
      latitude: null,
      longitude: null,
      geocoded_address: null,
      geocoded_source_address: address,
      geocoding_status: "FAILED",
      geocoding_error: "서버 설정 오류 (API 키 누락)",
      geocoded_at: new Date().toISOString()
    };
  }

  try {
    const url = `https://naveropenapi.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent(normalized)}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-NCP-APIGW-API-KEY-ID": clientId,
        "X-NCP-APIGW-API-KEY": clientSecret,
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Naver Geocoding API error (HTTP ${response.status}):`, errorText);
      return {
        latitude: null,
        longitude: null,
        geocoded_address: null,
        geocoded_source_address: address,
        geocoding_status: "FAILED",
        geocoding_error: `API 요청 실패 (HTTP ${response.status})`,
        geocoded_at: new Date().toISOString()
      };
    }

    const data = await response.json();
    
    if (data.status !== "OK") {
      return {
        latitude: null,
        longitude: null,
        geocoded_address: null,
        geocoded_source_address: address,
        geocoding_status: "FAILED",
        geocoding_error: data.errorMessage || "API 오류",
        geocoded_at: new Date().toISOString()
      };
    }

    if (!data.addresses || data.addresses.length === 0) {
      return {
        latitude: null,
        longitude: null,
        geocoded_address: null,
        geocoded_source_address: address,
        geocoding_status: "FAILED",
        geocoding_error: "검색 결과 주소가 존재하지 않습니다.",
        geocoded_at: new Date().toISOString()
      };
    }

    const bestMatch = data.addresses[0];
    const lng = parseFloat(bestMatch.x);
    const lat = parseFloat(bestMatch.y);

    // 좌표 유효 범위 검증 (위도 -90 ~ 90, 경도 -180 ~ 180)
    // 한국 바운더리 체크 (남한 기준 대략 위도 33 ~ 39, 경도 124 ~ 132)
    const isValidLat = !isNaN(lat) && lat >= -90 && lat <= 90;
    const isValidLng = !isNaN(lng) && lng >= -180 && lng <= 180;

    if (!isValidLat || !isValidLng) {
      return {
        latitude: null,
        longitude: null,
        geocoded_address: bestMatch.roadAddress || bestMatch.jibunAddress || null,
        geocoded_source_address: address,
        geocoding_status: "FAILED",
        geocoding_error: `유효하지 않은 위경도 범위가 반환되었습니다. (위도: ${lat}, 경도: ${lng})`,
        geocoded_at: new Date().toISOString()
      };
    }

    // 대한민국 이외의 쌩뚱맞은 해외 좌표(예: 위경도 0, 0 또는 한국 범위를 완전히 벗어난 경우)에 대한 추가 방어막
    const isInsideKorea = lat >= 30 && lat <= 43 && lng >= 120 && lng <= 135;
    if (!isInsideKorea) {
      return {
        latitude: lat,
        longitude: lng,
        geocoded_address: bestMatch.roadAddress || bestMatch.jibunAddress || null,
        geocoded_source_address: address,
        geocoding_status: "FAILED",
        geocoding_error: `한국 이외의 지역으로 판정된 좌표입니다. (위도: ${lat}, 경도: ${lng})`,
        geocoded_at: new Date().toISOString()
      };
    }

    return {
      latitude: lat,
      longitude: lng,
      geocoded_address: bestMatch.roadAddress || bestMatch.jibunAddress || null,
      geocoded_source_address: address,
      geocoding_status: "SUCCESS",
      geocoding_error: null,
      geocoded_at: new Date().toISOString()
    };
  } catch (error: any) {
    console.error("Geocoding exception:", error);
    return {
      latitude: null,
      longitude: null,
      geocoded_address: null,
      geocoded_source_address: address,
      geocoding_status: "FAILED",
      geocoding_error: error.message || "알 수 없는 에러 발생",
      geocoded_at: new Date().toISOString()
    };
  }
}
