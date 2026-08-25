import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildLegacyReconciliationManifest,
  normalizeLegacyReconciliationPeriod,
  type LegacyReconciliationSourceRow,
} from "../lib/preliminary-survey-v2/legacy-reconciliation";

const source: LegacyReconciliationSourceRow = {
  id: 1, code: "H0001", year: 2026, period: "하반기", measurement_date: "2026-08-03",
  preliminary_surveyor: "한기문", measurer: "고유빈", survey_code: "FF",
};
const target = { id: 10, code: "H0001", year: 2026, period: "하반기", measurement_date: "2026-08-01",
  daily_staff: [{ date: "2026-08-03", reportWriterUserId: 99 }] };
const plan = { id: "plan-1", measurement_target_business_id: 10, status: "recommended",
  recommended_date: "2026-07-20", survey_method: "phone" };
const users = [
  { id: 2, name: "한기문", is_active: true, survey_code: "B" },
  { id: 5, name: "고유빈", is_active: true, survey_code: "F" },
];

function classify(overrides: Record<string, unknown> = {}) {
  return buildLegacyReconciliationManifest({
    sources: [source], targets: [target], plans: [plan], assignments: [], users,
    sourceHashes: new Map([[1, "a".repeat(64)]]), ...overrides,
  })[0];
}

test("명시 daily_staff 날짜와 exact user를 사용해 assignment gap만 복원한다", () => {
  const result = classify();
  assert.equal(result.targetId, 10);
  assert.equal(result.classification, "ASSIGNMENT_ONLY_EXACT_RECOVERY");
  assert.deepEqual(result.matchedResponsibleUserIds, [2]);
  assert.equal(result.matchedPublicSampleUserId, 5);
});

test("bigint target ID가 문자열로 조회되어도 manifest는 숫자로 canonicalize한다", () => {
  const result = classify({ targets: [{ ...target, id: "10" as unknown as number }] });
  assert.equal(result.targetId, 10);
  assert.equal(typeof result.targetId, "number");
});

test("기존 V2 assignment 우선, protected 및 모호한 key는 write하지 않는다", () => {
  assert.equal(classify({ assignments: [{ id: "a", plan_id: "plan-1", measurement_date: "2026-08-03" }] }).classification,
    "V2_ALREADY_AUTHORITATIVE");
  assert.equal(classify({ targets: [{ ...target, code: "H0063" }], sources: [{ ...source, code: "H0063" }] }).classification,
    "SNAPSHOT_ONLY");
  assert.equal(classify({ targets: [target, { ...target, id: 11 }] }).classification, "SNAPSHOT_ONLY");
});

test("동명이인·미등록 사용자와 plan 미존재는 snapshot-only이며 값을 추측하지 않는다", () => {
  assert.equal(classify({ users: [...users, { ...users[1], id: 6 }] }).classification, "SNAPSHOT_ONLY");
  assert.equal(classify({ users: users.slice(0, 1) }).classification, "SNAPSHOT_ONLY");
  assert.equal(classify({ plans: [] }).classification, "SNAPSHOT_ONLY");
});

test("동일 normalized legacy source key가 두 행이면 모두 conflict snapshot-only다", () => {
  const duplicate = { ...source, id: 2, period: "하반기 (수시)" };
  const results = buildLegacyReconciliationManifest({
    sources: [source, duplicate], targets: [target], plans: [plan], assignments: [], users,
    sourceHashes: new Map([[1, "a".repeat(64)], [2, "b".repeat(64)]]),
  });
  assert.deepEqual(results.map((row) => row.classification), ["SNAPSHOT_ONLY", "SNAPSHOT_ONLY"]);
  assert.ok(results.every((row) => row.exclusionReason === "DUPLICATE_LEGACY_SOURCE_KEY"));
});

test("수시 표기만 정규화한다", () => {
  assert.equal(normalizeLegacyReconciliationPeriod("하반기 (수시)"), "하반기");
  assert.equal(normalizeLegacyReconciliationPeriod("하반기(수시)"), "하반기");
  assert.equal(normalizeLegacyReconciliationPeriod("상반기"), "상반기");
});

test("migration은 stale/count/권한/감사/idempotency 경계를 유지한다", () => {
  const sql = readFileSync("supabase/migrations/20260825230907_preliminary_survey_v2_legacy_reconciliation.sql", "utf8");
  for (const marker of [
    "STALE_LEGACY_SOURCE", "LEGACY_EXPECTED_COUNT_MISMATCH", "LEGACY_CLASSIFICATION_CHANGED",
    "SECURITY DEFINER", "SET search_path = public", "FROM PUBLIC, anon, authenticated",
    "assignment_origin = 'legacy_reconciled'", "LEGACY_RECONCILIATION_ASSIGNMENT_CHANGED",
    "OWNER TO postgres",
  ]) assert.ok(sql.includes(marker), `missing migration guard: ${marker}`);
  assert.doesNotMatch(sql, /DISABLE\s+TRIGGER/i);
  assert.doesNotMatch(sql, /DELETE FROM public\.preliminary_survey_v2_legacy_reconciliation/);
});

test("운영 apply runner는 write opt-in과 정확한 production project ref를 모두 요구한다", () => {
  const runner = readFileSync("scripts/preliminary-survey-v2-legacy-reconciliation.ts", "utf8");
  assert.match(runner, /LEGACY_RECONCILIATION_PRODUCTION_WRITE/);
  assert.match(runner, /xjxqbwvcgffunqnkmoqw\.supabase\.co/);
  assert.match(runner, /LEGACY_RECONCILIATION_PRODUCTION_PROJECT_MISMATCH/);
});
