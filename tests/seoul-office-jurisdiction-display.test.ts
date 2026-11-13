import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  buildOfficeJurisdictionDisplayLookup,
  toOfficeJurisdictionDisplayName,
  toOfficeDisplayRows,
} from "../lib/labor-offices/office-display";
import { filterResultSearchRows } from "../lib/custom-query/result-search";
import { sortResultRows } from "../lib/custom-query/result-sort";
import type { LaborOfficeDirectory } from "../lib/labor-offices/address-resolver";

const branches = [
  ["GANGNAM", "강남"],
  ["DONGBU", "동부"],
  ["SEOBU", "서부"],
  ["NAMBU", "남부"],
  ["BUKBU", "북부"],
  ["GWANAK", "관악"],
] as const;

/** 운영 labor_offices/labor_office_aliases의 서울 기관·별칭 구조를 재현한 최소 샘플. */
function sampleMaster(): LaborOfficeDirectory {
  return {
    offices: [
      {
        office_code: "SEOUL",
        current_official_name: "서울지방고용노동청",
        current_short_name: "서울지방고용노동청",
        jurisdiction_reference: "서울특별시 중구, 종로구, 동대문구, 서초구",
        is_active: true,
      },
      ...branches.map(([code, branch]) => ({
        office_code: "SEOUL_" + code,
        current_official_name: `서울지방고용노동청 서울${branch}지청`,
        current_short_name: `서울${branch}지청`,
        jurisdiction_reference: "서울특별시",
        is_active: true,
      })),
      {
        office_code: "SEOSAN",
        current_official_name: "대전지방고용노동청 서산지청",
        current_short_name: "서산지청",
        jurisdiction_reference: "충청남도 서산시",
        is_active: true,
      },
    ],
    aliases: [
      {
        office_code: "SEOUL",
        business_office_name: "서울지방고용노동청 서초지청",
        document_office_name: "서울지방고용노동청 서초지청",
        is_active: true,
      },
      {
        office_code: "SEOUL_DONGBU",
        business_office_name: "서울지방고용노동청 성동지청",
        document_office_name: "서울지방고용노동청 성동지청",
        is_active: true,
      },
      ...branches.map(([code, branch]) => ({
        office_code: "SEOUL_" + code,
        business_office_name: `서울지방고용노동청 ${branch}지청`,
        document_office_name: `서울지방고용노동청 ${branch}지청`,
        is_active: true,
      })),
    ],
  };
}

test("서울 7개 표준 표시명은 운영 마스터의 관서코드·현행 약칭과 별칭을 사용한다", () => {
  const lookup = buildOfficeJurisdictionDisplayLookup(sampleMaster());
  assert.equal(toOfficeJurisdictionDisplayName("서울", lookup), "서울청");
  assert.equal(toOfficeJurisdictionDisplayName("서울지방고용노동청", lookup), "서울청");
  assert.equal(toOfficeJurisdictionDisplayName("서울지방고용노동청 서초지청", lookup), "서울청");
  for (const [, branch] of branches) {
    for (const stored of [
      `서울지방고용노동청 ${branch}지청`,
      `서울지방고용노동청 서울${branch}지청`,
      `서울${branch}지청`,
      `서울${branch}`,
    ]) {
      assert.equal(toOfficeJurisdictionDisplayName(stored, lookup), `서울${branch}`, stored);
    }
  }
  assert.equal(toOfficeJurisdictionDisplayName("서울지방고용노동청 성동지청", lookup), "서울동부");
});

test("실제 보고된 H0546·H0549 전체 명칭은 별칭/마스터를 통해 표준화한다", () => {
  const lookup = buildOfficeJurisdictionDisplayLookup(sampleMaster());
  assert.equal(toOfficeJurisdictionDisplayName("서울지방고용노동청 강남지청", lookup), "서울강남");
  assert.equal(toOfficeJurisdictionDisplayName("대전지방고용노동청 서산지청", lookup), "서산");
  assert.equal(toOfficeJurisdictionDisplayName("서울서부", lookup), "서울서부");
});

test("명칭이 모호하면 임의로 서울 관서에 매핑하지 않는다", () => {
  const directory = sampleMaster();
  directory.aliases.push(
    { office_code: "SEOUL_DONGBU", business_office_name: "동부지청", document_office_name: "동부지청" },
    { office_code: "SEOSAN", business_office_name: "동부지청", document_office_name: "동부지청" },
  );
  const lookup = buildOfficeJurisdictionDisplayLookup(directory);
  assert.equal(toOfficeJurisdictionDisplayName("동부지청", lookup), "동부지청");
  assert.equal(toOfficeJurisdictionDisplayName("강남", lookup), "강남");
  assert.equal(toOfficeJurisdictionDisplayName("서울지방고용노동청 알수없음출장소", lookup), "서울지방고용노동청 알수없음출장소");
  assert.equal(toOfficeJurisdictionDisplayName("천안", lookup), "천안");
  assert.equal(toOfficeJurisdictionDisplayName("", lookup), null);
  assert.equal(toOfficeJurisdictionDisplayName(null, lookup), null);
});

test("요약 API는 별도 Supabase 기준정보를 조회하고 원본 관할지청을 보존한다", () => {
  const source = readFileSync(path.join(process.cwd(), "app/api/summary/route.ts"), "utf8");
  assert.match(source, /loadLaborOfficeDirectory\(supabase\)/);
  assert.match(source, /\.then\(buildOfficeJurisdictionDisplayLookup\)/);
  assert.match(source, /office_jurisdiction: journal\.office_jurisdiction,/);
  assert.match(source, /office_jurisdiction_display: toOfficeJurisdictionDisplayName\(journal\.office_jurisdiction, officeDisplayLookup\)/);
  assert.match(source, /designated_office: journal\.designated_office \? toShortName\(journal\.designated_office\)/);
});

test("내맘대로 검색·정렬·XLSX에 같은 표준명 사용, 원본 데이터는 변하지 않는다", () => {
  const lookup = buildOfficeJurisdictionDisplayLookup(sampleMaster());
  const sources = [
    { id: 1, code: "H0549", office_jurisdiction: "대전지방고용노동청 서산지청" },
    { id: 2, code: "H0546", office_jurisdiction: "서울지방고용노동청 강남지청" },
    { id: 3, code: "H1000", office_jurisdiction: "서울서부" },
    { id: 4, code: "H1001", office_jurisdiction: "서울" },
  ];
  const apiRows = sources.map((r) => ({
    ...r,
    office_jurisdiction_display: toOfficeJurisdictionDisplayName(r.office_jurisdiction, lookup),
  }));
  const rows = toOfficeDisplayRows(apiRows);
  assert.deepEqual(rows.map((r) => r.office_jurisdiction), ["서산", "서울강남", "서울서부", "서울청"]);
  assert.deepEqual(rows.map((r) => r.office_jurisdiction_original), sources.map((r) => r.office_jurisdiction));
  assert.equal(sources[1].office_jurisdiction, "서울지방고용노동청 강남지청");
  assert.deepEqual(
    filterResultSearchRows(rows, "서울강남", ["office_jurisdiction"]).map((r) => r.code),
    ["H0546"],
  );
  const sorted = sortResultRows(rows, [{ field: "office_jurisdiction", direction: "asc" }]);
  assert.deepEqual(sorted.map((r) => r.office_jurisdiction), ["서산", "서울강남", "서울서부", "서울청"]);
  const source = readFileSync(path.join(process.cwd(), "components/features/CustomQueryExport.tsx"), "utf8");
  assert.match(source, /toOfficeDisplayRows\(\(resJson\.data \|\| \[\]\) as any\[\]\)/);
  assert.match(source, /const displayedResults = useMemo\(\(\) => sortResultRows\(/);
  assert.match(source, /const excelData = displayedResults\.map\(\(item\) =>/);
});

test("기존 개인 템플릿의 원본 관할지청 '일치' 조건도 보존한다", () => {
  const source = readFileSync(path.join(process.cwd(), "components/features/CustomQueryExport.tsx"), "utf8");
  assert.match(source, /item\.office_jurisdiction_original/);
  assert.match(source, /strItemVal === value \|\| originalItemVal === value/);
  assert.match(source, /strItemVal !== value && originalItemVal !== value/);
  const raw=[{id:10,office_jurisdiction:"서울",office_jurisdiction_display:"서울청"}];
  const rows=toOfficeDisplayRows(raw);
  assert.equal(rows[0].office_jurisdiction,"서울청");
  assert.equal(rows[0].office_jurisdiction_original,"서울");
});
