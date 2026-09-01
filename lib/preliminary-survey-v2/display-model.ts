/** 예비조사 V2와 legacy fallback을 화면별로 같은 의미로 표현하기 위한 공통 표시 모델. */
export interface PreliminarySurveyDisplayModel {
  preliminarySurveyDate: string | null;
  preliminarySurveyors: string;
  measurementPublicSampleAssignee: string;
  publicSampleCode: string;
  measurementParticipants: string;
  reportWriter: string;
  source: "v2" | "legacy" | "none";
}

const text = (value: unknown) => String(value ?? "").trim();
const join = (values: unknown[]) => [...new Set(values.map(text).filter(Boolean))].join(", ") || "-";

/** 표시 순서만 경력자 우선으로 통일하며 responsible/reviewer 역할 ID는 변경하지 않는다. */
export function orderSurveyParticipantsForDisplay<T extends { id: number; experienced: boolean }>(
  participants: readonly T[],
) {
  return [...participants].sort((left, right) =>
    Number(right.experienced) - Number(left.experienced) || left.id - right.id,
  );
}

export function buildPreliminarySurveyDisplayModel(input: {
  v2?: {
    preliminarySurveyDate?: unknown;
    preliminarySurveyors?: unknown;
    measurementPublicSampleAssignee?: unknown;
    publicSampleCode?: unknown;
  } | null;
  measurementParticipants?: unknown;
  reportWriter?: unknown;
  legacy?: {
    preliminarySurveyDate?: unknown;
    preliminarySurveyors?: unknown;
    measurementPublicSampleAssignee?: unknown;
    publicSampleCode?: unknown;
  } | null;
}): PreliminarySurveyDisplayModel {
  const v2 = input.v2;
  // Persisted V2 plan이 있으면 누락을 legacy 값으로 가리지 않는다.
  // legacy fallback은 V2 plan 자체가 없는 과거 문서에만 쓴다.
  const hasV2 = Boolean(v2);
  const source = hasV2 ? v2! : input.legacy;
  return {
    preliminarySurveyDate: text(source?.preliminarySurveyDate) || null,
    preliminarySurveyors: text(source?.preliminarySurveyors) || "-",
    measurementPublicSampleAssignee: text(source?.measurementPublicSampleAssignee) || "-",
    publicSampleCode: text(source?.publicSampleCode) || "-",
    measurementParticipants: join(Array.isArray(input.measurementParticipants)
      ? input.measurementParticipants : String(input.measurementParticipants ?? "").split(",")),
    reportWriter: text(input.reportWriter) || "-",
    source: hasV2 ? "v2" : source ? "legacy" : "none",
  };
}

/** 인쇄는 담당자명이 아니라 공시료 코드만 괄호 안에 넣는다. */
export function formatPreliminarySurveyorWithPublicSampleCode(model: PreliminarySurveyDisplayModel) {
  return model.publicSampleCode !== "-"
    ? `${model.preliminarySurveyors} (${model.publicSampleCode})`
    : model.preliminarySurveyors;
}

/** 화면의 별도 측정자(공시료) 항목은 담당자명과 코드를 함께 표시한다. */
export function formatMeasurementPublicSampleAssignee(model: PreliminarySurveyDisplayModel) {
  if (model.measurementPublicSampleAssignee === "-") return "-";
  return model.publicSampleCode !== "-"
    ? `${model.measurementPublicSampleAssignee}(${model.publicSampleCode})`
    : model.measurementPublicSampleAssignee;
}
