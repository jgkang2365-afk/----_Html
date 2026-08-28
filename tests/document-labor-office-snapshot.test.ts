import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveLaborOfficeSnapshot } from "../lib/document-generation/snapshot";
import {
  DOCUMENT_SOURCE_FIELDS,
  parseDocumentFieldMappings,
} from "../lib/document-generation/definitions";

const offices = [
  {
    office_code: "DJ",
    current_official_name: "대전지방고용노동청",
    current_short_name: "대전",
    phone: "042-000-0000",
    fax: "042-000-0001",
  },
  {
    office_code: "GY",
    current_official_name: "중부지방고용노동청 고양지청",
    current_short_name: "고양",
    phone: "031-000-0000",
    fax: "031-000-0001",
  },
];

test("노동관서 snapshot은 정확 alias의 문서명과 master 연락처를 고정한다", () => {
  assert.deepEqual(
    resolveLaborOfficeSnapshot(
      "대전",
      [
        {
          business_office_name: "대전",
          office_code: "DJ",
          document_office_name: "대전지방고용노동청장 귀하",
        },
      ],
      offices
    ),
    {
      labor_office_name: "대전지방고용노동청장 귀하",
      labor_office_phone: "042-000-0000",
      labor_office_fax: "042-000-0001",
    }
  );
});

test("노동관서 snapshot은 전체명 alias를 기존 약칭 규칙으로 보완한다", () => {
  assert.deepEqual(
    resolveLaborOfficeSnapshot(
      "고양",
      [
        {
          business_office_name: "중부지방고용노동청 고양지청",
          office_code: "GY",
          document_office_name: "고양지청장 귀하",
        },
      ],
      offices
    ),
    {
      labor_office_name: "고양지청장 귀하",
      labor_office_phone: "031-000-0000",
      labor_office_fax: "031-000-0001",
    }
  );
});

test("모호한 alias는 다른 노동관서 연락처를 채우지 않는다", () => {
  assert.deepEqual(
    resolveLaborOfficeSnapshot(
      "대전",
      [
        { business_office_name: "대전", office_code: "DJ", document_office_name: "대전청" },
        { business_office_name: "대전", office_code: "GY", document_office_name: "고양지청" },
      ],
      offices
    ),
    { labor_office_name: "", labor_office_phone: "", labor_office_fax: "" }
  );
});

test("활성 master가 없는 오래된 alias는 모든 노동관서 값을 비운다", () => {
  assert.deepEqual(
    resolveLaborOfficeSnapshot(
      "대전",
      [
        {
          business_office_name: "대전",
          office_code: "OLD",
          document_office_name: "폐지관서장 귀하",
        },
      ],
      offices
    ),
    { labor_office_name: "", labor_office_phone: "", labor_office_fax: "" }
  );
});

test("같은 관서 코드의 문서용 명칭이 충돌하면 모든 노동관서 값을 비운다", () => {
  assert.deepEqual(
    resolveLaborOfficeSnapshot(
      "대전",
      [
        { business_office_name: "대전", office_code: "DJ", document_office_name: "A 귀하" },
        { business_office_name: "대전", office_code: "DJ", document_office_name: "B 귀하" },
      ],
      offices
    ),
    { labor_office_name: "", labor_office_phone: "", labor_office_fax: "" }
  );
});

test("활성 master의 관서 코드가 중복되면 모든 노동관서 값을 비운다", () => {
  assert.deepEqual(
    resolveLaborOfficeSnapshot(
      "대전",
      [
        {
          business_office_name: "대전",
          office_code: "DJ",
          document_office_name: "대전지방고용노동청장 귀하",
        },
      ],
      [...offices, { ...offices[0], phone: "042-999-9999" }]
    ),
    { labor_office_name: "", labor_office_phone: "", labor_office_fax: "" }
  );
});

test("광주 본청과 제주 업무단위는 같은 UI 약칭이어도 저장 alias로 연락처 identity를 보존한다", () => {
  const identityOffices = [
    {
      office_code: "GWANGJU",
      current_official_name: "광주지방고용노동청",
      current_short_name: "광주지방고용노동청",
      phone: "062-000-0000",
      fax: "062-000-0001",
    },
    {
      office_code: "GWANGJU_JEJU",
      current_official_name: "광주지방고용노동청 제주산재예방감독팀",
      current_short_name: "광주지방고용노동청",
      phone: "064-000-0000",
      fax: "064-000-0001",
    },
  ];
  const identityAliases = [
    {
      business_office_name: "광주지방고용노동청",
      office_code: "GWANGJU",
      document_office_name: "광주지방고용노동청",
    },
    {
      business_office_name: "광주지방고용노동청 제주지청",
      office_code: "GWANGJU_JEJU",
      document_office_name: "광주지방고용노동청 제주지청",
    },
  ];

  assert.equal(
    resolveLaborOfficeSnapshot("광주지방고용노동청", identityAliases, identityOffices)
      .labor_office_phone,
    "062-000-0000"
  );
  assert.equal(
    resolveLaborOfficeSnapshot(
      "광주지방고용노동청 제주지청",
      identityAliases,
      identityOffices
    ).labor_office_phone,
    "064-000-0000"
  );
});

test("노동관서 snapshot 필드는 allowlist와 HWPX 누름틀 매핑에 포함된다", () => {
  for (const field of ["labor_office_name", "labor_office_phone", "labor_office_fax"]) {
    assert.ok(DOCUMENT_SOURCE_FIELDS.some((source) => source.value === field));
  }
  assert.equal(
    parseDocumentFieldMappings(
      [
        {
          source_field: "labor_office_name",
          target_type: "HWPX_FIELD",
          target_address: "labor_office_name",
        },
      ],
      "HWPX"
    )[0].source_field,
    "labor_office_name"
  );
  const migration = readFileSync(
    "supabase/migrations/20260727_add_labor_office_snapshot_source_fields.sql",
    "utf8"
  );
  assert.match(migration, /document_field_mappings_source_field_check/);
  assert.match(migration, /labor_office_name/);
  assert.match(migration, /labor_office_phone/);
  assert.match(migration, /labor_office_fax/);
  assert.match(migration, /작업환경측정기관 선정 신고서/);
  assert.match(migration, /INSERT INTO public\.document_field_mappings/);
});
