type AdminOverridePlanLike = {
  plan_origin?: unknown;
  recommendation_reason?: unknown;
  source_measurement_date?: unknown;
  source_responsible_user_id?: unknown;
};

type AdminOverrideTargetLike = {
  id?: unknown;
  measurement_date?: unknown;
  measurer_id?: unknown;
  collaborators?: unknown;
  daily_staff?: unknown;
};

type FixedAssignmentLike = {
  measurement_target_business_id?: unknown;
  measurement_date?: unknown;
  assignee_user_id?: unknown;
  updated_at?: unknown;
  source_snapshot?: unknown;
};

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value == null || value === "") return [];
  return [String(value)];
}

function normalizedJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

function normalizedNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function isAdminExplicitOverridePlan(plan: AdminOverridePlanLike): boolean {
  if (String(plan?.plan_origin ?? "") !== "manual") return false;
  const reason = plan?.recommendation_reason as any;
  const reasons = [
    ...stringList(reason?.reason),
    ...stringList(reason?.reasons),
  ];
  return reasons.includes("ADMIN_EXPLICIT_OVERRIDE");
}

export function currentFixedVersionSnapshot(targetId: number, fixedAssignments: FixedAssignmentLike[]) {
  return fixedAssignments
    .filter((fixed) => Number(fixed.measurement_target_business_id) === targetId)
    .map((fixed) => ({
      measurementDate: String(fixed.measurement_date ?? ""),
      assigneeUserId: Number(fixed.assignee_user_id),
      updatedAtMs: new Date(String(fixed.updated_at ?? "")).getTime(),
      nonParticipantConfirmed: (fixed.source_snapshot as any)?.nonParticipantConfirmed === true,
    }))
    .sort((left, right) => left.measurementDate.localeCompare(right.measurementDate)
      || left.assigneeUserId - right.assigneeUserId);
}

/**
 * 관리자 예외 편성은 자동계산이 덮어쓰지 않는다.
 * 다만 관리자 저장 당시의 핵심 원천이 바뀌었으면 자동으로 재계산하지 않고 재검토 대상으로 돌린다.
 */
export function adminOverrideSourceChanged(input: {
  target: AdminOverrideTargetLike;
  plan: AdminOverridePlanLike;
  fixedAssignments: FixedAssignmentLike[];
  auditAfterSnapshot?: unknown;
}): boolean {
  const targetId = Number(input.target.id);
  const audit = input.auditAfterSnapshot as any;

  if (!audit || typeof audit !== "object") {
    const planMeasurementDate = String(input.plan.source_measurement_date ?? "");
    const targetMeasurementDate = String(input.target.measurement_date ?? "");
    const planResponsible = normalizedNumber(input.plan.source_responsible_user_id);
    const targetResponsible = normalizedNumber(input.target.measurer_id);
    return (planMeasurementDate && planMeasurementDate !== targetMeasurementDate)
      || (planResponsible != null && planResponsible !== targetResponsible);
  }

  if (String(audit.source_measurement_date ?? "") !== String(input.target.measurement_date ?? "")) return true;
  if (normalizedNumber(audit.source_report_writer_id) !== normalizedNumber(input.target.measurer_id)) return true;
  if (normalizedJson(audit.source_collaborators) !== normalizedJson(input.target.collaborators)) return true;
  if (normalizedJson(audit.source_daily_staff) !== normalizedJson(input.target.daily_staff)) return true;

  const auditFixed = Array.isArray(audit.source_fixed_versions)
    ? [...audit.source_fixed_versions].sort((left: any, right: any) =>
        String(left?.measurementDate ?? "").localeCompare(String(right?.measurementDate ?? ""))
        || Number(left?.assigneeUserId ?? 0) - Number(right?.assigneeUserId ?? 0))
    : [];
  const currentFixed = currentFixedVersionSnapshot(targetId, input.fixedAssignments);
  return normalizedJson(auditFixed) !== normalizedJson(currentFixed);
}
