export type PersonAssignmentRole = "measurement_assignee" | "preliminary_surveyor";

export interface PersonAssignmentTargetSource {
  id: number;
  code: string | null;
  business_name: string | null;
  address: string | null;
}

export interface PersonAssignmentPlanSource {
  id: string;
  measurement_target_business_id: number;
  recommended_date: string | null;
  participant_user_ids: unknown;
  participant_names?: unknown;
  survey_method: "field" | "phone" | null;
}

export interface MeasurementAssignmentSource {
  plan_id: string;
  measurement_date: string;
  assignee_user_id: number;
  public_sample_code?: string | null;
}

export interface PersonAssignmentUserSource {
  id: number;
  name: string | null;
}

export interface PersonAssignmentRow {
  key: string;
  employeeId: number;
  employeeName: string;
  role: PersonAssignmentRole;
  code: string;
  businessName: string;
  sigungu: string;
  eupMyeonDong: string;
  measurementDates: string[];
  preliminaryDate: string | null;
  method: "field" | "phone" | null;
}

export interface PersonAssignmentFilters {
  startDate: string;
  endDate: string;
  employeeId?: number | null;
  role?: PersonAssignmentRole | "";
  search?: string;
}

const SIDO_PATTERN = /^(?:서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|경기도|강원도|충청북도|충청남도|전라북도|전라남도|경상북도|경상남도|[가-힣]+특별자치(?:시|도))$/;
const SPECIAL_AUTONOMOUS_CITY_PATTERN = /^[가-힣]+특별자치시$/;
const SIGUNGU_PATTERN = /^[가-힣0-9]+(?:시|군|구)$/;
const EUP_MYEON_DONG_PATTERN = /^[가-힣0-9]+(?:읍|면|동)$/;

export function parseStoredAddressAdministrativeUnits(address: unknown): {
  sigungu: string;
  eupMyeonDong: string;
} {
  const tokens = String(address ?? "")
    .normalize("NFKC")
    .replace(/[(),]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const lowerSigunguIndex = tokens.findIndex((token) => SIGUNGU_PATTERN.test(token) && !SIDO_PATTERN.test(token));
  const sigunguIndex = lowerSigunguIndex >= 0
    ? lowerSigunguIndex
    : tokens.findIndex((token) => SPECIAL_AUTONOMOUS_CITY_PATTERN.test(token));
  const sigunguTokens = sigunguIndex < 0 ? [] : [tokens[sigunguIndex]];
  if (sigunguTokens[0]?.endsWith("시") && SIGUNGU_PATTERN.test(tokens[sigunguIndex + 1] ?? "") && tokens[sigunguIndex + 1].endsWith("구")) {
    sigunguTokens.push(tokens[sigunguIndex + 1]);
  }
  const sigungu = sigunguTokens.join(" ") || "-";
  const eupMyeonDong = tokens.find((token, index) =>
    index > sigunguIndex && EUP_MYEON_DONG_PATTERN.test(token),
  ) ?? "-";
  return { sigungu, eupMyeonDong };
}

function numericIds(value: unknown): number[] {
  return Array.isArray(value)
    ? [...new Set(value.map(Number).filter(Number.isInteger))]
    : [];
}

function isDateInRange(date: string | null, startDate: string, endDate: string): boolean {
  return Boolean(date) && (!startDate || date! >= startDate) && (!endDate || date! <= endDate);
}

export function buildPersonAssignmentRows(input: {
  targets: PersonAssignmentTargetSource[];
  plans: PersonAssignmentPlanSource[];
  assignments: MeasurementAssignmentSource[];
  users: PersonAssignmentUserSource[];
}): PersonAssignmentRow[] {
  const targetById = new Map(input.targets.map((target) => [Number(target.id), target]));
  const userNameById = new Map(input.users.map((user) => [Number(user.id), String(user.name ?? "").trim()]));
  const assignmentsByPlan = new Map<string, MeasurementAssignmentSource[]>();
  for (const assignment of input.assignments) {
    const planId = String(assignment.plan_id);
    assignmentsByPlan.set(planId, [...(assignmentsByPlan.get(planId) ?? []), assignment]);
  }

  const rows: PersonAssignmentRow[] = [];
  for (const plan of input.plans) {
    const target = targetById.get(Number(plan.measurement_target_business_id));
    if (!target) continue;
    const location = parseStoredAddressAdministrativeUnits(target.address);
    const assignments = [...(assignmentsByPlan.get(String(plan.id)) ?? [])]
      .sort((left, right) => left.measurement_date.localeCompare(right.measurement_date));
    const measurementDates = [...new Set(assignments.map((assignment) => assignment.measurement_date))];
    const common = {
      code: String(target.code ?? "").trim() || "-",
      businessName: String(target.business_name ?? "").trim() || "-",
      ...location,
      preliminaryDate: plan.recommended_date,
      method: plan.survey_method,
    };

    for (const assignment of assignments) {
      rows.push({
        key: `measurement:${plan.id}:${assignment.measurement_date}:${assignment.assignee_user_id}`,
        employeeId: Number(assignment.assignee_user_id),
        employeeName: userNameById.get(Number(assignment.assignee_user_id)) || "-",
        role: "measurement_assignee",
        ...common,
        measurementDates: [assignment.measurement_date],
      });
    }

    for (const participantId of numericIds(plan.participant_user_ids)) {
      rows.push({
        key: `preliminary:${plan.id}:${participantId}`,
        employeeId: participantId,
        employeeName: userNameById.get(participantId) || "-",
        role: "preliminary_surveyor",
        ...common,
        measurementDates,
      });
    }
  }
  return rows;
}

export function filterPersonAssignmentRows(
  rows: readonly PersonAssignmentRow[],
  filters: PersonAssignmentFilters,
): PersonAssignmentRow[] {
  const search = String(filters.search ?? "").trim().toLocaleLowerCase("ko-KR");
  return rows.filter((row) => {
    const roleDateMatches = row.role === "measurement_assignee"
      ? row.measurementDates.some((date) => isDateInRange(date, filters.startDate, filters.endDate))
      : isDateInRange(row.preliminaryDate, filters.startDate, filters.endDate);
    return roleDateMatches &&
      (!filters.employeeId || row.employeeId === filters.employeeId) &&
      (!filters.role || row.role === filters.role) &&
      (!search || `${row.code} ${row.businessName}`.toLocaleLowerCase("ko-KR").includes(search));
  }).sort((left, right) =>
    left.employeeName.localeCompare(right.employeeName, "ko") ||
    (left.measurementDates[0] ?? left.preliminaryDate ?? "").localeCompare(
      right.measurementDates[0] ?? right.preliminaryDate ?? "",
    ) || left.code.localeCompare(right.code, "ko"),
  );
}
