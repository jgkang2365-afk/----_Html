import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_MANUAL_NATIONAL_SUPPORT_INTENT,
  buildTargetBusinessEditPatch,
  resolveManualNationalSupportStatus,
  serializeTargetBusinessCreateValues,
  toggleManualNationalSupportIntent,
} from "../lib/business/target-business-form";

test("관리자 수동수정 ON → 선택 → OFF는 draft와 저장 intent를 함께 지운다", () => {
  const enabled = toggleManualNationalSupportIntent(
    EMPTY_MANUAL_NATIONAL_SUPPORT_INTENT,
    true,
  );
  const selected = { ...enabled, draft: "대상" as const };
  const cancelled = toggleManualNationalSupportIntent(selected, false);

  assert.deepEqual(cancelled, EMPTY_MANUAL_NATIONAL_SUPPORT_INTENT);
  assert.equal(resolveManualNationalSupportStatus(cancelled), null);
});

test("국고지원 상태는 일반 신규등록 serializer와 상세 dirty patch에 포함되지 않는다", () => {
  const createPayload = serializeTargetBusinessCreateValues({
    business_name: "테스트 사업장",
    national_support_status: "대상",
  });
  const editPatch = buildTargetBusinessEditPatch(
    { business_name: "테스트 사업장", national_support_status: "비대상" },
    { business_name: "테스트 사업장", national_support_status: "대상" },
    [],
    [],
  );

  assert.deepEqual(createPayload, { business_name: "테스트 사업장" });
  assert.deepEqual(editPatch, {});
});

test("명시적으로 켠 수동수정의 유효한 draft만 별도 저장값으로 해석한다", () => {
  assert.equal(
    resolveManualNationalSupportStatus({ enabled: true, draft: "비대상" }),
    "비대상",
  );
  assert.equal(
    resolveManualNationalSupportStatus({ enabled: false, draft: "대상" }),
    null,
  );
});
