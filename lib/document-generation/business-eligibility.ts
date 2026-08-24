export const INDUSTRIAL_SHOP_PRELIMINARY_SURVEY_CODE = "INDUSTRIAL_SHOP_PRELIMINARY_SURVEY";
export const INDUSTRIAL_SHOP_PRELIMINARY_SURVEY_NAME = "공업사(예비조사표)";

const NEW_BUSINESS_TYPES = new Set(["first_measurement", "external_new"]);

export type DocumentGenerationTarget = {
  document_generation_enabled?: unknown;
  business_type?: unknown;
  business_category?: unknown;
};

export type DocumentDefinitionIdentity = {
  code?: unknown;
  name?: unknown;
};

export function isNewBusinessDocumentGenerationEligible(target: DocumentGenerationTarget): boolean {
  return (
    target.document_generation_enabled === true &&
    typeof target.business_type === "string" &&
    NEW_BUSINESS_TYPES.has(target.business_type)
  );
}

export function isIndustrialShopPreliminarySurvey(definition: DocumentDefinitionIdentity): boolean {
  return (
    definition.code === INDUSTRIAL_SHOP_PRELIMINARY_SURVEY_CODE ||
    definition.name === INDUSTRIAL_SHOP_PRELIMINARY_SURVEY_NAME
  );
}

export function isDocumentDefinitionEligibleForTarget(
  definition: DocumentDefinitionIdentity,
  target: DocumentGenerationTarget
): boolean {
  if (!isNewBusinessDocumentGenerationEligible(target)) return false;
  if (!isIndustrialShopPreliminarySurvey(definition)) return true;
  return String(target.business_category ?? "").trim() === "공업사";
}
