import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import JSZip from "jszip";
import {
  analyzeHwpxPlaceholders,
  HwpxAnalysisError,
} from "../lib/document-generation/hwpx-placeholder-analysis";
import {
  getHwpxMappingStatus,
  reviewHwpxRegistration,
  sanitizeHwpxDefaultValue,
  sanitizeHwpxMappingDefaultValue,
} from "../lib/document-generation/hwpx-analysis-presentation";
import { parseDocumentFieldMappings } from "../lib/document-generation/definitions";

const HP = "http://www.hancom.co.kr/hwpml/2011/paragraph";
const HS = "http://www.hancom.co.kr/hwpml/2011/section";

function field(id: number, name: string, displayName: string, value = "") {
  return `<hp:ctrl><hp:fieldBegin id="${id}" type="CLICK_HERE" name="${name}" editable="1" dirty="0" zorder="-1" fieldid="${id}"><hp:parameters cnt="1" name=""><hp:stringParam name="Command">Clickhere:Direction:wstring:${displayName.length}:${displayName}</hp:stringParam></hp:parameters></hp:fieldBegin></hp:ctrl><hp:run><hp:t>${value}</hp:t></hp:run><hp:ctrl><hp:fieldEnd beginIDRef="${id}" fieldid="${id}"/></hp:ctrl>`;
}

function section(body: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="${HS}" xmlns:hp="${HP}"><hp:p id="1">${body}</hp:p></hs:sec>`;
}

async function hwpx(sections: string[]) {
  const zip = new JSZip();
  zip.file("mimetype", "application/hwp+zip", { compression: "STORE" });
  zip.file("Contents/content.hpf", '<?xml version="1.0"?><package/>');
  zip.file("Contents/header.xml", '<?xml version="1.0"?><header/>');
  sections.forEach((xml, index) => zip.file(`Contents/section${index}.xml`, xml));
  return zip.generateAsync({ type: "nodebuffer" });
}

test("HWPX 표시문구는 진단에만 유지하고 업무 기본값으로 반환하지 않는다", async () => {
  const result = await analyzeHwpxPlaceholders(
    await hwpx([
      section(field(1, "business_name", "사업장명", "기본 사업장")),
      section(field(2, "manager_email", "담당자 메일", "mail@example.com")),
    ])
  );

  assert.equal(result.summary.discovered, 2);
  assert.equal(result.summary.unique, 2);
  assert.deepEqual(result.placeholders[0], {
    placeholder_name: "business_name",
    display_name: "사업장명",
    mapped_db_field: "business_name",
    required: false,
    default_value: "",
    match_type: "exact",
    occurrence_count: 1,
    sections: [0],
    occurrences: [
      {
        section: 0,
        section_path: "Contents/section0.xml",
        position: "Contents/section0.xml#1",
        default_value: "기본 사업장",
        nested: false,
        conflict: false,
      },
    ],
    warnings: [],
  });
  assert.equal(result.placeholders[1].sections[0], 1);
});

test("누름틀 name이 DB 필드와 같으면 exact로 자동 매핑한다", async () => {
  const result = await analyzeHwpxPlaceholders(
    await hwpx([section(field(1, "measurement_period", "측정주기"))])
  );
  assert.equal(result.placeholders[0].mapped_db_field, "measurement_period");
  assert.equal(result.placeholders[0].match_type, "exact");
});

test("한글 누름틀 이름은 별도 alias 정책으로 자동 매핑한다", async () => {
  const result = await analyzeHwpxPlaceholders(
    await hwpx([section(field(1, "사업자등록번호", "사업자등록번호"))])
  );
  assert.equal(result.placeholders[0].mapped_db_field, "business_number");
  assert.equal(result.placeholders[0].match_type, "alias");
});

test("매칭되지 않은 누름틀은 자동 저장 대상에서 제외된 채 유지한다", async () => {
  const result = await analyzeHwpxPlaceholders(
    await hwpx([section(field(1, "custom_unknown", "별도 확인"))])
  );
  assert.equal(result.summary.unmatched, 1);
  assert.equal(result.placeholders[0].mapped_db_field, null);
  assert.equal(result.placeholders[0].match_type, null);
});

test("동일 DB 필드를 서로 다른 누름틀에 다중 매핑할 수 있다", () => {
  const mappings = parseDocumentFieldMappings(
    [
      {
        source_field: "measurement_year",
        target_type: "HWPX_FIELD",
        target_address: "measurement_year_top",
      },
      {
        source_field: "measurement_year",
        target_type: "HWPX_FIELD",
        target_address: "measurement_year_table",
      },
    ],
    "HWPX"
  );
  assert.equal(mappings.length, 2);
  assert.equal(mappings[0].source_field, mappings[1].source_field);
});

test("동일 누름틀 name의 출현 횟수를 집계하고 중복 경고를 표시한다", async () => {
  const result = await analyzeHwpxPlaceholders(
    await hwpx([
      section(`${field(1, "business_name", "사업장명")}${field(2, "business_name", "사업장명")}`),
    ])
  );
  assert.equal(result.summary.discovered, 2);
  assert.equal(result.summary.unique, 1);
  assert.equal(result.summary.duplicate_names, 1);
  assert.equal(result.placeholders[0].occurrence_count, 2);
  assert.match(result.placeholders[0].warnings[0], /2회/);
});

test("중첩 누름틀을 감지하되 분석 결과에서 삭제하지 않는다", async () => {
  const nested = `<hp:ctrl><hp:fieldBegin id="1" type="CLICK_HERE" name="outer"/></hp:ctrl><hp:ctrl><hp:fieldBegin id="2" type="CLICK_HERE" name="inner"/></hp:ctrl><hp:ctrl><hp:fieldEnd beginIDRef="2"/></hp:ctrl><hp:ctrl><hp:fieldEnd beginIDRef="1"/></hp:ctrl>`;
  const result = await analyzeHwpxPlaceholders(await hwpx([section(nested)]));
  assert.equal(result.placeholders.length, 2);
  assert.ok(
    result.placeholders.every(({ warnings }) => warnings.some((warning) => /중첩/.test(warning)))
  );
});

test("누름틀 매핑 상태는 warning과 치명적 구조 오류를 구분한다", () => {
  assert.equal(
    getHwpxMappingStatus({
      source_field: "measurement_year",
      target_address: "measurement_year",
      warnings: [],
    }),
    "normal"
  );
  assert.equal(
    getHwpxMappingStatus({
      source_field: "measurement_year",
      target_address: "measurement_year",
      warnings: ["동일 누름틀 이름이 2회 등장합니다."],
    }),
    "review"
  );
  assert.equal(
    getHwpxMappingStatus({ source_field: "", target_address: "measurement_year", warnings: [] }),
    "unmapped"
  );
  assert.equal(
    getHwpxMappingStatus({
      source_field: "measurement_year",
      target_address: "measurement_year",
      warnings: ["누름틀 시작·종료 위치가 충돌하거나 짝이 맞지 않습니다."],
    }),
    "error"
  );
});

test("등록 판정은 비차단 경고를 확인 필요로 두고 치명적 오류와 미매핑을 차단한다", () => {
  const review = reviewHwpxRegistration([
    {
      source_field: "measurement_year",
      target_address: "measurement_year",
      warnings: [
        "동일 누름틀 이름이 2회 등장합니다.",
        "누름틀이 중첩되어 있습니다.",
        "동일 이름 누름틀의 기본값이 서로 다릅니다.",
      ],
    },
  ]);
  assert.equal(review.status, "review");
  assert.equal(review.confirmation_count, 1);
  assert.equal(review.can_register, true);

  const blocked = reviewHwpxRegistration([
    {
      source_field: "business_name",
      target_address: "business_name",
      warnings: ["누름틀 시작·종료 위치가 충돌하거나 짝이 맞지 않습니다."],
    },
  ]);
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.can_register, false);
  assert.equal(blocked.fatal_count, 1);

  const unmapped = reviewHwpxRegistration([
    { source_field: "", target_address: "required_field", required: true, warnings: [] },
  ]);
  assert.equal(unmapped.unmapped_count, 1);
  assert.equal(unmapped.can_register, false);
});

test("HWPX 내부 제어 문자열은 업무용 기본값으로 노출하지 않는다", () => {
  assert.equal(
    sanitizeHwpxDefaultValue("Clickhere:set:Direction:wstring:4:연도 HelpState:0"),
    null
  );
  assert.equal(sanitizeHwpxDefaultValue("  사람이 읽는 기본값  "), "사람이 읽는 기본값");
  assert.equal(sanitizeHwpxDefaultValue(""), null);
  assert.equal(sanitizeHwpxMappingDefaultValue("phone", "전화번호"), null);
  assert.equal(sanitizeHwpxMappingDefaultValue("fax", "팩스"), null);
  assert.equal(sanitizeHwpxMappingDefaultValue("total_employees", "총 근로자수"), null);
  assert.equal(sanitizeHwpxMappingDefaultValue("measurement_year", "년도"), null);
  assert.equal(sanitizeHwpxMappingDefaultValue("measurement_period", "주기"), null);
  assert.equal(sanitizeHwpxMappingDefaultValue("manager_email", "담당자 메일"), null);
  assert.equal(
    sanitizeHwpxMappingDefaultValue("phone", "대표번호 없음"),
    "대표번호 없음"
  );
});

test("손상된 HWPX ZIP은 명확한 오류 코드로 실패한다", async () => {
  await assert.rejects(
    () => analyzeHwpxPlaceholders(Buffer.from("not-a-zip")),
    (error: unknown) => error instanceof HwpxAnalysisError && error.code === "CORRUPT_ZIP"
  );
});

test("본문 XML 파싱 실패와 누름틀 0개를 구분한다", async () => {
  await assert.rejects(
    async () => analyzeHwpxPlaceholders(await hwpx(["<hs:sec><hp:p></hs:sec>"])),
    (error: unknown) => error instanceof HwpxAnalysisError && error.code === "XML_PARSE_FAILED"
  );
  await assert.rejects(
    async () =>
      analyzeHwpxPlaceholders(await hwpx([section("<hp:run><hp:t>본문</hp:t></hp:run>")])),
    (error: unknown) => error instanceof HwpxAnalysisError && error.code === "NO_PLACEHOLDERS"
  );
});

test("분석 API 오류 계약과 기존 수동 매핑·템플릿 수정 경로를 유지한다", () => {
  const route = readFileSync("app/api/document-templates/analyze/route.ts", "utf8");
  const management = readFileSync("components/features/DocumentTemplateManagement.tsx", "utf8");
  assert.match(route, /INVALID_HWPX/);
  assert.match(route, /CORRUPT_ZIP|HwpxAnalysisError/);
  assert.match(route, /NO_PLACEHOLDERS/);
  assert.match(management, />\s*매핑 추가\s*</);
  assert.match(management, /method: "PATCH"/);
  assert.match(management, /changeActive\(template, !template\.is_active\)/);
});
