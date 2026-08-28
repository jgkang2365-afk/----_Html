import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("journal search는 persistence와 current labor office 표시값을 분리한다", () => {
  const source = read("app/api/journal/search/route.ts");

  assert.match(
    source,
    /normalizedAddress\s*\? resolveLaborOfficeAddressFromDirectory\(normalizedAddress, directory\)/
  );
  assert.match(source, /journal\.office_code = journalOffice\.officeCode/);
  assert.match(
    source,
    /journal\.office_jurisdiction_display = journalOffice\.officeJurisdictionDisplay/
  );
  assert.match(source, /office_jurisdiction: business\.office_jurisdiction \|\| null/);
  assert.match(source, /office_jurisdiction_display: businessOffice\.officeJurisdictionDisplay/);
});

test("JournalEditForm은 current display를 persistence alias보다 우선한다", () => {
  const source = read("components/features/JournalEditForm.tsx");

  assert.match(
    source,
    /return display \?\? toShortName\(persistence \|\| ""\)/
  );
  assert.match(
    source,
    /getOfficeJurisdictionDisplay\(entry\.office_jurisdiction_display, entry\.office_jurisdiction\)/
  );
});

test("운영 target schema에 없는 designated_office를 generate-plan payload에 쓰지 않는다", () => {
  const source = read("app/api/businesses/generate-plan/route.ts");

  assert.match(source, /office_jurisdiction: officeJurisdiction/);
  assert.doesNotMatch(source, /designated_office\s*:/);
});
