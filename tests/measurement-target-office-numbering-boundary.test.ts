import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { getDocumentNumberPrefix } from "../lib/constants/designated-offices";
import {
  classifyKnownDesignatedOffice,
  classifyDesignatedOffice,
} from "../lib/utils/jurisdiction-matcher";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("labor_offices 소재지 표시값은 기존 4분류 지정지청 규칙을 그대로 사용한다", () => {
  const cases = [
    { jurisdiction: "보령", designated: "천안" },
    { jurisdiction: "대전", designated: "대전" },
    { jurisdiction: "평택", designated: "평택" },
    { jurisdiction: "경기", designated: "경기" },
  ];

  for (const expected of cases) {
    assert.equal(classifyDesignatedOffice(expected.jurisdiction), expected.designated);
  }
});

test("target 표시 경계에서 소재지지청 미판정은 지정지청 천안으로 파생하지 않는다", () => {
  assert.equal(classifyKnownDesignatedOffice(null), null);
  assert.equal(classifyKnownDesignatedOffice("  "), null);
  assert.equal(classifyKnownDesignatedOffice("보령"), "천안");
  assert.equal(classifyDesignatedOffice(null), "천안");
});

test("지정지청 4개 연번 prefix는 기존 값과 동일하다", () => {
  assert.deepEqual(
    Object.fromEntries(
      ["천안", "대전", "평택", "경기"].map((office) => [
        office,
        getDocumentNumberPrefix(office),
      ])
    ),
    { 천안: "천", 대전: "대", 평택: "평", 경기: "경" }
  );
});

test("측정일지 등록은 designated_office를 번호 생성에 사용하고 소재지지청은 별도 저장한다", () => {
  const journalRoute = read("app/api/journal/route.ts");
  const numberAssignment = read("lib/utils/number-assignment.ts");

  assert.match(
    journalRoute,
    /assignAllNumbers\(\{[\s\S]{0,180}designated_office: designatedOffice/
  );
  assert.match(journalRoute, /office_jurisdiction: office_jurisdiction \|\| businessData\.office_jurisdiction/);
  assert.match(numberAssignment, /const normalizedOffice = toShortName\(String\(journalData\.designated_office\)\.trim\(\)\)/);
});

test("사업장 주소·소재지지청 저장은 기존 일지 번호를 재계산하지 않는다", () => {
  const businessRoute = read("app/api/businesses/route.ts");
  const journalUpdateRoute = read("app/api/journal/[id]/route.ts");

  assert.doesNotMatch(businessRoute, /assignAllNumbers|assignDocumentNumber|assignSequenceNumber/);
  assert.match(
    journalUpdateRoute,
    /const designatedOfficeRaw = body\.designated_office;[\s\S]{0,220}existingJournal\.designated_office/
  );
  assert.match(
    journalUpdateRoute,
    /const normalizedOfficeJurisdiction = body\.office_jurisdiction[\s\S]{0,180}existingJournal\.office_jurisdiction/
  );
});

test("기존 번호 변경 요청·승인 flow는 독립 API로 유지된다", () => {
  const requestRoute = read("app/api/journal/[id]/number-change-request/route.ts");
  const approvalRoute = read("app/api/journal/number-change-request/[id]/approve/route.ts");

  assert.match(requestRoute, /journal_number_change_request/);
  assert.match(requestRoute, /status: "대기"/);
  assert.match(approvalRoute, /action !== "approve" && action !== "reject"/);
  assert.match(approvalRoute, /status: "승인"/);
});
