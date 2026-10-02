import type { Coordinate } from "./types";

type Site = { address: string | null; coordinate: Coordinate | null };

const normalizeAddress = (value: string | null) => String(value ?? "")
  .normalize("NFKC").replace(/\s+/g, "").trim().toLowerCase();

function validCoordinate(value: Coordinate | null): value is Coordinate {
  return value != null && Number.isFinite(value.latitude) && Number.isFinite(value.longitude)
    && value.latitude >= 33 && value.latitude <= 39
    && value.longitude >= 124 && value.longitude <= 132;
}

/** 저장된 WGS84 좌표의 소수점 차이만 허용한다. 0.5m를 넘으면 route 근거가 필요하다. */
export function samePhysicalSite(left: Site, right: Site): boolean {
  if (validCoordinate(left.coordinate) && validCoordinate(right.coordinate)) {
    const latitudeRadians = ((left.coordinate.latitude + right.coordinate.latitude) / 2) * Math.PI / 180;
    const northMeters = (left.coordinate.latitude - right.coordinate.latitude) * 111_195;
    const eastMeters = (left.coordinate.longitude - right.coordinate.longitude) * 111_195 * Math.cos(latitudeRadians);
    if (Math.hypot(northMeters, eastMeters) <= 0.5) return true;
  }
  const leftAddress = normalizeAddress(left.address);
  return leftAddress !== "" && leftAddress === normalizeAddress(right.address);
}
