import { extractInsuranceNumbers, normalizeElevenDigitNumber } from "@/lib/national-support/eligibility";
import { normalizeNationalSupportRepresentative } from "@/lib/national-support/representative";

export type LatestTargetBusinessInfo = {
  code: string;
  notes?: string | null;
  representative_name?: string | null;
  national_support_representative_name?: string | null;
};

export type TargetEditEnrichmentInput = {
  code: string;
  business_type?: string | null;
  sanjae?: string | null;
  commencement?: string | null;
  industrial_accident_number?: string | null;
  commencement_number?: string | null;
  representative_name?: string | null;
  national_support_representative_name?: string | null;
};

/** 사업장정보의 최신 메모는 두 신규 유형의 빈 조회 입력만 보완한다. */
export function buildTargetEditEnrichment(
  target: TargetEditEnrichmentInput,
  businessInfo: LatestTargetBusinessInfo | null,
) {
  if (!businessInfo || businessInfo.code !== target.code ||
      !["first_measurement", "external_new"].includes(target.business_type || "")) return {};

  const extracted = extractInsuranceNumbers(businessInfo.notes);
  const result: {
    sanjae?: string;
    commencement?: string;
    representative_name?: string;
    national_support_representative_name?: string;
  } = {};

  if (!normalizeElevenDigitNumber(target.sanjae || target.industrial_accident_number) && extracted.industrialAccidentNumber) {
    result.sanjae = extracted.industrialAccidentNumber;
  }
  if (!normalizeElevenDigitNumber(target.commencement || target.commencement_number) && extracted.commencementNumber) {
    result.commencement = extracted.commencementNumber;
  }
  if (!normalizeNationalSupportRepresentative(target.representative_name)) {
    const base = normalizeNationalSupportRepresentative(businessInfo.representative_name);
    if (base) result.representative_name = base;
  }
  if (!normalizeNationalSupportRepresentative(target.national_support_representative_name)) {
    const override = normalizeNationalSupportRepresentative(businessInfo.national_support_representative_name);
    if (override) result.national_support_representative_name = override;
  }
  return result;
}
