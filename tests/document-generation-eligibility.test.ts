import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260724_target_document_generation_eligibility.sql",
  "utf8"
);
const route = readFileSync("app/api/document-generation/route.ts", "utf8");
const component = readFileSync("components/features/NewBusinessDocumentGeneration.tsx", "utf8");
const snapshot = readFileSync("lib/document-generation/snapshot.ts", "utf8");
const journalLookup = readFileSync("lib/document-generation/journal.ts", "utf8");

test("기존 대상은 false이고 신규 등록 API만 자격을 true로 저장한다", () => {
  const createRoute = readFileSync("app/api/businesses/route.ts", "utf8");
  assert.match(migration, /document_generation_enabled BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(createRoute, /document_generation_enabled: true/);
  assert.doesNotMatch(
    migration,
    /UPDATE[\s\S]+document_generation_enabled = TRUE[\s\S]+WHERE document_generation_enabled/i
  );
});

test("사업장 코드의 다른 테이블·과거 연도 존재 여부는 자격 제한에 사용하지 않는다", () => {
  const registrationFunction = migration.slice(
    migration.indexOf("CREATE FUNCTION public.register_new_business_document_eligibility"),
    migration.indexOf("CREATE OR REPLACE FUNCTION public.queue_document_generation_job")
  );
  assert.doesNotMatch(
    registrationFunction,
    /business_info|measurement_business|measurement_journal/
  );
});

test("일지는 연결 ID 또는 정확한 code year period로만 판정한다", () => {
  assert.match(journalLookup, /\.eq\("id", target\.journal_id\)/);
  assert.match(journalLookup, /\.eq\("code", target\.code\)/);
  assert.match(journalLookup, /\.eq\("measurement_year", target\.year\)/);
  assert.match(journalLookup, /\.eq\("measurement_period", target\.period\)/);
  assert.doesNotMatch(journalLookup, /normalizeMeasurementPeriod/);
});

test("실제 일지가 있으면 GET에서 버튼을 숨기고 POST에서도 업무 오류로 차단한다", () => {
  assert.match(route, /hasActualMeasurementJournal: Boolean\(actualJournal\)/);
  assert.match(route, /if \(context\.hasActualMeasurementJournal\)/);
  assert.match(route, /DOCUMENT_GENERATION_JOURNAL_ERROR/);
  assert.match(component, /context\.hasActualMeasurementJournal/);
});

test("완료·실패 작업도 일지가 없으면 새 작업으로 재생성한다", () => {
  assert.match(migration, /DROP CONSTRAINT IF EXISTS document_generation_jobs_business_id_key/);
  assert.match(migration, /INSERT INTO public\.document_generation_jobs/);
  assert.doesNotMatch(route, /context\.job\.status === "COMPLETED"/);
  assert.match(component, /COMPLETED: "문서 재생성"/);
  assert.match(component, /FAILED: "다시 생성"/);
});

test("대기·처리 중 작업은 DB와 API 양쪽에서 중복 생성하지 않는다", () => {
  assert.match(migration, /WHERE status IN \('PENDING', 'PROCESSING'\)/);
  assert.match(migration, /DOCUMENT_GENERATION_ALREADY_RUNNING/);
  assert.match(route, /\["PENDING", "PROCESSING"\]\.includes/);
});

test("재생성 payload는 현재 대상 정보에서 매 요청마다 새 스냅샷을 만든다", () => {
  assert.match(route, /buildDocumentSnapshot\(admin, businessId\)/);
  assert.match(snapshot, /\.from\("measurement_target_business"\)/);
  assert.doesNotMatch(route, /context\.job\.payload/);
});

test("고아 journal_id는 실제 레코드가 없으면 버튼을 숨기지 않는다", () => {
  assert.match(journalLookup, /return linkedJournal \|\| exactMatch \|\| null/);
  assert.match(migration, /journal\.id = target_row\.journal_id/);
});
