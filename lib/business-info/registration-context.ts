export interface RegistrationBusinessInfo {
  representative_name?: string | null;
  address?: string | null;
  business_category?: string | null;
  phone?: string | null;
  fax?: string | null;
  industrial_accident_number?: string | null;
  commencement_number?: string | null;
}

export interface ExactMeasurementBusiness {
  representative_name?: string | null;
  address?: string | null;
  business_category?: string | null;
  industrial_accident_number?: string | null;
  commencement_number?: string | null;
  manager_name?: string | null;
  manager_mobile?: string | null;
  manager_phone?: string | null;
  phone?: string | null;
  fax?: string | null;
  total_employees?: number | string | null;
  updated_at?: string | null;
}

export interface RegistrationAutoFillValues {
  representative_name: string;
  address: string;
  business_category: string;
  sanjae: string;
  commencement: string;
  manager_name: string;
  manager_mobile: string;
  manager_phone: string;
  phone: string;
  fax: string;
  total_employees: number | null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function preferred(primary: unknown, fallback: unknown): string {
  return text(primary) || text(fallback);
}

function employeeCount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number"
    ? value
    : Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Builds the values used only by the new target-business registration modal.
 * No historical measurement_business row is accepted by this helper.
 */
export function buildRegistrationAutoFillValues(
  businessInfo: RegistrationBusinessInfo,
  exactMeasurementBusiness: ExactMeasurementBusiness | null,
): RegistrationAutoFillValues {
  const measurement = exactMeasurementBusiness || {};

  return {
    representative_name: preferred(measurement.representative_name, businessInfo.representative_name),
    address: preferred(measurement.address, businessInfo.address),
    business_category: preferred(measurement.business_category, businessInfo.business_category),
    sanjae: preferred(measurement.industrial_accident_number, businessInfo.industrial_accident_number),
    commencement: preferred(measurement.commencement_number, businessInfo.commencement_number),
    manager_name: text(measurement.manager_name),
    manager_mobile: text(measurement.manager_mobile),
    manager_phone: text(measurement.manager_phone),
    phone: preferred(measurement.phone, businessInfo.phone),
    fax: preferred(measurement.fax, businessInfo.fax),
    total_employees: employeeCount(measurement.total_employees),
  };
}
