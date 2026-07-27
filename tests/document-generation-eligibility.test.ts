import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DESIGNATED_MEASUREMENT_INSTITUTION_REPORT_NAME,
  isDocumentDefinitionVisibleForJurisdiction,
} from "../lib/document-generation/selection-report-visibility";

const migration = readFileSync(
  "supabase/migrations/20260724_target_document_generation_eligibility.sql",
  "utf8"
);
const h0508BackfillMigration = readFileSync(
  "supabase/migrations/20260727_backfill_h0508_document_generation_eligibility.sql",
  "utf8"
);
const h0508OfficeJurisdictionMigration = readFileSync(
  "supabase/migrations/20260727_fix_h0508_business_info_office_jurisdiction.sql",
  "utf8"
);
const route = readFileSync("app/api/document-generation/route.ts", "utf8");
const component = readFileSync("components/features/NewBusinessDocumentGeneration.tsx", "utf8");
const snapshot = readFileSync("lib/document-generation/snapshot.ts", "utf8");
const journalLookup = readFileSync("lib/document-generation/journal.ts", "utf8");
const businessesRoute = readFileSync("app/api/businesses/route.ts", "utf8");
const management = readFileSync(
  "components/features/MeasurementTargetBusinessManagement.tsx",
  "utf8"
);

test("기존 대상은 false이고 신규 등록 API만 자격을 true로 저장한다", () => {
  const createRoute = readFileSync("app/api/businesses/route.ts", "utf8");
  assert.match(migration, /document_generation_enabled BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(createRoute, /document_generation_enabled: true/);
  assert.doesNotMatch(
    migration,
    /UPDATE[\s\S]+document_generation_enabled = TRUE[\s\S]+WHERE document_generation_enabled/i
  );
});

test("H0508 자격 백필은 전체 식별값이 일치하는 행만 멱등으로 보정한다", () => {
  assert.match(h0508BackfillMigration, /BEGIN;/);
  assert.match(h0508BackfillMigration, /COMMIT;/);
  assert.match(h0508BackfillMigration, /UPDATE public\.measurement_target_business/);
  assert.match(h0508BackfillMigration, /SET document_generation_enabled = TRUE/);
  assert.match(h0508BackfillMigration, /code = 'H0508'/);
  assert.match(h0508BackfillMigration, /year = 2026/);
  assert.match(h0508BackfillMigration, /period = '하반기'/);
  assert.match(
    h0508BackfillMigration,
    /business_name = '남영물류산업 \(주\) YAN5 Manless Mezzanine 공사'/
  );
  assert.match(
    h0508BackfillMigration,
    /document_generation_enabled IS DISTINCT FROM TRUE/
  );
  assert.doesNotMatch(h0508BackfillMigration, /\bid\s*=/i);
  assert.doesNotMatch(h0508BackfillMigration, /created_at|ILIKE|LIKE|%/i);
});

test("H0508 관할 정정은 확인된 business_info 기존값에서만 경기로 바꾼다", () => {
  assert.match(h0508OfficeJurisdictionMigration, /BEGIN;/);
  assert.match(h0508OfficeJurisdictionMigration, /COMMIT;/);
  assert.match(h0508OfficeJurisdictionMigration, /UPDATE public\.business_info/);
  assert.match(h0508OfficeJurisdictionMigration, /SET office_jurisdiction = '경기'/);
  assert.match(h0508OfficeJurisdictionMigration, /code = 'H0508'/);
  assert.match(
    h0508OfficeJurisdictionMigration,
    /office_jurisdiction = '중부지방고용노동청 경기지청'/
  );
  assert.doesNotMatch(h0508OfficeJurisdictionMigration, /ILIKE|LIKE|%|created_at/i);
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

test("목록은 정확한 code year period 일지 여부를 문서 생성 힌트로 제공한다", () => {
  assert.match(businessesRoute, /actualMeasurementJournalKeys/);
  assert.match(businessesRoute, /\[item\.code, item\.year, item\.period\]/);
  assert.match(businessesRoute, /has_actual_measurement_journal: hasActualMeasurementJournal/);
});

test("2026년 하반기 자격 대상은 상태 조회 중에도 버튼을 보이고, 수시·일지 대상은 숨긴다", () => {
  assert.match(management, /editingItem\.year === 2026/);
  assert.match(management, /editingItem\.period === "하반기"/);
  assert.match(management, /editingItem\.document_generation_enabled === true/);
  assert.match(management, /editingItem\.has_actual_measurement_journal === false/);
  assert.match(component, /canShowWhileLoading/);
  assert.match(component, /disabled=\{loading \|\| isRunning\}/);
  assert.match(component, /loading \? "문서 생성"/);
});

test("작업환경측정기관 선정 신고서는 business_info 관할값의 네 제외 대상에서만 숨긴다", () => {
  for (const jurisdiction of ["경기", "평택", "대전", "천안"]) {
    assert.equal(
      isDocumentDefinitionVisibleForJurisdiction(
        DESIGNATED_MEASUREMENT_INSTITUTION_REPORT_NAME,
        jurisdiction
      ),
      false,
      `${jurisdiction}는 선정 신고서를 생성할 수 없어야 합니다.`
    );
  }
  for (const jurisdiction of ["보령", "서울", "부산", "광주"]) {
    assert.equal(
      isDocumentDefinitionVisibleForJurisdiction(
        DESIGNATED_MEASUREMENT_INSTITUTION_REPORT_NAME,
        jurisdiction
      ),
      true,
      `${jurisdiction}는 선정 신고서를 생성할 수 있어야 합니다.`
    );
  }
  assert.equal(
    isDocumentDefinitionVisibleForJurisdiction(
      DESIGNATED_MEASUREMENT_INSTITUTION_REPORT_NAME,
      "  경기  "
    ),
    false
  );
  assert.equal(
    isDocumentDefinitionVisibleForJurisdiction(
      DESIGNATED_MEASUREMENT_INSTITUTION_REPORT_NAME,
      "경기지청"
    ),
    true
  );
  assert.equal(
    isDocumentDefinitionVisibleForJurisdiction("일반 예비조사표", "경기"),
    true
  );
});

test("H0508 경기 사업장은 GET 목록과 POST 선택 검증이 공유하는 문서 목록에서 제외된다", () => {
  assert.match(route, /\.from\("business_info"\)/);
  assert.match(route, /\.select\("office_jurisdiction"\)/);
  assert.match(route, /String\(businessInfo\?\.office_jurisdiction \?\? ""\)\.trim\(\)/);
  assert.doesNotMatch(route, /target\.office_jurisdiction/);
  assert.doesNotMatch(route, /toShortName/);
  assert.match(route, /isDocumentDefinitionVisibleForJurisdiction\(definition\.name, officeJurisdiction\)/);
  assert.match(route, /const documents = applicableDefinitions\.map/);
  assert.match(route, /const context = await getContext\(businessId\)/);
  assert.match(route, /const documentMap = new Map<string, any>\(\)/);
  assert.equal(
    isDocumentDefinitionVisibleForJurisdiction(
      DESIGNATED_MEASUREMENT_INSTITUTION_REPORT_NAME,
      "경기"
    ),
    false
  );
});
