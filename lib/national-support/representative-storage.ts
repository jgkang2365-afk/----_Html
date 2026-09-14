import { normalizeNationalSupportRepresentativeOverride } from "./representative";

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

  const { error } = await supabase.from("business_info").insert({
    code: params.code,
    business_name: params.businessName,
    ...updates,
  });
  if (error) throw error;
  return override;
}
