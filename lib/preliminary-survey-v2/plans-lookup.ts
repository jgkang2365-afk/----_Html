import type { SupabaseClient } from "@supabase/supabase-js";

type Client = SupabaseClient<any, "public", any>;

export interface V2PlanLookupEntry {
  code: string;
  year: number;
  period: string;
  recommended_date: string | null;
  participant_names: string[];
  responsible_user_name: string | null;
  status: string | null;
}

const keyOf = (code: string, year: number, period: string) => `${code}|${year}|${period}`;

/**
 * code+year+period 기준으로 V2 plan을 일괄 조회한다.
 * row별 개별 호출(N+1) 없이 targets 1회 + plans 1회로 처리한다.
 * V2 plan이 없으면 해당 key는 map에 없다.
 */
export async function loadV2PlansByTargetKeys(
  supabase: Client,
  keys: Array<{ code: string; year: number | null; period: string | null }>,
): Promise<Map<string, V2PlanLookupEntry>> {
  const map = new Map<string, V2PlanLookupEntry>();
  const valid = keys.filter((k) => k.code && k.year != null && k.period != null);
  if (!valid.length) return map;

  const codes = [...new Set(valid.map((k) => k.code))];
  const { data: targets, error: targetError } = await supabase
    .from("measurement_target_business")
    .select("id, code, year, period")
    .in("code", codes);
  if (targetError) return map;

  const targetByKey = new Map<string, { id: number; code: string; year: number; period: string }>();
  for (const t of targets ?? []) {
    const key = keyOf(String(t.code), Number(t.year), String(t.period).trim());
    targetByKey.set(key, { id: Number(t.id), code: String(t.code), year: Number(t.year), period: String(t.period) });
  }
  const targetIds = [...new Set([...targetByKey.values()].map((t) => t.id))];
  if (!targetIds.length) return map;

  const { data: plans, error: planError } = await supabase
    .from("preliminary_survey_v2_plans")
    .select("measurement_target_business_id, recommended_date, participant_names, status")
    .in("measurement_target_business_id", targetIds);
  if (planError) return map;

  const targetIdToKey = new Map<number, string>();
  for (const [key, t] of targetByKey) targetIdToKey.set(t.id, key);

  for (const plan of plans ?? []) {
    const key = targetIdToKey.get(Number(plan.measurement_target_business_id));
    const target = key ? targetByKey.get(key) : undefined;
    if (!key || !target) continue;
    const participants = Array.isArray(plan.participant_names)
      ? plan.participant_names.map((n: unknown) => String(n)).filter(Boolean)
      : [];
    map.set(key, {
      code: target.code,
      year: target.year,
      period: target.period,
      recommended_date: plan.recommended_date ?? null,
      participant_names: participants,
      responsible_user_name: participants[0] ?? null,
      status: plan.status ?? null,
    });
  }
  return map;
}
