import assert from "node:assert/strict";
import test from "node:test";
import { buildTargetEditEnrichment } from "../lib/business-info/target-edit-enrichment";
import { buildTargetBusinessEditPatch } from "../lib/business/target-business-form";
import {
  getNationalSupportDisplayStatus,
  hasNationalSupportApplicationInformation,
} from "../lib/national-support/eligibility";

const latest = {
  code: "H0541",
  notes: "산재: 22087847550, 개시: 00000000000",
  representative_name: "서경",
};

for (const business_type of ["first_measurement", "external_new"]) {
  test(`${business_type}: 코드만 등록한 대상에 최신 business_info를 편집값으로 보완한다`, () => {
    const patch = buildTargetEditEnrichment({ code: "H0541", business_type }, latest);
    assert.deepEqual(patch, {
      sanjae: "22087847550",
      commencement: "00000000000",
      representative_name: "서경",
    });
    assert.equal(getNationalSupportDisplayStatus({
      sync_status: "정보부족",
      industrial_accident_number: patch.sanjae,
      commencement_number: patch.commencement,
      representative_name: patch.representative_name,
    }), "조회 대기");
    assert.equal(hasNationalSupportApplicationInformation({
      industrial_accident_number: patch.sanjae,
      commencement_number: patch.commencement,
      representative_name: patch.representative_name,
    }), false);
  });
}

test("기존 유효한 수동 입력은 보완자료보다 우선한다", () => {
  assert.deepEqual(buildTargetEditEnrichment({
    code: "H0541", business_type: "external_new",
    sanjae: "12345678901", commencement: "00000000001", representative_name: "수동 대표",
    national_support_representative_name: "수동 신청 대표",
  }, { ...latest, national_support_representative_name: "자료 신청 대표" }), {});
});

test("보완값은 열기만 하면 저장되지 않고 기존 상세 저장에서 변경분으로 직렬화된다", () => {
  const original = {
    code: "H0541", business_type: "external_new" as const, business_name: "예시 사업장",
    sanjae: "", commencement: "", representative_name: null,
  };
  const enriched = { ...original, ...buildTargetEditEnrichment(original, latest) };
  assert.deepEqual(buildTargetBusinessEditPatch(original, original, [], []), {});
  assert.deepEqual(buildTargetBusinessEditPatch(original, enriched, [], []), {
    industrial_accident_number: "22087847550",
    commencement_number: "00000000000",
    representative_name: "서경",
  });
});

test("코드가 다르거나 기존 사업장이면 타 사업장 정보로 보완하지 않는다", () => {
  assert.deepEqual(buildTargetEditEnrichment({ code: "H0542", business_type: "external_new" }, latest), {});
  assert.deepEqual(buildTargetEditEnrichment({ code: "H0541", business_type: "existing" }, latest), {});
  assert.deepEqual(buildTargetEditEnrichment({ code: "H0541", business_type: "external_new" }, {
    code: "H0541", notes: "사업자번호: 22087847550", representative_name: "서경",
  }), { representative_name: "서경" });
});

test("신청 대표자 명시값을 우선하며 복수 이름을 임의 분해하지 않는다", () => {
  const patch = buildTargetEditEnrichment({ code: "H0541", business_type: "first_measurement" }, {
    ...latest, national_support_representative_name: "서경, 김경",
  });
  assert.equal(patch.national_support_representative_name, "서경, 김경");
  assert.equal(getNationalSupportDisplayStatus({
    sync_status: "정보부족", industrial_accident_number: patch.sanjae,
    commencement_number: patch.commencement,
    representative_name: patch.representative_name,
    national_support_representative_name: patch.national_support_representative_name,
  }), "조회 대기");
});
