import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  isProcessChangedDefaultCategory,
  serializeTargetBusinessFormValues,
} from "../lib/business/target-business-form";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("측정대상사업장 UI는 세 기본유형을 상호배타 체크박스로 표시한다", () => {
  const source = read("components/features/MeasurementTargetBusinessFormSections.tsx");
  const helper = read("lib/business/target-business-form.ts");

  assert.match(helper, /\{ value: "existing", label: "기존업체" \}/);
  assert.match(helper, /\{ value: "first_measurement", label: "최초실시" \}/);
  assert.match(helper, /\{ value: "external_new", label: "타기관 신규" \}/);
  assert.match(source, /business_type: event\.target\.checked \? option\.value : null/);
  assert.match(source, /process_changed: event\.target\.checked/);

  const editModalFlex = source.match(/className="flex flex-wrap gap-x-5 gap-y-2">[\s\S]*?공정변경[\s\S]*?<\/label>/);
  assert.ok(editModalFlex, "공정변경 checkbox가 기본유형과 같은 flex 줄에 배치되어야 합니다.");
});

test("신규 등록은 공업사·건설에만 초기 공정변경을 적용하고 사용자 해제를 보존한다", () => {
  const source = read("components/features/MeasurementTargetBusinessManagement.tsx");
  const form = read("components/features/MeasurementTargetBusinessFormSections.tsx");

  assert.equal(isProcessChangedDefaultCategory("공업사"), true);
  assert.equal(isProcessChangedDefaultCategory("건설"), true);
  assert.equal(isProcessChangedDefaultCategory("제조"), false);
  assert.match(source, /addProcessChangedTouched/);
  assert.match(source, /process_changed: isProcessChangedDefaultCategory\(businessCategory\) \? true : null/);
  assert.match(source, /onProcessChangedTouched=\{\(\) => setAddProcessChangedTouched\(true\)\}/);
  const addFormFlex = form.match(/className="flex flex-wrap gap-x-5 gap-y-2">[\s\S]*?onProcessChangedTouched\?\.\(\)[\s\S]*?공정변경[\s\S]*?<\/label>/);
  assert.ok(addFormFlex, "신규등록의 공정변경 checkbox가 기본유형과 같은 flex 줄에 배치되어야 합니다.");
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

test("sanitizeUpdates는 business_type과 process_changed를 PATCH 전달 허용 목록에 포함한다", () => {
  const helper = read("lib/business/target-business-form.ts");

  assert.match(helper, /"business_type"/);
  assert.match(helper, /"process_changed"/);
});

test("sanitizeUpdates를 통과한 값은 실제 PATCH payload의 updates로 전달된다", () => {
  const source = read("components/features/MeasurementTargetBusinessManagement.tsx");

  assert.match(source, /updates: cleanUpdates/);
  assert.deepEqual(serializeTargetBusinessFormValues({ business_type: "existing" }), { business_type: "existing" });
  assert.deepEqual(serializeTargetBusinessFormValues({ business_type: null }), { business_type: null });
  assert.deepEqual(serializeTargetBusinessFormValues({ process_changed: true }), { process_changed: true });
  assert.deepEqual(serializeTargetBusinessFormValues({ process_changed: false }), { process_changed: false });
  assert.deepEqual(serializeTargetBusinessFormValues({ process_changed: null }), { process_changed: null });
});

test("기존 process_changed 미정(null)은 수정하지 않으면 false로 강제 변환되지 않는다", () => {
  const source = read("components/features/MeasurementTargetBusinessManagement.tsx");
  const form = read("components/features/MeasurementTargetBusinessFormSections.tsx");

  const initFormSpread = /(?:const|let) initialForm = \{[\s\S]*?\.\.\.item,/.exec(source);
  assert.ok(initFormSpread, "편집 폼이 기존 item 값을 상속해야 합니다.");

  assert.match(form, /checked=\{value\.process_changed === true\}/);
  assert.match(form, /process_changed: event\.target\.checked/);
  assert.doesNotMatch(source, /setEditForm\([^)]*process_changed: true\)/);
  assert.deepEqual(serializeTargetBusinessFormValues({ process_changed: null }), { process_changed: null });
});
