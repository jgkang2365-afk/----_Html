import { NextRequest, NextResponse } from "next/server";

// 사업장 입력 데이터 인터페이스
interface BusinessInput {
  id: string | number;
  business_name: string;
  latitude: number;
  longitude: number;
  address?: string | null;
}

// 카카오 Directions API 구간 경로 계산 결과
interface SegmentResult {
  success: boolean;
  distance: number; // 미터(m)
  duration: number; // 초(s)
  path: { lat: number; lng: number }[]; // 도로 세부 좌표 목록
  error?: string;
}

// 거리(m)를 '12.4km' 또는 '800m' 포맷으로 변환하는 헬퍼 함수
function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)}km`;
  }
  return `${Math.round(meters)}m`;
}

// 시간(s)을 '18분' 또는 '1시간 15분' 포맷으로 변환하는 헬퍼 함수
function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 1) {
    return "1분 미만";
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}시간 ${minutes}분` : `${hours}시간`;
  }
  return `${minutes}분`;
}

// 배열의 모든 순열(Permutation)을 생성하는 함수
function getPermutations<T>(array: T[]): T[][] {
  if (array.length <= 1) return [array];
  const result: T[][] = [];

  for (let i = 0; i < array.length; i++) {
    const current = array[i];
    const remaining = [...array.slice(0, i), ...array.slice(i + 1)];
    const remainingPerms = getPermutations(remaining);

    for (const perm of remainingPerms) {
      result.push([current, ...perm]);
    }
  }

  return result;
}

// 단일 구간(출발지 -> 목적지) 카카오 길찾기 API 호출
async function fetchDirectionsSegment(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  apiKey: string
): Promise<SegmentResult> {
  try {
    const url = new URL("https://apis-navi.kakaomobility.com/v1/directions");
    url.searchParams.append("origin", `${origin.lng},${origin.lat}`);
    url.searchParams.append("destination", `${destination.lng},${destination.lat}`);
    url.searchParams.append("priority", "RECOMMEND"); // 승용차 추천 경로

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `KakaoAK ${apiKey}`,
      },
    });

    if (!response.ok) {
      return {
        success: false,
        distance: 0,
        duration: 0,
        path: [],
        error: `카카오 API 응답 오류 (상태코드: ${response.status})`,
      };
    }

    const data = await response.json();
    const route = data.routes && data.routes[0];

    if (!route || route.result_code !== 0) {
      return {
        success: false,
        distance: 0,
        duration: 0,
        path: [],
        error: route?.result_msg || "경로를 찾을 수 없습니다.",
      };
    }

    const summary = route.summary;
    const path: { lat: number; lng: number }[] = [];

    // 도로 마디(vertexes) 좌표 추출 [lng, lat, lng, lat, ...]
    if (route.sections && Array.isArray(route.sections)) {
      for (const section of route.sections) {
        if (section.roads && Array.isArray(section.roads)) {
          for (const road of section.roads) {
            if (road.vertexes && Array.isArray(road.vertexes)) {
              const vx = road.vertexes;
              for (let i = 0; i < vx.length; i += 2) {
                const lng = vx[i];
                const lat = vx[i + 1];
                if (lat !== undefined && lng !== undefined) {
                  path.push({ lat, lng });
                }
              }
            }
          }
        }
      }
    }

    return {
      success: true,
      distance: summary.distance || 0,
      duration: summary.duration || 0,
      path,
    };
  } catch (error: any) {
    console.error("카카오 길찾기 API 호출 예외:", error);
    return {
      success: false,
      distance: 0,
      duration: 0,
      path: [],
      error: error.message || "네트워크 오류",
    };
  }
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.KAKAO_REST_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "서버 설정 오류: 카카오 REST API 키(KAKAO_REST_API_KEY)가 누락되었습니다." },
        { status: 500 }
      );
    }

    const body = await request.json();
    const businesses: BusinessInput[] = body.businesses;

    if (!Array.isArray(businesses) || businesses.length < 2) {
      return NextResponse.json(
        { success: false, error: "최적 동선 계산을 위해 최소 2개 이상의 사업장이 필요합니다." },
        { status: 400 }
      );
    }

    // 좌표 유효성 검사
    for (const biz of businesses) {
      if (!biz.latitude || !biz.longitude || isNaN(biz.latitude) || isNaN(biz.longitude)) {
        return NextResponse.json(
          { success: false, error: `사업장 '${biz.business_name}'의 유효한 위도/경도 좌표가 없습니다.` },
          { status: 400 }
        );
      }
    }

    // 1. 첫 번째 사업장을 출발지로 고정
    const originBusiness = businesses[0];
    const remainingBusinesses = businesses.slice(1);

    // 2. 나머지 사업장들의 모든 방문 순열(Permutations) 생성
    const remainingPermutations = getPermutations(remainingBusinesses);

    // 3. 구간별 경로 캐시맵 (중복 API 호출 방지)
    // key: "fromId->toId"
    const segmentCache = new Map<string, SegmentResult>();

    const getSegmentKey = (from: BusinessInput, to: BusinessInput) => `${from.id}->${to.id}`;

    // 4. 모든 순열의 경로 탐색 및 최적 순열 비교
    let bestRoute: {
      orderedBusinesses: BusinessInput[];
      totalDistance: number;
      totalDuration: number;
      segments: {
        fromIndex: number;
        toIndex: number;
        fromName: string;
        toName: string;
        distance: number;
        duration: number;
        formattedDistance: string;
        formattedDuration: string;
        path: { lat: number; lng: number }[];
      }[];
    } | null = null;

    let minTotalDuration = Infinity;

    for (const perm of remainingPermutations) {
      const currentRoute = [originBusiness, ...perm];
      let currentTotalDistance = 0;
      let currentTotalDuration = 0;
      let isPermutationValid = true;
      const currentSegments = [];

      for (let i = 0; i < currentRoute.length - 1; i++) {
        const from = currentRoute[i];
        const to = currentRoute[i + 1];
        const key = getSegmentKey(from, to);

        let segmentRes = segmentCache.get(key);
        if (!segmentRes) {
          segmentRes = await fetchDirectionsSegment(
            { lat: from.latitude, lng: from.longitude },
            { lat: to.latitude, lng: to.longitude },
            apiKey
          );
          segmentCache.set(key, segmentRes);
        }

        if (!segmentRes.success) {
          isPermutationValid = false;
          break; // 한 구간이라도 실패하면 해당 순열은 후보 제외
        }

        currentTotalDistance += segmentRes.distance;
        currentTotalDuration += segmentRes.duration;

        currentSegments.push({
          fromIndex: i + 1,
          toIndex: i + 2,
          fromName: from.business_name,
          toName: to.business_name,
          distance: segmentRes.distance,
          duration: segmentRes.duration,
          formattedDistance: formatDistance(segmentRes.distance),
          formattedDuration: formatDuration(segmentRes.duration),
          path: segmentRes.path,
        });
      }

      // 모든 구간 성공 시 최단 이동시간 갱신
      if (isPermutationValid) {
        if (
          currentTotalDuration < minTotalDuration ||
          (currentTotalDuration === minTotalDuration &&
            bestRoute &&
            currentTotalDistance < bestRoute.totalDistance)
        ) {
          minTotalDuration = currentTotalDuration;
          bestRoute = {
            orderedBusinesses: currentRoute,
            totalDistance: currentTotalDistance,
            totalDuration: currentTotalDuration,
            segments: currentSegments,
          };
        }
      }
    }

    // 5. 결과 검증
    if (!bestRoute) {
      return NextResponse.json(
        {
          success: false,
          error: "모든 방문 순서 후보에서 경로 계산에 실패했습니다. (도로 network 연결 실패 또는 좌표 불일치)",
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      success: true,
      optimalRoute: {
        totalDistance: bestRoute.totalDistance,
        totalDuration: bestRoute.totalDuration,
        formattedTotalDistance: formatDistance(bestRoute.totalDistance),
        formattedTotalDuration: formatDuration(bestRoute.totalDuration),
        orderedBusinesses: bestRoute.orderedBusinesses,
        segments: bestRoute.segments,
      },
    });
  } catch (error: any) {
    console.error("경로 최적화 API 오류:", error);
    return NextResponse.json(
      { success: false, error: error.message || "서버 내부 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
