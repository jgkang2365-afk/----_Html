import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  EDIT_SOURCE_OWNED_FIELDS,
  buildInlineMeasurementDateUpdates,
  buildTargetBusinessEditPatch,
  buildTargetBusinessSaveValues,
  resolveTargetBusinessStatusForCreate,
  serializeTargetBusinessCreateValues,
  serializeTargetBusinessEditValues,
} from "../lib/business/target-business-form";
import {
  serializeMeasurementDayForms,
  withMeasurementDayUiKeys,
} from "../lib/business/measurement-day-form";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("신규등록 payload에 소재지지청·연락정보·상태·비고·다일 날짜별 배정이 함께 포함된다", () => {
  const payload = buildTargetBusinessSaveValues(
    {
      period: "하반기",
      business_name: "테스트 사업장",
      office_jurisdiction: "보령",
      designated_office: "천안",
      phone: "041-000-0000",
      fax: "041-000-0001",
      total_employees: 12,
      invoice_email: "invoice@example.com",
      is_registered_text: "실시",
      notes: "최초 등록 비고",
      plan_manager: "한기문",
      sanjae: "12345678901",
      commencement: "10987654321",
    },
    [
      { date: "2026-09-03", measurerId: 7, collaborators: ["김민영"] },
      { date: "2026-09-01", measurerId: 2, collaborators: ["한기문", "강종구"] },
    ]
  );

  assert.equal(payload.office_jurisdiction, "보령");
  assert.equal("designated_office" in payload, false);
  assert.equal(payload.phone, "041-000-0000");
  assert.equal(payload.fax, "041-000-0001");
  assert.equal(payload.total_employees, 12);
  assert.equal(payload.invoice_email, "invoice@example.com");
  assert.equal(payload.is_registered, "실시");
  assert.equal(payload.notes, "최초 등록 비고");
  assert.equal(payload.plan_manager, "한기문");
  assert.equal(payload.industrial_accident_number, "12345678901");
  assert.equal(payload.commencement_number, "10987654321");
  assert.equal(payload.measurement_date, "2026-09-01");
  assert.equal(payload.measurement_end_date, "2026-09-03");
  assert.deepEqual(payload.daily_staff, [
    { date: "2026-09-03", measurer_id: 7, collaborators: ["김민영"] },
    { date: "2026-09-01", measurer_id: 2, collaborators: ["한기문", "강종구"] },
  ]);
});

test("신규/상세수정의 공통 업무 필드는 같은 canonical column으로 직렬화된다", () => {
  const createValues = serializeTargetBusinessCreateValues({
    sanjae: "123",
    commencement: "456",
    is_registered_text: "확정",
    notes: "동일",
  });
  const editValues = serializeTargetBusinessEditValues({
    industrial_accident_number: "123",
    commencement_number: "456",
    is_registered: "실시",
    notes: "동일",
  });

  assert.deepEqual(createValues, editValues);
});

test("상세수정에서 비고만 바꾸면 source-owned 값과 소재지지청은 PATCH payload에서 제외된다", () => {
  const original = {
    business_name: "테스트 사업장",
    notes: "기존 비고",
    phone: "041-000-0000",
    fax: "041-000-0001",
    total_employees: 12,
    invoice_email: "invoice@example.com",
    manager_phone: "041-000-0002",
    business_number: "1234567890",
    office_jurisdiction: "보령",
  };
  const days = [{ date: "2026-09-01", measurerId: 2, collaborators: ["한기문"] }];
  const patch = buildTargetBusinessEditPatch(
    original,
    { ...original, notes: "수정 비고" },
    days,
    days
  );

  assert.deepEqual(patch, { notes: "수정 비고" });
  for (const field of EDIT_SOURCE_OWNED_FIELDS) {
    assert.equal(field in patch, false, `${field}가 dirty PATCH에 포함되면 안 됩니다.`);
  }
});

test("상세수정 일정이 바뀐 경우에만 날짜별 배정 묶음을 PATCH한다", () => {
  const form = { business_name: "테스트 사업장", is_registered_text: "실시" };
  const originalDays = [
    { date: "2026-09-01", measurerId: 2, collaborators: ["한기문"] },
    { date: "2026-09-02", measurerId: 3, collaborators: ["강종구"] },
  ];
  assert.deepEqual(buildTargetBusinessEditPatch(form, form, originalDays, originalDays), {});

  const changedDays = [originalDays[0], { ...originalDays[1], date: "2026-09-03" }];
  const patch = buildTargetBusinessEditPatch(form, form, originalDays, changedDays);
  assert.equal("measurement_date" in patch, false);
  assert.equal(patch.measurement_end_date, "2026-09-03");
  assert.deepEqual(patch.daily_staff, [
    { date: "2026-09-01", measurer_id: 2, collaborators: ["한기문"] },
    { date: "2026-09-03", measurer_id: 3, collaborators: ["강종구"] },
  ]);
});

test("inline 날짜는 실제 change에서 시작일·종료일·상태를 함께 만들고 거래종료를 보존한다", () => {
  assert.deepEqual(buildInlineMeasurementDateUpdates("미실시", "2026-09-01"), {
    measurement_date: "2026-09-01",
    measurement_end_date: "2026-09-01",
    is_registered: "실시",
  });
  assert.deepEqual(buildInlineMeasurementDateUpdates("실시", ""), {
    measurement_date: null,
    measurement_end_date: null,
    is_registered: "미실시",
  });
  assert.deepEqual(buildInlineMeasurementDateUpdates("거래종료", ""), {
    measurement_date: null,
    measurement_end_date: null,
  });
});

test("신규 상태는 명시적인 실시 선택을 날짜가 없어도 보존한다", () => {
  assert.equal(resolveTargetBusinessStatusForCreate("실시", false), "실시");
  assert.equal(resolveTargetBusinessStatusForCreate("미실시", true), "실시");
  assert.equal(resolveTargetBusinessStatusForCreate("거래종료", true), "거래종료");
});

test("날짜와 무관한 uiKey는 날짜 변경·중간 삭제 뒤에도 다른 카드에 남고 DB payload에는 저장되지 않는다", () => {
  const keys = ["day-a", "day-b", "day-c"];
  const days = withMeasurementDayUiKeys(
    [
      { date: "2026-09-01", measurerId: 1, collaborators: ["A"] },
      { date: "2026-09-02", measurerId: 2, collaborators: ["B"] },
      { date: "2026-09-03", measurerId: 3, collaborators: ["C"] },
    ],
    () => keys.shift()!
  );

  const changed = days.map((day, index) => (index === 2 ? { ...day, date: "2026-10-03" } : day));
  const afterMiddleRemoval = changed.filter((_, index) => index !== 1);
  assert.deepEqual(
    afterMiddleRemoval.map((day) => [day.uiKey, day.measurerId, day.collaborators]),
    [
      ["day-a", 1, ["A"]],
      ["day-c", 3, ["C"]],
    ]
  );
  assert.deepEqual(serializeMeasurementDayForms(afterMiddleRemoval), {
    daily_staff: [
      { date: "2026-09-01", measurer_id: 1, collaborators: ["A"] },
      { date: "2026-10-03", measurer_id: 3, collaborators: ["C"] },
    ],
    measurement_date: "2026-09-01",
    measurement_end_date: "2026-10-03",
    measurer_id: 1,
    collaborators: "A",
  });
});

test("모달 날짜는 local callback과 stable key만 사용하고 inline 날짜는 onChange만 저장한다", () => {
  const commonForm = read("components/features/MeasurementTargetBusinessFormSections.tsx");
  const management = read("components/features/MeasurementTargetBusinessManagement.tsx");

  assert.match(commonForm, /key=\{day\.uiKey\}/);
  assert.match(commonForm, /type="date"[\s\S]{0,180}onChange=\{\(event\) => onDateChange/);
  assert.doesNotMatch(commonForm, /type="date"[\s\S]{0,240}onBlur=/);
  assert.doesNotMatch(commonForm, /fetch\(/);

  assert.match(
    management,
    /value=\{item\.measurement_date \|\| ""\}[\s\S]{0,180}onChange=\{\(e\) => handleConfirmedDateChange/
  );
  assert.doesNotMatch(
    management,
    /defaultValue=\{item\.measurement_date \|\| ""\}[\s\S]{0,220}onBlur=/
  );
});

test("신규 POST는 공통 배정 validation과 legacy Calendar 후속 처리만 호출하고 V2 자동생성을 호출하지 않는다", () => {
  const route = read("app/api/businesses/route.ts");
  const management = read("components/features/MeasurementTargetBusinessManagement.tsx");

  assert.match(management, /buildTargetBusinessSaveValues\(addForm, addMeasurementDays\)/);
  assert.match(route, /validateMeasurementAssignmentsForSave\(\s*supabase,\s*measurementDays\s*\)/);
  assert.match(route, /syncCreatedTargetMeasurementSchedule\(supabase/);
  assert.match(
    route,
    /syncBusinessToCalendar\(supabase, params\.code, params\.year, params\.period\)/
  );
  assert.doesNotMatch(route, /ensureV2PlanForTarget|reconcileV2AfterTargetChange/);
});

test("지정지청과 소재지지청은 화면·serializer·API에서 alias로 혼용되지 않는다", () => {
  const helper = read("lib/business/target-business-form.ts");
  const commonForm = read("components/features/MeasurementTargetBusinessFormSections.tsx");
  const management = read("components/features/MeasurementTargetBusinessManagement.tsx");
  const route = read("app/api/businesses/route.ts");

  assert.doesNotMatch(helper, /normalized\.office_jurisdiction\s*=\s*raw\.designated_office/);
  assert.match(commonForm, />지정지청</);
  assert.match(commonForm, />소재지지청</);
  assert.doesNotMatch(commonForm, /onChange=\{\(event\) => onChange\(\{ designated_office:/);
  assert.match(commonForm, /address: event\.target\.value,[\s\S]{0,120}office_jurisdiction: "",[\s\S]{0,80}designated_office: ""/);
  assert.match(route, /designated_office: classifyDesignatedOffice\(item\.office_jurisdiction\)/);
  assert.match(route, /const office = findOfficeByAddress\(updates\.address\);[\s\S]{0,120}updatePayload\.office_jurisdiction = office/);
  assert.doesNotMatch(route, /if \(office\) \{[\s\S]{0,80}updatePayload\.office_jurisdiction = office/);
  assert.match(
    management,
    /const result = await response\.json\(\);[\s\S]{0,260}\{ \.\.\.item, \.\.\.result\.data \}/
  );
});

test("비고-only edit payload는 measurement_business detail upsert 경로를 만들지 않는다", () => {
  const route = read("app/api/businesses/route.ts");
  const patch = serializeTargetBusinessEditValues({
    notes: "수정 비고",
    phone: "041-000-0000",
    total_employees: 12,
  });

  assert.deepEqual(patch, { notes: "수정 비고" });
  assert.doesNotMatch(
    route.match(/const allowedUpdateColumns = new Set\(\[[\s\S]*?\]\);/)?.[0] || "",
    /"business_number"|"phone"|"fax"|"total_employees"|"invoice_email"|"manager_phone"|"office_jurisdiction"/
  );
  assert.doesNotMatch(route, /Measurement Business detail sync|\.upsert\(masterPayload/);
});
