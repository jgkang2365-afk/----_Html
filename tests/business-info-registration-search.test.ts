import assert from "node:assert/strict";
import test from "node:test";
import { mapBusinessInfoToRegistrationSearchResult } from "../lib/business-info/registration-search";
import { buildRegistrationAutoFillValues } from "../lib/business-info/registration-context";

test("business_info 기본정보와 비고 번호를 등록 검색 결과로 매핑한다", () => {
  const result = mapBusinessInfoToRegistrationSearchResult({
    code: "H9999",
    business_name: "테스트 사업장",
    business_number: "1234567890",
    representative_name: "홍길동",
    address1: "충남 천안시",
    address2: "서북구",
    business_category: "제조",
    phone: "041-000-0000",
    fax: "041-000-0001",
    invoice_email: "invoice@example.com",
    invoice_manager: "계산서담당",
    manager_position: "대리",
    manager_contact: "010-1111-2222",
    notes: "산재: 30781123856, 개시: 92600209747",
  }, "천안");

  assert.equal(result.code, "H9999");
  assert.equal(result.address, "충남 천안시 서북구");
  assert.equal(result.industrial_accident_number, "30781123856");
  assert.equal(result.commencement_number, "92600209747");
  assert.deepEqual(result.invoice_contact_candidate, {
    name: "계산서담당",
    position: "대리",
    contact: "010-1111-2222",
  });
  assert.equal((result as any).manager_name, undefined);
});

test("동일 연도·주기 measurement_business 보완값을 우선 적용한다", () => {
  const result = buildRegistrationAutoFillValues(
    {
      representative_name: "기본 대표",
      address: "기본 주소",
      business_category: "기본 업종",
      phone: "041-111-1111",
      fax: "041-111-2222",
      industrial_accident_number: "11111111111",
      commencement_number: "22222222222",
    },
    {
      representative_name: "동일 주기 대표",
      address: "동일 주기 주소",
      business_category: "동일 주기 업종",
      industrial_accident_number: "33333333333",
      commencement_number: "44444444444",
      manager_name: "측정 담당",
      manager_mobile: "010-1234-5678",
      phone: "041-333-3333",
      total_employees: "1,234",
    },
  );

  assert.equal(result.representative_name, "동일 주기 대표");
  assert.equal(result.sanjae, "33333333333");
  assert.equal(result.manager_name, "측정 담당");
  assert.equal(result.phone, "041-333-3333");
  assert.equal(result.total_employees, 1234);
});

test("정확 일치 보완자료의 공백은 business_info 유효값을 지우지 않는다", () => {
  const result = buildRegistrationAutoFillValues(
    {
      representative_name: "기본 대표",
      address: "기본 주소",
      business_category: "기본 업종",
      phone: "041-111-1111",
      fax: "041-111-2222",
      industrial_accident_number: "11111111111",
      commencement_number: "22222222222",
    },
    {
      representative_name: " ",
      address: null,
      phone: "",
      total_employees: null,
    },
  );

  assert.equal(result.representative_name, "기본 대표");
  assert.equal(result.address, "기본 주소");
  assert.equal(result.phone, "041-111-1111");
  assert.equal(result.sanjae, "11111111111");
  assert.equal(result.manager_name, "");
  assert.equal(result.total_employees, null);
});
