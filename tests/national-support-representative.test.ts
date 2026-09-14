import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  normalizeNationalSupportRepresentativeOverride,
  resolveNationalSupportRepresentative,
} from "../lib/national-support/representative";

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
  assert.match(source, /national_support_application/);
  assert.doesNotMatch(source, /enqueueAutomationJob|apply_if_missing|selenium/i);
});
