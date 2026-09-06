import {
  type LaborOfficeDirectory,
  resolveLaborOfficeAddressFromDirectory,
} from "@/lib/labor-offices/address-resolver";

export type IntegritySeverity = "ERROR" | "WARNING" | "REVIEW" | "NORMAL";

export type IntegrityIssue = {
  severity: IntegritySeverity;
  businessName: string;
  code: string;
  type: string;
  currentValue: string;
  referenceValue: string;
  status: "오류" | "확인필요" | "정상";
};

export type IntegrityTarget = {
  code: string | null;
  business_name: string | null;
  business_number?: string | null;
  address?: string | null;
  office_jurisdiction?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geocoding_status?: string | null;
  geocoding_error?: string | null;
  measurement_date?: string | null;
  measurement_end_date?: string | null;
  year?: number | null;
  period?: string | null;
  sync_status?: string | null;
};

export type IntegrityBusinessInfo = {
  code: string | null;
  business_name?: string | null;
  business_number?: string | null;
  address1?: string | null;
  address2?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geocoded_address?: string | null;
  geocoded_source_address?: string | null;
  geocoding_status?: string | null;
  geocoding_error?: string | null;
  geocoded_at?: string | null;
  geocode_provider?: string | null;
  coordinate_locked?: boolean | null;
};

export type IntegrityJournal = {
  code: string | null;
  measurement_year: number | null;
  measurement_period: string | null;
};

export function normalizeIntegrityText(value: unknown): string {
  return String(value ?? "").normalize("NFKC").replace(/[^0-9A-Za-z가-힣]/g, "").toLowerCase();
}

export function hasIntegrityCoordinates(row: Pick<IntegrityTarget, "latitude" | "longitude"> | IntegrityBusinessInfo): boolean {
  return typeof row.latitude === "number" && Number.isFinite(row.latitude)
    && typeof row.longitude === "number" && Number.isFinite(row.longitude);
}

export function getIntegrityBusinessInfoAddress(info: IntegrityBusinessInfo): string {
  return [info.address1, info.address2]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

function display(value: unknown): string {
  return String(value ?? "").trim() || "-";
}

const ACTION_NEEDED_SYNC_STATES = new Set([
  "정보부족", "조회대기", "조회중", "확인대기", "신청중", "신청완료대기", "비대상대기", "수동확인필요", "실패",
]);

/**
 * 측정대상 사업장 점검 전용의 순수 함수다. 기존 sync 검증과 달리 저장·특이사항
 * 동기화·상태 변경을 전혀 하지 않으며, 불확실한 원천은 확인필요로 남긴다.
 */
export function inspectMeasurementTargetIntegrity(input: {
  targets: IntegrityTarget[];
  businessInfos: IntegrityBusinessInfo[];
  journals: IntegrityJournal[];
  laborOfficeDirectory: LaborOfficeDirectory;
}): IntegrityIssue[] {
  const infoByCode = new Map(input.businessInfos.map((item) => [String(item.code ?? "").trim(), item]));
  const journalsByCode = new Map<string, IntegrityJournal[]>();
  for (const journal of input.journals) {
    const code = String(journal.code ?? "").trim();
    if (!code) continue;
    journalsByCode.set(code, [...(journalsByCode.get(code) || []), journal]);
  }
  const issues: IntegrityIssue[] = [];
  const add = (target: IntegrityTarget, severity: IntegritySeverity, type: string, currentValue: unknown, referenceValue: unknown) => {
    issues.push({
      severity,
      businessName: display(target.business_name),
      code: display(target.code),
      type,
      currentValue: display(currentValue),
      referenceValue: display(referenceValue),
      status: severity === "ERROR" ? "오류" : severity === "NORMAL" ? "정상" : "확인필요",
    });
  };

  for (const target of input.targets) {
    const issueCountBeforeTarget = issues.length;
    const code = String(target.code ?? "").trim();
    const info = infoByCode.get(code);
    if (!code || !info) {
      add(target, "ERROR", "사업장 기본정보 없음", code, "business_info.code");
      continue;
    }

    if (normalizeIntegrityText(target.business_name) && normalizeIntegrityText(info.business_name) && normalizeIntegrityText(target.business_name) !== normalizeIntegrityText(info.business_name)) {
      add(target, "ERROR", "사업장명 불일치", target.business_name, info.business_name);
    }
    if (normalizeIntegrityText(target.business_number) && normalizeIntegrityText(info.business_number) && normalizeIntegrityText(target.business_number) !== normalizeIntegrityText(info.business_number)) {
      add(target, "ERROR", "사업자번호 불일치", target.business_number, info.business_number);
    }

    const infoFullAddress = getIntegrityBusinessInfoAddress(info);
    const targetAddress = normalizeIntegrityText(target.address);
    const infoAddress = normalizeIntegrityText(infoFullAddress);
    if (!targetAddress) {
      add(target, "REVIEW", "주소 미등록", target.address, infoFullAddress);
    } else if (infoAddress && targetAddress !== infoAddress) {
      add(target, "ERROR", "주소 불일치", target.address, infoFullAddress);
    }

    if (infoAddress && !hasIntegrityCoordinates(info)) {
      add(target, "WARNING", "주소 대비 좌표 없음", infoFullAddress, "business_info.latitude/longitude");
    }
    const geocodingStatus = String(info.geocoding_status ?? "").toUpperCase();
    if (["FAILED", "ERROR", "ADDRESS_MISSING"].includes(geocodingStatus)) {
      add(target, "WARNING", "지오코딩 명시 실패", info.geocoding_error ?? geocodingStatus, geocodingStatus);
    }

    if (targetAddress) {
      const resolution = resolveLaborOfficeAddressFromDirectory(target.address, input.laborOfficeDirectory);
      const storedOffice = normalizeIntegrityText(target.office_jurisdiction);
      if (resolution.status !== "matched") {
        add(target, "REVIEW", "소재지지청 판정 불확실", target.address, resolution.status);
      } else if (!storedOffice) {
        add(target, "WARNING", "소재지지청 미등록", target.office_jurisdiction, resolution.officeJurisdictionDisplay);
      } else if (storedOffice !== normalizeIntegrityText(resolution.officeJurisdictionDisplay) && storedOffice !== normalizeIntegrityText(resolution.officeJurisdictionPersistence)) {
        add(target, "ERROR", "소재지지청 불일치", target.office_jurisdiction, resolution.officeJurisdictionDisplay);
      }
    }

    if (target.measurement_date && target.measurement_end_date && target.measurement_end_date < target.measurement_date) {
      add(target, "ERROR", "측정 시작/종료일 역전", target.measurement_date, target.measurement_end_date);
    }

    const relatedJournals = journalsByCode.get(code) || [];
    if (relatedJournals.length > 0 && !relatedJournals.some((journal) => Number(journal.measurement_year) === Number(target.year) && String(journal.measurement_period ?? "").trim() === String(target.period ?? "").trim())) {
      add(target, "ERROR", "일지 코드/연도/주기 불일치", `${target.year ?? "-"}/${target.period ?? "-"}`, relatedJournals.map((journal) => `${journal.measurement_year ?? "-"}/${journal.measurement_period ?? "-"}`).join(", "));
    }
    if (ACTION_NEEDED_SYNC_STATES.has(String(target.sync_status ?? "").trim())) {
      add(target, "REVIEW", "동기화 조치 필요", target.sync_status, "성공 또는 대기 상태 확인");
    }
    if (issues.length === issueCountBeforeTarget) {
      add(target, "NORMAL", "정합성 이상 없음", "-", "-");
    }
  }
  return issues;
}
