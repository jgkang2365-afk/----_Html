import {
  MeasurementDayForm,
  serializeMeasurementDayForms,
} from "@/lib/business/measurement-day-form";

export type TargetBusinessStatus = "미실시" | "실시" | "거래종료";

export const TARGET_BUSINESS_TYPE_OPTIONS = [
  { value: "existing", label: "기존업체" },
  { value: "first_measurement", label: "최초실시" },
  { value: "external_new", label: "타기관 신규" },
] as const;

export function getTargetBusinessTypeLabel(value: unknown): string {
  return TARGET_BUSINESS_TYPE_OPTIONS.find((option) => option.value === value)?.label || "-";
}

export function isProcessChangedDefaultCategory(value: string | null | undefined): boolean {
  const normalized = value?.trim();
  return normalized === "공업사" || normalized === "건설";
}

export interface TargetBusinessFormValues {
  code?: string | null;
  year?: number | null;
  period?: string | null;
  business_name?: string | null;
  business_number?: string | null;
  business_category?: string | null;
  business_type?: "existing" | "first_measurement" | "external_new" | null;
  process_changed?: boolean | null;
  address?: string | null;
  phone?: string | null;
  fax?: string | null;
  total_employees?: number | null;
  invoice_email?: string | null;
  plan_manager?: string | null;
  designated_office?: string | null;
  office_jurisdiction?: string | null;
  is_registered?: string | null;
  is_registered_text?: string | null;
  management_status?: string | null;
  notes?: string | null;
  sanjae?: string | null;
  commencement?: string | null;
  industrial_accident_number?: string | null;
  commencement_number?: string | null;
  representative_name?: string | null;
  manager_name?: string | null;
  manager_mobile?: string | null;
  manager_phone?: string | null;
  manager_email?: string | null;
  measurement_date?: string | null;
  measurement_end_date?: string | null;
  future_measurement_period?: number | null;
  future_measurement_date?: string | null;
  measurer_id?: number | null;
  link_measurer_id?: number | null;
  collaborators?: string | null;
  daily_staff?: unknown;
  national_support_status?: string | null;
  sync_status?: string | null;
  sync_error_message?: string | null;
}

const SHARED_TARGET_BUSINESS_FIELDS = [
  "period",
  "business_name",
  "business_number",
  "business_category",
  "business_type",
  "process_changed",
  "address",
  "phone",
  "fax",
  "total_employees",
  "invoice_email",
  "plan_manager",
  "office_jurisdiction",
  "is_registered",
  "management_status",
  "notes",
  "industrial_accident_number",
  "commencement_number",
  "representative_name",
  "manager_name",
  "manager_mobile",
  "manager_phone",
  "manager_email",
  "measurement_date",
  "measurement_end_date",
  "future_measurement_period",
  "future_measurement_date",
  "measurer_id",
  "link_measurer_id",
  "collaborators",
  "daily_staff",
] as const;

export type SerializedTargetBusinessForm = Partial<
  Pick<TargetBusinessFormValues, (typeof SHARED_TARGET_BUSINESS_FIELDS)[number]>
>;

const hasOwn = (value: object, key: PropertyKey) =>
  Object.prototype.hasOwnProperty.call(value, key);

export function normalizeTargetBusinessStatus(value: unknown): string | null {
  if (value === null) return null;
  if (value === undefined) return null;
  const status = String(value).trim();
  if (status === "확정" || status === "실시") return "실시";
  if (status === "미확정" || status === "미실시" || !status) return "미실시";
  if (status === "종료" || status === "거래종료" || status === "거래 종료") return "거래종료";
  return status;
}

export function isTargetBusinessTerminated(value: unknown): boolean {
  return normalizeTargetBusinessStatus(value) === "거래종료";
}

export function resolveOfficeJurisdiction(
  explicitOffice: unknown,
  calculatedOffice: unknown
): string | null {
  const explicit = String(explicitOffice ?? "").trim();
  if (explicit) return explicit;
  const calculated = String(calculatedOffice ?? "").trim();
  return calculated || null;
}

/** 신규/수정에서 같은 UI 필드를 같은 DB column으로 직렬화한다. */
export function serializeTargetBusinessFormValues(
  raw: TargetBusinessFormValues
): SerializedTargetBusinessForm {
  const normalized: Record<string, unknown> = { ...raw };

  if (hasOwn(raw, "is_registered_text")) {
    normalized.is_registered = normalizeTargetBusinessStatus(raw.is_registered_text);
  } else if (hasOwn(raw, "is_registered")) {
    normalized.is_registered = normalizeTargetBusinessStatus(raw.is_registered);
  }

  if (hasOwn(raw, "designated_office")) {
    normalized.office_jurisdiction = raw.designated_office;
  }
  if (hasOwn(raw, "sanjae")) {
    normalized.industrial_accident_number = raw.sanjae;
  }
  if (hasOwn(raw, "commencement")) {
    normalized.commencement_number = raw.commencement;
  }

  for (const field of [
    "measurement_date",
    "measurement_end_date",
    "future_measurement_date",
  ] as const) {
    if (normalized[field] === "") normalized[field] = null;
  }

  return Object.fromEntries(
    SHARED_TARGET_BUSINESS_FIELDS.filter((field) => hasOwn(normalized, field)).map((field) => [
      field,
      normalized[field],
    ])
  ) as SerializedTargetBusinessForm;
}

export function buildTargetBusinessSaveValues(
  form: TargetBusinessFormValues,
  days: MeasurementDayForm[]
): SerializedTargetBusinessForm {
  return serializeTargetBusinessFormValues({
    ...form,
    ...serializeMeasurementDayForms(days),
  });
}

export function statusForMeasurementDays(
  currentStatus: unknown,
  days: MeasurementDayForm[]
): TargetBusinessStatus {
  if (isTargetBusinessTerminated(currentStatus)) return "거래종료";
  return days.some((day) => Boolean(day.date.trim())) ? "실시" : "미실시";
}

export function resolveTargetBusinessStatusForCreate(
  requestedStatus: unknown,
  hasMeasurementDate: boolean
): TargetBusinessStatus {
  const normalizedStatus = normalizeTargetBusinessStatus(requestedStatus);
  if (normalizedStatus === "거래종료") return "거래종료";
  if (normalizedStatus === "실시") return "실시";
  return hasMeasurementDate ? "실시" : "미실시";
}

export function buildInlineMeasurementDateUpdates(
  currentStatus: unknown,
  value: string
): SerializedTargetBusinessForm {
  const date = value || null;
  const updates: SerializedTargetBusinessForm = {
    measurement_date: date,
    measurement_end_date: date,
  };
  if (!isTargetBusinessTerminated(currentStatus)) {
    updates.is_registered = date ? "실시" : "미실시";
  }
  return updates;
}
