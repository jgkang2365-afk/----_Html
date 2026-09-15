import { normalizeNationalSupportRepresentativeOverride } from "./representative";

/**
 * 신청 대표자 override는 business_info의 부가 필드다. target을 수정하기 전에
 * master 존재 여부를 확인해, 예측 가능한 missing-master 오류가 partial write로
 * 바뀌지 않게 한다.
 */
export async function hasNationalSupportRepresentativeMaster(
  supabase: any,
  code: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("business_info")
    .select("code")
    .eq("code", code)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/** business master에만 건강디딤돌 override를 저장한다. 기본 대표자 원본은 건드리지 않는다. */
export async function saveNationalSupportRepresentativeOverride(
  supabase: any,
  params: { code: string; businessName: string; representativeName: unknown; override: unknown },
) {
  const override = normalizeNationalSupportRepresentativeOverride(params.override, params.representativeName);
  const updates = {
    national_support_representative_name: override,
    updated_at: new Date().toISOString(),
  };
  const { data: existing, error: updateError } = await supabase
    .from("business_info")
    .update(updates)
    .eq("code", params.code)
    .select("code")
    .maybeSingle();
  if (updateError) throw updateError;
  if (existing) return override;

  // 신청 대표자 override는 이미 존재하는 master의 부가 정보다. 이 값 하나만
  // 저장하려고 필수 정보가 빠진 synthetic business_info 행을 만들면 안 된다.
  throw new Error(`NATIONAL_SUPPORT_BUSINESS_INFO_NOT_FOUND:${params.code}`);
}
