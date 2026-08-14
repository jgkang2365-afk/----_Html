import assert from "node:assert/strict";
import test from "node:test";

import {
  applyTargetClassificationToJournalNote,
  getInitialProcessChanged,
  isNullableBusinessType,
  isNullableProcessChanged,
  resolveTargetBusinessCategory,
} from "../lib/business/target-classification";

test("business_type은 확정된 세 값과 null만 허용한다", () => {
  for (const value of ["existing", "first_measurement", "external_new", null]) {
    assert.equal(isNullableBusinessType(value), true);
  }
  for (const value of ["new", "기존업체", "", false, undefined]) {
    assert.equal(isNullableBusinessType(value), false);
  }
});

test("process_changed는 boolean 또는 null만 허용한다", () => {
  assert.equal(isNullableProcessChanged(true), true);
  assert.equal(isNullableProcessChanged(false), true);
  assert.equal(isNullableProcessChanged(null), true);
  assert.equal(isNullableProcessChanged("true"), false);
  assert.equal(isNullableProcessChanged(undefined), false);
});

test("공업사와 건설은 신규 생성 기본 true, 다른 업종은 null이다", () => {
  assert.equal(getInitialProcessChanged(undefined, false, " 공업사 "), true);
  assert.equal(getInitialProcessChanged(undefined, false, "건설"), true);
  assert.equal(getInitialProcessChanged(undefined, false, "제조"), null);
  assert.equal(getInitialProcessChanged(undefined, false, "선택"), null);
});

test("사용자 명시 process_changed는 업종 기본값보다 우선한다", () => {
  assert.equal(getInitialProcessChanged(false, true, "공업사"), false);
  assert.equal(getInitialProcessChanged(null, true, "건설"), null);
  assert.throws(() => getInitialProcessChanged("false", true, "건설"));
});

test("target의 정상 업종은 공업사를 포함해 fallback으로 덮어쓰지 않는다", () => {
  assert.equal(resolveTargetBusinessCategory("공업사", "제조", "건설"), "공업사");
  assert.equal(resolveTargetBusinessCategory("건설", "제조"), "건설");
  assert.equal(resolveTargetBusinessCategory("제조", "공업사"), "제조");
  assert.equal(resolveTargetBusinessCategory("선택", "공업사"), "공업사");
  assert.equal(resolveTargetBusinessCategory("  ", null, "건설"), "건설");
});

test("target 확정값은 신규 journal 호환 token만 정규화하고 다른 note를 보존한다", () => {
  assert.equal(
    applyTargetClassificationToJournalNote("소음,신규,공정 수시변경", "external_new", true),
    "소음,타기관 신규,공정 변경",
  );
  assert.equal(
    applyTargetClassificationToJournalNote("소음,최초실시,공정 변경", "existing", false),
    "소음",
  );
  assert.equal(
    applyTargetClassificationToJournalNote("신규,공정 수시변경", null, null),
    "신규,공정 수시변경",
  );
});
