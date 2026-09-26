export const NATIONAL_SUPPORT_PROCESSING_STATUS_HEADERS = [
  "사업년도",
  "파일명",
  "접수번호",
  "사업장관리번호",
  "사업장개시번호",
  "사업장명",
  "순번",
  "반기",
  "파일전송일",
  "파일상태",
  "반송/삭감사유",
  "신청금액",
  "1차 심사일",
  "비용지급일",
  "공단산정금액",
  "삭감금액",
  "심사금액",
  "지급예정금액",
  "입금일",
] as const;

export const NATIONAL_SUPPORT_REQUIRED_HEADERS = [
  "사업년도",
  "사업장관리번호",
  "사업장개시번호",
  "반기",
  "지급예정금액",
  "입금일",
] as const;
export type NationalSupportPaymentRow = {
  year: string | null;
  period: "상반기" | "하반기" | null;
  accidentNumber: string | null;
  commencementNumber: string | null;
  businessName: string;
  depositDate: string | null;
  depositAmount: number | null;
};

function pick(row: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return null;
}

export function normalizeElevenDigitIdentifier(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value).toString()
    : String(value).trim();
  const digits = text.replace(/\D/g, "");
  if (!digits || digits.length > 11) return null;
  return digits.padStart(11, "0");
}
export function normalizeNationalSupportYear(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  return /^\d{4}$/.test(digits) ? digits : null;
}

export function normalizeNationalSupportPeriod(value: unknown): "상반기" | "하반기" | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text === "상반기" || text.includes("수시(상)")) return "상반기";
  if (text === "하반기" || text.includes("수시(하)")) return "하반기";
  return null;
}

function validDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function yyyymmdd(value: string): string | null {
  if (!/^\d{8}$/.test(value)) return null;
  return validDate(Number(value.slice(0, 4)), Number(value.slice(4, 6)), Number(value.slice(6, 8)));
}
export function normalizeNationalSupportPaymentDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return validDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const integerText = Math.trunc(value).toString();
    const direct = yyyymmdd(integerText);
    if (direct) return direct;
    if (value > 0 && value < 100000) {
      const excelEpoch = Date.UTC(1899, 11, 30);
      const date = new Date(excelEpoch + Math.floor(value) * 86400000);
      return validDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    }
  }

  const text = String(value ?? "").trim();
  if (!text) return null;
  const digits = text.replace(/\D/g, "");
  const direct = yyyymmdd(digits);
  if (direct) return direct;

  const match = text.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
  return match ? validDate(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

export function normalizeNationalSupportAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number"
    ? value
    : Number(String(value).replace(/[,\s원₩]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
export function normalizeNationalSupportBusinessName(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function normalizeNationalSupportPaymentRow(
  row: Record<string, unknown>,
): NationalSupportPaymentRow {
  const businessNameValue = pick(row, ["사업장명"]);
  return {
    year: normalizeNationalSupportYear(pick(row, ["사업년도", "측정년도"])),
    period: normalizeNationalSupportPeriod(pick(row, ["반기", "측정주기"])),
    accidentNumber: normalizeElevenDigitIdentifier(pick(row, ["사업장관리번호", "산재관리번호"])),
    commencementNumber: normalizeElevenDigitIdentifier(pick(row, ["사업장개시번호", "개시번호"])),
    businessName: businessNameValue ? String(businessNameValue).trim() : "",
    depositDate: normalizeNationalSupportPaymentDate(pick(row, ["입금일"])),
    depositAmount: normalizeNationalSupportAmount(pick(row, ["지급예정금액", "입금액"])),
  };
}

export function getNationalSupportPaymentMissingFields(row: NationalSupportPaymentRow): string[] {
  const missing: string[] = [];
  if (!row.year) missing.push("사업년도");
  if (!row.accidentNumber) missing.push("사업장관리번호");
  if (!row.commencementNumber) missing.push("사업장개시번호");
  if (!row.period) missing.push("반기");
  if (!row.depositDate) missing.push("입금일");
  if (row.depositAmount === null) missing.push("지급예정금액");
  return missing;
}

export function nationalSupportPaymentIdentity(row: NationalSupportPaymentRow): string {
  return [row.year, row.period, row.accidentNumber, row.commencementNumber]
    .map((value) => value ?? "")
    .join("\u0000");
}
