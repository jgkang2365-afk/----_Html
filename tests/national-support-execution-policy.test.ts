import assert from "node:assert/strict";
import test from "node:test";
import { nationalSupportExecutionDecision, readNationalSupportExecutionDecision } from "../lib/national-support/automation-contract";
import { isCurrentNationalSupportApplicationReady } from "../lib/national-support/apply-readiness";
import { mergeNationalSupportTargetState } from "../lib/national-support/target-state-sync";
import { projectNationalSupportOrphanStatuses } from "../lib/national-support/orphan-status";
import { nationalSupportProgressView } from "../components/features/AutomationProgressModal";
import { canRequestNationalSupportLookup } from "../lib/national-support/eligibility";

const target = { target_id: 754, code: "H0557", year: 2026, period: "하반기" };
const run = (status: unknown, hasJournal: boolean, intent: "automatic" | "direct", mode: "apply_if_missing" | "lookup_only", beforeApply = false) =>
  nationalSupportExecutionDecision({ status, period: "하반기", hasJournal, intent, mode, beforeApply });

test("H0557 실시·동일 일지 없음은 자동 및 직접 조회·조건부 신청을 실행한다", () => {
  for (const status of ["미실시", "실시"])
    for (const intent of ["automatic", "direct"] as const)
      for (const mode of ["lookup_only", "apply_if_missing"] as const)
        assert.deepEqual(run(status, false, intent, mode), { action: "run", mode });
});

test("동일 일지 등록 후 자동처리는 제외하고 직접 요청은 조회전용으로 강제한다", () => {
  assert.deepEqual(run("실시", true, "automatic", "apply_if_missing"), {
    action: "skip", resultCode: "JOURNAL_REGISTERED_SKIP",
  });
  assert.deepEqual(run("실시", true, "automatic", "lookup_only"), {
    action: "skip", resultCode: "JOURNAL_REGISTERED_SKIP",
  });
  assert.deepEqual(run("실시", true, "direct", "apply_if_missing"), {
    action: "run", mode: "lookup_only",
  });
  assert.deepEqual(run("실시", true, "direct", "lookup_only"), {
    action: "run", mode: "lookup_only",
  });
  assert.deepEqual(run("실시", true, "direct", "apply_if_missing", true), {
    action: "skip", resultCode: "JOURNAL_REGISTERED_SKIP",
  });
});

test("일지 등록 행은 과거 비대상 결과가 있어도 직접 재조회 버튼을 사용할 수 있다", () => {
  const row = { period: "하반기", is_registered: "실시", has_actual_measurement_journal: true,
    national_support_status: "비대상", sync_status: "성공",
    industrial_accident_number: "22087847550", commencement_number: "00000000000",
    representative_name: "서경" };
  assert.equal(canRequestNationalSupportLookup(row), true);
  assert.equal(canRequestNationalSupportLookup({ ...row, is_registered: "거래종료" }), false);
  assert.equal(canRequestNationalSupportLookup({ ...row, period: "하반기(수시)" }), false);
});

test("거래종료·수시·알 수 없는 상태는 조회·신청하지 않고 final_lookup은 보존한다", () => {
  for (const status of ["거래종료", "종료", null, "확정", "알수없음"])
    assert.deepEqual(run(status, false, "direct", "lookup_only"), {
      action: "skip", resultCode: "TARGET_STATUS_SKIP",
    });
  assert.deepEqual(nationalSupportExecutionDecision({ status: "실시", period: "하반기(수시)",
    hasJournal: false, intent: "direct", mode: "lookup_only" }), {
    action: "skip", resultCode: "TARGET_STATUS_SKIP",
  });
  assert.deepEqual(nationalSupportExecutionDecision({ status: "거래종료", period: "하반기",
    hasJournal: true, intent: "automatic", mode: "final_lookup" }), {
    action: "run", mode: "final_lookup",
  });
});

function fakeDb(options: { status?: string; journals?: Array<{ code: string; year: number; period: string }>;
  targetError?: boolean; journalError?: boolean; businessInfo?: Record<string, unknown> }) {
  const filters: Record<string, unknown>[] = [];
  const db = {
    filters,
    from(table: string) {
      const values: Record<string, unknown> = { table };
      filters.push(values);
      const query = {
        select() { return query; },
        eq(key: string, value: unknown) { values[key] = value; return query; },
        maybeSingle: async () => {
          if (table === "measurement_target_business") {
            return options.targetError ? { data: null, error: new Error("DB_DOWN") } : {
              data: { id: 754, code: "H0557", year: 2026, period: "하반기",
                is_registered: options.status || "실시", representative_name: "서경",
                industrial_accident_number: "22087847550", commencement_number: "00000000000",
                manager_name: "담당자 김", manager_mobile: "01098765432" }, error: null,
            };
          }
          return { data: options.businessInfo || { representative_name: "서경", national_support_representative_name: null }, error: null };
        },
        limit: async () => options.journalError ? { data: null, error: new Error("DB_DOWN") } : {
          data: (options.journals || []).filter(row => row.code === values.code &&
            row.year === values.measurement_year && row.period === values.measurement_period)
            .map((_, index) => ({ id: index + 1 })), error: null,
        },
      };
      return query;
    },
  };
  return db;
}

test("정확한 code·year·period의 일지만 차단하고 다른 연도 일지는 차단하지 않는다", async () => {
  const otherYear = fakeDb({ journals: [{ code: "H0557", year: 2025, period: "하반기" }] });
  const decision = await readNationalSupportExecutionDecision(otherYear as any, target,
    { intent: "automatic", mode: "apply_if_missing" });
  assert.deepEqual(decision, { action: "run", mode: "apply_if_missing" });
  assert.deepEqual(otherYear.filters[1], { table: "measurement_journal", code: "H0557",
    measurement_year: 2026, measurement_period: "하반기" });
});

test("일지/target 조회 오류는 외부 신청을 fail-closed한다", async () => {
  await assert.rejects(readNationalSupportExecutionDecision(fakeDb({ journalError: true }) as any, target,
    { intent: "automatic", mode: "apply_if_missing" }), /DB_DOWN/);
  await assert.rejects(readNationalSupportExecutionDecision(fakeDb({ targetError: true }) as any, target,
    { intent: "automatic", mode: "apply_if_missing" }), /DB_DOWN/);
});

test("신청 직전 저장된 번호·담당자·단일 신청 대표자를 다시 확인한다", async () => {
  const payload = { ...target, sanjae: "22087847550", commencement: "00000000000",
    representative: "서경", contact_name: "담당자 김", contact_phone: "01098765432" };
  assert.equal(await isCurrentNationalSupportApplicationReady(fakeDb({}) as any, payload), true);
  assert.equal(await isCurrentNationalSupportApplicationReady(fakeDb({ businessInfo: {
    representative_name: "서경", national_support_representative_name: "서경, 김경",
  } }) as any, payload), false);
  assert.equal(await isCurrentNationalSupportApplicationReady(fakeDb({}) as any,
    { ...payload, commencement: "00000000001" }), false);
  assert.equal(await isCurrentNationalSupportApplicationReady(fakeDb({}) as any,
    { ...payload, contact_phone: "01011112222" }), false);
});

test("완료 코드는 조회·신청·제외를 구분하고 같은 행의 상태만 병합한다", () => {
  for (const [code, expected] of [["SUPPORT", "지원 대상"], ["NON_SUPPORT", "비대상"],
    ["JOURNAL_REGISTERED_SKIP", "자동 처리 제외"], ["TARGET_STATUS_SKIP", "조회 제외"],
    ["APPLIED_WAITING_RESULT", "결과 대기"]]) {
    const view = nationalSupportProgressView({ status: "COMPLETED", progress_percent: 100,
      result_code: code, effect_started_at: null }, "진행 중");
    assert.match(view.heading, new RegExp(expected));
  }
  const identity = { id: 754, code: "H0557", year: 2026, period: "하반기" };
  const current = { ...identity, sync_status: "조회중", representative_name: "미저장 수정", notes: "입력 중" };
  const state = { ...identity, sync_status: "조회대기", national_support_status: null, sync_error_message: null };
  assert.deepEqual(mergeNationalSupportTargetState(current, identity, state), {
    ...current, sync_status: "조회대기", national_support_status: null, sync_error_message: null,
  });
  assert.equal(mergeNationalSupportTargetState({ ...current, id: 755 }, identity, state).id, 755);
});

test("활성 작업이 없는 조회중만 읽기 응답에서 복구하고 다른 행·DB 오류는 보존한다", async () => {
  const targets = [{ id: 754, sync_status: "조회중" }, { id: 755, sync_status: "조회중" },
    { id: 756, sync_status: "확인대기" }];
  const db = {
    from(table: string) {
      const query = {
        select() { return query; }, eq() { return query; }, in() { return query; },
        then(resolve: (value: unknown) => void) {
          resolve({ data: table === "automation_jobs"
            ? [{ target_key: "national-support:755", status: "RUNNING" }] : [], error: null });
        },
      };
      return query;
    },
  };
  const projected = await projectNationalSupportOrphanStatuses(db as any, targets);
  assert.equal(projected[0].sync_status, "확인대기");
  assert.equal(projected[1], targets[1]);
  assert.equal(projected[2], targets[2]);
  assert.equal(targets[0].sync_status, "조회중");
  const failed = { from() { const query = {
    select() { return query; }, eq() { return query; }, in() { return query; },
    then(resolve: (value: unknown) => void) { resolve({ data: null, error: new Error("DB_DOWN") }); },
  }; return query; } };
  await assert.rejects(projectNationalSupportOrphanStatuses(failed as any, targets), /DB_DOWN/);
});
