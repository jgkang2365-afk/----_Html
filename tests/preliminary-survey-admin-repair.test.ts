import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { repairLinkCandidates, collectMeasurementStaffNames } from "../lib/business/link-measurer";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const apiSource = read("app/api/preliminary-survey-v2/admin-repair/route.ts");
const migration = read("supabase/migrations/20260817_add_preliminary_survey_exception_log.sql");
const uiSource = read("components/features/MeasurementTargetBusinessManagement.tsx");
const businessesRoute = read("app/api/businesses/route.ts");

const users = [
  { id: 16, name: "고유빈" },
  { id: 17, name: "한기문" },
  { id: 20, name: "김민영" },
];

// ===== 권한 =====
test("관리자 예외 정비 API는 일반 사용자(POST)를 거부한다", () => {
  assert.match(apiSource, /session\.role !== "관리자"/);
  assert.match(apiSource, /관리자만 예비조사 예외 정비를 수행할 수 있습니다/);
});

test("관리자 예외 정비 API는 GET 비교 정보도 관리자 전용이다", () => {
  assert.match(apiSource, /function adminGuard/);
  assert.match(apiSource, /adminGuard\(session\)/);
});

test("UI: 수정 모달의 '연결 정비' 진입점은 제거됐다 (Phase A, 관리자 정비는 별도 모달/예비조사 영역)", () => {
  // 사업장 수정 모달의 예비조사 정보 섹션이 제거됨에 따라 연결 정비 버튼 진입점도 함께 제거됨
  assert.doesNotMatch(uiSource, />예비조사 정보</);
  assert.doesNotMatch(uiSource, /linkStatusForForm\(editForm\)\.kind !== "C"/);
});

// ===== 서버 검증 (RPC) =====
test("변경 사유 없음은 거부된다 (REASON_REQUIRED)", () => {
  assert.match(apiSource, /if \(!reason\)/);
  assert.match(apiSource, /변경 사유를 입력해 주세요/);
  assert.match(migration, /REASON_REQUIRED/);
  assert.match(migration, /btrim\(reason\) <> ''/);
});

test("예·측이 정정 후 예비조사자가 아니면 거부된다", () => {
  assert.match(migration, /LINK_MEASURER_NOT_IN_PARTICIPANTS/);
  assert.match(apiSource, /예·측은 정정 후 예비조사자에 포함되어야 합니다/);
});

test("예·측이 실제 측정자가 아니면 거부된다", () => {
  assert.match(migration, /LINK_MEASURER_NOT_IN_STAFF/);
  assert.match(apiSource, /예·측은 실제 측정 인원에 포함되어야 합니다/);
});

test("예·측 후보 0명이면 저장 불가 (후보 계산)", () => {
  // 참가자(한기문)가 실제 측정자(김민영)에 없음 → 후보 0
  const candidates = repairLinkCandidates([17], users, ["김민영"]);
  assert.equal(candidates.length, 0);
});

test("예·측 후보가 정확히 1명이면 후보로 표시된다", () => {
  const candidates = repairLinkCandidates([17, 20], users, ["김민영"]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].name, "김민영");
});

test("예·측 후보 2명 이상이면 관리자가 명시적으로 선택한다", () => {
  const candidates = repairLinkCandidates([17, 20], users, ["김민영", "한기문"]);
  assert.equal(candidates.length, 2);
});

test("다일 측정은 전체 기간 중 최소 하루 참여자면 후보가 된다", () => {
  const staff = collectMeasurementStaffNames({
    collaborators: null,
    dailyStaff: [
      { date: "2026-08-08", collaborators: ["김민영"] },
      { date: "2026-08-09", collaborators: ["강종구", "한기문"] },
    ],
  });
  const candidates = repairLinkCandidates([17], users, staff);
  // 한기문은 Day2에 참여 → 후보 가능
  assert.ok(candidates.some((user) => user.name === "한기문"));
});

test("정비 대상은 확정(sequence_number 부여) 상태만 허용된다", () => {
  assert.match(migration, /SEQUENCE_NUMBER_NOT_CONFIRMED/);
  assert.match(migration, /sequence_number IS NOT NULL/);
  assert.match(apiSource, /확정 상태가 아닙니다/);
});

// ===== 저장 =====
test("정비는 V2 예비조사자와 link_measurer_id를 하나의 원자적 RPC로 저장한다", () => {
  assert.match(migration, /admin_repair_preliminary_survey_connection/);
  assert.match(migration, /participant_user_ids = p_participant_user_ids/);
  assert.match(migration, /participant_names = p_participant_names/);
  assert.match(migration, /UPDATE public\.measurement_target_business[\s\S]*link_measurer_id = p_link_measurer_id/);
});

test("정비는 실제 측정자·보고서 담당자·legacy를 변경하지 않는다", () => {
  // RPC는 collaborators/daily_staff/measurer_id를 UPDATE하지 않는다.
  assert.doesNotMatch(migration, /SET collaborators/);
  assert.doesNotMatch(migration, /SET daily_staff/);
  assert.doesNotMatch(migration, /SET measurer_id/);
  // legacy preliminary_survey를 UPDATE하지 않는다.
  assert.doesNotMatch(migration, /UPDATE public\.preliminary_survey\s/);
});

test("정비는 감사기록을 생성한다 (변경 전/후 + 변경자 + 사유)", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.preliminary_survey_exception_log/);
  assert.match(migration, /old_participant_user_ids jsonb/);
  assert.match(migration, /new_participant_user_ids jsonb/);
  assert.match(migration, /old_participant_names jsonb/);
  assert.match(migration, /new_participant_names jsonb/);
  assert.match(migration, /old_link_measurer_id integer/);
  assert.match(migration, /new_link_measurer_id integer/);
  assert.match(migration, /changed_by varchar\(100\) NOT NULL/);
  assert.match(migration, /reason text NOT NULL CHECK \(btrim\(reason\) <> ''\)/);
  assert.match(migration, /INSERT INTO public\.preliminary_survey_exception_log/);
});

test("정비 감사기록은 서비스 롤 전용이며 일반 사용자는 접근 불가다", () => {
  assert.match(migration, /REVOKE ALL ON TABLE public\.preliminary_survey_exception_log FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT ALL ON TABLE public\.preliminary_survey_exception_log TO service_role/);
});

// ===== 보호 =====
test("일반 사용자는 measurement_journal row가 있는 찐확정 핵심값을 수정할 수 없다", () => {
  assert.match(businessesRoute, /유효한 측정일지가 있어 찐확정된 사업장입니다/);
  assert.doesNotMatch(businessesRoute, /confirmedJournal[\s\S]*?not\("sequence_number"/);
  assert.match(businessesRoute, /if \(!isAdmin && planCriticalActuallyChanged/);
});

test("관리자 예외 정비는 별도 관리자 전용 API 경로로만 수행된다", () => {
  assert.match(apiSource, /export async function POST/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_repair_preliminary_survey_connection/);
});

// ===== 감사기록 old 예비조사자 보존 (RPC 버그 회귀 방지) =====
test("감사기록은 변경 전 예비조사자를 old_plan 스냅샷으로 기록한다 (버그 수정)", () => {
  const fixMigration = read("supabase/migrations/20260817_fix_admin_repair_audit_old_participants.sql");
  // UPDATE 이전 plan 스냅샷을 old_plan에 보존
  assert.match(fixMigration, /old_plan public\.preliminary_survey_v2_plans/);
  assert.match(fixMigration, /old_plan := plan_row/);
  // 감사기록 INSERT가 old_plan 값을 사용
  assert.match(fixMigration, /COALESCE\(old_plan\.participant_user_ids, '\[\]'::jsonb\), p_participant_user_ids/);
  assert.match(fixMigration, /COALESCE\(old_plan\.participant_names, '\[\]'::jsonb\), p_participant_names/);
  // 변경 후 값(plan_row)은 old 값으로 사용되지 않아야 한다
  assert.doesNotMatch(fixMigration, /COALESCE\(plan_row\.participant_user_ids, '\[\]'::jsonb\), p_participant_user_ids/);
  assert.doesNotMatch(fixMigration, /COALESCE\(plan_row\.participant_names, '\[\]'::jsonb\), p_participant_names/);
});
