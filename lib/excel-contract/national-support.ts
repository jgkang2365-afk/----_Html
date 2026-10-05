import { ExcelField } from "./contract";

export const nationalSupportFields: readonly ExcelField[] = [
  { key: "code", label: "사업장코드", source: "national_support_application.code", export: true, template: true, import: true, writable: true, required: true, aliases: ["코드", "code", "관리번호"] },
  { key: "business_name", label: "사업장명", source: "business_info > measurement_business", export: true, template: false, import: false, writable: false },
  { key: "representative", label: "신청 대표자", source: "national_support_application.representative_name > current override/base", export: true, template: true, import: true, writable: true, aliases: ["대표자", "대표자명", "representative"] },
  { key: "industrial_accident_number", label: "산재관리번호", source: "measurement_target_business / measurement_business; upload fills empty target only", export: true, template: true, import: true, writable: true, aliases: ["사업장관리번호", "산재번호", "industrial_accident_number"] },
  { key: "commencement_number", label: "사업개시번호", source: "measurement_target_business / measurement_business; upload fills empty target only", export: true, template: true, import: true, writable: true, aliases: ["commencement_number"] },
  { key: "address", label: "주소", source: "business_info > measurement_business", export: true, template: false, import: false, writable: false, aliases: ["소재지", "주소(필수 값 아님)"] },
  { key: "year", label: "측정년도", source: "national_support_application.year", export: true, template: false, import: false, writable: false, aliases: ["year", "년도"] },
  { key: "period", label: "측정주기", source: "national_support_application.period", export: true, template: false, import: false, writable: false, aliases: ["period", "주기"] },
  { key: "application_status", label: "신청 여부", source: "national_support_application.application_status", export: true, template: true, import: true, writable: true, aliases: ["신청여부", "application_status"] },
  { key: "result", label: "신청결과", source: "national_support_application.result", export: true, template: true, import: true, writable: true, aliases: ["결과", "result"] },
  { key: "national_support_status", label: "국고지원 상태", source: "national_support_application.national_support_status", export: true, template: false, import: false, writable: false, aliases: ["국고지원상태"] },
  { key: "updated_at", label: "수정일시", source: "national_support_application.updated_at", export: true, template: false, import: false, writable: false },
  { key: "legacy_manager", label: "담당자", source: "legacy ignored", export: false, template: false, import: false, writable: false },
  { key: "legacy_mobile", label: "휴대전화번호\n(010 제외한 번호만 입력)", source: "legacy ignored", export: false, template: false, import: false, writable: false },
];

export function assertNationalSupportPeriod(row: Record<string, unknown>, year: string, period: string, rowNumber: number) {
  const fieldValue = (key: string) => {
    const field = nationalSupportFields.find((item) => item.key === key)!;
    const name = [field.label, ...(field.aliases || [])].find((candidate) => row[candidate] !== undefined);
    return name ? String(row[name] ?? "").trim() : "";
  };
  const fileYear = fieldValue("year");
  const filePeriod = fieldValue("period");
  if ((fileYear && Number(fileYear) !== Number(year)) || (filePeriod && filePeriod !== period)) {
    throw new Error(`${rowNumber}행의 측정년도·측정주기가 선택한 ${year} ${period}와 다릅니다.`);
  }
}
