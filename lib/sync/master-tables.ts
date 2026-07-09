/**
 * 건강디딤돌 조회로 확정된 가입력 정보를 마스터 테이블에 동기화합니다.
 */
export async function syncToMasterTables(
  supabase: any,
  code: string,
  year: number,
  period: string,
  businessName: string,
  representativeName: string | null,
  industrialAccidentNumber: string | null,
  commencementNumber: string | null
) {
  if (code) {
    const { error } = await supabase.from("business_info").upsert({
      code,
      business_name: businessName,
      representative_name: representativeName,
      updated_at: new Date().toISOString(),
    }, { onConflict: "code" });

    if (error) throw error;
  }

  if (code && year && period) {
    const { error } = await supabase.from("measurement_business").upsert({
      code,
      year,
      period,
      business_name: businessName,
      representative_name: representativeName,
      industrial_accident_number: industrialAccidentNumber,
      commencement_number: commencementNumber,
      updated_at: new Date().toISOString(),
    }, { onConflict: "code,year,period" });

    if (error) throw error;
  }
}
