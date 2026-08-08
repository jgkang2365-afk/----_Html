import type { Coordinate, ExistingAssignment, RouteMetric, RouteMetrics, SurveyTarget } from "./types";

const TTL_MS = 5 * 60 * 1000;
const sharedCache = new Map<string, { expiresAt: number; value: RouteMetric }>();

function validCoordinate(value: Coordinate | null): value is Coordinate {
  return Boolean(value && value.latitude >= 33 && value.latitude <= 39 && value.longitude >= 124 && value.longitude <= 132);
}

function haversineKm(left: Coordinate, right: Coordinate) {
  const radians = (value: number) => value * Math.PI / 180;
  const lat = radians(right.latitude - left.latitude);
  const lng = radians(right.longitude - left.longitude);
  const a = Math.sin(lat / 2) ** 2 +
    Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude)) * Math.sin(lng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pairKey(left: Coordinate, right: Coordinate) {
  return `${left.latitude.toFixed(6)},${left.longitude.toFixed(6)}->${right.latitude.toFixed(6)},${right.longitude.toFixed(6)}`;
}

async function vehicleMetric(left: Coordinate, right: Coordinate, apiKey: string): Promise<RouteMetric | null> {
  const url = new URL("https://apis-navi.kakaomobility.com/v1/directions");
  url.searchParams.set("origin", `${left.longitude},${left.latitude}`);
  url.searchParams.set("destination", `${right.longitude},${right.latitude}`);
  url.searchParams.set("priority", "RECOMMEND");
  try {
    const response = await fetch(url, { headers: { Authorization: `KakaoAK ${apiKey}` }, signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return null;
    const body = await response.json();
    const summary = body?.routes?.[0]?.summary;
    if (!summary) return null;
    return {
      source: "vehicle",
      durationMinutes: Math.ceil(Number(summary.duration || 0) / 60),
      distanceKm: Number(summary.distance || 0) / 1000,
      sameRegion: false,
    };
  } catch {
    return null;
  }
}

/** 추천 세션별 캐시 + 서버 5분 TTL 캐시. DB에는 경로 결과를 저장하지 않는다. */
export function createRouteMetrics(apiKey = process.env.KAKAO_REST_API_KEY): RouteMetrics {
  const sessionCache = new Map<string, Promise<RouteMetric>>();
  return {
    between(left: SurveyTarget | ExistingAssignment, right: SurveyTarget | ExistingAssignment) {
      const leftCoordinate = left.coordinate;
      const rightCoordinate = right.coordinate;
      const sameRegion = Boolean(left.region && right.region && left.region === right.region);
      if (!validCoordinate(leftCoordinate) || !validCoordinate(rightCoordinate)) {
        return Promise.resolve({ source: sameRegion ? "region" : "unknown", durationMinutes: null, distanceKm: null, sameRegion });
      }
      const key = pairKey(leftCoordinate, rightCoordinate);
      const session = sessionCache.get(key);
      if (session) return session;
      const promise = (async () => {
        const cached = sharedCache.get(key);
        if (cached && cached.expiresAt > Date.now()) return { ...cached.value, sameRegion };
        const vehicle = apiKey ? await vehicleMetric(leftCoordinate, rightCoordinate, apiKey) : null;
        const value: RouteMetric = vehicle
          ? { ...vehicle, sameRegion }
          : { source: "distance", durationMinutes: null, distanceKm: haversineKm(leftCoordinate, rightCoordinate), sameRegion };
        if (vehicle) sharedCache.set(key, { expiresAt: Date.now() + TTL_MS, value });
        return value;
      })();
      sessionCache.set(key, promise);
      return promise;
    },
  };
}
