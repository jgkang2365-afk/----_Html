import type { SupabaseClient } from "@supabase/supabase-js";
import { isSingleNationalSupportRepresentative, isValidNationalSupportContactName,
  isValidNationalSupportMobile, normalizeElevenDigitNumber } from "./eligibility";
import { resolveNationalSupportRepresentative } from "./representative";
import { normalizeContactName } from "@/lib/utils/data-utils";

type ApplyPayload = {
  target_id: number | string;
  code: string;
  year: number | string;
  period: string;
  sanjae: string;
  commencement: string;
  representative: string;
  contact_name?: string;
  contact_phone?: string;
};

/** 신청 payload가 현재 저장된 업무정보와 여전히 일치할 때만 외부 effect를 허용한다. */
export async function isCurrentNationalSupportApplicationReady(
  supabase: SupabaseClient<any>, payload: ApplyPayload,
): Promise<boolean> {
  const { data: target, error: targetError } = await supabase.from("measurement_target_business")
    .select("id,code,year,period,representative_name,industrial_accident_number,commencement_number,manager_name,manager_mobile")
    .eq("id", payload.target_id).maybeSingle();
  if (targetError) throw targetError;
  if (!target || String(target.code) !== String(payload.code) ||
      Number(target.year) !== Number(payload.year) || String(target.period) !== String(payload.period)) return false;
  const { data: businessInfo, error: infoError } = await supabase.from("business_info")
    .select("representative_name,national_support_representative_name")
    .eq("code", target.code).maybeSingle();
  if (infoError) throw infoError;
  const representative = resolveNationalSupportRepresentative(
    businessInfo?.national_support_representative_name,
    businessInfo?.representative_name || target.representative_name,
  );
  const sanjae = normalizeElevenDigitNumber(target.industrial_accident_number);
  const commencement = normalizeElevenDigitNumber(target.commencement_number);
  const contactName = normalizeContactName(target.manager_name || "");
  const contactPhone = String(target.manager_mobile || "").replace(/\D/g, "");
  return Boolean(
    sanjae && sanjae === normalizeElevenDigitNumber(payload.sanjae) &&
    commencement && commencement === normalizeElevenDigitNumber(payload.commencement) &&
    representative && representative === payload.representative &&
    isSingleNationalSupportRepresentative(representative) &&
    isValidNationalSupportContactName(contactName) &&
    contactName === normalizeContactName(payload.contact_name || "") &&
    isValidNationalSupportMobile(contactPhone) &&
    contactPhone === String(payload.contact_phone || "").replace(/\D/g, ""),
  );
}
