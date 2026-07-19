import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  FIELD_HWPX_FIELDS,
  GENERAL_HWPX_FIELDS,
  XLSM_TARGET_CELLS,
  buildBusinessYearPeriodLabel,
  buildDocumentFilename,
  buildDocumentOutputPath,
  buildManagerContact,
  formatBusinessNumber,
  normalizeMeasurementPeriod,
  sanitizeWindowsFilename,
} from "../lib/document-generation/constants";

test("측정주기는 상반기 별칭만 정확히 정규화한다", () => {
  assert.equal(normalizeMeasurementPeriod("상반기"), "상반기");
  assert.equal(normalizeMeasurementPeriod("1"), "상반기");
  assert.equal(normalizeMeasurementPeriod("상"), "상반기");
});

test("측정주기는 하반기 별칭만 정확히 정규화한다", () => {
  assert.equal(normalizeMeasurementPeriod("하반기"), "하반기");
  assert.equal(normalizeMeasurementPeriod("2"), "하반기");
  assert.equal(normalizeMeasurementPeriod("하"), "하반기");
  assert.equal(normalizeMeasurementPeriod("상반기(수시)"), null);
});

test("H0507 출력 경로에 연도·주기·미확정 폴더가 포함된다", () => {
  assert.equal(
    buildDocumentOutputPath(
      "Z:\\data\\측정팀\\측정보고서",
      2026,
      "하반기",
      "H0507 통합검증 사업장",
      "H0507"
    ),
    "Z:\\data\\측정팀\\측정보고서\\2026년\\하반기\\(((미확정 사업장)))\\H0507 통합검증 사업장"
  );
});

test("Windows 금지문자와 끝 마침표를 안전하게 정리한다", () => {
  assert.equal(sanitizeWindowsFilename('회사:/\\*?"<>|.  '), "회사_________");
});

test("세 문서 파일명은 26하 규칙을 사용한다", () => {
  assert.equal(
    buildDocumentFilename("GENERAL_PRELIMINARY_SURVEY", "회사", 2026, "하반기"),
    "회사(예비조사표-26하).hwpx"
  );
  assert.equal(
    buildDocumentFilename("FIELD_PRELIMINARY_SURVEY", "회사", 2026, "하반기"),
    "회사(현장 예비조사표-26하).hwpx"
  );
  assert.equal(
    buildDocumentFilename("MEASUREMENT_PLAN_XLSM", "회사", 2026, "하반기"),
    "★ 회사(26하)_화학물질입력 및 측정계획(V2.0).xlsm"
  );
});

test("사업자번호는 10자리일 때만 표준 형식으로 바꾼다", () => {
  assert.equal(formatBusinessNumber("1234567890"), "123-45-67890");
  assert.equal(formatBusinessNumber("123-45-67890"), "123-45-67890");
  assert.equal(formatBusinessNumber("1234"), "1234");
});

test("담당자 연락처는 휴대전화, 유선전화 순서다", () => {
  assert.equal(buildManagerContact("010-1234-5678", "041-123-4567"), "010-1234-5678");
  assert.equal(buildManagerContact("", "041-123-4567"), "041-123-4567");
  assert.equal(buildManagerContact("", ""), "");
});

test("사업장명·연도·주기 조합 문자열이 정확하다", () => {
  assert.equal(
    buildBusinessYearPeriodLabel("주식회사 한결산업", 2026, "하반기"),
    "주식회사 한결산업(2026년 하반기)"
  );
});

test("실제 샘플에서 검증한 HWPX 필드 집합을 유지한다", () => {
  assert.equal(GENERAL_HWPX_FIELDS.length, 16);
  assert.equal(FIELD_HWPX_FIELDS.length, 13);
  assert.ok(GENERAL_HWPX_FIELDS.includes("preliminary_surveyor"));
  assert.ok(!(FIELD_HWPX_FIELDS as readonly string[]).includes("preliminary_surveyor"));
});

test("XLSM 수정 대상은 B1 G1 C2 F2 I2뿐이다", () => {
  assert.deepEqual(Object.keys(XLSM_TARGET_CELLS).sort(), ["B1", "C2", "F2", "G1", "I2"]);
  assert.ok(!("J2" in XLSM_TARGET_CELLS));
  assert.ok(!("O2" in XLSM_TARGET_CELLS));
});

test("신규 코드 판정은 서버 RPC 결과로 응답한다", () => {
  const source = readFileSync("app/api/businesses/route.ts", "utf8");
  assert.match(source, /register_new_business_document_eligibility/);
  assert.match(source, /newBusinessCodeCreated/);
});

test("기존 업체에는 자격 작업이 없으므로 버튼 컴포넌트가 렌더링되지 않는다", () => {
  const source = readFileSync("components/features/NewBusinessDocumentGeneration.tsx", "utf8");
  assert.match(source, /!context\?\.job \|\| !hasRequiredContext\) return null/);
});

test("작업 요청은 선택 문서와 템플릿 버전을 payload에 고정한다", () => {
  const source = readFileSync("app/api/document-generation/route.ts", "utf8");
  assert.match(source, /template_id: template\.id/);
  assert.match(source, /version: template\.version/);
  assert.match(source, /selected_documents: selected/);
});

test("템플릿 조회는 연도와 주기를 정확히 일치시킨다", () => {
  const source = readFileSync("app/api/document-generation/route.ts", "utf8");
  assert.match(source, /eq\("measurement_year", job\.measurement_year\)/);
  assert.match(source, /eq\("measurement_period", period \|\| ""\)/);
});

test("Worker API는 Bearer token 인증을 사용한다", () => {
  const source = readFileSync("lib/document-generation/worker-auth.ts", "utf8");
  assert.match(source, /DOCUMENT_WORKER_TOKEN/);
  assert.match(source, /timingSafeEqual/);
});

test("DB는 활성 템플릿 하나와 원자적 SKIP LOCKED 선점을 보장한다", () => {
  const migration = readFileSync(
    "supabase/migrations/20260719_add_new_business_document_generation.sql",
    "utf8"
  );
  assert.match(migration, /uq_document_templates_one_active/);
  assert.match(migration, /FOR UPDATE SKIP LOCKED/);
  assert.match(migration, /'PENDING', 'PROCESSING'/);
});

test("manager_email과 invoice_email은 서로 다른 스냅샷 필드다", () => {
  const source = readFileSync("lib/document-generation/snapshot.ts", "utf8");
  assert.match(source, /manager_email: normalizeText\(target\.manager_email\)/);
  assert.match(source, /invoice_email: normalizeText\(businessInfo\?\.invoice_email\)/);
});

test("Windows Worker는 원본을 복사하고 COM을 finally에서 종료한다", () => {
  const source = readFileSync("document_worker.py", "utf8");
  assert.match(source, /shutil\.copy2\(template_file, working_file\)/);
  assert.match(source, /hwp\.Save\(True\)/);
  assert.match(source, /HWPX \{stage\} 단계 실패/);
  assert.match(source, /hwp\.Quit\(\)/);
  assert.match(source, /excel\.Quit\(\)/);
  assert.match(source, /DispatchEx\("Excel\.Application"\)/);
  assert.match(source, /def publish_file/);
  assert.match(source, /except PermissionError/);
});
test("템플릿 업로드는 배포 런타임의 전역 File 객체에 의존하지 않는다", () => {
  const source = readFileSync("app/api/document-templates/route.ts", "utf8");
  assert.match(source, /function isUploadedFile/);
  assert.doesNotMatch(source, /instanceof File/);
  assert.match(source, /correlationId/);
  assert.match(source, /DOCUMENT_TEMPLATE_/);
});
test("Storage 내부 경로는 한글 원본 파일명 대신 ASCII 키를 사용한다", () => {
  const source = readFileSync("app/api/document-templates/route.ts", "utf8");
  assert.match(source, /"first-half"/);
  assert.match(source, /"second-half"/);
  assert.doesNotMatch(source, /uploadedPath = .*file\.name/);
  assert.match(source, /original_filename: file\.name/);
});
test("한글 Worker는 Boolean 저장 인수와 단계별 오류를 사용한다", () => {
  const source = readFileSync("document_worker.py", "utf8");
  assert.match(source, /hwp\.Save\(True\)/);
  assert.match(source, /HWPX \{stage\} 단계 실패/);
});
test("Worker 템플릿 다운로드는 로컬 API가 파일 바이트를 직접 전달한다", () => {
  const route = readFileSync(
    "app/api/document-worker/jobs/[id]/templates/[templateId]/route.ts",
    "utf8"
  );
  const worker = readFileSync("document_worker.py", "utf8");
  assert.match(route, /\.download\(template\.storage_path\)/);
  assert.match(route, /new NextResponse\(bytes/);
  assert.doesNotMatch(route, /createSignedUrl|NextResponse\.redirect/);
  assert.match(worker, /destination\.write_bytes/);
  assert.match(worker, /템플릿 다운로드 실패 \(HTTP/);
  assert.doesNotMatch(worker, /payload\.get\("signedUrl"\)/);
});
test("Worker 템플릿 API는 선택 문서와 연도·주기로 다운로드 권한을 검증한다", () => {
  const route = readFileSync(
    "app/api/document-worker/jobs/[id]/templates/[templateId]/route.ts",
    "utf8"
  );
  assert.match(route, /selected_documents, measurement_year, measurement_period/);
  assert.match(route, /selectedDocuments\.includes\(template\.document_type\)/);
  assert.match(route, /template\.measurement_period !== job\.measurement_period/);
  assert.doesNotMatch(route, /payload\.templates|payloadTemplateIds/);
});
test("실패 재시도 선택창은 실제 실패한 문서만 기본 선택한다", () => {
  const source = readFileSync("components/features/NewBusinessDocumentGeneration.tsx", "utf8");
  assert.match(source, /\["PARTIAL_SUCCESS", "FAILED"\]\.includes/);
  assert.match(source, /file\.status !== "COMPLETED"/);
});
