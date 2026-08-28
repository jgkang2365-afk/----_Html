import assert from "node:assert/strict";
import test from "node:test";
import {
  LaborOfficeAliasRow,
  LaborOfficeDirectory,
  LaborOfficeMasterRow,
  normalizeJurisdictionReferenceToken,
  resolveLaborOfficeAddressFromDirectory,
  resolveLaborOfficeByStoredJurisdiction,
} from "../lib/labor-offices/address-resolver";

const offices: LaborOfficeMasterRow[] = [
  ["GWANGJU", "광주지방고용노동청", "광주지방고용노동청", "광주광역시, 전라남도 (나주시, 담양군, 영광군, 장성군, 함평군, 화순군, 구례군, 곡성군)"],
  ["GWANGJU_JEJU", "광주지방고용노동청 제주산재예방감독팀", "광주지방고용노동청", "제주특별자치도 제주시, 서귀포시"],
  ["CHEONAN", "대전지방고용노동청 천안지청", "천안지청", "천안시, 아산시, 당진시, 예산군"],
  ["BORYEONG", "대전지방고용노동청 보령지청", "보령지청", "보령시, 홍성군, 부여군, 서천군, 청양군"],
  ["DAEGU_SEOBU", "대구지방고용노동청 대구서부지청", "대구서부지청", "대구 달서구, 서구, 남구, 달성군, 경북 칠곡군(석적읍 중리 내 구미국가산업단지 제외), 성주군, 고령군"],
  ["GUMI", "대구지방고용노동청 구미지청", "구미지청", "구미시, 김천시, 칠곡군 석적읍 중리 구미국가산업단지"],
  ["PYEONGTAEK", "경기지방고용노동청 평택지청", "평택지청", "평택시, 오산시, 안성시"],
  ["ULSAN", "부산지방고용노동청 울산지청", "울산지청", "울산광역시 남구, 울주군"],
  ["ULSAN_DONGBU", "부산지방고용노동청 울산동부지청", "울산동부지청", "울산광역시 동구, 중구, 북구"],
  ["SEOSAN", "대전지방고용노동청 서산지청", "서산지청", "서산시, 태안군"],
  ["DAEJEON", "대전지방고용노동청", "대전지방고용노동청", "대전광역시, 세종시, 충청남도 금산군, 공주시, 논산시, 계룡시"],
  ["GYEONGGI", "경기지방고용노동청", "경기지방고용노동청", "수원시, 용인시, 화성시"],
  ["SEONGNAM", "경기지방고용노동청 성남지청", "성남지청", "성남시, 하남시, 경기 광주시, 이천시, 여주시, 양평군"],
  ["BUSAN", "부산지방고용노동청", "부산지방고용노동청", "부산시 부산진구, 연제구, 중구, 서구, 영도구, 사하구, 동구, 남구"],
  ["BUSAN_BUKBU", "부산지방고용노동청 부산북부지청", "부산북부지청", "부산시 강서구, 사상구, 북구"],
  ["BUSAN_DONGBU", "부산지방고용노동청 부산동부지청", "부산동부지청", "부산시 동래구, 금정구, 해운대구, 수영구, 기장군"],
  ["GANGNEUNG", "중부지방고용노동청 강릉지청", "강릉지청", "강릉시, 동해시, 속초시, 양양군, 고성군"],
  ["TONGYEONG", "부산지방고용노동청 통영지청", "통영지청", "통영시, 거제시, 고성군"],
  ["GANGWON", "중부지방고용노동청 강원지청", "강원지청", "강원도 춘천시, 화천군, 양구군, 홍천군, 인제군, 경기도 가평군"],
  ["YANGSAN", "부산지방고용노동청 양산지청", "양산지청", "경상남도 양산시, 밀양시, 김해시"],
  ["MOKPO", "광주지방고용노동청 목포지청", "목포지청", "목포시, 강진, 장흥, 신안, 해남, 완도, 영암, 무안군"],
  ["UIJEONGBU", "경기지방고용노동청 의정부지청", "의정부지청", "의정부, 구리, 남양주, 동두천, 양주, 포천, 연천, 철원"],
].map(([office_code, current_official_name, current_short_name, jurisdiction_reference]) => ({
  office_code,
  current_official_name,
  current_short_name,
  jurisdiction_reference,
  is_active: true,
}));

const persistenceByCode: Record<string, string> = {
  GWANGJU: "광주지방고용노동청",
  GWANGJU_JEJU: "광주지방고용노동청 제주지청",
  CHEONAN: "대전지방고용노동청 천안지청",
  BORYEONG: "대전지방고용노동청 보령지청",
  DAEGU_SEOBU: "대구지방고용노동청 서부지청",
  GUMI: "대구지방고용노동청 구미지청",
  PYEONGTAEK: "중부지방고용노동청 평택지청",
  ULSAN: "부산지방고용노동청 울산지청",
  ULSAN_DONGBU: "부산지방고용노동청 울산동부지청",
  SEOSAN: "대전지방고용노동청 서산지청",
  DAEJEON: "대전지방고용노동청",
  GYEONGGI: "중부지방고용노동청 경기지청",
  SEONGNAM: "중부지방고용노동청 성남지청",
  BUSAN: "부산지방고용노동청",
  BUSAN_BUKBU: "부산지방고용노동청 부산북부지청",
  BUSAN_DONGBU: "부산지방고용노동청 부산동부지청",
  GANGNEUNG: "중부지방고용노동청 강릉지청",
  TONGYEONG: "부산지방고용노동청 통영지청",
  GANGWON: "중부지방고용노동청 강원지청",
  YANGSAN: "부산지방고용노동청 양산지청",
  MOKPO: "광주지방고용노동청 목포지청",
  UIJEONGBU: "중부지방고용노동청 의정부지청",
};

const aliases: LaborOfficeAliasRow[] = Object.entries(persistenceByCode).map(
  ([office_code, business_office_name]) => ({
    office_code,
    business_office_name,
    document_office_name: business_office_name,
    mapping_note: "현재 관서 마스터에 직접 연결",
    is_active: true,
  })
);
const directory: LaborOfficeDirectory = { offices, aliases };

test("labor_offices 관할정보로 대표 주소를 office_code와 UI 약칭까지 판정한다", () => {
  const cases = [
    ["제주특별자치도 제주시", "GWANGJU_JEJU", "광주"],
    ["제주특별자치도 서귀포시", "GWANGJU_JEJU", "광주"],
    ["광주광역시", "GWANGJU", "광주"],
    ["충남 천안시", "CHEONAN", "천안"],
    ["충남 보령시", "BORYEONG", "보령"],
    ["대구 달서구", "DAEGU_SEOBU", "대구서부"],
    ["경기 평택시", "PYEONGTAEK", "평택"],
    ["울산 동구", "ULSAN_DONGBU", "울산동부"],
    ["울산 남구", "ULSAN", "울산"],
    ["경북 칠곡군 일반 지역", "DAEGU_SEOBU", "대구서부"],
    ["경북 칠곡군 석적읍 중리 구미국가산업단지", "GUMI", "구미"],
    ["충남 서산시", "SEOSAN", "서산"],
  ] as const;

  for (const [address, officeCode, display] of cases) {
    const result = resolveLaborOfficeAddressFromDirectory(address, directory);
    assert.equal(result.status, "matched", address);
    assert.equal(result.officeCode, officeCode, address);
    assert.equal(result.officeJurisdictionDisplay, display, address);
    assert.equal(result.officeJurisdictionPersistence, persistenceByCode[officeCode], address);
  }
});

test("광주광역시와 제주는 UI 약칭이 같아도 canonical office_code와 저장 alias가 다르다", () => {
  const gwangju = resolveLaborOfficeAddressFromDirectory("광주광역시", directory);
  const jeju = resolveLaborOfficeAddressFromDirectory("제주특별자치도 제주시", directory);

  assert.equal(gwangju.officeJurisdictionDisplay, "광주");
  assert.equal(jeju.officeJurisdictionDisplay, "광주");
  assert.notEqual(gwangju.officeCode, jeju.officeCode);
  assert.notEqual(gwangju.officeJurisdictionPersistence, jeju.officeJurisdictionPersistence);
});

test("경기도 광주시를 광주광역시로 오인하지 않는다", () => {
  const result = resolveLaborOfficeAddressFromDirectory("경기도 광주시 경안로 1", directory);
  assert.equal(result.status, "matched");
  assert.equal(result.officeCode, "SEONGNAM");
});

test("master 축약 관할명은 실제 주소의 시군 접미사와 안전하게 비교한다", () => {
  assert.equal(normalizeJurisdictionReferenceToken("강진"), "강진");
  assert.equal(normalizeJurisdictionReferenceToken("강진군"), "강진");
  assert.equal(normalizeJurisdictionReferenceToken("광주광역시"), null);

  const cases = [
    ["전라남도 강진군", "MOKPO"],
    ["전라남도 해남군", "MOKPO"],
    ["경기도 의정부시", "UIJEONGBU"],
    ["경기도 구리시", "UIJEONGBU"],
    ["경기도 남양주시", "UIJEONGBU"],
    ["강원특별자치도 철원군", "UIJEONGBU"],
    ["충청남도 금산군", "DAEJEON"],
    ["부산광역시 부산진구", "BUSAN"],
  ] as const;
  for (const [address, officeCode] of cases) {
    const result = resolveLaborOfficeAddressFromDirectory(address, directory);
    assert.equal(result.status, "matched", address);
    assert.equal(result.officeCode, officeCode, address);
  }
});

test("동일 고성군은 master 전체 광역권 context로 구분하고 시도 없이는 거부한다", () => {
  assert.equal(
    resolveLaborOfficeAddressFromDirectory("강원특별자치도 고성군", directory).officeCode,
    "GANGNEUNG"
  );
  assert.equal(
    resolveLaborOfficeAddressFromDirectory("경상남도 고성군", directory).officeCode,
    "TONGYEONG"
  );
  assert.equal(resolveLaborOfficeAddressFromDirectory("고성군", directory).status, "ambiguous");
  assert.equal(
    resolveLaborOfficeAddressFromDirectory("대전광역시 유성구", directory).officeCode,
    "DAEJEON"
  );
});

test("미판정과 동률 후보는 임의 관서나 천안 지정지청을 만들지 않는다", () => {
  const unmatched = resolveLaborOfficeAddressFromDirectory("판정할 수 없는 주소", directory);
  assert.equal(unmatched.status, "unmatched");
  assert.equal(unmatched.officeJurisdictionPersistence, null);
  assert.equal(unmatched.designatedOffice, null);

  const ambiguousDirectory: LaborOfficeDirectory = {
    offices: [
      ...offices,
      {
        office_code: "OTHER_CHEONAN",
        current_official_name: "다른 천안 관서",
        current_short_name: "다른천안지청",
        jurisdiction_reference: "천안시",
      },
    ],
    aliases: [
      ...aliases,
      {
        office_code: "OTHER_CHEONAN",
        business_office_name: "다른 천안 관서",
        document_office_name: "다른 천안 관서",
      },
    ],
  };
  const ambiguous = resolveLaborOfficeAddressFromDirectory("충남 천안시", ambiguousDirectory);
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(ambiguous.officeCode, null);
  assert.equal(ambiguous.designatedOffice, null);
});

test("현재 master 직접 alias만 persistence로 선택하고 활성 다중 alias 추측을 거부한다", () => {
  const boryeongDirectory: LaborOfficeDirectory = {
    offices,
    aliases: [
      ...aliases,
      {
        office_code: "BORYEONG",
        business_office_name: "대전지방고용노동청 보령(천)지청",
        document_office_name: "대전지방고용노동청 보령(천)지청",
        mapping_note: "보령지청의 기존 별칭으로 처리",
      },
    ],
  };
  assert.equal(
    resolveLaborOfficeAddressFromDirectory("충남 보령시", boryeongDirectory)
      .officeJurisdictionPersistence,
    "대전지방고용노동청 보령지청"
  );

  const ambiguousAliases = boryeongDirectory.aliases.map((alias, index) =>
    alias.office_code === "BORYEONG"
      ? {
          ...alias,
          business_office_name: `보령 과거 별칭 ${index}`,
          mapping_note: "",
        }
      : alias
  );
  const ambiguous = resolveLaborOfficeAddressFromDirectory("충남 보령시", {
    offices,
    aliases: ambiguousAliases,
  });
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(ambiguous.officeJurisdictionPersistence, null);
});

test("저장 alias로 재조회해도 제주 identity와 UI 광주 표시를 복원한다", () => {
  const result = resolveLaborOfficeByStoredJurisdiction(
    "광주지방고용노동청 제주지청",
    directory
  );
  assert.equal(result.status, "matched");
  assert.equal(result.officeCode, "GWANGJU_JEJU");
  assert.equal(result.officeJurisdictionDisplay, "광주");
});
