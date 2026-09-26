import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import JSZip from "jszip";
import * as XLSX from "xlsx";

import {
  NATIONAL_SUPPORT_PROCESSING_STATUS_HEADERS,
  NATIONAL_SUPPORT_REQUIRED_HEADERS,
  getNationalSupportPaymentMissingFields,
  nationalSupportPaymentIdentity,
  normalizeElevenDigitIdentifier,
  normalizeNationalSupportPaymentRow,
} from "../lib/national-support/payment-upload";

test("처리현황 원본 18개 열 뒤에 입금일을 추가해 업로드 표준으로 유지한다", () => {
  assert.deepEqual([...NATIONAL_SUPPORT_PROCESSING_STATUS_HEADERS], [
    "사업년도", "파일명", "접수번호", "사업장관리번호", "사업장개시번호", "사업장명",
    "순번", "반기", "파일전송일", "파일상태", "반송/삭감사유", "신청금액",
    "1차 심사일", "비용지급일", "공단산정금액", "삭감금액", "심사금액", "지급예정금액",
    "입금일",
  ]);
  assert.deepEqual([...NATIONAL_SUPPORT_REQUIRED_HEADERS], [
    "사업년도", "사업장관리번호", "사업장개시번호", "반기", "지급예정금액", "입금일",
  ]);
});
test("다운로드 양식의 마지막 헤더는 적색 입금일이고 메모는 없다", async () => {
  const templatePath = "public/templates/national-support-payment-upload.xlsx";
  const workbook = XLSX.readFile(templatePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
  assert.equal(rows[0]?.[18], "입금일");

  const zip = await JSZip.loadAsync(readFileSync(templatePath));
  const styles = await zip.file("xl/styles.xml")?.async("string");
  const sheetXml = await zip.file("xl/worksheets/sheet1.xml")?.async("string");
  assert.match(styles || "", /FF0000/i);
  assert.match(styles || "", /numFmtId="49"/);
  assert.match(sheetXml || "", /<col[^>]*min="19"[^>]*max="19"[^>]*style="4"[^>]*\/>/);
  assert.equal(
    Object.keys(zip.files).some(name => /comments|vmlDrawing/i.test(name)),
    false,
  );
});

test("처리현황 행을 DB 정산용 값으로 정규화한다", () => {
  const row = normalizeNationalSupportPaymentRow({
    "사업년도": "2026",
    "사업장관리번호": "58881004746",
    "사업장개시번호": "92608301647",
    "사업장명": "주식회사 에이치원건설",
    "반기": "하반기",
    "비용지급일": "20260920",
    "지급예정금액": "1,000,000",
    "입금일": "20260922",
  });

  assert.deepEqual(row, {
    year: "2026",
    period: "하반기",
    accidentNumber: "58881004746",
    commencementNumber: "92608301647",
    businessName: "주식회사 에이치원건설",
    depositDate: "2026-09-22",
    depositAmount: 1000000,
  });
  assert.deepEqual(getNationalSupportPaymentMissingFields(row), []);
});

test("엑셀이 앞자리 0을 숫자로 바꿔도 11자리 개시번호로 복구한다", () => {
  assert.equal(normalizeElevenDigitIdentifier(0), "00000000000");
  assert.equal(normalizeElevenDigitIdentifier(1234567890), "01234567890");
});

test("엑셀 날짜 일련번호도 입금일로 정규화한다", () => {
  const row = normalizeNationalSupportPaymentRow({
    "사업년도": 2026,
    "사업장관리번호": 58881004746,
    "사업장개시번호": 92608301647,
    "반기": "하반기",
    "비용지급일": 46230,
    "지급예정금액": 1000000,
    "입금일": 46237,
  });
  assert.equal(row.depositDate, "2026-08-03");
});

test("비용지급일은 실제 입금일로 사용하지 않고 입금일을 필수로 요구한다", () => {
  const row = normalizeNationalSupportPaymentRow({
    "사업년도": 2026,
    "사업장관리번호": 58881004746,
    "사업장개시번호": 92608301647,
    "반기": "하반기",
    "비용지급일": "20260801",
    "지급예정금액": 1000000,
  });
  assert.equal(row.depositDate, null);
  assert.ok(getNationalSupportPaymentMissingFields(row).includes("입금일"));
});
test("동일 산재관리번호라도 개시번호가 다르면 서로 다른 정산 대상이다", () => {
  const base = {
    year: "2026",
    period: "하반기" as const,
    accidentNumber: "58881004746",
    businessName: "에이치원건설",
    depositDate: "2026-09-22",
    depositAmount: 1000000,
  };
  const first = { ...base, commencementNumber: "92605689817" };
  const second = { ...base, commencementNumber: "92608301647" };
  assert.notEqual(nationalSupportPaymentIdentity(first), nationalSupportPaymentIdentity(second));
});

test("기존 헤더 명칭도 개시번호를 포함하면 전환용 입력으로 읽을 수 있다", () => {
  const row = normalizeNationalSupportPaymentRow({
    "측정년도": 2026,
    "측정주기": "상반기",
    "산재관리번호": 31285255890,
    "개시번호": 0,
    "사업장명": "선진정공(주)",
    "입금일": 20260803,
    "입금액": 300000,
  });
  assert.equal(row.year, "2026");
  assert.equal(row.period, "상반기");
  assert.equal(row.accidentNumber, "31285255890");
  assert.equal(row.commencementNumber, "00000000000");
  assert.equal(row.depositDate, "2026-08-03");
  assert.equal(row.depositAmount, 300000);
});
test("정산 API가 4개 식별값 모두로 조회하고 중복이면 사업장명으로 1건만 확정한다", () => {
  const source = readFileSync("app/api/journal/upload/payment-status/route.ts", "utf8");
  assert.match(source, /\.eq\("measurement_year", measurement_year\)/);
  assert.match(source, /\.eq\("measurement_period", measurement_period\)/);
  assert.match(source, /\.eq\("industrial_accident_number", normalizedAccidentNumber\)/);
  assert.match(source, /\.eq\("commencement_number", normalizedCommencementNumber\)/);
  assert.match(source, /journals\.length > 1/);
  assert.match(source, /normalizeNationalSupportBusinessName\(business_name\)/);
  assert.match(source, /nameMatches\.length !== 1/);
});

test("매출 조회의 전체 측정자료에 개시번호를 포함한다", () => {
  const source = readFileSync("app/api/sales/route.ts", "utf8");
  assert.match(
    source,
    /business_number, industrial_accident_number, commencement_number, designated_office/,
  );
});
