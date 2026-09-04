from pathlib import Path
import hashlib
import re


def replace(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"pattern not found in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))

# Canonical policy first.
doc_path = Path("docs/business-rules/preliminary-survey.md")
doc = doc_path.read_text()
old = """- 고정 측정자 확정에는 최소한 확정자, 확정시각, 확정 경로와 원천 snapshot을 식별할 수 있는 기록을 남긴다.\n- 고정 측정자가 바뀌면 그 값을 전제로 만든 미적용 역산 draft는 즉시 무효화하고 다시 계산한다.\n"""
new = """- 고정 측정자 확정에는 최소한 확정자, 확정시각, 확정 경로와 원천 snapshot을 식별할 수 있는 기록을 남긴다.\n- 사용자는 이미 확정한 고정 측정자를 해당 실제 측정일에 한해 `자동`으로 되돌릴 수 있다. 이 동작은 다른 날짜의 고정값을 건드리지 않고 해당 날짜의 `preliminary_survey_v2_fixed_assignments` 고정값만 해제한다.\n- `자동`으로 되돌린 뒤에는 그 날짜의 측정자(공시료)를 다음 `배정안 계산`에서 다시 자동 계산한다.\n- 고정 측정자 확정·변경·해제는 그 값을 전제로 만든 미적용 역산 draft를 즉시 무효화하고 다시 계산한다. 관리자 명시 편성이 이미 존재하면 고정 측정자 해제를 핵심 원천 변경으로 보아 자동 덮어쓰기하지 않고 `관리자 지정 재검토 필요`로 전환한다.\n"""
if old not in doc:
    raise SystemExit("canonical fixed-assignee section not found")
doc = doc.replace(old, new, 1)
doc_path.write_text(doc)
canonical_sha = hashlib.sha1(doc.encode()).hexdigest()

# Version/canonical fingerprint.
replace("lib/preliminary-survey-v2/reverse-planner/types.ts",
        'export const REVERSE_PLANNER_VERSION = "fixed-assignee-reverse-planner-v1.3.4";',
        'export const REVERSE_PLANNER_VERSION = "fixed-assignee-reverse-planner-v1.3.5";')
p = Path("lib/preliminary-survey-v2/reverse-planner/types.ts")
text = p.read_text()
text = re.sub(r'export const PRELIMINARY_SURVEY_CANONICAL_SHA = "[0-9a-f]+";',
              f'export const PRELIMINARY_SURVEY_CANONICAL_SHA = "{canonical_sha}";', text, count=1)
p.write_text(text)

# API: display-mode load for release and explicit release action.
replace("app/api/preliminary-survey-v2/reverse-planner/route.ts",
        '    let { snapshot } = await loadSnapshot(supabase, measurementDate,\n      body.action === "confirm_fixed" ? "display" : "calculation");',
        '    let { snapshot } = await loadSnapshot(supabase, measurementDate,\n      body.action === "confirm_fixed" || body.action === "release_fixed" ? "display" : "calculation");')
marker = '''      if (error) throw error;\n      return NextResponse.json({ success: true, fixedAssignment: Array.isArray(data) ? data[0] : data });\n    }\n\n    if (body.action === "preview") {\n'''
insert = '''      if (error) throw error;\n      return NextResponse.json({ success: true, fixedAssignment: Array.isArray(data) ? data[0] : data });\n    }\n\n    if (body.action === "release_fixed") {\n      const targetId = Number(body.targetId);\n      const fixedDate = String(body.fixedDate ?? "");\n      if (!Number.isInteger(targetId) || !DATE_ONLY.test(fixedDate)) {\n        return NextResponse.json({ error: "고정 측정자 해제값이 올바르지 않습니다." }, { status: 400 });\n      }\n      const target = snapshot.targets.find((item) => item.id === targetId);\n      const day = target?.days.find((item) => item.date === fixedDate);\n      const fixed = target?.fixedAssignments.find((item) => item.measurementDate === fixedDate && item.origin !== "automatic");\n      if (!target || !day) {\n        return NextResponse.json({ error: "해당 사업장의 실제 측정일이 아닙니다." }, { status: 400 });\n      }\n      if (!fixed) {\n        return NextResponse.json({ success: true, released: false, alreadyAutomatic: true });\n      }\n      if (target.days.some((entry) => entry.date.startsWith("2026-08-"))) {\n        return NextResponse.json({ error: "2026년 8월 실제 측정자료는 새 플래너에서 변경하지 않습니다.", code: "TRANSITION_BOUNDARY_REVIEW_REQUIRED" }, { status: 409 });\n      }\n      const { data, error } = await supabase.rpc("release_preliminary_survey_v2_fixed_assignment", {\n        p_target_id: targetId,\n        p_measurement_date: fixedDate,\n        p_actor_user_id: session.userId,\n        p_expected_assignee_user_id: fixed.assigneeUserId,\n        p_expected_updated_at: fixed.updatedAt,\n      });\n      if (error) throw error;\n      return NextResponse.json({ success: true, released: Boolean(data?.released), release: data });\n    }\n\n    if (body.action === "preview") {\n'''
replace("app/api/preliminary-survey-v2/reverse-planner/route.ts", marker, insert)

# UI: allow switching fixed -> automatic and call release API.
ui = Path("components/features/FixedAssigneeReversePlanner.tsx")
text = ui.read_text()
confirm_end = '''  };\n\n  const createPreview = async () => {\n'''
release_fn = '''  };\n\n  const releaseFixed = async (targetId: number, fixedDate: string) => {\n    const target = snapshot?.targets.find((item) => item.id === targetId);\n    const fixed = target?.fixedAssignments.find((item) => item.measurementDate === fixedDate && item.origin !== "automatic");\n    if (!target || !fixed) return;\n    if (!window.confirm("고정 측정자 지정을 해제하고 자동배정으로 전환하시겠습니까?")) return;\n    setWorking(true);\n    setError(null);\n    setPreview(null);\n    try {\n      await request("/api/preliminary-survey-v2/reverse-planner", {\n        method: "POST",\n        headers: { "Content-Type": "application/json" },\n        body: JSON.stringify({ action: "release_fixed", measurementDate, targetId, fixedDate }),\n      });\n      await load(measurementDate);\n      setNotice(`${target.code} ${fixedDate} 고정 측정자를 자동으로 되돌렸습니다. 배정안을 다시 계산해 주세요.`);\n    } catch (caught) {\n      setError(caught instanceof Error ? caught.message : "고정 측정자 자동 전환에 실패했습니다.");\n    } finally {\n      setWorking(false);\n    }\n  };\n\n  const createPreview = async () => {\n'''
if confirm_end not in text:
    raise SystemExit("UI confirmFixed end not found")
text = text.replace(confirm_end, release_fn, 1)
old_select = '''                    <select aria-label={`${target.code} ${day.date} 고정 측정자`} value={fixed?.assigneeUserId ?? ""}\n                      onChange={(event) => event.target.value\n                        ? void confirmFixed(target.id, day.date, Number(event.target.value))\n                        : undefined}\n                      className="h-8 min-w-0 flex-1 rounded-md border border-surface-300 bg-white px-2 text-sm">\n                      <option value="" disabled={Boolean(fixed)}>자동</option>\n'''
new_select = '''                    <select aria-label={`${target.code} ${day.date} 고정 측정자`} value={fixed?.assigneeUserId ?? ""}\n                      onChange={(event) => {\n                        const value = event.target.value;\n                        if (value) void confirmFixed(target.id, day.date, Number(value));\n                        else if (fixed) void releaseFixed(target.id, day.date);\n                      }}\n                      disabled={working}\n                      className="h-8 min-w-0 flex-1 rounded-md border border-surface-300 bg-white px-2 text-sm">\n                      <option value="">자동</option>\n'''
if old_select not in text:
    raise SystemExit("UI fixed select pattern not found")
text = text.replace(old_select, new_select, 1)
ui.write_text(text)

# Forward migration: release one fixed row with stale-write protection.
migration = Path("supabase/migrations/20260904103000_add_fixed_assignee_release.sql")
migration.write_text(r'''-- Allow a user-confirmed fixed measurement assignee to return to automatic planning.
-- Forward-only, no backfill.
CREATE OR REPLACE FUNCTION public.release_preliminary_survey_v2_fixed_assignment(
  p_target_id bigint,
  p_measurement_date date,
  p_actor_user_id integer,
  p_expected_assignee_user_id integer,
  p_expected_updated_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  target_row public.measurement_target_business;
  fixed_row public.preliminary_survey_v2_fixed_assignments;
  actor_allowed boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_actor_user_id AND is_active IS NOT FALSE
      AND (role = '관리자' OR is_preliminary_survey_manager IS TRUE)
  ) INTO actor_allowed;
  IF NOT actor_allowed THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PLANNER_MANAGER_REQUIRED';
  END IF;

  SELECT * INTO target_row
  FROM public.measurement_target_business
  WHERE id = p_target_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'TARGET_NOT_FOUND';
  END IF;

  IF (p_measurement_date >= DATE '2026-08-01' AND p_measurement_date < DATE '2026-09-01')
     OR (target_row.measurement_date::date >= DATE '2026-08-01' AND target_row.measurement_date::date < DATE '2026-09-01')
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(
         CASE WHEN jsonb_typeof(target_row.daily_staff) = 'array' THEN target_row.daily_staff ELSE '[]'::jsonb END
       ) day
       WHERE day->>'date' >= '2026-08-01' AND day->>'date' < '2026-09-01'
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TRANSITION_BOUNDARY_REVIEW_REQUIRED';
  END IF;

  IF p_measurement_date IS DISTINCT FROM target_row.measurement_date::date AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(target_row.daily_staff) = 'array' THEN target_row.daily_staff ELSE '[]'::jsonb END
    ) day
    WHERE day->>'date' = p_measurement_date::text
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'FIXED_ASSIGNMENT_DATE_MISMATCH';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'fixed-assignment|' || p_target_id::text || '|' || p_measurement_date::text, 0
  ));

  SELECT * INTO fixed_row
  FROM public.preliminary_survey_v2_fixed_assignments
  WHERE measurement_target_business_id = p_target_id
    AND measurement_date = p_measurement_date
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('released', false, 'alreadyAutomatic', true);
  END IF;

  IF fixed_row.assignee_user_id IS DISTINCT FROM p_expected_assignee_user_id
     OR fixed_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'SOURCE_CHANGED';
  END IF;

  DELETE FROM public.preliminary_survey_v2_fixed_assignments
  WHERE id = fixed_row.id;

  RETURN jsonb_build_object(
    'released', true,
    'targetId', p_target_id,
    'measurementDate', p_measurement_date,
    'previousAssigneeUserId', fixed_row.assignee_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.release_preliminary_survey_v2_fixed_assignment(bigint, date, integer, integer, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_preliminary_survey_v2_fixed_assignment(bigint, date, integer, integer, timestamptz)
  TO service_role;

NOTIFY pgrst, 'reload schema';
''')

# Focused regression test.
Path("tests/preliminary-survey-fixed-assignee-release.test.ts").write_text(r'''import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("고정 측정자는 자동으로 되돌릴 수 있고 해당 날짜 release RPC를 사용한다", () => {
  const ui = readFileSync("components/features/FixedAssigneeReversePlanner.tsx", "utf8");
  const route = readFileSync("app/api/preliminary-survey-v2/reverse-planner/route.ts", "utf8");
  assert.match(ui, /<option value="">자동<\/option>/);
  assert.doesNotMatch(ui, /<option value="" disabled=\{Boolean\(fixed\)\}>자동<\/option>/);
  assert.match(ui, /action: "release_fixed"/);
  assert.match(ui, /고정 측정자 지정을 해제하고 자동배정으로 전환하시겠습니까/);
  assert.match(route, /body\.action === "release_fixed"/);
  assert.match(route, /release_preliminary_survey_v2_fixed_assignment/);
  assert.match(route, /p_expected_assignee_user_id: fixed\.assigneeUserId/);
  assert.match(route, /p_expected_updated_at: fixed\.updatedAt/);
});

test("release migration은 단일 target/date만 지우고 stale·8월 경계를 보호한다", () => {
  const sql = readFileSync("supabase/migrations/20260904103000_add_fixed_assignee_release.sql", "utf8");
  assert.match(sql, /measurement_target_business_id = p_target_id/);
  assert.match(sql, /measurement_date = p_measurement_date/);
  assert.match(sql, /fixed_row\.updated_at IS DISTINCT FROM p_expected_updated_at/);
  assert.match(sql, /MESSAGE = 'SOURCE_CHANGED'/);
  assert.match(sql, /MESSAGE = 'TRANSITION_BOUNDARY_REVIEW_REQUIRED'/);
  assert.match(sql, /DELETE FROM public\.preliminary_survey_v2_fixed_assignments/);
  assert.match(sql, /GRANT EXECUTE[\s\S]*TO service_role/);
});

test("canonical은 고정 측정자 자동 복귀와 관리자 지정 재검토를 명시한다", () => {
  const doc = readFileSync("docs/business-rules/preliminary-survey.md", "utf8");
  assert.match(doc, /고정 측정자를 해당 실제 측정일에 한해 `자동`으로 되돌릴 수 있다/);
  assert.match(doc, /관리자 지정 재검토 필요/);
});
''')
