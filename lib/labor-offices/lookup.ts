import {
  normalizeJurisdictionReferenceToken,
  resolveLaborOfficeAddressFromDirectory,
  type LaborOfficeAliasRow,
  type LaborOfficeDirectory,
  type LaborOfficeMasterRow,
} from "./address-resolver";

export interface LaborOfficeLookupRow extends LaborOfficeMasterRow {
  phone?: string | null;
  fax?: string | null;
}

export interface LaborOfficeLookupResult {
  status: "matched" | "ambiguous" | "unmatched";
  candidates: LaborOfficeLookupRow[];
}

const BROAD_AREA_NAMES = new Set([
  "서울", "서울시", "서울특별시", "부산", "부산시", "부산광역시",
  "대구", "대구시", "대구광역시", "인천", "인천시", "인천광역시",
  "광주", "광주광역시", "대전", "대전시", "대전광역시",
  "울산", "울산시", "울산광역시", "세종", "세종시", "세종특별자치시",
  "경기", "경기도", "강원", "강원도", "강원특별자치도",
  "충북", "충청북도", "충남", "충청남도", "전북", "전라북도",
  "전북특별자치도", "전남", "전라남도", "경북", "경상북도",
  "경남", "경상남도", "제주", "제주도", "제주특별자치도",
]);

function compact(value: unknown): string {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, "").trim();
}

function officeTextMatches(
  query: string,
  office: LaborOfficeLookupRow,
  aliases: LaborOfficeAliasRow[],
): boolean {
  const queryCompact = compact(query);
  const queryToken = normalizeJurisdictionReferenceToken(query);
  const values = [
    office.current_official_name,
    office.current_short_name,
    office.jurisdiction_reference,
    ...aliases.filter((alias) => alias.office_code === office.office_code).flatMap((alias) => [
      alias.business_office_name,
      alias.document_office_name,
    ]),
  ];
  if (values.some((value) => compact(value).includes(queryCompact))) return true;
  if (!queryToken) return false;
  return jurisdictionTokenMatches(queryToken, office);
}

function jurisdictionTokenMatches(token: string, office: LaborOfficeLookupRow): boolean {
  return String(office.jurisdiction_reference ?? "")
    .split(/[,()]/)
    .some((segment) => normalizeJurisdictionReferenceToken(segment) === token);
}

export function lookupLaborOffices(
  query: unknown,
  directory: LaborOfficeDirectory,
): LaborOfficeLookupResult {
  const normalizedQuery = String(query ?? "").trim();
  if (!normalizedQuery) return { status: "unmatched", candidates: [] };
  const activeOffices = directory.offices.filter((office) => office.is_active !== false) as LaborOfficeLookupRow[];
  const direct = resolveLaborOfficeAddressFromDirectory(normalizedQuery, {
    offices: activeOffices,
    aliases: directory.aliases,
  });
  const candidateCodes = new Set<string>();
  if (direct.status === "matched" && direct.officeCode) candidateCodes.add(direct.officeCode);
  for (const office of activeOffices) {
    const singleton = resolveLaborOfficeAddressFromDirectory(normalizedQuery, {
      offices: [office], aliases: directory.aliases,
    });
    if (singleton.status === "matched" || officeTextMatches(normalizedQuery, office, directory.aliases)) {
      const code = String(office.office_code ?? "").trim();
      if (code) candidateCodes.add(code);
    }
  }
  const queryToken = normalizeJurisdictionReferenceToken(normalizedQuery);
  const explicitCodes = new Set(queryToken
    ? activeOffices.filter((office) => jurisdictionTokenMatches(queryToken, office))
      .map((office) => String(office.office_code ?? "").trim()).filter(Boolean)
    : []);
  if (explicitCodes.size > 0) {
    candidateCodes.clear();
    if (normalizedQuery.split(/\s+/).length > 1 && direct.status === "matched" &&
      direct.officeCode && explicitCodes.has(direct.officeCode)) {
      candidateCodes.add(direct.officeCode);
    } else {
      for (const code of explicitCodes) candidateCodes.add(code);
    }
  }
  const candidates = activeOffices
    .filter((office) => candidateCodes.has(String(office.office_code ?? "").trim()))
    .sort((left, right) => String(left.current_official_name ?? "").localeCompare(
      String(right.current_official_name ?? ""), "ko",
    ));
  return {
    status: BROAD_AREA_NAMES.has(compact(normalizedQuery)) || candidates.length > 1
      ? "ambiguous"
      : candidates.length === 1 ? "matched" : "unmatched",
    candidates,
  };
}
