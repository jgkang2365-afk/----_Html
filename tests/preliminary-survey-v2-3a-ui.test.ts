import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("측정대상사업장 UI는 세 기본유형을 상호배타 체크박스로 표시한다", () => {
  const source = read("components/features/MeasurementTargetBusinessManagement.tsx");

  assert.match(source, /\{ value: "existing", label: "기존업체" \}/);
  assert.match(source, /\{ value: "first_measurement", label: "최초실시" \}/);
  assert.match(source, /\{ value: "external_new", label: "타기관 신규" \}/);
  assert.match(source, /business_type: e\.target\.checked \? option\.value : null/);
  assert.match(source, /process_changed: e\.target\.checked/);
});

test("신규 등록은 공업사·건설에만 초기 공정변경을 적용하고 사용자 해제를 보존한다", () => {
  const source = read("components/features/MeasurementTargetBusinessManagement.tsx");

  assert.match(source, /normalized === "공업사" \|\| normalized === "건설"/);
  assert.match(source, /addProcessChangedTouched/);
  assert.match(source, /process_changed: isProcessChangedDefaultCategory\(businessCategory\) \? true : null/);
});

test("측정일지 화면은 연결 target의 분류를 우선 표시한다", () => {
  const searchRoute = read("app/api/journal/search/route.ts");
  const journalForm = read("components/features/JournalEditForm.tsx");

  assert.match(searchRoute, /notes, business_category, business_type, process_changed/);
  assert.match(searchRoute, /journal\.target_business_type = targetBusiness\?\.business_type \?\? null/);
  assert.match(searchRoute, /journal\.target_process_changed = targetBusiness\?\.process_changed \?\? null/);
  assert.match(journalForm, /측정대상사업장 기준 분류/);
  assert.match(journalForm, /측정일지 비고는 호환용/);
});
