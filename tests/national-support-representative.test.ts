import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  normalizeNationalSupportRepresentativeOverride,
  resolveNationalSupportRepresentative,
} from "../lib/national-support/representative";
import {
  hasNationalSupportRepresentativeMaster,
  saveNationalSupportRepresentativeOverride,
} from "../lib/national-support/representative-storage";

test("신청 대표자는 override를 우선하고 이름 구조를 보존한다", () => {
  assert.equal(resolveNationalSupportRepresentative(null, "홍길동, 백두산"), "홍길동, 백두산");
  assert.equal(resolveNationalSupportRepresentative("최진욱", "홍길동/백두산"), "최진욱");
  assert.equal(resolveNationalSupportRepresentative(null, "김주봉 외 1명"), "김주봉 외 1명");
});

test("빈 값과 기본 대표자 동일 값은 override로 저장하지 않는다", () => {
  assert.equal(normalizeNationalSupportRepresentativeOverride("", "홍길동"), null);
  assert.equal(normalizeNationalSupportRepresentativeOverride(" 홍길동 ", "홍길동"), null);
  assert.equal(normalizeNationalSupportRepresentativeOverride("백두산", "홍길동"), "백두산");
});

test("관리자 수동 상태 API는 외부 신청 큐를 호출하지 않는다", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "app/api/businesses/national-support/manual-status/route.ts"),
    "utf8",
  );
  assert.match(source, /user\.role !== "관리자"/);
  assert.match(source, /national_support_status !== "대상"/);
  assert.match(source, /set_manual_national_support_status/);
  assert.doesNotMatch(source, /enqueueAutomationJob|apply_if_missing|selenium/i);
});

test("신청 대표자 override 저장은 없는 business_info master를 생성하지 않는다", async () => {
  let insertCalls = 0;
  const supabase = {
    from(table: string) {
      assert.equal(table, "business_info");
      return {
        update() {
          return {
            eq() {
              return {
                select() {
                  return { maybeSingle: async () => ({ data: null, error: null }) };
                },
              };
            },
          };
        },
        insert() {
          insertCalls += 1;
          return { then() {} };
        },
      };
    },
  };
  await assert.rejects(
    saveNationalSupportRepresentativeOverride(supabase, {
      code: "MISSING", businessName: "없는 사업장", representativeName: "기본 대표", override: "신청 대표",
    }),
    /NATIONAL_SUPPORT_BUSINESS_INFO_NOT_FOUND:MISSING/,
  );
  assert.equal(insertCalls, 0);
});

test("신청 대표자 override preflight는 없는 master를 target 저장 전에 판별한다", async () => {
  const found = await hasNationalSupportRepresentativeMaster({
    from(table: string) {
      assert.equal(table, "business_info");
      return {
        select() {
          return {
            eq() {
              return { maybeSingle: async () => ({ data: null, error: null }) };
            },
          };
        },
      };
    },
  }, "MISSING");
  assert.equal(found, false);

  const source = fs.readFileSync(path.join(process.cwd(), "app/api/businesses/route.ts"), "utf8");
  const patchPreflight = source.indexOf("hasNationalSupportRepresentativeMaster(supabase, String(overrideCode))");
  const postPreflight = source.indexOf("hasNationalSupportRepresentativeMaster(supabase, String(code))");
  const targetInsert = source.indexOf(".insert({", postPreflight);
  const targetUpdate = source.indexOf('let query = supabase.from("measurement_target_business").update(updatePayload)');
  assert.ok(postPreflight >= 0 && targetInsert >= 0 && postPreflight < targetInsert);
  assert.ok(patchPreflight >= 0 && targetUpdate >= 0 && patchPreflight < targetUpdate);
});

test("override 후속 저장 실패는 target 부분 저장 사실을 숨기지 않는다", () => {
  const businessApi = fs.readFileSync(path.join(process.cwd(), "app/api/businesses/route.ts"), "utf8");
  assert.equal(
    (businessApi.match(/NATIONAL_SUPPORT_REPRESENTATIVE_OVERRIDE_PARTIAL_SAVE/g) || []).length,
    2,
  );
  assert.match(businessApi, /targetSaved: true,[\s\S]*partialSave: true/);
});

test("대표자 snapshot은 실제 완료 projection만 기록하고 수동 placeholder는 null을 유지한다", () => {
  const migration = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/20260915090000_add_national_support_representative.sql"),
    "utf8",
  );
  const terminal = migration.slice(
    migration.indexOf("CREATE OR REPLACE FUNCTION public.complete_national_support_automation_job"),
    migration.indexOf("CREATE OR REPLACE FUNCTION public.sync_manual_national_support_application"),
  );
  const manual = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.sync_manual_national_support_application"));
  assert.match(terminal, /NULLIF\(completed\.request_payload->>'representative', ''\)/);
  assert.match(terminal, /representative_name=EXCLUDED\.representative_name/);
  assert.doesNotMatch(migration, /CREATE TRIGGER national_support_application_representative_snapshot/);
  assert.match(manual, /application_status, result, national_support_status/);
  assert.doesNotMatch(manual, /representative_name/);
});

test("수동 상태 RPC는 anon/authenticated 직접 실행 권한을 부여하지 않는다", () => {
  const migration = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/20260915090000_add_national_support_representative.sql"),
    "utf8",
  );
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.set_manual_national_support_status\(bigint, text\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.set_manual_national_support_status\(bigint, text\) TO service_role/);
});

test("수동 확정은 target sync_status 제약에서 허용된다", () => {
  const migration = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/20260915090000_add_national_support_representative.sql"),
    "utf8",
  );
  assert.match(migration, /measurement_target_business_sync_status_check/);
  assert.match(migration, /'수동확정'/);
  assert.match(migration, /'일지 등록 · 제외'/);
});

test("신청결과 목록은 snapshot이 없을 때 현재 신청 대표자 override를 fallback한다", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "app/api/businesses/national-support/route.ts"),
    "utf8",
  );
  assert.match(source, /representative_name, national_support_representative_name/);
  assert.match(source, /canonicalBaseRepresentative[\s\S]*tb\.representative_name[\s\S]*mbFallback\.representative_name/);
  assert.match(source, /resolveNationalSupportRepresentative\([\s\S]*nationalSupportRepresentativeName[\s\S]*canonicalBaseRepresentative/);
  assert.match(source, /representative_name: effectiveNationalSupportRepresentative/);
  assert.match(source, /representative_name: entry\.representative_name \|\| targetInfo\.representative_name/);
});

test("수시 주기는 UI와 서버에서 대상 수동확정을 차단한다", () => {
  const manualApi = fs.readFileSync(
    path.join(process.cwd(), "app/api/businesses/national-support/manual-status/route.ts"),
    "utf8",
  );
  const businessApi = fs.readFileSync(path.join(process.cwd(), "app/api/businesses/route.ts"), "utf8");
  const form = fs.readFileSync(
    path.join(process.cwd(), "components/features/MeasurementTargetBusinessFormSections.tsx"),
    "utf8",
  );

  assert.match(manualApi, /isAdHocMeasurement\(targetPeriod\) && national_support_status === "대상"/);
  assert.ok(manualApi.indexOf("isAdHocMeasurement(targetPeriod)") < manualApi.indexOf('.rpc("set_manual_national_support_status"'));
  assert.match(businessApi, /isAdHocMeasurement\(period\) && requestedManualStatus === "대상"/);
  assert.match(form, /isAdmin && !isAdHocPeriod/);
  assert.match(form, /수시 주기는 건강디딤돌 비대상으로 처리됩니다/);
});
