import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("jurisdiction preview는 인증된 GET 조회만 수행하고 DB write 경로가 없다", () => {
  const route = read("app/api/businesses/jurisdiction-preview/route.ts");

  assert.match(route, /export async function GET/);
  assert.match(route, /checkPermission\("journal:read"\)/);
  assert.match(route, /resolveLaborOfficeByAddress\(supabase, address\)/);
  assert.match(route, /office_code: result\.officeCode/);
  assert.match(route, /office_jurisdiction: result\.officeJurisdictionDisplay/);
  assert.doesNotMatch(route, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  assert.doesNotMatch(route, /Calendar|preliminary_survey|ensureBusinessCoordinate/);
});

test("공통 Form preview는 400ms debounce와 최신 요청 경계를 사용한다", () => {
  const form = read("components/features/MeasurementTargetBusinessFormSections.tsx");

  assert.match(form, /window\.setTimeout\(async \(\) => \{/);
  assert.match(form, /\}, 400\)/);
  assert.match(form, /new AbortController\(\)/);
  assert.match(form, /requestSequence !== previewRequestSequence\.current/);
  assert.match(form, /controller\.abort\(\)/);
  assert.match(form, /cache: "no-store"/);
  assert.match(form, /result\.status === "matched"/);
  assert.match(form, /"ambiguous" \? "ambiguous" : "unmatched"/);
});

test("Preview와 target POST/PATCH 및 journal auto-fill은 같은 labor_offices resolver를 사용한다", () => {
  const preview = read("app/api/businesses/jurisdiction-preview/route.ts");
  const businesses = read("app/api/businesses/route.ts");
  const journalAutoFill = read("app/api/journal/auto-fill/route.ts");

  assert.match(preview, /resolveLaborOfficeByAddress\(supabase, address\)/);
  assert.match(
    businesses,
    /addressOfficeResolution = await resolveLaborOfficeByAddress\(supabase, updates\.address\)/
  );
  assert.match(
    businesses,
    /const addressOfficeResolution = await resolveLaborOfficeByAddress\(supabase, address\)/
  );
  assert.match(journalAutoFill, /resolveLaborOfficeByAddress\(supabase, address\)/);
});

test("target 목록 GET도 저장 alias가 아니라 현재 주소를 labor_offices resolver로 우선 판정한다", () => {
  const source = read("app/api/businesses/route.ts");

  assert.match(
    source,
    /item\.address\s*\?\s*resolveLaborOfficeAddressFromDirectory\(item\.address,\s*laborOfficeDirectory\)/
  );
  assert.match(
    source,
    /!item\.address\s*\?\s*toShortName\(item\.office_jurisdiction\s*\|\|\s*""\)\s*:\s*""/
  );
});

test("target PATCH 응답도 주소가 있으면 저장 alias 대신 현재 주소를 다시 판정한다", () => {
  const source = read("app/api/businesses/route.ts");

  assert.match(
    source,
    /addressOfficeResolution\s*\|\|\s*\(responseAddress\s*\?\s*await resolveLaborOfficeByAddress\(supabase, responseAddress\)/
  );
  assert.match(
    source,
    /!responseAddress \? toShortName\(updatedData\.office_jurisdiction \|\| ""\) : ""/
  );
  assert.match(
    source,
    /!responseAddress\s*\? classifyKnownDesignatedOffice\(updatedData\.office_jurisdiction\)\s*:\s*null/
  );
});

test("계획 생성은 주소가 있으면 labor_offices persistence를 새 target에 저장한다", () => {
  const source = read("app/api/businesses/generate-plan/route.ts");

  assert.match(
    source,
    /addressBased\.status === "matched"[\s\S]{0,140}officeJurisdiction = addressBased\.officeJurisdictionPersistence/
  );
  assert.match(source, /office_jurisdiction: officeJurisdiction/);
  assert.match(source, /if \(!address && previousOfficeJurisdiction\)/);
  assert.doesNotMatch(
    source,
    /office_jurisdiction:\s*previousOfficeJurisdiction/
  );
});

test("측정일지 주소 자동판정은 pending·실패 시 과거 지청을 저장하지 않는다", () => {
  const source = read("components/features/JournalEditForm.tsx");

  assert.match(source, /setAutoFilling\(true\)[\s\S]{0,260}office_jurisdiction: ""[\s\S]{0,80}designated_office: ""/);
  assert.match(source, /if \(!response\.ok\) throw new Error/);
  assert.match(source, /setOfficeJurisdictionDisplay\("판정 실패"\)/);
  assert.match(source, /if \(autoFilling\)[\s\S]{0,160}판정이 끝난 뒤 다시 저장/);
  assert.match(source, /formData\.address\?\.trim\(\) && !formData\.designated_office/);
  assert.match(source, /newAddress\.trim\(\)\.length < 3\)[\s\S]{0,80}setAutoFilling\(false\)/);
});

test("현행 주소 판정 callsite는 CSV matcher를 호출하지 않는다", () => {
  const runtimeFiles = [
    "app/api/businesses/route.ts",
    "app/api/businesses/generate-plan/route.ts",
    "app/api/businesses/recalculate-jurisdiction/route.ts",
    "app/api/journal/auto-fill/route.ts",
    "app/api/journal/search/route.ts",
  ];

  for (const path of runtimeFiles) {
    const source = read(path);
    assert.doesNotMatch(source, /findOfficeByAddress|getDesignatedOfficeByAddress/, path);
    assert.doesNotMatch(source, /노동지청별 관할지역\.csv/, path);
  }
});

test("미판정 주소 저장 경계는 persistence와 지정지청을 null로 유지한다", () => {
  const businesses = read("app/api/businesses/route.ts");
  const journalSearch = read("app/api/journal/search/route.ts");

  assert.match(
    businesses,
    /addressOfficeResolution\.status === "matched"[\s\S]{0,120}officeJurisdictionPersistence[\s\S]{0,30}: null/
  );
  assert.doesNotMatch(journalSearch, /finalDesignatedOffice \|\| "천안"/);
  assert.doesNotMatch(journalSearch, /let autoDesignatedOffice = "천안"/);
});
