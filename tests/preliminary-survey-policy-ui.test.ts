import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("정책 / 지정한계 메뉴는 정책을 먼저 노출한다", () => {
  const quotaPage = read("app/admin/quotas/page.tsx");
  const sidebar = read("components/layout/Sidebar.tsx");
  const header = read("components/layout/Header.tsx");

  assert.match(sidebar, /label: "정책 \/ 지정한계"/);
  assert.match(header, /label: "정책 \/ 지정한계"/);
  const policyTab = quotaPage.indexOf('setActiveTab("policy")');
  const quotaTab = quotaPage.indexOf('setActiveTab("quota")');
  assert.ok(policyTab >= 0);
  assert.ok(quotaTab >= 0);
  assert.ok(policyTab < quotaTab);
  assert.match(quotaPage.slice(policyTab, quotaTab), />\s*정책\s*</);
  assert.match(quotaPage.slice(quotaTab), />\s*지정한계\s*</);
  assert.match(quotaPage, /useState<"policy" \| "quota">\("policy"\)/);
});

test("정책 화면은 OFF 설명과 ON 시작값 검증을 제공한다", () => {
  const panel = read("components/admin/PreliminarySurveyPolicyPanel.tsx");

  assert.match(panel, /공정변경 정보는 저장·관리되지만 예비조사 추천에는 반영되지 않습니다/);
  assert.match(panel, /정책 ON\/OFF 변경만으로 과거 예비조사 계획을 자동 재계산하지 않습니다/);
  assert.match(panel, /policy\.enabled && \(/);
  assert.match(panel, /적용 시작 연도, 주기, 측정일을 모두 입력해야 합니다/);
  assert.match(panel, /disabled=\{!policy\.enabled \|\| saving\}/);
});

test("정책 API는 관리자 서버 권한과 실제 날짜 검증을 유지한다", () => {
  const api = read("app/api/admin/preliminary-survey-policy/route.ts");

  assert.equal((api.match(/checkPermission\("system:settings"\)/g) || []).length, 2);
  assert.match(api, /function isValidIsoDate/);
  assert.match(api, /toISOString\(\)\.slice\(0, 10\) === value/);
  assert.ok(api.includes("body.enabled"));
  assert.ok(api.includes("year === null"));
  assert.ok(api.includes("period === null"));
  assert.ok(api.includes("date === null"));
});

test("기존 지정한계 API와 저장 흐름은 같은 경로를 유지한다", () => {
  const quotaPage = read("app/admin/quotas/page.tsx");

  assert.match(quotaPage, /fetch\(`\/api\/admin\/quotas\?year=\$\{year\}`\)/);
  assert.match(quotaPage, /fetch\("\/api\/admin\/quotas", \{/);
  assert.match(quotaPage, /change_reason: changeReason/);
});
