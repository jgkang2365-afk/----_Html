import {
  buildBusinessYearPeriodLabel,
  buildManagerContact,
  formatBusinessNumber,
  normalizeMeasurementPeriod,
  normalizeText,
} from "./constants";

export async function buildDocumentSnapshot(supabase: any, businessId: number) {
  const { data: target, error: targetError } = await supabase
    .from("measurement_target_business")
    .select("*")
    .eq("id", businessId)
    .maybeSingle();
  if (targetError) throw targetError;
  if (!target) throw new Error("DOCUMENT_TARGET_NOT_FOUND");

  const period = normalizeMeasurementPeriod(target.period);
  if (!period) throw new Error("지원하지 않는 측정주기입니다.");

  const [{ data: businessInfo, error: infoError }, { data: survey, error: surveyError }] =
    await Promise.all([
      supabase
        .from("business_info")
        .select("invoice_email, main_product")
        .eq("code", target.code)
        .maybeSingle(),
      supabase
        .from("preliminary_survey")
        .select("preliminary_surveyor")
        .eq("code", target.code)
        .eq("year", target.year)
        .eq("period", target.period)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
  if (infoError) throw infoError;
  if (surveyError) throw surveyError;

  const snapshot = {
    measurement_year: String(target.year),
    measurement_period: period,
    business_id: target.id,
    business_code: normalizeText(target.code),
    business_name: normalizeText(target.business_name),
    representative_name: normalizeText(target.representative_name),
    address: normalizeText(target.address),
    business_category: normalizeText(target.business_category),
    phone: normalizeText(target.phone),
    main_product: normalizeText(businessInfo?.main_product),
    fax: normalizeText(target.fax),
    total_employees: normalizeText(target.total_employees),
    manager_name: normalizeText(target.manager_name),
    manager_email: normalizeText(target.manager_email),
    manager_mobile: normalizeText(target.manager_mobile),
    manager_phone: normalizeText(target.manager_phone),
    manager_contact: buildManagerContact(target.manager_mobile, target.manager_phone),
    invoice_email: normalizeText(businessInfo?.invoice_email),
    business_number: formatBusinessNumber(target.business_number),
    industrial_accident_number: normalizeText(target.industrial_accident_number),
    preliminary_surveyor: normalizeText(survey?.preliminary_surveyor),
    business_year_period_label: buildBusinessYearPeriodLabel(
      target.business_name,
      target.year,
      period
    ),
  };

  return { target, snapshot };
}
