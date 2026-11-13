import { toShortName } from "@/lib/constants/designated-offices";
import type { LaborOfficeDirectory } from "@/lib/labor-offices/address-resolver";

/** 기존 노동관서 마스터의 현행 약칭 형식만 처리하는 클라이언트 안전 함수. */
function toMasterDisplayName(currentShortName: unknown): string {
  const compact = String(currentShortName ?? "").replace(/\s+/g, "").trim();
  if (!compact) return "";
  if (compact.endsWith("지청") && !compact.includes("지방고용노동청")) {
    return compact.slice(0, -2);
  }
  return toShortName(compact);
}

/**
 * 관할지청 표시명의 유일한 근거는 Supabase의 활성 관서 마스터와 별칭입니다.
 * 모호한 별칭이 여러 관서에 연결되면 임의로 확정하지 않습니다.
 */
const compactOfficeName = (value: unknown): string =>
  String(value ?? "").normalize("NFKC").replace(/\s+/g, "").trim();

export type OfficeJurisdictionDisplayLookup = ReadonlyMap<string, string>;

export function buildOfficeJurisdictionDisplayLookup(
  directory: LaborOfficeDirectory,
): OfficeJurisdictionDisplayLookup {
  const byCode = new Map(
    directory.offices
      .filter((office) => office.is_active !== false && office.office_code)
      .map((office) => [String(office.office_code), office] as const),
  );
  const codesByName = new Map<string, Set<string>>();

  const addName = (value: unknown, officeCode: string) => {
    const name = compactOfficeName(value);
    if (!name) return;
    const codes = codesByName.get(name) ?? new Set<string>();
    codes.add(officeCode);
    codesByName.set(name, codes);
  };

  for (const [code, office] of byCode) {
    addName(office.current_official_name, code);
    addName(office.current_short_name, code);
    addName(toMasterDisplayName(office.current_short_name), code);
    if (code === "SEOUL") {
      // 기존 데이터의 '서울'은 서울청 본청을 의미하며, 구 지청과 혼동하지 않습니다.
      addName("서울", code);
      addName("서울청", code);
    }
  }

  for (const alias of directory.aliases) {
    const code = String(alias.office_code ?? "");
    if (alias.is_active === false || !byCode.has(code)) continue;
    addName(alias.business_office_name, code);
    addName(alias.document_office_name, code);
  }

  const displayLookup = new Map<string, string>();
  for (const [name, codes] of codesByName) {
    if (codes.size !== 1) continue;
    const code = [...codes][0];
    const office = byCode.get(code);
    const display = code === "SEOUL"
      ? "서울청"
      : toMasterDisplayName(office?.current_short_name);
    if (display) displayLookup.set(name, display);
  }
  return displayLookup;
}

export function toOfficeJurisdictionDisplayName(
  value: unknown,
  lookup: OfficeJurisdictionDisplayLookup = new Map(),
): string | null {
  const original = String(value ?? "").trim();
  if (!original) return null;
  return lookup.get(compactOfficeName(original)) ?? original;
}

export interface SummaryOfficeRow {
  office_jurisdiction?: string | null;
  office_jurisdiction_display?: string | null;
  office_jurisdiction_original?: string | null;
}

/**
 * 필터·빠른 검색·정렬·XLSX용 표시 행 복사.
 * 측정일지 원본 관할값과 DB는 변경하지 않습니다.
 */
export function toOfficeDisplayRows<T extends SummaryOfficeRow>(
  rows: readonly T[],
): Array<Omit<T, "office_jurisdiction"> & {
  office_jurisdiction: string | null;
  office_jurisdiction_original: string | null | undefined;
}> {
  return rows.map(({ office_jurisdiction, ...rest }) => ({
    ...rest,
    office_jurisdiction_original: office_jurisdiction,
    office_jurisdiction: rest.office_jurisdiction_display ??
      toOfficeJurisdictionDisplayName(office_jurisdiction),
  }));
}
