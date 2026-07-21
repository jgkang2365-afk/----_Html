import proj4 from "proj4";

interface GeocodeResult {
  latitude: number | null;
  longitude: number | null;
  geocoded_address: string | null;
  geocoded_source_address: string;
  geocoding_status: "SUCCESS" | "FAILED" | "ADDRESS_MISSING" | "STALE";
  geocoding_error: string | null;
  geocoded_at: string | null;
}

// Proj4 정의 추가 (EPSG:5179 & EPSG:4326)
// EPSG:5179: Korea 2000 / Unified CS (UTM-K)
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
 * 행정안전부 도로명주소 API 및 주소별 좌표정보 API를 이용해 주소를 위경도(WGS84) 좌표로 변환합니다.
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

  const searchApiKey = process.env.JUSO_SEARCH_API_KEY;
  const coordApiKey = process.env.JUSO_COORD_API_KEY;

  // 각 사업장별 실제 원본 주소를 마스킹하여 로그에 출력
  const maskedAddress = address.length > 8 ? `${address.substring(0, 8)}***` : address;
  console.log(`[Geocoding] 주소 변환 프로세스 진입 - 원본 주소: ${maskedAddress}`);

  if (!searchApiKey || !coordApiKey) {
    console.error("행안부 주소 API 키(JUSO_SEARCH_API_KEY, JUSO_COORD_API_KEY)가 환경변수에 누락되었습니다.");
    return {
      latitude: null,
      longitude: null,
      geocoded_address: null,
      geocoded_source_address: address,
      geocoding_status: "FAILED",
      geocoding_error: "서버 설정 오류 (행안부 API 키 누락)",
      geocoded_at: new Date().toISOString()
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
      resultType: "json"
    });

    const searchResponse = await fetch(searchUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: searchParams.toString()
    });

    if (!searchResponse.ok) {
      return {
        latitude: null,
        longitude: null,
        geocoded_address: null,
        geocoded_source_address: address,
        geocoding_status: "FAILED",
        geocoding_error: `주소 검색 API 실패 (HTTP ${searchResponse.status})`,
        geocoded_at: new Date().toISOString()
      };
    }

    const searchData = await searchResponse.json();
    const jusoList = searchData.results?.juso;

    if (!jusoList || jusoList.length === 0) {
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

    const bestJuso = jusoList[0];
    const { admCd, rnMgtSn, udrtYn, buldMnnm, buldSlno, roadAddr } = bestJuso;

    // 도로명주소 검색 API 결과 상세 로그 출력 (좌표 API 전송 인자 검증용)
    console.log(`[Geocoding] 1단계 검색 성공 - 정규화 주소: ${roadAddr}, admCd: ${admCd}, rnMgtSn: ${rnMgtSn}, udrtYn: ${udrtYn}, buldMnnm: ${buldMnnm}, buldSlno: ${buldSlno}`);

    if (!admCd || !rnMgtSn || !udrtYn || !buldMnnm || !buldSlno) {
      return {
        latitude: null,
        longitude: null,
        geocoded_address: roadAddr || null,
        geocoded_source_address: address,
        geocoding_status: "FAILED",
        geocoding_error: "주소 필수 코드 정보(본번/부번)가 누락되었습니다.",
        geocoded_at: new Date().toISOString()
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
      resultType: "json"
    });

    const coordResponse = await fetch(coordUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: coordParams.toString()
    });

    if (!coordResponse.ok) {
      return {
        latitude: null,
        longitude: null,
        geocoded_address: roadAddr || null,
        geocoded_source_address: address,
        geocoding_status: "FAILED",
        geocoding_error: `좌표 조회 API 실패 (HTTP ${coordResponse.status})`,
        geocoded_at: new Date().toISOString()
      };
    }

    const coordData = await coordResponse.json();
    const coordList = coordData.results?.juso;

    if (!coordList || coordList.length === 0) {
      return {
        latitude: null,
        longitude: null,
        geocoded_address: roadAddr || null,
        geocoded_source_address: address,
        geocoding_status: "FAILED",
        geocoding_error: "해당 주소의 좌표정보를 찾을 수 없습니다.",
        geocoded_at: new Date().toISOString()
      };
    }

    const bestCoord = coordList[0];
    const entX = parseFloat(bestCoord.entX);
    const entY = parseFloat(bestCoord.entY);

    if (isNaN(entX) || isNaN(entY)) {
      return {
        latitude: null,
        longitude: null,
        geocoded_address: roadAddr || null,
        geocoded_source_address: address,
        geocoding_status: "FAILED",
        geocoding_error: "유효하지 않은 좌표형식이 반환되었습니다.",
        geocoded_at: new Date().toISOString()
      };
    }

    // entX, entY 반환 정보 상세 출력
    console.log(`[Geocoding] 2단계 좌표 획득 성공 - entX: ${entX}, entY: ${entY}`);

    // 3단계: GRS80 UTM-K (EPSG:5179) -> WGS84 (EPSG:4326) 좌표계 변환 수행
    // proj4는 [longitude, latitude] 순으로 리턴함
    const [longitude, latitude] = proj4("EPSG:5179", "EPSG:4326", [entX, entY]);

    // proj4 변환 결과 상세 출력
    console.log(`[Geocoding] 3단계 proj4 변환 완료 - 입력: [X:${entX}, Y:${entY}] -> 출력 위경도: [Lat:${latitude}, Lng:${longitude}]`);

    // 위/경도 유효 범위 체크
    const isValidLat = !isNaN(latitude) && latitude >= -90 && latitude <= 90;
    const isValidLng = !isNaN(longitude) && longitude >= -180 && longitude <= 180;

    if (!isValidLat || !isValidLng) {
      return {
        latitude: null,
        longitude: null,
        geocoded_address: roadAddr || null,
        geocoded_source_address: address,
        geocoding_status: "FAILED",
        geocoding_error: `변환된 위경도 범위를 초과했습니다. (위도: ${latitude}, 경도: ${longitude})`,
        geocoded_at: new Date().toISOString()
      };
    }

    // 대한민국 영토 경계 필터링
    const isInsideKorea = latitude >= 30 && latitude <= 43 && longitude >= 120 && longitude <= 135;
    if (!isInsideKorea) {
      return {
        latitude: latitude,
        longitude: longitude,
        geocoded_address: roadAddr || null,
        geocoded_source_address: address,
        geocoding_status: "FAILED",
        geocoding_error: `한국 이외의 지역으로 판정된 좌표입니다. (위도: ${latitude}, 경도: ${longitude})`,
        geocoded_at: new Date().toISOString()
      };
    }

    return {
      latitude,
      longitude,
      geocoded_address: roadAddr || null,
      geocoded_source_address: address,
      geocoding_status: "SUCCESS",
      geocoding_error: null,
      geocoded_at: new Date().toISOString()
    };
  } catch (error: any) {
    console.error("행안부 Geocoding 변환 예외 발생:", error);
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
