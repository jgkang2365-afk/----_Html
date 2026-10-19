import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("app/(dashboard)/report-processing/page.tsx", "utf8");
const header = readFileSync("components/layout/Header.tsx", "utf8");
const layout = readFileSync("components/layout/MainLayout.tsx", "utf8");

test("보고서 처리 작업영역만 전역 Header와 2단 nav 아래에 고정한다", () => {
  const structure = page.match(/<div className="([^"]+)">\s*<div className="([^"]+)">\s*<div>\s*<h1[^>]*>작업환경측정결과 보고서 처리<\/h1>/);
  assert.ok(structure);
  const [, wrapper, toolbar] = structure;
  assert.match(wrapper, /\boverflow-x-clip\b/);
  assert.doesNotMatch(wrapper, /\boverflow-hidden\b|\boverflow-y-(?:auto|scroll)\b/);
  assert.match(toolbar, /\bsticky top-16 z-40\b/);
  assert.match(toolbar, /lg:top-\[113px\]/);
  assert.match(toolbar, /bg-surface-50\/95/);
  assert.match(header, /<header className="[^"]*sticky top-0 z-50/);
  assert.match(header, /<div className="h-16 /);
  assert.match(header, /<nav className="hidden lg:block /);
  assert.match(layout, /<Header onMenuToggle=/);

  const toolbarContent = page.slice(page.indexOf("작업환경측정결과 보고서 처리"), page.indexOf("<K2BBusinessResultPanel"));
  for (const label of ["새로고침", "이메일 합산 전송", "K2B 실제결과 최근 7일 재검증", "K2B 업로드", "진행 작업 중단"])
    assert.ok(toolbarContent.includes(label), label);
  assert.ok(page.indexOf("<K2BUnmatchableErrorsPanel") > page.indexOf("<K2BBusinessResultPanel"));
  assert.ok(page.indexOf("<Card className=\"grid gap-2 p-3") > page.indexOf("<K2BUnmatchableErrorsPanel"));
});
