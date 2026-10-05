import { ExcelField } from "./contract";

const futurePeriod = (value: string) => {
  const number = Number(value.match(/\d+/)?.[0]);
  return Number.isFinite(number) && number > 0 ? (value.includes("년") || number === 1 ? number * 12 : number) : null;
};
const date = (value: string) => {
  const digits = value.replace(/[^0-9]/g, "");
  return /^\d{8}$/.test(digits) ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}` : value;
};

// Order is the public Excel contract. Read-only fields are recognized but never written.
export const measurementTargetFields: readonly ExcelField[] = [
  { key: "code", label: "사업장코드", source: "measurement_target_business.code", export: true, template: true, import: true, writable: true, required: true, aliases: ["code", "m.i_code", "관리번호", "코드"] },
  { key: "year", label: "측정년도", source: "measurement_target_business.year", export: true, template: true, import: true, writable: true, required: true, aliases: ["year", "년도"] },
  { key: "period", label: "측정주기", source: "measurement_target_business.period", export: true, template: true, import: true, writable: true, required: true, aliases: ["period", "주기", "분기"] },
  { key: "is_registered", label: "실시여부", source: "measurement_target_business.is_registered", export: true, template: true, import: true, writable: true, aliases: ["is_registered", "계획진행", "상태"] },
  { key: "national_support_status", label: "국고지원", source: "measurement_target_business > application > journal", export: true, template: false, import: false, writable: false, aliases: ["국고결과"] },
  { key: "plan_manager", label: "계획담당자", source: "measurement_target_business.plan_manager / measurer", export: true, template: true, import: true, writable: true, aliases: ["plan_manager", "담당"] },
  { key: "business_category", label: "업종분류", source: "measurement_target_business > latest measurement_business > latest journal", export: true, template: true, import: true, writable: true, aliases: ["business_category", "업종", "업태"] },
  { key: "business_type", label: "기본유형", source: "measurement_target_business.business_type", export: true, template: false, import: false, writable: false },
  { key: "business_name", label: "사업장명", source: "measurement_target_business.business_name", export: true, template: true, import: true, writable: true, aliases: ["business_name", "업체명"] },
  { key: "address", label: "주소", source: "measurement_target_business.address", export: true, template: true, import: true, writable: true, aliases: ["address", "소재지"] },
  { key: "office_jurisdiction", label: "소재지관할청", source: "measurement_target_business.office_jurisdiction", export: true, template: true, import: true, writable: true, aliases: ["office_jurisdiction", "관할청", "소재지 관할청"] },
  { key: "unpaid_count", label: "미수", source: "receivables derived", export: true, template: false, import: false, writable: false },
  { key: "previous_measurement_date", label: "전회측정일", source: "measurement_target_business.previous_measurement_date", export: true, template: true, import: true, writable: true, aliases: ["previous_measurement_date", "전회측정"], parse: date },
  { key: "previous_measurement_period", label: "전회측정주기", source: "measurement_target_business.previous_measurement_period", export: true, template: true, import: true, writable: true, aliases: ["previous_measurement_period", "전회주기", "전회 측정 주기"] },
  { key: "future_measurement_period", label: "향후측정주기", source: "measurement_target_business.future_measurement_period", export: true, template: true, import: true, writable: true, aliases: ["future_measurement_period", "향후 측정 주기"], parse: futurePeriod },
  { key: "measurement_month", label: "예정월", source: "measurement_target_business.measurement_month", export: true, template: false, import: false, writable: false, aliases: ["측정월"] },
  { key: "future_measurement_date", label: "예정일", source: "measurement_target_business.future_measurement_date", export: true, template: false, import: false, writable: false, aliases: ["금회예정일"] },
  { key: "report_writer", label: "보고서 담당", source: "measurement target presentation", export: true, template: false, import: false, writable: false },
  { key: "measurement_date", label: "실시일", source: "measurement_target_business.measurement_date", export: true, template: false, import: false, writable: false, aliases: ["금회측정확정일"] },
  { key: "manager_name", label: "담당자", source: "measurement_target_business.manager_name", export: true, template: true, import: true, writable: true, aliases: ["manager_name", "담당자명"] },
  { key: "manager_mobile", label: "휴대폰", source: "measurement_target_business.manager_mobile", export: true, template: true, import: true, writable: true, aliases: ["manager_mobile", "연락처", "담당자 휴대폰"] },
  { key: "phone", label: "전화번호", source: "measurement_target_business.phone", export: true, template: true, import: true, writable: true, aliases: ["phone", "회사전화", "회사전화번호"] },
  { key: "fax", label: "팩스", source: "measurement_target_business.fax", export: true, template: true, import: true, writable: true, aliases: ["fax", "전송"] },
  { key: "industrial_accident_number", label: "산재관리번호", source: "measurement_target_business.industrial_accident_number", export: true, template: true, import: true, writable: true, aliases: ["industrial_accident_number", "산재번호", "관리번호_산재"] },
  { key: "commencement_number", label: "사업개시번호", source: "measurement_target_business.commencement_number", export: true, template: true, import: true, writable: true, aliases: ["commencement_number", "개시번호"] },
  { key: "representative_name", label: "대표자명", source: "measurement_target_business.representative_name", export: true, template: true, import: true, writable: true, aliases: ["representative_name", "대표자", "대표", "대표이사", "사장님"] },
  { key: "notes", label: "비고", source: "measurement_target_business.notes", export: true, template: true, import: true, writable: true, aliases: ["notes", "특이사항"] },
  { key: "business_number", label: "사업자번호", source: "measurement_target_business.business_number", export: false, template: false, import: true, writable: true, aliases: ["business_number", "등록번호"] },
];
