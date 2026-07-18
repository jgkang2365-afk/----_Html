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
