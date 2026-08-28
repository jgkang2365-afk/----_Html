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

const CREATE_TARGET_BUSINESS_FIELDS = [
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
  Pick<TargetBusinessFormValues, (typeof CREATE_TARGET_BUSINESS_FIELDS)[number]>
>;

const EDITABLE_TARGET_BUSINESS_FIELDS = [
  "period",
  "business_name",
  "business_category",
  "business_type",
  "process_changed",
  "address",
  "plan_manager",
  "is_registered",
  "management_status",
  "notes",
  "industrial_accident_number",
  "commencement_number",
  "representative_name",
  "manager_name",
  "manager_mobile",
  "manager_email",
  "future_measurement_period",
  "future_measurement_date",
  "link_measurer_id",
] as const;

const MEASUREMENT_SCHEDULE_FIELDS = [
  "measurement_date",
  "measurement_end_date",
  "measurer_id",
  "collaborators",
  "daily_staff",
] as const;

/** 상세수정 화면에서 source-owned/read-only로 유지하며 PATCH에 싣지 않는 필드. */
export const EDIT_SOURCE_OWNED_FIELDS = [
  "business_number",
  "phone",
  "fax",
  "total_employees",
  "invoice_email",
  "manager_phone",
  "office_jurisdiction",
] as const;

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

function normalizeTargetBusinessAliases(
  raw: TargetBusinessFormValues
): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...raw };

  if (hasOwn(raw, "is_registered_text")) {
    normalized.is_registered = normalizeTargetBusinessStatus(raw.is_registered_text);
  } else if (hasOwn(raw, "is_registered")) {
    normalized.is_registered = normalizeTargetBusinessStatus(raw.is_registered);
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

  return normalized;
}

/** 신규등록에서 입력 가능한 값을 target POST payload로 직렬화한다. */
export function serializeTargetBusinessCreateValues(
  raw: TargetBusinessFormValues
): SerializedTargetBusinessForm {
  const normalized = normalizeTargetBusinessAliases(raw);

  return Object.fromEntries(
    CREATE_TARGET_BUSINESS_FIELDS.filter((field) => hasOwn(normalized, field)).map((field) => [
      field,
      normalized[field],
    ])
  ) as SerializedTargetBusinessForm;
}

/**
 * inline 수정 등 이미 dirty field만 받은 호출용 serializer.
 * 상세 모달 전체 form에는 buildTargetBusinessEditPatch를 사용한다.
 */
export function serializeTargetBusinessEditValues(
  raw: TargetBusinessFormValues
): SerializedTargetBusinessForm {
  const normalized = normalizeTargetBusinessAliases(raw);
  const allowedFields = [...EDITABLE_TARGET_BUSINESS_FIELDS, ...MEASUREMENT_SCHEDULE_FIELDS];

  return Object.fromEntries(
    allowedFields.filter((field) => hasOwn(normalized, field)).map((field) => [
      field,
      normalized[field],
    ])
  ) as SerializedTargetBusinessForm;
}

/** 기존 import 호환용. 신규 저장 경계는 create serializer를 사용한다. */
export const serializeTargetBusinessFormValues = serializeTargetBusinessCreateValues;

const comparableValue = (value: unknown): unknown => {
  if (value === "" || value === null || value === undefined) return null;
  if (typeof value === "object") return JSON.stringify(value);
  return value;
};

/** 상세 모달 최초값과 현재값을 비교해 실제로 바뀐 edit-allowed field만 반환한다. */
export function buildTargetBusinessEditPatch(
  original: TargetBusinessFormValues,
  current: TargetBusinessFormValues,
  originalDays: MeasurementDayForm[],
  currentDays: MeasurementDayForm[]
): SerializedTargetBusinessForm {
  const originalValues = normalizeTargetBusinessAliases(original);
  const currentValues = normalizeTargetBusinessAliases(current);
  const patch: Record<string, unknown> = {};

  for (const field of EDITABLE_TARGET_BUSINESS_FIELDS) {
    if (!hasOwn(currentValues, field)) continue;
    if (comparableValue(currentValues[field]) !== comparableValue(originalValues[field])) {
      patch[field] = currentValues[field];
    }
  }

  const originalSchedule = serializeMeasurementDayForms(originalDays);
  const currentSchedule = serializeMeasurementDayForms(currentDays);
  for (const field of MEASUREMENT_SCHEDULE_FIELDS) {
    if (comparableValue(currentSchedule[field]) !== comparableValue(originalSchedule[field])) {
      patch[field] = currentSchedule[field];
    }
  }

  return patch as SerializedTargetBusinessForm;
}

export function buildTargetBusinessSaveValues(
  form: TargetBusinessFormValues,
  days: MeasurementDayForm[]
): SerializedTargetBusinessForm {
  return serializeTargetBusinessCreateValues({
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

/** 신규 target은 현재 주소에서 유효하게 판정된 소재지지청을 우선한다. */
export function resolveCreateOfficeJurisdiction(
  providedOffice: unknown,
  calculatedOffice: unknown
): string | null {
  const calculated = String(calculatedOffice ?? "").trim();
  if (calculated) return calculated;
  const provided = String(providedOffice ?? "").trim();
  return provided || null;
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
