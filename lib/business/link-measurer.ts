/**
 * 연계측정자 자동 후보/분류 로직
 *
 * 원칙:
 * - 연계측정자는 예비조사와 실제 측정을 연결하는 기준 인원(사업장 단위 1명)이다.
 * - 보고서 담당자(measurer_id)를 연계측정자로 자동 확정하지 않는다.
 * - 아래 함수는 "자동 확정"이 아니라 "자동 후보 제안"만 수행한다.
 *   실제 저장/확정은 반드시 사용자 확인을 거쳐야 한다.
 */

export interface LinkMeasurerCandidateInput {
  /** 보고서 담당자 이름 */
  measurerName: string | null;
  /** 실제 측정자 전체 목록 (쉼표 구분) */
  collaborators: string | null | undefined;
  /** daily_staff JSONB (일자별 { date, measurer_id, collaborators }) */
  dailyStaff: unknown;
  /** 기존 V2 plan participant_names */
  v2ParticipantNames: string[];
}

export function splitNames(value: string | null | undefined): string[] {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** 실제 측정 인원 전체(단일 일자 collaborators + 다일 daily_staff 협력자) 이름 목록 */
export function collectMeasurementStaffNames(input: Pick<LinkMeasurerCandidateInput, "collaborators" | "dailyStaff">): string[] {
  const names = new Set<string>();
  splitNames(input.collaborators).forEach((name) => names.add(name));
  if (Array.isArray(input.dailyStaff)) {
    for (const entry of input.dailyStaff) {
      if (!entry) continue;
      if (Array.isArray(entry.collaborators)) {
        entry.collaborators.map(String).map((s: string) => s.trim()).filter(Boolean)
          .forEach((name: string) => names.add(name));
      } else {
        splitNames(entry.collaborators).forEach((name) => names.add(name));
      }
    }
  }
  return [...names];
}

export type LinkCandidateStatus = "auto" | "multiple" | "none" | "unknown";

export interface LinkCandidateResult {
  /** 우선순위 후보 이름 목록 (빈 배열이면 자동 후보 없음) */
  candidates: string[];
  status: LinkCandidateStatus;
  /** 보고서 담당자가 실제 측정 인원에 포함되는지 */
  reportMeasurerIncluded: boolean;
}

/**
 * 연계측정자 자동 후보 제안.
 * - 우선 후보 1: 보고서 담당자가 실제 측정 인원에 포함되면 후보로 제시 (자동 확정 아님)
 * - 우선 후보 2: 기존 V2 예비조사자 중 실제 측정 인원에 포함된 사람이 정확히 1명이면 후보로 제시
 * - 후보 0/2명 이상/측정 인원 불명확 → status none/multiple/unknown (사용자 선택)
 */
export function suggestLinkMeasurerCandidates(input: LinkMeasurerCandidateInput): LinkCandidateResult {
  const staff = new Set(collectMeasurementStaffNames(input));
  const reportMeasurerIncluded = Boolean(input.measurerName && staff.has(input.measurerName));

  if (staff.size === 0) {
    return { candidates: [], status: "unknown", reportMeasurerIncluded: false };
  }

  const candidates: string[] = [];
  if (reportMeasurerIncluded && input.measurerName) {
    candidates.push(input.measurerName);
  }
  const v2InStaff = (input.v2ParticipantNames || [])
    .map((name) => String(name).trim())
    .filter((name) => staff.has(name));
  if (v2InStaff.length === 1 && !candidates.includes(v2InStaff[0])) {
    candidates.push(v2InStaff[0]);
  }

  const status: LinkCandidateStatus =
    candidates.length === 1 ? "auto" : candidates.length === 0 ? "none" : "multiple";
  return { candidates, status, reportMeasurerIncluded };
}

export type LinkMeasurerClass = "A" | "B" | "C" | "D";

export interface LinkMeasurerClassResult {
  klass: LinkMeasurerClass;
  /** V2 예비조사자 ∩ 실제 측정 인원 */
  v2InStaff: string[];
  staffCount: number;
}

/**
 * 기존 40건 READ-ONLY 분류용.
 * - A: 교집합 정확히 1명 → 자동 후보 명확
 * - B: 교집합 2명 이상 → 후보 복수
 * - C: 교집합 0명 → 후보 없음 (업무 규칙 위반 후보)
 * - D: 실제 측정 인원 불명확 → 사용자 확인 필요
 */
export function classifyLinkMeasurerCandidate(input: LinkMeasurerCandidateInput): LinkMeasurerClassResult {
  const staff = collectMeasurementStaffNames(input);
  const v2InStaff = (input.v2ParticipantNames || [])
    .map((name) => String(name).trim())
    .filter((name) => staff.includes(name));
  const klass: LinkMeasurerClass =
    staff.length === 0 ? "D" : v2InStaff.length === 1 ? "A" : v2InStaff.length >= 2 ? "B" : "C";
  return { klass, v2InStaff, staffCount: staff.length };
}
