import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as XLSX from "xlsx";
import { exportRow, headersFor, importRow } from "../lib/excel-contract/contract";
import { measurementTargetFields } from "../lib/excel-contract/measurement-target";
import { assertNationalSupportPeriod, nationalSupportFields } from "../lib/excel-contract/national-support";

const measurementExport = [
  "사업장코드", "측정년도", "측정주기", "실시여부", "국고지원", "계획담당자", "업종분류", "기본유형",
  "사업장명", "주소", "소재지관할청", "미수", "전회측정일", "전회측정주기", "향후측정주기",
  "예정월", "예정일", "보고서 담당", "실시일", "담당자", "휴대폰", "전화번호", "팩스",
  "산재관리번호", "사업개시번호", "대표자명", "비고",
];
const measurementTemplate = measurementExport.filter((header) => ![
  "국고지원", "기본유형", "미수", "예정월", "예정일", "보고서 담당", "실시일",
].includes(header));
const nationalExport = [
  "사업장코드", "사업장명", "신청 대표자", "산재관리번호", "사업개시번호", "주소",
  "측정년도", "측정주기", "신청 여부", "신청결과", "국고지원 상태", "수정일시",
];
const nationalTemplate = ["사업장코드", "신청 대표자", "산재관리번호", "사업개시번호", "신청 여부", "신청결과"];

test("canonical headers derive from the two registries in stable order", () => {
  assert.deepEqual(headersFor(measurementTargetFields, "export"), measurementExport);
  assert.deepEqual(headersFor(measurementTargetFields, "template"), measurementTemplate);
  assert.deepEqual(headersFor(nationalSupportFields, "export"), nationalExport);
  assert.deepEqual(headersFor(nationalSupportFields, "template"), nationalTemplate);
  for (const fields of [measurementTargetFields, nationalSupportFields]) {
    assert.equal(new Set(fields.map((field) => field.label)).size, fields.length);
    assert.ok(fields.every((field) => !field.template || (field.import && field.writable)));
    assert.ok(fields.every((field) => !field.import || field.writable));
    const headerOwners = new Map<string, string>();
    for (const field of fields) {
      for (const header of [field.label, ...(field.aliases || [])]) {
        assert.ok(!headerOwners.has(header) || headerOwners.get(header) === field.key, `${header} maps to two fields`);
        headerOwners.set(header, field.key);
      }
    }
  }
});

function xlsxRoundTrip(row: Record<string, unknown>, headers: string[]) {
  const sheet = XLSX.utils.json_to_sheet([row], { header: headers });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "contract");
  const bytes = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  const parsed = XLSX.read(bytes, { type: "buffer" });
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(parsed.Sheets.contract, { raw: false })[0];
}

test("measurement export xlsx can be uploaded while derived fields are ignored", () => {
  const row = exportRow(measurementTargetFields, {
    code: "H0138", year: 2026, period: "상반기", is_registered: "미실시", national_support_status: "대상",
    plan_manager: "홍길동", business_category: "공업사", business_name: "예시 사업장", address: "대전",
    office_jurisdiction: "대전지청", unpaid_count: 2, previous_measurement_date: "2025-10-01",
    previous_measurement_period: "하반기", future_measurement_period: "6개월", measurement_month: "4월",
    future_measurement_date: "2026-04-01", report_writer: "김담당", measurement_date: "2026-04-02",
    manager_name: "이담당", manager_mobile: "01012345678", phone: "0421234567", fax: "0421234568",
    industrial_accident_number: "12345", commencement_number: "001", representative_name: "박대표", notes: "확인",
  });
  const parsed = importRow(measurementTargetFields, xlsxRoundTrip(row, measurementExport));
  assert.equal(parsed.code, "H0138");
  assert.equal(parsed.business_category, "공업사");
  assert.equal(parsed.future_measurement_period, 6);
  assert.equal(parsed.plan_manager, "홍길동");
  for (const key of ["national_support_status", "unpaid_count", "future_measurement_date", "report_writer", "measurement_date"]) {
    assert.ok(!(key in parsed), key);
  }
});

test("national export xlsx accepts matching context and rejects a different period before writes", () => {
  const row = exportRow(nationalSupportFields, {
    code: "H0138", business_name: "예시 사업장", representative: "홍길동", industrial_accident_number: "12345",
    commencement_number: "001", address: "대전", year: 2026, period: "상반기", application_status: "○",
    result: "대상", national_support_status: "대상", updated_at: "2026-10-05",
  });
  const read = xlsxRoundTrip(row, nationalExport);
  assert.doesNotThrow(() => assertNationalSupportPeriod(read, "2026", "상반기", 2));
  assert.throws(() => assertNationalSupportPeriod(read, "2026", "하반기", 2), /2행.*다릅니다/);
  assert.throws(() => assertNationalSupportPeriod(read, "2025", "상반기", 2), /2행.*다릅니다/);
  const parsed = importRow(nationalSupportFields, read);
  assert.equal(parsed.code, "H0138");
  assert.equal(parsed.representative, "홍길동");
  assert.equal(parsed.result, "대상");
  for (const key of ["business_name", "address", "year", "period", "national_support_status", "updated_at"]) {
    assert.ok(!(key in parsed), key);
  }
});

test("legacy headers retain their original field meanings", () => {
  const target = importRow(measurementTargetFields, {
    "관리번호": "H0138", "년도": 2026, "분기": "상반기", "업태": "공업사", "소재지": "대전",
    "회사전화": "0421234567", "관할청": "대전", "담당": "계획자", "대표이사": "대표", "관리번호_산재": "12345",
  });
  assert.equal(target.code, "H0138");
  assert.equal(target.business_category, "공업사");
  assert.equal(target.phone, "0421234567");
  assert.equal(target.office_jurisdiction, "대전");
  assert.equal(target.industrial_accident_number, "12345");
  const national = importRow(nationalSupportFields, {
    "사업장코드": "H0138", "사업장관리번호": "12345", "대표자": "홍길동", "결과": "대상",
  });
  assert.equal(national.code, "H0138");
  assert.equal(national.industrial_accident_number, "12345");
  assert.equal(national.representative, "홍길동");
});

test("routes and the visible measurement download use registry headers", () => {
  for (const path of [
    "app/api/export/businesses/route.ts", "app/api/export/national-support/route.ts",
    "app/api/templates/[template]/route.ts", "components/features/MeasurementTargetBusinessManagement.tsx",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /headersFor\(/, path);
    assert.match(source, /excel-contract/, path);
  }
  for (const path of ["app/api/businesses/upload/route.ts", "app/api/businesses/national-support/upload/route.ts"]) {
    assert.match(readFileSync(path, "utf8"), /importRow\(/, path);
  }
  const nationalUpload = readFileSync("app/api/businesses/national-support/upload/route.ts", "utf8");
  assert.ok(nationalUpload.indexOf("data.forEach((row, index) => assertNationalSupportPeriod") < nationalUpload.indexOf("// 데이터 처리"));
  const exportSource = readFileSync("app/api/export/businesses/route.ts", "utf8");
  assert.match(exportSource, /resolveTargetBusinessCategory\(\s*business\.business_category,\s*latestCategoryMap\.get/);
});
