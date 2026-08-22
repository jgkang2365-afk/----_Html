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
  collaborators?: string | null;
}

const uniqueNames = (value: unknown): string[] => {
  const names = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return Array.from(new Set(names.map(String).map((name) => name.trim()).filter(Boolean)));
};

const toMeasurerId = (value: unknown): number | null => {
  const id = typeof value === "number" ? value : Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

export function measurementDayFormsFrom(source: MeasurementDaySource): MeasurementDayForm[] {
  if (Array.isArray(source.dailyStaff) && source.dailyStaff.length > 0) {
    return source.dailyStaff.map((entry: LegacyMeasurementDay) => ({
      date: typeof entry?.date === "string" ? entry.date : "",
      measurerId: toMeasurerId(entry?.measurer_id),
      collaborators: uniqueNames(entry?.collaborators),
    }));
  }

  return [{
    date: source.measurementDate || "",
    measurerId: source.measurerId ?? null,
    collaborators: uniqueNames(source.collaborators),
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

/** 날짜별 편집 상태를 DB의 단일일/다일 호환 형식으로 정규화한다. */
export function serializeMeasurementDayForms(days: MeasurementDayForm[]): SerializedMeasurementDays {
  const normalized = days.map((day) => ({
    date: day.date.trim(),
    measurerId: toMeasurerId(day.measurerId),
    collaborators: uniqueNames(day.collaborators),
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
