export interface MeasurementDayForm {
  date: string;
  measurerId: number | null;
  collaborators: string[];
}

interface LegacyMeasurementDay {
  date?: unknown;
  measurer_id?: unknown;
  collaborators?: unknown;
}

export interface MeasurementDaySource {
  dailyStaff?: unknown;
  measurementDate?: string | null;
  measurerId?: number | null;
  collaborators?: unknown;
}

/** 단일일 legacy CSV와 JSON 배열을 같은 측정 참여자 목록으로 정규화한다. */
export const normalizeMeasurementCollaborators = (value: unknown): string[] => {
  const names = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return Array.from(new Set(names.map(String).map((name) => name.trim()).filter(Boolean)));
};

export type MeasurementDayValidationCode =
  | "EMPTY_MEASUREMENT_DATE"
  | "DUPLICATE_MEASUREMENT_DATE"
  | "INVALID_MEASUREMENT_DATE"
  | "INCOMPLETE_MULTI_DAY_MEASUREMENT";

export type MeasurementDayValidation =
  | { valid: true }
  | { valid: false; code: MeasurementDayValidationCode; message: string };

const isValidDateString = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

/** 편집 중인 1일/다일 일정이 저장 가능한지 검사한다. */
export function validateMeasurementDayForms(days: MeasurementDayForm[]): MeasurementDayValidation {
  const normalizedDates = days.map((day) => day.date.trim());
  if (days.length <= 1) {
    const date = normalizedDates[0] ?? "";
    if (!date) return { valid: true };
    return isValidDateString(date)
      ? { valid: true }
      : { valid: false, code: "INVALID_MEASUREMENT_DATE", message: "측정일 형식을 확인해 주세요." };
  }

  const firstEmptyIndex = normalizedDates.findIndex((date) => !date);
  if (firstEmptyIndex >= 0) {
    return {
      valid: false,
      code: "INCOMPLETE_MULTI_DAY_MEASUREMENT",
      message: `측정일 ${firstEmptyIndex + 1}을 입력해 주세요.`,
    };
  }

  const invalidIndex = normalizedDates.findIndex((date) => !isValidDateString(date));
  if (invalidIndex >= 0) {
    return {
      valid: false,
      code: "INVALID_MEASUREMENT_DATE",
      message: `측정일 ${invalidIndex + 1}의 형식을 확인해 주세요.`,
    };
  }

  const firstIndexes = new Map<string, number>();
  for (let index = 0; index < normalizedDates.length; index += 1) {
    const date = normalizedDates[index];
    const firstIndex = firstIndexes.get(date);
    if (firstIndex !== undefined) {
      return {
        valid: false,
        code: "DUPLICATE_MEASUREMENT_DATE",
        message: `측정일이 중복되었습니다: ${firstIndex + 1}, ${index + 1}`,
      };
    }
    firstIndexes.set(date, index);
  }

  return { valid: true };
}

export function defaultEmptyParticipantsToReportWriter(
  days: MeasurementDayForm[],
  reportWriters: Array<{ id: number; name: string }>,
  isAvailable: (userId: number, date: string) => boolean = () => true,
): MeasurementDayForm[] {
  const namesById = new Map(reportWriters.map((writer) => [writer.id, writer.name.trim()]));
  return days.map((day) => {
    if (normalizeMeasurementCollaborators(day.collaborators).length > 0 || day.measurerId == null) return day;
    const reportWriterName = namesById.get(day.measurerId);
    return reportWriterName && isAvailable(day.measurerId, day.date)
      ? { ...day, collaborators: [reportWriterName] }
      : day;
  });
}

export function changeMeasurementDayReportWriter(
  day: MeasurementDayForm,
  measurerId: number | null,
  reportWriterName?: string | null,
): MeasurementDayForm {
  return {
    ...day,
    measurerId,
    collaborators: normalizeMeasurementCollaborators([
      ...day.collaborators,
      ...(reportWriterName?.trim() ? [reportWriterName.trim()] : []),
    ]),
  };
}

const toMeasurerId = (value: unknown): number | null => {
  const id = typeof value === "number" ? value : Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

export function measurementDayFormsFrom(source: MeasurementDaySource): MeasurementDayForm[] {
  if (Array.isArray(source.dailyStaff) && source.dailyStaff.length > 0) {
    return source.dailyStaff.map((entry: LegacyMeasurementDay) => ({
      date: typeof entry?.date === "string" ? entry.date : "",
      measurerId: toMeasurerId(entry?.measurer_id),
      collaborators: normalizeMeasurementCollaborators(entry?.collaborators),
    }));
  }

  return [{
    date: source.measurementDate || "",
    measurerId: source.measurerId ?? null,
    collaborators: normalizeMeasurementCollaborators(source.collaborators),
  }];
}

export interface SerializedMeasurementDays {
  daily_staff: Array<{ date: string; measurer_id: number | null; collaborators: string[] }> | null;
  measurement_date: string | null;
  measurement_end_date: string | null;
  measurer_id: number | null;
  collaborators: string | null;
}

export interface MeasurementDayDateTransition {
  day: MeasurementDayForm;
  linkMeasurerId: number | null | undefined;
}

/**
 * 2026-06-09 인력 전환 규칙을 날짜를 바꾼 해당 일자에만 적용한다.
 * link_measurer_id는 기간 전체의 예·측 연결값이므로 기존 단일일 동작처럼 함께 치환한다.
 */
export function swapMeasurerForMeasurementDateTransition(
  day: MeasurementDayForm,
  previousDate: string | null | undefined,
  nextDate: string | null | undefined,
  linkMeasurerId: number | null | undefined,
): MeasurementDayDateTransition {
  const wasAfterTransition = !previousDate || previousDate >= "2026-06-09";
  const isAfterTransition = !nextDate || nextDate >= "2026-06-09";
  if (wasAfterTransition === isAfterTransition) {
    return { day, linkMeasurerId };
  }

  const from = isAfterTransition
    ? { id: 14, name: "배윤민", replacementId: 20, replacementName: "김민영" }
    : { id: 20, name: "김민영", replacementId: 14, replacementName: "배윤민" };
  const collaborators = day.collaborators.includes(from.name)
    ? [
        ...day.collaborators.filter((name) => name !== from.name),
        ...(day.collaborators.includes(from.replacementName) ? [] : [from.replacementName]),
      ]
    : day.collaborators;

  return {
    day: {
      ...day,
      measurerId: day.measurerId === from.id ? from.replacementId : day.measurerId,
      collaborators,
    },
    linkMeasurerId: linkMeasurerId === from.id ? from.replacementId : linkMeasurerId,
  };
}

function serializeNormalizedMeasurementDayForms(days: MeasurementDayForm[]): SerializedMeasurementDays {
  const normalized = days.map((day) => ({
    date: day.date.trim(),
    measurerId: toMeasurerId(day.measurerId),
    collaborators: normalizeMeasurementCollaborators(day.collaborators),
  }));
  const dated = normalized.filter((day) => Boolean(day.date));
  const sorted = [...dated].sort((left, right) => left.date.localeCompare(right.date));
  const primary = sorted[0] ?? normalized[0] ?? { date: "", measurerId: null, collaborators: [] };
  const collaborators = primary.collaborators.join(",") || null;

  if (normalized.length <= 1) {
    return {
      daily_staff: null,
      measurement_date: primary.date || null,
      measurement_end_date: primary.date || null,
      measurer_id: primary.measurerId,
      collaborators,
    };
  }

  return {
    daily_staff: normalized.map((day) => ({
      date: day.date,
      measurer_id: day.measurerId,
      collaborators: day.collaborators,
    })),
    measurement_date: sorted[0]?.date || null,
    measurement_end_date: sorted.at(-1)?.date || null,
    measurer_id: primary.measurerId,
    collaborators,
  };
}

/** 저장 경계용 serializer. 유효하지 않은 날짜 상태를 조용히 저장하지 않는다. */
export function serializeMeasurementDayForms(days: MeasurementDayForm[]): SerializedMeasurementDays {
  const validation = validateMeasurementDayForms(days);
  if (!validation.valid) throw new Error(`${validation.code}: ${validation.message}`);
  return serializeNormalizedMeasurementDayForms(days);
}

/** 사용자가 다일 일정을 입력하는 중의 빈 카드까지 보존하는 UI 전용 변환이다. */
export function serializeMeasurementDayFormsForEditing(days: MeasurementDayForm[]): SerializedMeasurementDays {
  return serializeNormalizedMeasurementDayForms(days);
}
