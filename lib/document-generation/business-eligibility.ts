export const GENERAL_PRELIMINARY_SURVEY_CODE = "GENERAL_PRELIMINARY_SURVEY";
export const GENERAL_PRELIMINARY_SURVEY_NAME = "예비조사표(일반)";
export const INDUSTRIAL_SHOP_PRELIMINARY_SURVEY_CODE = "INDUSTRIAL_SHOP_PRELIMINARY_SURVEY";
export const INDUSTRIAL_SHOP_PRELIMINARY_SURVEY_NAME = "예비조사표(공업사)";
export const PRELIMINARY_SURVEY_FILENAME_PATTERN =
  "{business_name}(예비조사표-{short_year}{short_period})";

const LEGACY_GENERAL_PRELIMINARY_SURVEY_NAME = "일반 예비조사표";
const LEGACY_INDUSTRIAL_SHOP_PRELIMINARY_SURVEY_NAME = "공업사(예비조사표)";

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
    definition.name === INDUSTRIAL_SHOP_PRELIMINARY_SURVEY_NAME ||
    definition.name === LEGACY_INDUSTRIAL_SHOP_PRELIMINARY_SURVEY_NAME
  );
}

export function isGeneralPreliminarySurvey(definition: DocumentDefinitionIdentity): boolean {
  return (
    definition.code === GENERAL_PRELIMINARY_SURVEY_CODE ||
    definition.name === GENERAL_PRELIMINARY_SURVEY_NAME ||
    definition.name === LEGACY_GENERAL_PRELIMINARY_SURVEY_NAME
  );
}

export function isPreliminarySurveyVariantEligibleForTarget(
  definition: DocumentDefinitionIdentity,
  target: DocumentGenerationTarget
): boolean {
  const industrialShop = String(target.business_category ?? "").trim() === "공업사";
  if (isIndustrialShopPreliminarySurvey(definition)) return industrialShop;
  if (isGeneralPreliminarySurvey(definition)) return !industrialShop;
  return true;
}

export function documentDefinitionDisplayName(definition: DocumentDefinitionIdentity): string {
  if (isIndustrialShopPreliminarySurvey(definition))
    return INDUSTRIAL_SHOP_PRELIMINARY_SURVEY_NAME;
  if (isGeneralPreliminarySurvey(definition)) return GENERAL_PRELIMINARY_SURVEY_NAME;
  return String(definition.name ?? definition.code ?? "문서").trim() || "문서";
}

export function documentDefinitionFilenamePattern(
  definition: DocumentDefinitionIdentity,
  currentPattern: unknown
): string {
  if (isGeneralPreliminarySurvey(definition) || isIndustrialShopPreliminarySurvey(definition))
    return PRELIMINARY_SURVEY_FILENAME_PATTERN;
  return String(currentPattern ?? "").trim();
}

export function isDocumentDefinitionEligibleForTarget(
  definition: DocumentDefinitionIdentity,
  target: DocumentGenerationTarget
): boolean {
  if (!isNewBusinessDocumentGenerationEligible(target)) return false;
  return isPreliminarySurveyVariantEligibleForTarget(definition, target);
}
