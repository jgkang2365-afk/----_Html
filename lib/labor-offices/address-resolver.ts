import { toShortName } from "@/lib/constants/designated-offices";
import { classifyKnownDesignatedOffice } from "@/lib/utils/jurisdiction-matcher";

export type LaborOfficeMatchStatus = "matched" | "unmatched" | "ambiguous";

export interface LaborOfficeMasterRow {
  office_code: string | null;
  current_official_name: string | null;
  current_short_name: string | null;
  jurisdiction_reference: string | null;
  is_active?: boolean | null;
}

export interface LaborOfficeAliasRow {
  office_code: string | null;
  business_office_name: string | null;
  document_office_name: string | null;
  mapping_note?: string | null;
  is_active?: boolean | null;
}

export interface LaborOfficeDirectory {
  offices: LaborOfficeMasterRow[];
  aliases: LaborOfficeAliasRow[];
}

export interface LaborOfficeAddressResolution {
  status: LaborOfficeMatchStatus;
  officeCode: string | null;
  currentOfficialName: string | null;
  currentShortName: string | null;
  officeJurisdictionDisplay: string | null;
  officeJurisdictionPersistence: string | null;
  designatedOffice: string | null;
}

const CURRENT_MASTER_ALIAS_NOTE = "현재 관서 마스터에 직접 연결";
const ADMIN_SUFFIX_PATTERN = /[가-힣0-9]+(?:시|군|구|읍|면|동|리)/g;
const DETAIL_SUFFIX_PATTERN = /(?:읍|면|동|리)$/;
const SIGUNGU_SUFFIX_PATTERN = /(?:시|군|구)$/;
const GENERIC_DISTRICTS = new Set(["중구", "서구", "남구", "동구", "북구"]);
const SIDO_NAMES = [
  "서울",
  "부산",
  "대구",
  "인천",
  "광주",
  "대전",
  "울산",
  "세종",
  "경기",
  "강원",
  "충북",
  "충남",
  "전북",
  "전남",
  "경북",
  "경남",
  "제주",
] as const;

const SIDO_ALIASES: Array<[RegExp, string]> = [
  [/서울특별시|서울시/g, "서울"],
  [/부산광역시|부산시/g, "부산"],
  [/대구광역시|대구시/g, "대구"],
  [/인천광역시|인천시/g, "인천"],
  [/광주광역시/g, "광주"],
  [/대전광역시|대전시/g, "대전"],
  [/울산광역시|울산시/g, "울산"],
  [/세종특별자치시|세종시/g, "세종"],
  [/경기도/g, "경기"],
  [/강원특별자치도|강원도/g, "강원"],
  [/충청북도/g, "충북"],
  [/충청남도/g, "충남"],
  [/전북특별자치도|전라북도/g, "전북"],
  [/전라남도/g, "전남"],
  [/경상북도/g, "경북"],
  [/경상남도/g, "경남"],
  [/제주특별자치도|제주도/g, "제주"],
];

const emptyResolution = (
  status: Exclude<LaborOfficeMatchStatus, "matched">
): LaborOfficeAddressResolution => ({
  status,
  officeCode: null,
  currentOfficialName: null,
  currentShortName: null,
  officeJurisdictionDisplay: null,
  officeJurisdictionPersistence: null,
  designatedOffice: null,
});

function normalizeAdministrativeText(value: unknown): string {
  let normalized = String(value ?? "").normalize("NFKC");
  for (const [pattern, replacement] of SIDO_ALIASES) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized
    .replace(/[·ㆍ/]/g, " ")
    .replace(/[()\[\],]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value: unknown): string {
  return normalizeAdministrativeText(value).replace(/\s+/g, "");
}

function extractSidos(value: unknown): Array<(typeof SIDO_NAMES)[number]> {
  const tokens = new Set(normalizeAdministrativeText(value).split(" ").filter(Boolean));
  return SIDO_NAMES.filter((sido) => tokens.has(sido));
}

function extractAdminTokens(value: unknown): string[] {
  return Array.from(
    new Set(normalizeAdministrativeText(value).match(ADMIN_SUFFIX_PATTERN) || [])
  );
}

function stripExclusions(reference: string): string {
  return reference.replace(/\([^)]*제외[^)]*\)/g, " ");
}

function exclusionMatches(address: string, reference: string): boolean {
  const addressCompact = compact(address);
  const exclusions = Array.from(reference.matchAll(/\(([^)]*제외[^)]*)\)/g));

  return exclusions.some((match) => {
    const requiredParts = normalizeAdministrativeText(match[1])
      .split(" ")
      .map((part) => part.trim())
      .filter(
        (part) =>
          part.length >= 2 &&
          !["제외", "내", "단", "단,"].includes(part)
      );
    return requiredParts.length > 0 && requiredParts.every((part) => addressCompact.includes(compact(part)));
  });
}

function scoreOfficeForAddress(address: string, office: LaborOfficeMasterRow): number | null {
  const reference = String(office.jurisdiction_reference ?? "").trim();
  if (!reference || exclusionMatches(address, reference)) return null;

  const addressTokens = new Set(extractAdminTokens(address));
  const addressSigunguTokens = Array.from(addressTokens).filter((token) =>
    SIGUNGU_SUFFIX_PATTERN.test(token)
  );
  const addressSidos = extractSidos(address);
  const positiveReference = stripExclusions(reference);
  const referenceSidos = extractSidos(positiveReference);

  if (
    addressSidos.length > 0 &&
    referenceSidos.length > 0 &&
    !addressSidos.some((sido) => referenceSidos.includes(sido))
  ) {
    return null;
  }

  const segments = positiveReference
    .replace(/[()]/g, ",")
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
  let bestScore = 0;

  for (const segment of segments) {
    const segmentTokens = extractAdminTokens(segment);
    const sigunguMatches = segmentTokens.filter(
      (token) => SIGUNGU_SUFFIX_PATTERN.test(token) && addressTokens.has(token)
    );
    if (sigunguMatches.length === 0) continue;

    const segmentDetails = segmentTokens.filter((token) => DETAIL_SUFFIX_PATTERN.test(token));
    if (
      segmentDetails.length > 0 &&
      !segmentDetails.every((detail) => addressTokens.has(detail))
    ) {
      continue;
    }

    const genericOnly = sigunguMatches.every((token) => GENERIC_DISTRICTS.has(token));
    if (genericOnly && addressSidos.length === 0) continue;

    const score =
      100 +
      Math.max(...sigunguMatches.map((token) => token.length)) * 10 +
      segmentDetails.length * 100;
    bestScore = Math.max(bestScore, score);
  }

  if (bestScore > 0) return bestScore;

  // 시·군·구까지 적히지 않은 주소나 광역시 단독 주소는 상위 시·도 일치만
  // 후보로 남긴다. 같은 시·도에 여러 관서가 있으면 아래 동률 처리에서 ambiguous가 된다.
  const standaloneReferenceSidos = segments
    .map((segment) => normalizeAdministrativeText(segment))
    .filter((segment): segment is (typeof SIDO_NAMES)[number] =>
      SIDO_NAMES.includes(segment as (typeof SIDO_NAMES)[number])
    );
  if (
    addressSidos.some((sido) => referenceSidos.includes(sido)) &&
    (addressSigunguTokens.length === 0 ||
      addressSidos.some((sido) => standaloneReferenceSidos.includes(sido)))
  ) {
    return 10;
  }

  return null;
}

function selectPersistenceAlias(
  office: LaborOfficeMasterRow,
  aliases: LaborOfficeAliasRow[]
): string | null {
  const officeCode = String(office.office_code ?? "").trim();
  const candidates = aliases.filter(
    (alias) => String(alias.office_code ?? "").trim() === officeCode
  );
  if (candidates.length === 0) return null;

  const directCandidates = candidates.filter(
    (alias) => String(alias.mapping_note ?? "").trim() === CURRENT_MASTER_ALIAS_NOTE
  );
  if (directCandidates.length === 1) {
    return String(directCandidates[0].business_office_name ?? "").trim() || null;
  }

  const currentOfficialName = String(office.current_official_name ?? "").trim();
  const currentNameCandidates = candidates.filter(
    (alias) => String(alias.business_office_name ?? "").trim() === currentOfficialName
  );
  if (currentNameCandidates.length === 1) return currentOfficialName;

  if (candidates.length === 1) {
    return String(candidates[0].business_office_name ?? "").trim() || null;
  }

  return null;
}

/**
 * labor_offices.current_short_name 전용 표시 규칙이다. 이미 `OO지청` 형태인
 * master 약칭은 지역 접두사를 보존하고, 지방고용노동청 본청명만 기존 약칭
 * 변환을 사용한다.
 */
export function toLaborOfficeDisplayName(currentShortName: unknown): string {
  const normalized = String(currentShortName ?? "").replace(/\s+/g, "").trim();
  if (!normalized) return "";
  if (normalized.endsWith("지청") && !normalized.includes("지방고용노동청")) {
    return normalized.slice(0, -2);
  }
  return toShortName(normalized);
}

function buildMatchedResolution(
  office: LaborOfficeMasterRow,
  aliases: LaborOfficeAliasRow[]
): LaborOfficeAddressResolution {
  const officeCode = String(office.office_code ?? "").trim();
  const currentOfficialName = String(office.current_official_name ?? "").trim();
  const currentShortName = String(office.current_short_name ?? "").trim();
  const officeJurisdictionDisplay = toLaborOfficeDisplayName(currentShortName);
  const officeJurisdictionPersistence = selectPersistenceAlias(office, aliases);

  if (!officeCode || !officeJurisdictionDisplay || !officeJurisdictionPersistence) {
    return {
      ...emptyResolution("ambiguous"),
      officeCode: officeCode || null,
      currentOfficialName: currentOfficialName || null,
      currentShortName: currentShortName || null,
      officeJurisdictionDisplay: officeJurisdictionDisplay || null,
    };
  }

  return {
    status: "matched",
    officeCode,
    currentOfficialName: currentOfficialName || null,
    currentShortName: currentShortName || null,
    officeJurisdictionDisplay,
    officeJurisdictionPersistence,
    designatedOffice: classifyKnownDesignatedOffice(officeJurisdictionDisplay),
  };
}

export function resolveLaborOfficeAddressFromDirectory(
  address: string | null | undefined,
  directory: LaborOfficeDirectory
): LaborOfficeAddressResolution {
  const normalizedAddress = normalizeAdministrativeText(address);
  if (!normalizedAddress) return emptyResolution("unmatched");

  const scored = directory.offices
    .map((office) => ({ office, score: scoreOfficeForAddress(normalizedAddress, office) }))
    .filter((candidate): candidate is { office: LaborOfficeMasterRow; score: number } =>
      candidate.score !== null
    );
  if (scored.length === 0) return emptyResolution("unmatched");

  const highestScore = Math.max(...scored.map((candidate) => candidate.score));
  const bestCandidates = scored.filter((candidate) => candidate.score === highestScore);
  if (bestCandidates.length !== 1) return emptyResolution("ambiguous");

  return buildMatchedResolution(bestCandidates[0].office, directory.aliases);
}

export function resolveLaborOfficeByStoredJurisdiction(
  officeJurisdiction: string | null | undefined,
  directory: LaborOfficeDirectory
): LaborOfficeAddressResolution {
  const stored = String(officeJurisdiction ?? "").trim();
  if (!stored) return emptyResolution("unmatched");

  const aliasOfficeCodes = Array.from(
    new Set(
      directory.aliases
        .filter(
          (alias) =>
            String(alias.business_office_name ?? "").trim() === stored ||
            String(alias.document_office_name ?? "").trim() === stored
        )
        .map((alias) => String(alias.office_code ?? "").trim())
        .filter(Boolean)
    )
  );
  const directOfficeCodes = directory.offices
    .filter(
      (office) =>
        String(office.current_official_name ?? "").trim() === stored ||
        String(office.current_short_name ?? "").trim() === stored
    )
    .map((office) => String(office.office_code ?? "").trim())
    .filter(Boolean);
  const displayOfficeCodes = directory.offices
    .filter((office) => toLaborOfficeDisplayName(office.current_short_name) === stored)
    .map((office) => String(office.office_code ?? "").trim())
    .filter(Boolean);
  const candidateCodes =
    aliasOfficeCodes.length > 0
      ? aliasOfficeCodes
      : directOfficeCodes.length > 0
        ? directOfficeCodes
        : displayOfficeCodes;
  const uniqueCodes = Array.from(new Set(candidateCodes));
  if (uniqueCodes.length !== 1) {
    return emptyResolution(uniqueCodes.length === 0 ? "unmatched" : "ambiguous");
  }

  const candidates = directory.offices.filter(
    (office) => String(office.office_code ?? "").trim() === uniqueCodes[0]
  );
  if (candidates.length !== 1) return emptyResolution("ambiguous");
  return buildMatchedResolution(candidates[0], directory.aliases);
}

export async function loadLaborOfficeDirectory(supabase: any): Promise<LaborOfficeDirectory> {
  const [officeResult, aliasResult] = await Promise.all([
    supabase
      .from("labor_offices")
      .select(
        "office_code, current_official_name, current_short_name, jurisdiction_reference, is_active"
      )
      .eq("is_active", true),
    supabase
      .from("labor_office_aliases")
      .select(
        "office_code, business_office_name, document_office_name, mapping_note, is_active"
      )
      .eq("is_active", true),
  ]);
  if (officeResult.error) throw officeResult.error;
  if (aliasResult.error) throw aliasResult.error;

  return {
    offices: (officeResult.data || []) as LaborOfficeMasterRow[],
    aliases: (aliasResult.data || []) as LaborOfficeAliasRow[],
  };
}

export async function resolveLaborOfficeByAddress(
  supabase: any,
  address: string | null | undefined
): Promise<LaborOfficeAddressResolution> {
  const directory = await loadLaborOfficeDirectory(supabase);
  return resolveLaborOfficeAddressFromDirectory(address, directory);
}
