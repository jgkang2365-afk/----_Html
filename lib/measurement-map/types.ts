export const MEASUREMENT_MAP_CHANNEL = "measurement-map-sync";
export const MEASUREMENT_MAP_VIEWER_NAME = "measurement-map-viewer";
export const MEASUREMENT_MAP_VIEWER_PATH = "/measurement-business/map-viewer";
export const LONG_SEGMENT_WARNING_MINUTES = 30;
export const MAX_OPTIMIZATION_BUSINESSES = 6;
export const NEARBY_PAGE_SIZE = 10;

export interface MeasurementMapBusiness {
  id: string | number;
  code: string;
  year: number;
  period: string;
  business_name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  is_registered_text?: string | null;
  measurement_date?: string | null;
  distanceKm?: number;
  included?: boolean;
}

export interface MeasurementMapContext {
  year: number;
  period: string;
}

export interface MeasurementMapInitializePayload {
  context: MeasurementMapContext;
  businesses: MeasurementMapBusiness[];
  baseBusinessId: string | number | null;
}

export type MeasurementMapMessage =
  | { type: "MAP_INITIALIZE"; payload: MeasurementMapInitializePayload }
  | { type: "SET_CONTEXT"; payload: MeasurementMapContext }
  | { type: "SET_BASE_BUSINESS"; payload: { businessId: string | number } }
  | { type: "ADD_BUSINESS"; payload: { business: MeasurementMapBusiness } }
  | { type: "REMOVE_BUSINESS"; payload: { businessId: string | number } }
  | { type: "RESET_MAP" }
  | { type: "REFRESH_BUSINESS"; payload: { business: MeasurementMapBusiness } }
  | { type: "REQUEST_CURRENT_STATE" }
  | { type: "VIEWER_READY" }
  | { type: "VIEWER_STATE"; payload: MeasurementMapInitializePayload };

export function isValidKoreanCoordinate(
  latitude: unknown,
  longitude: unknown,
): latitude is number {
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= 33 &&
    latitude <= 39 &&
    longitude >= 124 &&
    longitude <= 132
  );
}

export function toMeasurementMapBusiness(value: unknown): MeasurementMapBusiness | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (
    (typeof item.id !== "string" && typeof item.id !== "number") ||
    typeof item.code !== "string" ||
    typeof item.business_name !== "string" ||
    typeof item.year !== "number" ||
    typeof item.period !== "string"
  ) {
    return null;
  }

  const latitude = typeof item.latitude === "number" ? item.latitude : null;
  const longitude = typeof item.longitude === "number" ? item.longitude : null;

  return {
    id: item.id,
    code: item.code,
    year: item.year,
    period: item.period,
    business_name: item.business_name,
    address: typeof item.address === "string" ? item.address : null,
    latitude,
    longitude,
    is_registered_text:
      typeof item.is_registered_text === "string" ? item.is_registered_text : null,
    measurement_date:
      typeof item.measurement_date === "string" ? item.measurement_date : null,
    distanceKm: typeof item.distanceKm === "number" ? item.distanceKm : undefined,
    included: typeof item.included === "boolean" ? item.included : true,
  };
}

export function isMeasurementMapMessage(value: unknown): value is MeasurementMapMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  const payload = message.payload as Record<string, unknown> | undefined;
  const hasBusinessId = () =>
    payload &&
    (typeof payload.businessId === "string" || typeof payload.businessId === "number");
  const hasContext = (candidate: unknown) => {
    if (!candidate || typeof candidate !== "object") return false;
    const context = candidate as Record<string, unknown>;
    return Number.isInteger(context.year) && typeof context.period === "string";
  };
  const hasInitializePayload = () =>
    payload &&
    hasContext(payload.context) &&
    Array.isArray(payload.businesses) &&
    payload.businesses.every((business) => toMeasurementMapBusiness(business) !== null) &&
    (payload.baseBusinessId === null ||
      typeof payload.baseBusinessId === "string" ||
      typeof payload.baseBusinessId === "number");

  switch (message.type) {
    case "MAP_INITIALIZE":
    case "VIEWER_STATE":
      return Boolean(hasInitializePayload());
    case "SET_CONTEXT":
      return hasContext(message.payload);
    case "SET_BASE_BUSINESS":
    case "REMOVE_BUSINESS":
      return Boolean(hasBusinessId());
    case "ADD_BUSINESS":
    case "REFRESH_BUSINESS":
      return Boolean(payload && toMeasurementMapBusiness(payload.business) !== null);
    case "RESET_MAP":
    case "REQUEST_CURRENT_STATE":
    case "VIEWER_READY":
      return true;
    default:
      return false;
  }
}

export function sanitizeBusinessForMap(value: {
  id: string | number;
  code: string;
  year: number;
  period: string;
  business_name: string;
  address: string | null;
  latitude?: number | null;
  longitude?: number | null;
  is_registered_text?: string | null;
  measurement_date?: string | null;
}): MeasurementMapBusiness {
  return {
    id: value.id,
    code: value.code,
    year: value.year,
    period: value.period,
    business_name: value.business_name,
    address: value.address,
    latitude: value.latitude ?? null,
    longitude: value.longitude ?? null,
    is_registered_text: value.is_registered_text ?? null,
    measurement_date: value.measurement_date ?? null,
    included: true,
  };
}

export function retainAvailableBusinessIds(
  selectedIds: Iterable<string | number>,
  businesses: Array<{ id: string | number }>,
): Set<string | number> {
  const availableIds = new Set(businesses.map((business) => String(business.id)));
  return new Set(
    Array.from(selectedIds).filter((id) => availableIds.has(String(id))),
  );
}
