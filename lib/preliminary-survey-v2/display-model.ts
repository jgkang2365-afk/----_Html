import {
  measurementDayFormsFrom,
  type MeasurementDaySource,
} from "@/lib/business/measurement-day-form";

/** 예비조사 V2와 legacy fallback을 측정일지 화면에서 같은 의미로 표현한다. */
export interface PreliminarySurveyDisplayModel {
  preliminarySurveyDate: string | null;
  preliminarySurveyors: string;
  measurementPublicSampleAssignee: string;
  publicSampleCode: string;
  measurementParticipants: string;
  reportWriter: string;
  source: "v2" | "legacy" | "none";
}

interface PreliminarySurveyDisplaySource {
  preliminarySurveyDate?: unknown;
  preliminarySurveyors?: unknown;
  measurementPublicSampleAssignee?: unknown;
  publicSampleCode?: unknown;
  measurementParticipants?: unknown;
  reportWriter?: unknown;
}

const text = (value: unknown) => String(value ?? "").trim();
const names = (value: unknown) => {
  const values = Array.isArray(value) ? value : String(value ?? "").split(",");
  return [...new Set(values.map(text).filter(Boolean))].join(", ") || "-";
};

/**
 * Persisted V2 plan이 있으면 5개 표시 필드 모두 V2/target 원천만 사용한다.
 * legacy fallback은 V2 plan 자체가 없는 과거 데이터에만 적용한다.
 */
export function buildPreliminarySurveyDisplayModel(input: {
  v2?: PreliminarySurveyDisplaySource | null;
  legacy?: PreliminarySurveyDisplaySource | null;
}): PreliminarySurveyDisplayModel {
  const hasV2 = Boolean(input.v2);
  const source = hasV2 ? input.v2! : input.legacy;

  return {
    preliminarySurveyDate: text(source?.preliminarySurveyDate) || null,
    preliminarySurveyors: names(source?.preliminarySurveyors),
    measurementPublicSampleAssignee: text(source?.measurementPublicSampleAssignee) || "-",
    publicSampleCode: text(source?.publicSampleCode) || "-",
    measurementParticipants: names(source?.measurementParticipants),
    reportWriter: text(source?.reportWriter) || "-",
    source: hasV2 ? "v2" : source ? "legacy" : "none",
  };
}

/** 단일일은 target 기본값, 다일은 시작 측정일의 daily_staff 값을 선택한다. */
export function measurementRolesForDisplay(source: MeasurementDaySource) {
  const days = measurementDayFormsFrom(source);
  const selectedDay = days.find((day) => day.date === source.measurementDate)
    ?? (days.length === 1 ? days[0] : null);

  return {
    measurementParticipants: selectedDay?.collaborators ?? [],
    reportWriterUserId: selectedDay?.measurerId ?? null,
  };
}

/** 측정자(공시료)는 persisted 담당자명과 코드를 함께 표시한다. */
export function formatMeasurementPublicSampleAssignee(model: PreliminarySurveyDisplayModel) {
  if (model.measurementPublicSampleAssignee === "-") return "-";
  return model.publicSampleCode !== "-"
    ? `${model.measurementPublicSampleAssignee}(${model.publicSampleCode})`
    : model.measurementPublicSampleAssignee;
}
