import proj4 from "proj4";

// 좌표 변환 API 공급자 타입 정의
export type GeocodeProviderType = "kakao" | "juso";

// 좌표 변환 결과 인터페이스 정의
export type GeocodeResult = {
  success: boolean;
  latitude: number | null;
  longitude: number | null;
  normalizedAddress: string | null;
  provider: GeocodeProviderType;
  error: string | null;
  geocoded_at?: string;
};

// 좌표 변환 공급자 인터페이스 정의
export interface GeocodingProvider {
  geocode(address: string): Promise<GeocodeResult>;
}

// Proj4 정의 추가 (EPSG:5179 & EPSG:4326)
// EPSG:5179: 한국 2000 / 통합 좌표계 (UTM-K)
// EPSG:4326: WGS84 (경위도)
proj4.defs(
  "EPSG:5179",
  "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs"
);
proj4.defs(
  "EPSG:4326",
  "+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs"
);

/**
 * 주소 텍스트를 정규화합니다.
 * - 앞뒤 공백 제거
 * - 줄바꿈 및 연속 공백을 하나로 축소
 */
export function normalizeAddressForGeocoding(address: string | null | undefined): string {
  if (!address) return "";
  return address
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 주소의 유효성을 검사합니다.
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
 * 카카오 Local REST API 기반 좌표 공급자 구현 클래스
 */
export class KakaoGeocodingProvider implements GeocodingProvider {
  async geocode(address: string): Promise<GeocodeResult> {
    const normalized = normalizeAddressForGeocoding(address);

    if (!isValidAddress(normalized)) {
      return {
        success: false,
        latitude: null,
        longitude: null,
        normalizedAddress: null,
        provider: "kakao",
        error: "유효하지 않은 주소 형식입니다.",
        geocoded_at: new Date().toISOString(),
      };
    }

    const apiKey = process.env.KAKAO_REST_API_KEY;
    if (!apiKey) {
      console.error("카카오 Local REST API 키(KAKAO_REST_API_KEY)가 환경변수에 누락되었습니다.");
      return {
        success: false,
        latitude: null,
        longitude: null,
        normalizedAddress: null,
        provider: "kakao",
        error: "서버 설정 오류 (카카오 REST API 키 누락)",
        geocoded_at: new Date().toISOString(),
      };
    }

    try {
      const url = new URL("https://dapi.kakao.com/v2/local/search/address.json");
      url.searchParams.append("query", normalized);

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `KakaoAK ${apiKey}`,
        },
      });

      if (!response.ok) {
        return {
          success: false,
          latitude: null,
          longitude: null,
          normalizedAddress: null,
          provider: "kakao",
          error: `카카오 API 실패 (HTTP ${response.status})`,
          geocoded_at: new Date().toISOString(),
        };
      }

      const data = await response.json();
      const documents = data.documents;

      if (!documents || documents.length === 0) {
        return {
          success: false,
          latitude: null,
          longitude: null,
          normalizedAddress: null,
          provider: "kakao",
          error: "검색 결과 주소가 존재하지 않습니다.",
          geocoded_at: new Date().toISOString(),
        };
      }

      const doc = documents[0];
      const xStr = doc.x;
      const yStr = doc.y;

      if (!xStr || !yStr) {
        return {
          success: false,
          latitude: null,
          longitude: null,
          normalizedAddress: null,
          provider: "kakao",
          error: "좌표(x, y) 정보가 누락되었습니다.",
          geocoded_at: new Date().toISOString(),
        };
      }

      const longitude = parseFloat(xStr);
      const latitude = parseFloat(yStr);

      if (isNaN(latitude) || isNaN(longitude)) {
        return {
          success: false,
          latitude: null,
          longitude: null,
          normalizedAddress: null,
          provider: "kakao",
          error: "숫자 변환 실패 (유효하지 않은 좌표 형식)",
          geocoded_at: new Date().toISOString(),
        };
      }

      // 대한민국 위도/경도 유효 범위 검증 (위도: 33 ~ 39, 경도: 124 ~ 132)
      const isValidLat = latitude >= 33 && latitude <= 39;
      const isValidLng = longitude >= 124 && longitude <= 132;

      if (!isValidLat || !isValidLng) {
        return {
          success: false,
          latitude: null,
          longitude: null,
          normalizedAddress: null,
          provider: "kakao",
          error: `대한민국 범위를 벗어난 좌표입니다. (위도: ${latitude}, 경도: ${longitude})`,
          geocoded_at: new Date().toISOString(),
        };
      }

      // 정규화 주소 결정 (도로명주소 우선, 없으면 지번주소 사용)
      const normalizedAddr = doc.road_address?.address_name || doc.address?.address_name || normalized;

      return {
        success: true,
        latitude,
        longitude,
        normalizedAddress: normalizedAddr,
        provider: "kakao",
        error: null,
        geocoded_at: new Date().toISOString(),
      };
    } catch (error: any) {
      console.error("카카오 Geocoding 변환 예외 발생:", error);
      return {
        success: false,
        latitude: null,
        longitude: null,
        normalizedAddress: null,
        provider: "kakao",
        error: error.message || "알 수 없는 에러 발생",
        geocoded_at: new Date().toISOString(),
      };
    }
  }
}

/**
 * 행정안전부 JUSO API 기반 좌표 공급자 구현 클래스
 */
export class JusoGeocodingProvider implements GeocodingProvider {
  async geocode(address: string): Promise<GeocodeResult> {
    const normalized = normalizeAddressForGeocoding(address);

    if (!isValidAddress(normalized)) {
      return {
        success: false,
        latitude: null,
        longitude: null,
        normalizedAddress: null,
        provider: "juso",
        error: "유효하지 않은 주소 형식입니다.",
        geocoded_at: new Date().toISOString(),
      };
    }

    const searchApiKey = process.env.JUSO_SEARCH_API_KEY;
    const coordApiKey = process.env.JUSO_COORD_API_KEY;

    if (!searchApiKey || !coordApiKey) {
      console.error("행안부 주소 API 키(JUSO_SEARCH_API_KEY, JUSO_COORD_API_KEY)가 환경변수에 누락되었습니다.");
      return {
        success: false,
        latitude: null,
        longitude: null,
        normalizedAddress: null,
        provider: "juso",
        error: "서버 설정 오류 (행안부 API 키 누락)",
        geocoded_at: new Date().toISOString(),
      };
    }

    try {
      // 1단계: 행안부 도로명주소 검색 API 호출
      const searchUrl = "https://business.juso.go.kr/addrlink/addrLinkApi.do";
      const searchParams = new URLSearchParams({
        confmKey: searchApiKey,
        currentPage: "1",
        countPerPage: "1",
        keyword: normalized,
        resultType: "json",
      });

      const searchResponse = await fetch(searchUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: searchParams.toString(),
      });

      if (!searchResponse.ok) {
        return {
          success: false,
          latitude: null,
          longitude: null,
          normalizedAddress: null,
          provider: "juso",
          error: `주소 검색 API 실패 (HTTP ${searchResponse.status})`,
          geocoded_at: new Date().toISOString(),
        };
      }

      const searchData = await searchResponse.json();
      const jusoList = searchData.results?.juso;

      if (!jusoList || jusoList.length === 0) {
        return {
          success: false,
          latitude: null,
          longitude: null,
          normalizedAddress: null,
          provider: "juso",
          error: "검색 결과 주소가 존재하지 않습니다.",
          geocoded_at: new Date().toISOString(),
        };
      }

      const bestJuso = jusoList[0];
      const { admCd, rnMgtSn, udrtYn, buldMnnm, buldSlno, roadAddr } = bestJuso;

      if (!admCd || !rnMgtSn || !udrtYn || !buldMnnm || !buldSlno) {
        return {
          success: false,
          latitude: null,
          longitude: null,
          normalizedAddress: roadAddr || null,
          provider: "juso",
          error: "주소 필수 코드 정보(본번/부번)가 누락되었습니다.",
          geocoded_at: new Date().toISOString(),
        };
      }

      if (coordApiKey === "your_juso_coord_api_key" || !coordApiKey) {
        return {
          success: false,
          latitude: null,
          longitude: null,
          normalizedAddress: roadAddr || null,
          provider: "juso",
          error: "좌표 조회 API 승인 대기중 (JUSO_COORD_API_KEY 미설정)",
          geocoded_at: new Date().toISOString(),
        };
      }

      // 2단계: 행안부 주소별 좌표정보조회 API 호출
      const coordUrl = "https://business.juso.go.kr/addrlink/addrCoordApi.do";
      const coordParams = new URLSearchParams({
        confmKey: coordApiKey,
        admCd,
        rnMgtSn,
        udrtYn,
        buldMnnm,
        buldSlno,
        resultType: "json",
      });

      const coordResponse = await fetch(coordUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: coordParams.toString(),
      });

      if (!coordResponse.ok) {
        return {
          success: false,
          latitude: null,
          longitude: null,
          normalizedAddress: roadAddr || null,
          provider: "juso",
          error: `좌표 조회 API 실패 (HTTP ${coordResponse.status})`,
          geocoded_at: new Date().toISOString(),
        };
      }

      const coordData = await coordResponse.json();
      const coordList = coordData.results?.juso;

      if (!coordList || coordList.length === 0) {
        return {
          success: false,
          latitude: null,
          longitude: null,
          normalizedAddress: roadAddr || null,
          provider: "juso",
          error: "해당 주소의 좌표정보를 찾을 수 없습니다.",
          geocoded_at: new Date().toISOString(),
        };
      }

      const bestCoord = coordList[0];
      const entX = parseFloat(bestCoord.entX);
      const entY = parseFloat(bestCoord.entY);

      if (isNaN(entX) || isNaN(entY)) {
        return {
          success: false,
          latitude: null,
          longitude: null,
          normalizedAddress: roadAddr || null,
          provider: "juso",
          error: "유효하지 않은 좌표형식이 반환되었습니다.",
          geocoded_at: new Date().toISOString(),
        };
      }

      // 3단계: GRS80 UTM-K (EPSG:5179) -> WGS84 (EPSG:4326) 좌표계 변환
      const [longitude, latitude] = proj4("EPSG:5179", "EPSG:4326", [entX, entY]);

      // 대한민국 위도/경도 유효 범위 검증 (위도: 33 ~ 39, 경도: 124 ~ 132)
      const isValidLat = !isNaN(latitude) && latitude >= 33 && latitude <= 39;
      const isValidLng = !isNaN(longitude) && longitude >= 124 && longitude <= 132;

      if (!isValidLat || !isValidLng) {
        return {
          success: false,
          latitude: null,
          longitude: null,
          normalizedAddress: roadAddr || null,
          provider: "juso",
          error: `대한민국 범위를 벗어난 좌표입니다. (위도: ${latitude}, 경도: ${longitude})`,
          geocoded_at: new Date().toISOString(),
        };
      }

      return {
        success: true,
        latitude,
        longitude,
        normalizedAddress: roadAddr || null,
        provider: "juso",
        error: null,
        geocoded_at: new Date().toISOString(),
      };
    } catch (error: any) {
      console.error("행안부 Geocoding 변환 예외 발생:", error);
      return {
        success: false,
        latitude: null,
        longitude: null,
        normalizedAddress: null,
        provider: "juso",
        error: error.message || "알 수 없는 에러 발생",
        geocoded_at: new Date().toISOString(),
      };
    }
  }
}

/**
 * 환경변수(GEOCODING_PROVIDER) 설정에 맞춰 적절한 좌표 변환 공급자를 반환합니다.
 */
export function getGeocodingProvider(): GeocodingProvider {
  const providerType = (process.env.GEOCODING_PROVIDER || "kakao").toLowerCase();
  if (providerType === "juso") {
    return new JusoGeocodingProvider();
  }
  return new KakaoGeocodingProvider();
}

/**
 * 기존 API 코드와의 하위 호환성을 보장하는 Geocoding 래퍼 함수입니다.
 */
export async function geocodeAddress(address: string) {
  const provider = getGeocodingProvider();
  const res = await provider.geocode(address);

  const status = res.success
    ? "SUCCESS"
    : res.error?.includes("유효하지 않은 주소")
    ? "ADDRESS_MISSING"
    : "FAILED";

  return {
    latitude: res.latitude,
    longitude: res.longitude,
    geocoded_address: res.normalizedAddress,
    geocoded_source_address: address,
    geocoding_status: status as "SUCCESS" | "FAILED" | "ADDRESS_MISSING" | "STALE",
    geocoding_error: res.error,
    geocoded_at: res.geocoded_at || new Date().toISOString(),
    geocode_provider: res.provider,
  };
}
