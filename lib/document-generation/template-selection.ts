import {
  ANNUAL_TEMPLATE_PERIOD,
  DocumentType,
  isDocumentType,
  normalizeMeasurementPeriod,
  TemplateMeasurementPeriod,
} from "./constants";

export interface DocumentTemplateCandidate {
  document_type: string;
  measurement_year: number;
  measurement_period: string;
  is_active: boolean;
}

export function isTemplatePeriodApplicable(
  templatePeriod: unknown,
  measurementPeriod: unknown
): boolean {
  const exactPeriod = normalizeMeasurementPeriod(measurementPeriod);
  return (
    exactPeriod !== null &&
    (templatePeriod === exactPeriod || templatePeriod === ANNUAL_TEMPLATE_PERIOD)
  );
}

export function selectApplicableDocumentTemplates<T extends DocumentTemplateCandidate>(
  candidates: readonly T[],
  measurementYear: unknown,
  measurementPeriod: unknown
): T[] {
  const year = Number(measurementYear);
  const exactPeriod = normalizeMeasurementPeriod(measurementPeriod);
  if (!Number.isInteger(year) || !exactPeriod) return [];

  const selected = new Map<DocumentType, { template: T; priority: number }>();

  for (const template of candidates) {
    if (
      !template.is_active ||
      Number(template.measurement_year) !== year ||
      !isDocumentType(template.document_type)
    )
      continue;

    const period = template.measurement_period as TemplateMeasurementPeriod;
    const priority =
      period === exactPeriod ? 0 : period === ANNUAL_TEMPLATE_PERIOD ? 1 : Number.POSITIVE_INFINITY;
    if (!Number.isFinite(priority)) continue;

    const current = selected.get(template.document_type);
    if (!current || priority < current.priority)
      selected.set(template.document_type, { template, priority });
  }

  return Array.from(selected.values(), ({ template }) => template);
}
