import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  NATIONAL_SUPPORT_SYNC_STATUSES,
  classifyNationalSupportQueueError,
  isAllowedNationalSupportSyncStatus,
} from "../lib/national-support/queue-error";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260718_sync_status_and_atomic_queue.sql",
);
const recheckMigrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260718_reset_second_half_national_support_review.sql",
);
const recheckVerificationPath = path.join(
  process.cwd(),
  "supabase/verification/20260718_verify_second_half_national_support_review.sql",
);



test("허용된 모든 sync_status가 코드와 DB 제약에 포함된다", () => {
  const migration = fs.readFileSync(migrationPath, "utf8");
  for (const status of NATIONAL_SUPPORT_SYNC_STATUSES) {
    assert.equal(isAllowedNationalSupportSyncStatus(status), true);
    assert.match(migration, new RegExp(`'${status}'`));
  }
  assert.equal(isAllowedNationalSupportSyncStatus(null), true);
  assert.equal(isAllowedNationalSupportSyncStatus("임의상태"), false);
});

test("DB 제약 위반은 추적 가능한 오류 코드로 분류한다", () => {
  assert.equal(
    classifyNationalSupportQueueError({ code: "23514", message: "check violation" }),
    "NATIONAL_SUPPORT_SYNC_STATUS_CONSTRAINT",
  );
  assert.equal(
    classifyNationalSupportQueueError({ code: "PGRST202", message: "function not found" }),
    "NATIONAL_SUPPORT_QUEUE_MIGRATION_REQUIRED",
  );
});

test("조회중 락과 큐 등록은 하나의 RPC 트랜잭션에서 성공한다", () => {
  const migration = fs.readFileSync(migrationPath, "utf8");
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /sync_status = '조회중'/);
  assert.match(migration, /INSERT INTO public\.background_jobs/);
  assert.match(migration, /RETURN QUERY SELECT created_job_id/);
});

test("이미 조회중이거나 큐가 중복이면 명시적으로 중단한다", () => {
  const migration = fs.readFileSync(migrationPath, "utf8");
  assert.match(migration, /current_sync_status IN \('신청중', '조회중'\)/);
  assert.match(migration, /NATIONAL_SUPPORT_ALREADY_RUNNING/);
  assert.match(migration, /NATIONAL_SUPPORT_JOB_DUPLICATE/);
  assert.equal(
    classifyNationalSupportQueueError({
      code: "P0001",
      message: "NATIONAL_SUPPORT_ALREADY_RUNNING",
    }),
    "NATIONAL_SUPPORT_ALREADY_RUNNING",
  );
});

test("큐 INSERT 실패는 RPC 예외로 상태 UPDATE와 함께 롤백된다", () => {
  const migration = fs.readFileSync(migrationPath, "utf8");
  const updatePosition = migration.indexOf("UPDATE public.measurement_target_business");
  const insertPosition = migration.indexOf("INSERT INTO public.background_jobs");
  assert.ok(updatePosition >= 0);
  assert.ok(insertPosition > updatePosition);
  assert.doesNotMatch(migration, /WHEN OTHERS\s+THEN\s+RETURN/);
});

test("이전 작업 큐 migration과 점검 SQL이 필수 스키마를 검사한다", () => {
  const hardening = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/20260718_harden_national_support_jobs.sql"),
    "utf8",
  );
  const verification = fs.readFileSync(
    path.join(process.cwd(), "supabase/verification/20260718_verify_national_support_schema.sql"),
    "utf8",
  );
  for (const token of [
    "available_at",
    "attempt_count",
    "uq_background_jobs_active_national_support_mode",
  ]) {
    assert.match(hardening, new RegExp(token));
    assert.match(verification, new RegExp(token));
  }
  assert.match(verification, /enqueue_national_support_job/);
  assert.match(verification, /measurement_target_business_sync_status_check/);
});

test("2026년 하반기 비대상 재검증은 감사 범위만 백업 후 초기화한다", () => {
  const migration = fs.readFileSync(recheckMigrationPath, "utf8");
  const verification = fs.readFileSync(recheckVerificationPath, "utf8");

  assert.match(migration, /year = 2026/);
  assert.match(migration, /period = '하반기'/);
  assert.match(migration, /national_support_status = '비대상'/);
  assert.match(migration, /COALESCE\(sync_status, '대기'\) = '대기'/);
  assert.match(migration, /target_count > 68/);
  assert.match(migration, /national_support_recheck_backup_20260718/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL[\s\S]*FROM anon, authenticated/);
  assert.match(migration, /THEN '조회대기'/);
  assert.match(migration, /ELSE '정보부족'/);
  assert.match(migration, /UPDATE public\.national_support_application/);
  assert.match(migration, /UPDATE public\.measurement_journal/);
  assert.match(migration, /UPDATE public\.measurement_target_business/);

  assert.match(verification, /remaining_target_non_support/);
  assert.doesNotMatch(migration, /CREATE\s+TEMP(?:ORARY)?\s+TABLE|national_support_recheck_targets/);
  assert.match(verification, /remaining_application_non_support/);
  assert.match(verification, /remaining_journal_non_support/);
});
