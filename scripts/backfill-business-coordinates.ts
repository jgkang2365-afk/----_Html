import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import {
  ensureBusinessCoordinate,
  selectCoordinateAddress,
  type BusinessCoordinateResult,
} from "../lib/business-coordinates/service";
import { isValidKoreanCoordinate } from "../lib/measurement-map/types";
import { normalizeAddressForGeocoding } from "../lib/naver-map/geocoding";

type TargetRow = {
  id: string | number;
  code: string;
  business_name: string | null;
  address: string | null;
};

type InfoRow = {
  code: string;
  address1: string | null;
  address2: string | null;
  latitude: number | null;
  longitude: number | null;
  coordinate_locked: boolean | null;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Supabase 환경변수가 설정되지 않았습니다.");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

async function fetchAllTargets() {
  const rows: TargetRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("measurement_target_business")
      .select("id, code, business_name, address")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data || []) as TargetRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function fetchBusinessInfos(codes: string[]) {
  const rows: InfoRow[] = [];
  for (let index = 0; index < codes.length; index += 200) {
    const { data, error } = await supabase
      .from("business_info")
      .select("code, address1, address2, latitude, longitude, coordinate_locked")
      .in("code", codes.slice(index, index + 200));
    if (error) throw error;
    rows.push(...((data || []) as InfoRow[]));
  }
  return rows;
}

async function reuseCoordinate(
  target: TargetRow,
  address: string,
  result: BusinessCoordinateResult,
) {
  const payload = {
    latitude: result.latitude,
    longitude: result.longitude,
    geocoded_address: result.geocoded_address,
    geocoded_source_address: address || null,
    geocoding_status: result.geocoding_status,
    geocoding_error: result.geocoding_error,
    geocoded_at: new Date().toISOString(),
  };
  const { error: infoError } = await supabase
    .from("business_info")
    .update(payload)
    .eq("code", target.code)
    .eq("coordinate_locked", false);
  if (infoError) throw infoError;

  const { error: targetError } = await supabase
    .from("measurement_target_business")
    .update(payload)
    .eq("code", target.code)
    .eq("coordinate_locked", false);
  if (targetError) throw targetError;
}

async function main() {
  const targetRows = await fetchAllTargets();
  const targetByCode = new Map<string, TargetRow>();
  for (const target of targetRows) {
    if (target.code && !targetByCode.has(target.code)) targetByCode.set(target.code, target);
  }

  const infos = await fetchBusinessInfos(Array.from(targetByCode.keys()));
  const infoMap = new Map(infos.map((info) => [info.code, info]));
  const groups = new Map<string, Array<{ target: TargetRow; address: string }>>();
  let skipped = 0;

  for (const target of targetByCode.values()) {
    const info = infoMap.get(target.code);
    if (isValidKoreanCoordinate(info?.latitude, info?.longitude) || info?.coordinate_locked) {
      skipped += 1;
      continue;
    }
    const address = selectCoordinateAddress(info || null, target.address);
    const key = normalizeAddressForGeocoding(address) || `__missing__:${target.code}`;
    const group = groups.get(key) || [];
    group.push({ target, address });
    groups.set(key, group);
  }

  const work = Array.from(groups.values());
  const stats = { total: targetByCode.size, pending: work.reduce((sum, group) => sum + group.length, 0), success: 0, failed: 0, skipped };
  let nextIndex = 0;
  let processed = 0;

  console.log(JSON.stringify({ event: "start", ...stats, uniqueAddressRequests: work.length }));

  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      const group = work[index];
      if (!group) return;

      let firstResult: BusinessCoordinateResult | null = null;
      for (let itemIndex = 0; itemIndex < group.length; itemIndex += 1) {
        const { target, address } = group[itemIndex];
        try {
          const result = itemIndex === 0
            ? await ensureBusinessCoordinate(supabase, {
                code: target.code,
                businessName: target.business_name,
                fallbackAddress: address,
              })
            : firstResult
              ? (await reuseCoordinate(target, address, firstResult), {
                  ...firstResult,
                  code: target.code,
                  skipped: true,
                })
              : await ensureBusinessCoordinate(supabase, {
                  code: target.code,
                  businessName: target.business_name,
                  fallbackAddress: address,
                });
          if (itemIndex === 0) firstResult = result;
          if (result.geocoding_status === "SUCCESS" && isValidKoreanCoordinate(result.latitude, result.longitude)) {
            stats.success += 1;
          } else {
            stats.failed += 1;
          }
        } catch (error) {
          stats.failed += 1;
          console.error(JSON.stringify({
            event: "failure",
            code: target.code,
            reason: error instanceof Error ? error.message : "unknown",
          }));
        } finally {
          processed += 1;
          if (processed % 25 === 0 || processed === stats.pending) {
            console.log(JSON.stringify({
              event: "progress",
              processed,
              pending: stats.pending,
              success: stats.success,
              failed: stats.failed,
              skipped: stats.skipped,
            }));
          }
        }
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(3, work.length) }, () => worker()));
  console.log(JSON.stringify({ event: "complete", ...stats, processed }));
}

main().catch((error) => {
  console.error(JSON.stringify({
    event: "fatal",
    reason: error instanceof Error ? error.message : "unknown",
  }));
  process.exit(1);
});
