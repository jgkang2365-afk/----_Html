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

  const editModalFlex = source.match(/className="flex flex-wrap gap-x-5 gap-y-2">[\s\S]*?공정변경[\s\S]*?<\/label>/);
  assert.ok(editModalFlex, "공정변경 checkbox가 기본유형과 같은 flex 줄에 배치되어야 합니다.");
});

test("신규 등록은 공업사·건설에만 초기 공정변경을 적용하고 사용자 해제를 보존한다", () => {
  const source = read("components/features/MeasurementTargetBusinessManagement.tsx");

  assert.match(source, /normalized === "공업사" \|\| normalized === "건설"/);
  assert.match(source, /addProcessChangedTouched/);
  assert.match(source, /process_changed: isProcessChangedDefaultCategory\(businessCategory\) \? true : null/);
  const addFormFlex = source.match(/className="flex flex-wrap gap-x-5 gap-y-2">[\s\S]*?setAddProcessChangedTouched\(true\)[\s\S]*?공정변경[\s\S]*?<\/label>/);
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

const extractValidColumns = (source: string): string[] => {
  const match = source.match(/const validColumns = \[([\s\S]*?)\];/);
  assert.ok(match, "validColumns 배열을 찾을 수 없습니다.");
  return match[1]
    .split(",")
    .map((entry) => entry.trim().match(/'([^']+)'/)?.[1])
    .filter((value): value is string => Boolean(value));
};

test("sanitizeUpdates는 business_type과 process_changed를 PATCH 전달 허용 목록에 포함한다", () => {
  const source = read("components/features/MeasurementTargetBusinessManagement.tsx");
  const validColumns = extractValidColumns(source);

  assert.ok(validColumns.includes("business_type"), "validColumns에 business_type 누락");
  assert.ok(validColumns.includes("process_changed"), "validColumns에 process_changed 누락");
});

test("sanitizeUpdates를 통과한 값은 실제 PATCH payload의 updates로 전달된다", () => {
  const source = read("components/features/MeasurementTargetBusinessManagement.tsx");
  const validColumns = extractValidColumns(source);

  assert.match(source, /updates: cleanUpdates/);

  const sanitizePassThrough = (key: string, value: unknown) =>
    validColumns.includes(key) ? { [key]: value } : {};

  assert.deepEqual(sanitizePassThrough("business_type", "existing"), { business_type: "existing" });
  assert.deepEqual(sanitizePassThrough("business_type", null), { business_type: null });
  assert.deepEqual(sanitizePassThrough("process_changed", true), { process_changed: true });
  assert.deepEqual(sanitizePassThrough("process_changed", false), { process_changed: false });
  assert.deepEqual(sanitizePassThrough("process_changed", null), { process_changed: null });
});

test("기존 process_changed 미정(null)은 수정하지 않으면 false로 강제 변환되지 않는다", () => {
  const source = read("components/features/MeasurementTargetBusinessManagement.tsx");

  const initFormSpread = /let initialForm = \{[\s\S]*?\.\.\.item,/.exec(source);
  assert.ok(initFormSpread, "편집 폼이 기존 item 값을 상속해야 합니다.");

  assert.match(source, /checked=\{editForm\.process_changed === true\}/);
  assert.match(source, /process_changed: e\.target\.checked/);
  assert.doesNotMatch(source, /setEditForm\([^)]*process_changed: true\)/);

  const validColumns = extractValidColumns(source);
  assert.ok(validColumns.includes("process_changed"));
});
