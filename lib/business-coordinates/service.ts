import type { SupabaseClient } from "@supabase/supabase-js";
import {
  geocodeAddress,
  isValidAddress,
  normalizeAddressForGeocoding,
} from "@/lib/naver-map/geocoding";
import { isValidKoreanCoordinate } from "@/lib/measurement-map/types";

type CoordinateStatus = "PENDING" | "SUCCESS" | "FAILED" | "ADDRESS_MISSING" | "STALE";

export interface EnsureBusinessCoordinateInput {
  code: string;
  businessName?: string | null;
  fallbackAddress?: string | null;
  force?: boolean;
}

export interface BusinessCoordinateResult {
  code: string;
  latitude: number | null;
  longitude: number | null;
  geocoding_status: CoordinateStatus;
  geocoding_error: string | null;
  geocoded_address: string | null;
  geocoded_source_address: string | null;
  coordinate_locked: boolean;
  skipped: boolean;
}

const inFlightCoordinates = new Map<string, Promise<BusinessCoordinateResult>>();

export function selectCoordinateAddress(
  info: { address1?: string | null; address2?: string | null } | null,
  fallbackAddress?: string | null,
) {
  const candidates = [info?.address1, info?.address2, fallbackAddress];
  return candidates
    .map(normalizeAddressForGeocoding)
    .find(isValidAddress) || "";
}

function toResult(
  code: string,
  row: Record<string, any>,
  skipped: boolean,
): BusinessCoordinateResult {
  return {
    code,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    geocoding_status: row.geocoding_status || "PENDING",
    geocoding_error: row.geocoding_error ?? null,
    geocoded_address: row.geocoded_address ?? null,
    geocoded_source_address: row.geocoded_source_address ?? null,
    coordinate_locked: row.coordinate_locked === true,
    skipped,
  };
}

async function mirrorCoordinateToTargets(
  supabase: SupabaseClient,
  code: string,
  coordinate: Record<string, any>,
) {
  // 구버전 화면과 배포 중 혼용되는 API를 위한 임시 호환 계층이다.
  // 좌표의 권위 있는 저장소는 business_info이며 이 복사본은 신규 생성하지 않는다.
  await supabase
    .from("measurement_target_business")
    .update(coordinate)
    .eq("code", code)
    .eq("coordinate_locked", false);
}

async function ensureCoordinateInternal(
  supabase: SupabaseClient,
  input: EnsureBusinessCoordinateInput,
): Promise<BusinessCoordinateResult> {
  const { data: existing, error: selectError } = await supabase
    .from("business_info")
    .select(
      "code, business_name, address1, address2, latitude, longitude, geocoded_address, geocoded_source_address, geocoding_status, geocoding_error, geocoded_at, geocode_provider, coordinate_locked",
    )
    .eq("code", input.code)
    .maybeSingle();

  if (selectError) throw selectError;

  const targetAddress = selectCoordinateAddress(existing, input.fallbackAddress);
  const normalizedSource = normalizeAddressForGeocoding(existing?.geocoded_source_address);
  const hasValidCoordinate = isValidKoreanCoordinate(existing?.latitude, existing?.longitude);

  if (existing?.coordinate_locked) {
    return toResult(input.code, existing, true);
  }

  if (
    !input.force &&
    hasValidCoordinate &&
    (!normalizedSource || normalizedSource === targetAddress)
  ) {
    return toResult(input.code, { ...existing, geocoding_status: "SUCCESS" }, true);
  }

  if (!targetAddress) {
    const missing = {
      latitude: null,
      longitude: null,
      geocoded_address: null,
      geocoded_source_address: null,
      geocoding_status: "ADDRESS_MISSING" as const,
      geocoding_error: "등록된 유효 주소가 없습니다.",
      geocoded_at: new Date().toISOString(),
      geocode_provider: null,
    };
    if (existing) {
      await supabase.from("business_info").update(missing).eq("code", input.code);
    } else {
      await supabase.from("business_info").insert({
        code: input.code,
        business_name: input.businessName || input.code,
        address1: input.fallbackAddress || null,
        ...missing,
      });
    }
    await mirrorCoordinateToTargets(supabase, input.code, missing);
    return toResult(input.code, missing, false);
  }

  const geocoded = await geocodeAddress(targetAddress);
  const coordinate = {
    latitude: geocoded.latitude,
    longitude: geocoded.longitude,
    geocoded_address: geocoded.geocoded_address,
    geocoded_source_address: targetAddress,
    geocoding_status: geocoded.geocoding_status,
    geocoding_error: geocoded.geocoding_error,
    geocoded_at: geocoded.geocoded_at,
    geocode_provider: geocoded.geocode_provider,
  };

  const payload = existing
    ? coordinate
    : {
        code: input.code,
        business_name: input.businessName || input.code,
        address1: input.fallbackAddress || null,
        ...coordinate,
      };
  const query = existing
    ? supabase.from("business_info").update(payload).eq("code", input.code)
    : supabase.from("business_info").insert(payload);
  const { error: saveError } = await query;
  if (saveError) throw saveError;

  await mirrorCoordinateToTargets(supabase, input.code, coordinate);
  return toResult(input.code, coordinate, false);
}

export function ensureBusinessCoordinate(
  supabase: SupabaseClient,
  input: EnsureBusinessCoordinateInput,
) {
  const key = `${input.code}|${normalizeAddressForGeocoding(input.fallbackAddress)}|${input.force === true}`;
  const running = inFlightCoordinates.get(key);
  if (running) return running;

  const request = ensureCoordinateInternal(supabase, input).finally(() => {
    inFlightCoordinates.delete(key);
  });
  inFlightCoordinates.set(key, request);
  return request;
}

export async function invalidateBusinessCoordinateForAddress(
  supabase: SupabaseClient,
  input: Omit<EnsureBusinessCoordinateInput, "force">,
) {
  const { data: existing } = await supabase
    .from("business_info")
    .select("address1, address2, geocoded_source_address, coordinate_locked")
    .eq("code", input.code)
    .maybeSingle();

  const nextAddress = normalizeAddressForGeocoding(input.fallbackAddress);
  const currentAddress = selectCoordinateAddress(existing, existing?.geocoded_source_address);
  const addressChanged = currentAddress !== nextAddress;
  if (!addressChanged || existing?.coordinate_locked) return { addressChanged: false };

  const stale = {
    address1: input.fallbackAddress || null,
    latitude: null,
    longitude: null,
    geocoded_address: null,
    geocoded_source_address: null,
    geocoding_status: "STALE" as const,
    geocoding_error: null,
    geocoded_at: null,
    geocode_provider: null,
  };
  if (existing) {
    await supabase.from("business_info").update(stale).eq("code", input.code);
  } else {
    await supabase.from("business_info").insert({
      code: input.code,
      business_name: input.businessName || input.code,
      ...stale,
    });
  }
  await mirrorCoordinateToTargets(supabase, input.code, stale);
  return { addressChanged: true };
}
