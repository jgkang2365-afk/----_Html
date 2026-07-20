import { extractInsuranceNumbers } from "@/lib/national-support/eligibility";

export function mapBusinessInfoToRegistrationSearchResult(
  business: any,
  officeJurisdiction: string,
  unpaidCount = 0,
  nationalUnpaidCount = 0,
) {
  const extracted = extractInsuranceNumbers(business.notes);
  return {
    code: business.code,
    business_number: business.business_number || "",
    business_name: business.business_name,
    representative_name: business.representative_name || "",
    address: [business.address1, business.address2].filter(Boolean).join(" ").trim(),
    business_category: business.business_category || "",
    phone: business.phone || "",
    fax: business.fax || "",
    invoice_email: business.invoice_email || "",
    industrial_accident_number: extracted.industrialAccidentNumber || "",
    commencement_number: extracted.commencementNumber || "",
    invoice_contact_candidate: business.invoice_manager || business.manager_name
      ? {
          name: business.invoice_manager || business.manager_name || "",
          position: business.manager_position || "",
          contact: business.manager_contact || "",
        }
      : null,
    notes: business.notes || "",
    office_jurisdiction: officeJurisdiction,
    unpaid_count: unpaidCount,
    national_unpaid_count: nationalUnpaidCount,
  };
}
