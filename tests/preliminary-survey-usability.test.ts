import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { lookupLaborOffices } from "../lib/labor-offices/lookup";
import { createDefaultPreliminarySurveyFilters } from "../lib/preliminary-survey-v2/filter-state";
import {
  buildPersonAssignmentRows,
  filterPersonAssignmentRows,
  parseStoredAddressAdministrativeUnits,
} from "../lib/preliminary-survey-v2/person-assignment-view";
import { SURVEY_TAB_IDS, restoreSurveyTabOrder } from "../lib/preliminary-survey-v2/tab-order";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("구형 search와 이동 전 labor-offices 탭 저장 순서는 유효 탭을 보존한다", () => {
  assert.deepEqual(
    restoreSurveyTabOrder('["schedule-blocks","search","labor-offices","plans","list"]'),
    ["schedule-blocks", "plans", "person-assignments", "list"],
  );
  assert.ok(!SURVEY_TAB_IDS.includes("search" as never));
  assert.ok(!SURVEY_TAB_IDS.includes("labor-offices" as never));
});

test("노동관서 조회는 독립 페이지이며 데스크톱·모바일 메뉴 순서가 같다", () => {
  const survey = read("app/survey/page.tsx");
  const page = read("app/labor-offices/page.tsx");
  assert.doesNotMatch(survey, /LaborOfficeLookup|labor-offices/);
  assert.match(page, /requireAuth\(\)/);
  assert.match(page, /<LaborOfficeLookup \/>/);
  for (const navPath of ["components/layout/Header.tsx", "components/layout/Sidebar.tsx"]) {
    const nav = read(navPath);
    const ordered = [
      '{ href: "/report-processing", label: "보고서 처리"',
      '{ href: "/labor-offices", label: "노동관서 조회"',
      '{ href: "/businesses/national-support", label: "건강디딤돌 조회"',
      '{ href: "/sales", label: "매출관리"',
    ];
    const positions = ordered.map((value) => nav.indexOf(value));
    assert.ok(positions.every((position) => position >= 0), navPath);
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b), navPath);
    assert.doesNotMatch(nav, /label: "건강디딤돌 신청결과"/);
  }
});

test("계획과 목록 초기화 기본값은 편집값과 active snapshot에 함께 쓸 수 있다", () => {
  const defaults = createDefaultPreliminarySurveyFilters("2026-09-26");
  assert.deepEqual(defaults.plan, {
    year: 2026, period: "", statusFilter: "", kindFilter: "",
    measurementBaseDate: "2026-09-26", measurementRangeUnit: "day",
    measurementDateFrom: "2026-09-26", measurementDateTo: "2026-09-26", searchQuery: "",
  });
  assert.equal(defaults.list.preliminaryDateFilter, "");
  assert.equal(defaults.list.methodFilter, "");
  const ui = read("components/features/PreliminarySurveyV2Plans.tsx");
  assert.match(ui, /setPlanSearchSnapshot\(defaults\.plan\)/);
  assert.match(ui, /setListSearchSnapshot\(defaults\.list\)/);
  assert.equal((ui.match(/>초기화<\/Button>/g) ?? []).length, 2);
});

test("개인별 배정은 V2 source를 역할별 행으로 펼치고 복수 조사자를 보존한다", () => {
  const rows = buildPersonAssignmentRows({
    targets: [{ id: 10, code: "H1000", business_name: "아산 사업장", address: "충청남도 아산시 배방읍 희망로 1" }],
    plans: [{
      id: "p1", measurement_target_business_id: 10, recommended_date: "2026-09-10",
      participant_user_ids: [2, 3], participant_names: ["김조사", "박조사"],
      survey_method: "field",
    }],
    assignments: [{ plan_id: "p1", measurement_date: "2026-09-20", assignee_user_id: 1, public_sample_code: "A" }],
    users: [{ id: 1, name: "이측정" }, { id: 2, name: "김조사" }, { id: 3, name: "박조사" }],
  });
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => !("status" in row)));
  const personUi = read("components/features/PreliminarySurveyPersonAssignments.tsx");
  assert.doesNotMatch(personUi, /row\.status|\["상태"/);
  assert.deepEqual(rows.filter((row) => row.role === "preliminary_surveyor").map((row) => row.employeeName), ["김조사", "박조사"]);
  assert.deepEqual(rows.map((row) => [row.sigungu, row.eupMyeonDong]), [
    ["아산시", "배방읍"], ["아산시", "배방읍"], ["아산시", "배방읍"],
  ]);
  assert.deepEqual(filterPersonAssignmentRows(rows, {
    startDate: "2026-09-20", endDate: "2026-09-20", role: "", search: "아산",
  }).map((row) => row.role), ["measurement_assignee"]);
  assert.deepEqual(filterPersonAssignmentRows(rows, {
    startDate: "2026-09-10", endDate: "2026-09-10", role: "preliminary_surveyor", employeeId: 3,
  }).map((row) => row.employeeName), ["박조사"]);
});

test("주소 표시 파서는 저장 주소만 사용하고 불명확한 읍면동은 대시를 반환한다", () => {
  assert.deepEqual(parseStoredAddressAdministrativeUnits("서울특별시 강남구 역삼동 테헤란로 1"), {
    sigungu: "강남구", eupMyeonDong: "역삼동",
  });
  assert.deepEqual(parseStoredAddressAdministrativeUnits("충남 아산시 도로명 1"), {
    sigungu: "아산시", eupMyeonDong: "-",
  });
  assert.deepEqual(parseStoredAddressAdministrativeUnits("경기도 수원시 영통구 매탄동 효원로 1"), {
    sigungu: "수원시 영통구", eupMyeonDong: "매탄동",
  });
  for (const [address, sigungu, eupMyeonDong] of [
    ["세종특별자치시 나성동 한누리대로 1", "세종특별자치시", "나성동"],
    ["강원특별자치도 원주시 반곡동 혁신로 1", "원주시", "반곡동"],
    ["전북특별자치도 전주시 완산구 효자동1가 도로명 1", "전주시 완산구", "-"],
    ["제주특별자치도 제주시 노형동 노형로 1", "제주시", "노형동"],
    ["강원도 원주시 무실동 도로명 1", "원주시", "무실동"],
    ["전라북도 전주시 완산구 중화산동 도로명 1", "전주시 완산구", "중화산동"],
  ]) {
    assert.deepEqual(parseStoredAddressAdministrativeUnits(address), { sigungu, eupMyeonDong }, address);
  }
});

const laborDirectory = {
  offices: [
    { office_code: "CHEONAN", current_official_name: "대전지방고용노동청 천안지청", current_short_name: "천안지청", jurisdiction_reference: "충남 천안시, 아산시", phone: "041-000-0000", fax: "041-000-0001", is_active: true },
    { office_code: "BORYEONG", current_official_name: "대전지방고용노동청 보령지청", current_short_name: "보령지청", jurisdiction_reference: "충남 보령시, 서천군", phone: "041-111-0000", fax: "041-111-0001", is_active: true },
  ],
  aliases: [
    { office_code: "CHEONAN", business_office_name: "대전지방고용노동청 천안지청", document_office_name: "천안지청", mapping_note: "현재 관서 마스터에 직접 연결", is_active: true },
    { office_code: "BORYEONG", business_office_name: "대전지방고용노동청 보령지청", document_office_name: "보령지청", mapping_note: "현재 관서 마스터에 직접 연결", is_active: true },
  ],
};

test("노동관서 조회는 짧은 행정명·시군구·전체 주소를 같은 DB 관서로 연결한다", () => {
  for (const query of ["아산", "아산시", "충남 아산시", "충청남도 아산시 배방읍 희망로 1"]) {
    const result = lookupLaborOffices(query, laborDirectory);
    assert.equal(result.status, "matched", query);
    assert.equal(result.candidates[0]?.office_code, "CHEONAN", query);
  }
});

test("노동관서 조회는 광역 입력의 복수 후보를 임의 선택하지 않는다", () => {
  const result = lookupLaborOffices("충남", laborDirectory);
  assert.equal(result.status, "ambiguous");
  assert.deepEqual(result.candidates.map((office) => office.office_code), ["BORYEONG", "CHEONAN"]);
  const incompleteReferences = {
    ...laborDirectory,
    offices: [
      { ...laborDirectory.offices[0], jurisdiction_reference: "충청남도 아산시" },
      { ...laborDirectory.offices[1], jurisdiction_reference: "보령시, 서천군" },
    ],
  };
  assert.equal(lookupLaborOffices("충남", incompleteReferences).status, "ambiguous");
});

test("실제 관할 표기에서 충남 아산은 천안만, 광역 단독·동명 시군구는 모호하게 표시한다", () => {
  const directory = {
    offices: [
      { ...laborDirectory.offices[0], jurisdiction_reference: "천안시, 아산시, 당진시, 예산군" },
      { office_code: "DAEJEON", current_official_name: "대전지방고용노동청", current_short_name: "대전청", jurisdiction_reference: "대전광역시, 세종시, 충청남도 금산군, 공주시, 논산시, 계룡시", phone: "042-000-0000", fax: "042-000-0001", is_active: true },
      { office_code: "SEOUL", current_official_name: "서울지방고용노동청", current_short_name: "서울청", jurisdiction_reference: "서울특별시 중구, 종로구", phone: null, fax: null, is_active: true },
      { office_code: "BUSAN", current_official_name: "부산지방고용노동청", current_short_name: "부산청", jurisdiction_reference: "부산시 부산진구, 연제구, 중구", phone: null, fax: null, is_active: true },
      { office_code: "GANGNEUNG", current_official_name: "강릉지청", current_short_name: "강릉지청", jurisdiction_reference: "강릉시, 동해시, 고성군", phone: null, fax: null, is_active: true },
      { office_code: "TONGYEONG", current_official_name: "통영지청", current_short_name: "통영지청", jurisdiction_reference: "통영시, 거제시, 고성군", phone: null, fax: null, is_active: true },
    ],
    aliases: laborDirectory.aliases,
  };
  for (const query of ["아산", "아산시", "충남 아산", "충청남도 아산", "충남 아산시", "충청남도 아산시 배방읍 희망로 1"]) {
    const result = lookupLaborOffices(query, directory);
    assert.equal(result.status, "matched", query);
    assert.deepEqual(result.candidates.map((office) => office.office_code), ["CHEONAN"], query);
  }
  assert.equal(lookupLaborOffices("충남", directory).status, "ambiguous");
  for (const query of ["중구", "고성군"]) {
    const result = lookupLaborOffices(query, directory);
    assert.equal(result.status, "ambiguous", query);
    assert.ok(result.candidates.length > 1, query);
  }
});

test("개인별 API는 legacy preliminary_survey를 source로 조회하지 않는다", () => {
  const api = read("app/api/preliminary-survey-v2/person-assignments/route.ts");
  assert.match(api, /preliminary_survey_v2_measurement_assignments/);
  assert.match(api, /preliminary_survey_v2_plans/);
  assert.match(api, /measurement_target_business/);
  assert.doesNotMatch(api, /from\("preliminary_survey"\)/);
});
