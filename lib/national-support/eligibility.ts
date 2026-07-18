export type NationalSupportLookupInput = {
  period?: string | null;
  national_support_status?: string | null;
  sync_status?: string | null;
  industrial_accident_number?: string | null;
  commencement_number?: string | null;
  representative_name?: string | null;
};

const IN_PROGRESS_STATUSES = new Set(["신청중", "조회중"]);
const COMPLETED_STATUSES = new Set(["대상", "비대상"]);

export function normalizeElevenDigitNumber(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 11 ? digits : null;
}

function extractLabelledNumber(notes: string, labels: string[]): string | null {
  const labelPattern = [...labels].sort((a, b) => b.length - a.length).join("|");
  const pattern = new RegExp(
    `(?:${labelPattern})\\s*(?:[:：=]|-)?\\s*([0-9][0-9\\s-]{9,20})`,
    "i",
  );
  const match = notes.match(pattern);
  return normalizeElevenDigitNumber(match?.[1]);
}

export function extractInsuranceNumbers(notes: unknown) {
  const text = String(notes ?? "");
  return {
    industrialAccidentNumber: extractLabelledNumber(text, [
      "산재관리번호",
      "산재번호",
      "산재",
    ]),
    commencementNumber: extractLabelledNumber(text, [
      "사업개시번호",
      "개시번호",
      "개시",
    ]),
  };
}

export function isAdHocMeasurement(period: unknown) {
  return String(period ?? "").includes("(수시)");
}

export function hasNationalSupportLookupInformation(
  input: NationalSupportLookupInput,
) {
  return Boolean(
    normalizeElevenDigitNumber(input.industrial_accident_number) &&
      normalizeElevenDigitNumber(input.commencement_number) &&
      input.representative_name?.trim(),
  );
}

export function canRequestNationalSupportLookup(
  input: NationalSupportLookupInput,
) {
  if (isAdHocMeasurement(input.period)) return false;
  if (input.national_support_status === "비대상") return false;
  if (IN_PROGRESS_STATUSES.has(input.sync_status || "")) return false;
  if (
    input.sync_status === "성공" &&
    COMPLETED_STATUSES.has(input.national_support_status || "")
  ) {
    return false;
  }
  return hasNationalSupportLookupInformation(input);
}

export function getNationalSupportDisplayStatus(
  input: NationalSupportLookupInput,
) {
  if (isAdHocMeasurement(input.period)) return "비대상";
  if (COMPLETED_STATUSES.has(input.national_support_status || "")) {
    return input.national_support_status as "대상" | "비대상";
  }

  switch (input.sync_status) {
    case "신청중":
    case "조회중":
      return "조회 중";
    case "실패":
      return "조회 실패";
    case "확인대기":
    case "조회대기":
    case "대기":
      return "조회 대기";
    case "정보부족":
      return "정보 부족";
    default:
      return hasNationalSupportLookupInformation(input) ? "조회 대기" : "미확인";
  }
}

export function getInitialNationalSupportState(
  input: NationalSupportLookupInput,
) {
  if (isAdHocMeasurement(input.period)) {
    return {
      nationalSupportStatus: "비대상" as const,
      syncStatus: "성공" as const,
      shouldQueueLookup: false,
    };
  }

  const hasLookupInfo = hasNationalSupportLookupInformation(input);
  return {
    nationalSupportStatus: null,
    syncStatus: hasLookupInfo ? ("조회대기" as const) : ("정보부족" as const),
    shouldQueueLookup: hasLookupInfo,
  };
}
