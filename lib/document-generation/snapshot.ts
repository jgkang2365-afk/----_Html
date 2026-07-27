import {
  buildBusinessYearPeriodLabel,
  buildManagerContact,
  formatBusinessNumber,
  normalizeMeasurementPeriod,
  normalizeText,
} from "./constants";
import { toShortName } from "@/lib/constants/designated-offices";

interface LaborOfficeAlias {
  business_office_name: string | null;
  office_code: string | null;
  document_office_name: string | null;
}

interface LaborOffice {
  office_code: string | null;
  current_official_name: string | null;
  current_short_name: string | null;
  phone: string | null;
  fax: string | null;
}

export interface LaborOfficeSnapshot {
  labor_office_name: string;
  labor_office_phone: string;
  labor_office_fax: string;
}

function officeComparisonKey(value: unknown): string {
  return toShortName(normalizeText(value)).replace(/\s+/g, "");
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string | null {
  const uniqueValues = Array.from(new Set(values.map(normalizeText).filter(Boolean)));
  return uniqueValues.length === 1 ? uniqueValues[0] : null;
}

function uniqueOfficeCode(rows: Array<{ office_code: string | null }>): string | null {
  return uniqueNonEmpty(rows.map((row) => row.office_code));
}

function findOfficeByCode(offices: LaborOffice[], officeCode: string | null): LaborOffice | null {
  if (!officeCode) return null;
  const candidates = offices.filter((office) => normalizeText(office.office_code) === officeCode);
  return candidates.length === 1 ? candidates[0] : null;
}

function emptyLaborOfficeSnapshot(): LaborOfficeSnapshot {
  return { labor_office_name: "", labor_office_phone: "", labor_office_fax: "" };
}

/**
 * Returns only an unambiguous active labor-office match.
 *
 * The raw jurisdiction is preferred for backward compatibility.  Older target
 * rows commonly contain a short name while aliases contain the formal name, so
 * the existing toShortName rule is the strictly limited fallback.
 */
export function resolveLaborOfficeSnapshot(
  officeJurisdiction: unknown,
  aliases: LaborOfficeAlias[],
  offices: LaborOffice[]
): LaborOfficeSnapshot {
  const jurisdiction = normalizeText(officeJurisdiction);
  if (!jurisdiction) {
    return emptyLaborOfficeSnapshot();
  }

  const exactAliases = aliases.filter(
    (alias) => normalizeText(alias.business_office_name) === jurisdiction
  );
  const aliasCandidates =
    exactAliases.length > 0
      ? exactAliases
      : aliases.filter(
          (alias) =>
            officeComparisonKey(alias.business_office_name) === officeComparisonKey(jurisdiction)
        );
  const aliasOfficeCode = uniqueOfficeCode(aliasCandidates);

  const exactOffices = offices.filter(
    (office) =>
      normalizeText(office.current_short_name) === jurisdiction ||
      normalizeText(office.current_official_name) === jurisdiction
  );
  const directOfficeCandidates =
    exactOffices.length > 0
      ? exactOffices
      : offices.filter(
          (office) =>
            officeComparisonKey(office.current_short_name) === officeComparisonKey(jurisdiction) ||
            officeComparisonKey(office.current_official_name) === officeComparisonKey(jurisdiction)
        );
  const directOfficeCode = uniqueOfficeCode(directOfficeCandidates);

  // A matched alias must resolve completely through one active master row.
  // Stale or ambiguous aliases must not fall through to a different office.
  const matchedOffice =
    aliasCandidates.length > 0
      ? findOfficeByCode(offices, aliasOfficeCode)
      : findOfficeByCode(offices, directOfficeCode);
  if (!matchedOffice) return emptyLaborOfficeSnapshot();

  const documentOfficeNames =
    aliasCandidates.length > 0 && aliasOfficeCode
      ? Array.from(
          new Set(
            aliasCandidates
              .filter((alias) => normalizeText(alias.office_code) === aliasOfficeCode)
              .map((alias) => normalizeText(alias.document_office_name))
              .filter(Boolean)
          )
        )
      : [];
  if (documentOfficeNames.length > 1) return emptyLaborOfficeSnapshot();
  const documentOfficeName = documentOfficeNames[0] || "";

  return {
    labor_office_name:
      documentOfficeName ||
      normalizeText(matchedOffice?.current_official_name) ||
      normalizeText(matchedOffice?.current_short_name),
    labor_office_phone: normalizeText(matchedOffice?.phone),
    labor_office_fax: normalizeText(matchedOffice?.fax),
  };
}

async function loadLaborOfficeSnapshot(supabase: any, officeJurisdiction: unknown) {
  if (!normalizeText(officeJurisdiction)) {
    return { labor_office_name: "", labor_office_phone: "", labor_office_fax: "" };
  }

  const [aliasResult, officeResult] = await Promise.all([
    supabase
      .from("labor_office_aliases")
      .select("business_office_name, office_code, document_office_name")
      .eq("is_active", true),
    supabase
      .from("labor_offices")
      .select("office_code, current_official_name, current_short_name, phone, fax")
      .eq("is_active", true),
  ]);
  if (aliasResult.error) throw aliasResult.error;
  if (officeResult.error) throw officeResult.error;

  return resolveLaborOfficeSnapshot(
    officeJurisdiction,
    (aliasResult.data || []) as LaborOfficeAlias[],
    (officeResult.data || []) as LaborOffice[]
  );
}

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

  const [
    { data: businessInfo, error: infoError },
    { data: survey, error: surveyError },
    laborOfficeSnapshot,
  ] = await Promise.all([
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
    loadLaborOfficeSnapshot(supabase, target.office_jurisdiction),
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
    ...laborOfficeSnapshot,
    business_year_period_label: buildBusinessYearPeriodLabel(
      target.business_name,
      target.year,
      period
    ),
  };

  return { target, snapshot };
}
