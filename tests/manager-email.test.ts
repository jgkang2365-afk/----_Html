import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  isValidOptionalManagerEmail,
  normalizeOptionalManagerEmail,
} from "../lib/business/manager-email";
import {
  hasNationalSupportApplicationInformation,
  hasNationalSupportLookupInformation,
} from "../lib/national-support/eligibility";

const root = process.cwd();
const routeSource = readFileSync(path.join(root, "app", "api", "businesses", "route.ts"), "utf8");
const componentSource = readFileSync(
  path.join(root, "components", "features", "MeasurementTargetBusinessManagement.tsx"),
  "utf8",
);
const registrationContextSource = readFileSync(
  path.join(root, "app", "api", "business-info", "registration-context", "route.ts"),
  "utf8",
);

test("담당자 메일은 선택값이며 공백 제거와 NULL 변환 기준을 공유한다", () => {
  assert.equal(normalizeOptionalManagerEmail("  Staff.Name@Example.COM  "), "Staff.Name@Example.COM");
  assert.equal(normalizeOptionalManagerEmail("   "), null);
  assert.equal(normalizeOptionalManagerEmail(undefined), null);
  assert.equal(isValidOptionalManagerEmail(""), true);
  assert.equal(isValidOptionalManagerEmail("name@example.com"), true);
  assert.equal(isValidOptionalManagerEmail("wrong-address"), false);
});

test("POST와 PATCH는 같은 manager_email 컬럼을 정리해 저장한다", () => {
  assert.match(routeSource, /manager_email: normalizedManagerEmail/);
  assert.match(routeSource, /allowedUpdateColumns[\s\S]*"manager_email"/);
  assert.match(routeSource, /hasOwnProperty\.call\(updatePayload, "manager_email"\)/);
  assert.match(routeSource, /normalizeOptionalManagerEmail\(\s*updatePayload\.manager_email/);
  assert.match(routeSource, /\.select\(\)/);
});

test("신규등록과 수정 모달은 동일한 manager_email 속성을 사용하고 초기화한다", () => {
  assert.match(componentSource, /manager_email\?: string \| null/);
  assert.match(componentSource, /value=\{editForm\.manager_email \|\| ""\}/);
  assert.match(componentSource, /value=\{addForm\.manager_email \|\| ""\}/);
  assert.match(componentSource, /manager_email: ""/);
  assert.match(componentSource, /담당자 메일 형식을 확인해 주세요\./);
  assert.equal((componentSource.match(/type="email"/g) || []).length >= 2, true);
  assert.equal((componentSource.match(/담당자 메일 형식을 확인해 주세요\./g) || []).length >= 2, true);
  assert.match(componentSource, /prev\.code && prev\.code !== business\.code \? "" : prev\.manager_email/);
  assert.doesNotMatch(componentSource, /invoice_email[^\n]*manager_email|manager_email[^\n]*invoice_email/);
  assert.match(registrationContextSource, /from\("measurement_target_business"\)[\s\S]*\.select\("\*"\)/);
});

test("계산서 이메일과 담당자 이메일은 독립된 저장값이다", () => {
  assert.match(routeSource, /invoice_email: invoice_email \|\| null/);
  assert.match(routeSource, /manager_email: normalizedManagerEmail/);
  assert.doesNotMatch(routeSource, /manager_email:\s*invoice_email/);
  assert.doesNotMatch(routeSource, /invoice_email:\s*manager_email/);
});

test("GET과 기존 사업장 전환은 measurement_target_business 전체 행에서 이메일을 읽는다", () => {
  assert.match(routeSource, /from\("measurement_target_business"\)[\s\S]*\.select\("\*"\)/);
  assert.match(registrationContextSource, /from\("measurement_target_business"\)[\s\S]*\.select\("\*"\)/);
});

test("담당자 메일은 건강디딤돌 조회 및 신청 자격에 영향을 주지 않는다", () => {
  const lookupInput = {
    industrial_accident_number: "30781123856",
    commencement_number: "92600209747",
    representative_name: "홍길동",
  };
  const applicationInput = {
    ...lookupInput,
    manager_name: "김담당",
    manager_mobile: "010-1234-5678",
  };

  assert.equal(
    hasNationalSupportLookupInformation(lookupInput),
    hasNationalSupportLookupInformation({ ...lookupInput, manager_email: "wrong" } as any),
  );
  assert.equal(
    hasNationalSupportApplicationInformation(applicationInput),
    hasNationalSupportApplicationInformation({ ...applicationInput, manager_email: "wrong" } as any),
  );
});
