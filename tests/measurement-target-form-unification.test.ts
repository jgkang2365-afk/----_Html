import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  buildInlineMeasurementDateUpdates,
  buildTargetBusinessSaveValues,
  resolveTargetBusinessStatusForCreate,
  resolveOfficeJurisdiction,
  serializeTargetBusinessFormValues,
} from "../lib/business/target-business-form";
import {
  serializeMeasurementDayForms,
  withMeasurementDayUiKeys,
} from "../lib/business/measurement-day-form";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("신규등록 payload에 지정지청·상태·비고·다일 날짜별 배정이 함께 포함된다", () => {
  const payload = buildTargetBusinessSaveValues(
    {
      period: "하반기",
      business_name: "테스트 사업장",
      designated_office: "천안",
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

  assert.equal(payload.office_jurisdiction, "천안");
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

test("신규 alias와 상세수정 canonical 필드는 같은 공통 직렬화 결과를 만든다", () => {
  const createValues = serializeTargetBusinessFormValues({
    designated_office: "대전",
    sanjae: "123",
    commencement: "456",
    is_registered_text: "확정",
    notes: "동일",
  });
  const editValues = serializeTargetBusinessFormValues({
    office_jurisdiction: "대전",
    industrial_accident_number: "123",
    commencement_number: "456",
    is_registered: "실시",
    notes: "동일",
  });

  assert.deepEqual(createValues, editValues);
});

test("명시적인 지정지청은 주소 자동계산 결과보다 우선한다", () => {
  assert.equal(resolveOfficeJurisdiction("천안", "대전"), "천안");
  assert.equal(resolveOfficeJurisdiction("", "대전"), "대전");
  assert.equal(resolveOfficeJurisdiction(null, null), null);
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
