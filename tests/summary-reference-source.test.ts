import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const source = readFileSync(
  path.join(process.cwd(), "app", "api", "summary", "route.ts"),
  "utf8",
);
const patchSource = readFileSync(
  path.join(process.cwd(), "app", "api", "summary", "[id]", "route.ts"),
  "utf8",
);
const masterUpdateSection = patchSource
  .split("// 2. 측정사업장 마스터 업데이트")[1]
  .split("// 3. 구글 캘린더 동기화 실행")[0];

test("측정정보 요약은 일지 스냅샷보다 최신 측정사업장 참조 데이터를 우선한다", () => {
  assert.match(
    source,
    /\.from\("measurement_business"\)[\s\S]*\.select\("code, year, period, representative_name, total_employees, industrial_accident_number, phone, fax, commencement_number, manager_name, manager_position, manager_mobile, manager_phone, manager_email, invoice_email"\)/,
  );
  assert.match(source, /manager_email: mb\.manager_email \|\| null/);
  assert.match(source, /manager_email: reference\.manager_email \|\| journal\.manager_email \|\| null/);
  assert.match(source, /invoice_email: reference\.invoice_email \|\| journal\.invoice_email \|\| null/);
  assert.match(source, /레거시 스키마에서도 보장된 기존 필드로 재시도한다\.[\s\S]*\.select\("code, year, period, representative_name, commencement_number, manager_name, manager_position, manager_mobile, manager_email, invoice_email"\)/);
  assert.match(source, /address: journal\.address/);
  assert.match(source, /business_number: journal\.business_number/);
  assert.match(source, /phone: reference\.phone \|\| journal\.phone/);
  assert.match(source, /fax: reference\.fax \|\| journal\.fax/);
});

test("빈 값은 일지의 유효값을 덮지 않고, 읽기 우선 필드는 PATCH 쓰기와 대칭이다", () => {
  assert.match(source, /const reference = mb \? \{/);
  assert.match(source, /const hasValue = \(value: any\) =>/);
  assert.match(source, /total_employees: hasValue\(mb\.total_employees\) \? mb\.total_employees : null/);
  assert.match(source, /hasValue\(reference\.total_employees\)/);
  assert.match(source, /manager_mobile: reference\.manager_mobile \|\| findFirstPhoneLikeValue\(managerName, journal\.manager_mobile\)/);
  assert.match(patchSource, /\.from\("measurement_business"\)[\s\S]*manager_name: updatedJournal\.manager_name/);
  assert.match(patchSource, /manager_position: updatedJournal\.manager_position/);
  assert.match(patchSource, /manager_mobile: updatedJournal\.manager_mobile/);
  assert.match(patchSource, /manager_email: updatedJournal\.manager_email/);
  assert.match(patchSource, /invoice_email: updatedJournal\.invoice_email/);
  assert.match(patchSource, /representative_name: updatedJournal\.representative_name/);
  assert.match(patchSource, /'invoice_email_2'/);
  assert.match(patchSource, /filteredUpdateData\.invoice_email_2/);
  assert.doesNotMatch(masterUpdateSection, /invoice_email_2/);
  assert.match(patchSource, /const \{ error: masterUpdateError \} = await supabase/);
  assert.match(patchSource, /if \(masterUpdateError\) \{[\s\S]*status: 500/);
  assert.match(patchSource, /측정사업장 정보 동기화에 실패했습니다\./);
});
