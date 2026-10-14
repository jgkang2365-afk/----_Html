// Transactional Docker Local proof. Every mutation is rolled back.
import assert from "node:assert/strict";
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.development.local", quiet: true });
assert.match(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", /^http:\/\/127\.0\.0\.1:/);
const client = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:55322/postgres" });
await client.connect();
const query = async (sql, values = []) => (await client.query(sql, values)).rows;
const ms = (value) => new Date(value).getTime();
const day = (value) => value instanceof Date
  ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(value)
  : String(value).slice(0, 10);

async function proposedPublicGroup(group, targetId, nextAssigneeUserId) {
  const users = await query("SELECT id, survey_code FROM public.users WHERE job='측정'");
  const codes = new Map(users.map((user) => [user.id, user.survey_code?.trim().toUpperCase()]));
  const next = group.map((row) => ({
    ...row,
    assignee_user_id: Number(row.target_id) === targetId ? nextAssigneeUserId : row.assignee_user_id,
  }));
  const ranks = new Map();
  for (const row of [...next].sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : Number(a.target_id) - Number(b.target_id))) {
    const base = codes.get(row.assignee_user_id);
    assert.ok(base, `missing survey code for user ${row.assignee_user_id}`);
    const rank = (ranks.get(row.assignee_user_id) ?? 0) + 1;
    ranks.set(row.assignee_user_id, rank);
    row.next_code = base.repeat(rank);
  }
  const impacts = next.filter((row) =>
    row.assignee_user_id !== group.find((source) => Number(source.target_id) === Number(row.target_id)).assignee_user_id
    || row.next_code !== (row.public_sample_code ?? row.survey_code)
  ).map((row) => {
    const before = group.find((source) => Number(source.target_id) === Number(row.target_id));
    return {
      targetId: Number(row.target_id), businessCode: row.code, measurementDate: day(row.measurement_date),
      beforeAssigneeUserId: before.assignee_user_id, afterAssigneeUserId: row.assignee_user_id,
      beforeCode: before.public_sample_code ?? before.survey_code, afterCode: row.next_code,
    };
  });
  return { next, impacts };
}

async function source(targetId, date) {
  const [target] = await query(`SELECT t.*, p.id AS plan_id, p.updated_at::text AS plan_updated_at,
    p.recommended_date, p.survey_method, p.responsible_user_id, p.experienced_reviewer_id,
    p.participant_user_ids, p.participant_names, p.warnings
    FROM public.measurement_target_business t JOIN public.preliminary_survey_v2_plans p
      ON p.measurement_target_business_id=t.id WHERE t.id=$1`, [targetId]);
  assert.ok(target);
  const users = await query(`SELECT id, is_active, is_preliminary_survey_experienced, survey_code, name
    FROM public.users WHERE job='측정' ORDER BY id`);
  const assignments = await query(`SELECT measurement_date, assignee_user_id, survey_code, public_sample_code, updated_at
    FROM public.preliminary_survey_v2_measurement_assignments WHERE plan_id=$1 ORDER BY measurement_date`, [target.plan_id]);
  const fixed = await query(`SELECT measurement_date, assignee_user_id, updated_at, source_snapshot
    FROM public.preliminary_survey_v2_fixed_assignments WHERE measurement_target_business_id=$1 ORDER BY measurement_date`, [targetId]);
  const occupancy = await query(`SELECT measurement_target_business_id AS target_id, id, updated_at
    FROM public.preliminary_survey_v2_plans WHERE measurement_target_business_id<>$1
      AND recommended_date=$2 AND survey_method='phone' AND responsible_user_id=$3
    ORDER BY measurement_target_business_id`, [targetId, date, target.responsible_user_id]);
  const blocks = await query(`SELECT user_id,start_date,end_date FROM public.user_schedule_blocks
    WHERE user_id=$1 AND start_date<=$2 AND end_date>=$2 ORDER BY user_id,start_date,end_date`,
    [target.responsible_user_id, date]);
  return {
    target_id: targetId, decision: "MANUAL_OVERRIDE", mutation: "REPLACE", preliminary_only: true,
    preliminary_date: date, survey_method: target.survey_method,
    responsible_user_id: target.responsible_user_id, reviewer_user_id: target.experienced_reviewer_id,
    participant_user_ids: target.participant_user_ids, participant_names: target.participant_names,
    source_measurement_date: day(target.measurement_date),
    source_report_writer_id: target.measurer_id, source_collaborators: target.collaborators,
    source_daily_staff: target.daily_staff, source_rule_type: "existing",
    actual_measurement_team: [{ date: "2026-09-21",
      collaboratorUserIds: targetId === 684 ? [13, 16] : [16] }],
    reasons: ["ADMIN_EXPLICIT_OVERRIDE"], warnings: [], route_evidence: [],
    before_snapshot: { id: target.plan_id, updatedAt: target.plan_updated_at },
    source_target_assignments: assignments.map((a) => ({
      measurementDate: day(a.measurement_date), assigneeUserId: a.assignee_user_id,
      surveyCode: a.survey_code, publicSampleCode: a.public_sample_code, updatedAtMs: ms(a.updated_at),
    })),
    source_occupancy_versions: occupancy.map((p) => ({
      targetId: Number(p.target_id), planId: p.id, updatedAtMs: ms(p.updated_at),
    })),
    source_schedule_blocks: blocks.map((b) => ({
      userId: b.user_id, startDate: day(b.start_date), endDate: day(b.end_date),
    })),
    source_actual_measurement_versions: [],
    source_users: users.map((u) => ({ id: u.id, active: u.is_active !== false,
      experienced: u.is_preliminary_survey_experienced === true,
      baseCode: u.survey_code == null ? null : String(u.survey_code).trim().toUpperCase() })),
    source_fixed_versions: fixed.map((f) => ({ measurementDate: day(f.measurement_date),
      assigneeUserId: f.assignee_user_id, updatedAtMs: ms(f.updated_at),
      nonParticipantConfirmed: f.source_snapshot?.nonParticipantConfirmed === true })),
    source_assignment_scope_keys: [], source_assignment_occupancy_versions: [],
    source_protected: true,
  };
}

try {
  await client.query("BEGIN");
  await client.query("SAVEPOINT measurement_edit_test");
  try {
    const edited = await source(684, "2026-09-11");
    const group = await query(`SELECT t.id AS target_id,t.code,a.measurement_date,a.assignee_user_id,
      a.survey_code,a.public_sample_code,a.updated_at FROM public.preliminary_survey_v2_measurement_assignments a
      JOIN public.preliminary_survey_v2_plans p ON p.id=a.plan_id
      JOIN public.measurement_target_business t ON t.id=p.measurement_target_business_id
      WHERE a.measurement_date=DATE '2026-09-21' ORDER BY a.measurement_date,t.id`);
    const fixedGroup = await query(`SELECT measurement_target_business_id AS target_id,measurement_date,
      assignee_user_id,updated_at FROM public.preliminary_survey_v2_fixed_assignments
      WHERE measurement_date=DATE '2026-09-21' ORDER BY measurement_date,measurement_target_business_id`);
    edited.measurement_edit = true;
    edited.measurement_changed_dates = ["2026-09-21"];
    edited.source_public_assignment_versions = group.map((row) => ({ targetId: Number(row.target_id),
      measurementDate: day(row.measurement_date), assigneeUserId: row.assignee_user_id,
      publicSampleCode: row.public_sample_code, surveyCode: row.survey_code, updatedAtMs: ms(row.updated_at) }));
    edited.source_public_fixed_versions = fixedGroup.map((row) => ({ targetId: Number(row.target_id),
      measurementDate: day(row.measurement_date), assigneeUserId: row.assignee_user_id,
      updatedAtMs: ms(row.updated_at) }));
    const proposed = await proposedPublicGroup(group, 684, 13);
    edited.public_code_impacts = proposed.impacts;
    const assignment = [{ target_id: 684, measurement_date: "2026-09-21", assignee_user_id: 13,
      survey_code: "D", public_sample_code: proposed.next.find((row) => Number(row.target_id) === 684).next_code,
      assignment_origin: "admin_override" }];
    await client.query("SAVEPOINT stale_public_group");
    try {
      const stale = { ...edited, source_public_assignment_versions:
        edited.source_public_assignment_versions.map((row) => row.targetId === 654
          ? { ...row, updatedAtMs: row.updatedAtMs - 1 } : row) };
      await query(`SELECT public.apply_preliminary_survey_v2_reverse_planner(
        $1::uuid, 'local-stale-public-test', 'local-stale-public-test', 'local-stale-public-test',
        $2::jsonb, $3::jsonb, 2, '영향 업체 변경 충돌 시험')`,
      [crypto.randomUUID(), JSON.stringify([stale]), JSON.stringify(assignment)]);
      assert.fail("stale impact group was accepted");
    } catch (error) {
      assert.equal(error.code, "40001");
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT stale_public_group");
    }
    const [result] = await query(`SELECT public.apply_preliminary_survey_v2_reverse_planner(
      $1::uuid, 'local-measurement-edit-test', 'local-measurement-edit-test', 'local-measurement-edit-test',
      $2::jsonb, $3::jsonb, 2, '로컬 공시료 변경과 영향 코드 확인') AS result`,
    [crypto.randomUUID(), JSON.stringify([edited]), JSON.stringify(assignment)]);
    assert.equal(result.result.appliedCount, 1);
    const afterGroup = await query(`SELECT t.code,a.assignee_user_id,a.public_sample_code
      FROM public.preliminary_survey_v2_measurement_assignments a
      JOIN public.preliminary_survey_v2_plans p ON p.id=a.plan_id
      JOIN public.measurement_target_business t ON t.id=p.measurement_target_business_id
      WHERE a.measurement_date=DATE '2026-09-21' ORDER BY t.code`);
    assert.deepEqual(afterGroup.map((row) => [row.code,row.assignee_user_id,row.public_sample_code]),
      [...proposed.next].sort((a,b) => a.code < b.code ? -1 : a.code > b.code ? 1 : 0)
        .map((row) => [row.code,row.assignee_user_id,row.next_code]));
    const [audit] = await query(`SELECT count(*)::integer AS total FROM public.preliminary_survey_v2_planner_audit
      WHERE planner_run_id=$1`, [result.result.plannerRunId]);
    assert.equal(audit.total, proposed.impacts.length);
    console.log("H0176 공시료 변경: 영향 업체 코드·audit 원자 처리 PASS");
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT measurement_edit_test");
  }
  await client.query("SAVEPOINT fixture_measurement_edit_test");
  try {
    const fixture = await source(735, "2026-09-22");
    const group = await query(`SELECT t.id AS target_id,t.code,a.measurement_date,a.assignee_user_id,
      a.survey_code,a.public_sample_code,a.updated_at FROM public.preliminary_survey_v2_measurement_assignments a
      JOIN public.preliminary_survey_v2_plans p ON p.id=a.plan_id
      JOIN public.measurement_target_business t ON t.id=p.measurement_target_business_id
      WHERE a.measurement_date=DATE '2026-09-21' ORDER BY a.measurement_date,t.id`);
    fixture.measurement_edit = true;
    fixture.measurement_changed_dates = ["2026-09-21"];
    fixture.source_public_assignment_versions = group.map((row) => ({ targetId: Number(row.target_id),
      measurementDate: day(row.measurement_date), assigneeUserId: row.assignee_user_id,
      publicSampleCode: row.public_sample_code, surveyCode: row.survey_code, updatedAtMs: ms(row.updated_at) }));
    fixture.source_public_fixed_versions = [];
    fixture.public_code_impacts = (await proposedPublicGroup(group, 735, 15)).impacts;
    const assignment = [{ target_id: 735, measurement_date: "2026-09-21", assignee_user_id: 15,
      survey_code: "A", public_sample_code: "A", assignment_origin: "admin_override" }];
    const [saved] = await query(`SELECT public.apply_preliminary_survey_v2_reverse_planner(
      $1::uuid, 'local-fixture-measurement-test', 'local-fixture-measurement-test', 'local-fixture-measurement-test',
      $2::jsonb, $3::jsonb, 2, '로컬 fixture 공시료 시험') AS result`,
    [crypto.randomUUID(), JSON.stringify([fixture]), JSON.stringify(assignment)]);
    assert.equal(saved.result.appliedCount, 1);
    console.log("ZT9901 공시료 변경 RPC PASS");
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT fixture_measurement_edit_test");
  }
  await client.query("SAVEPOINT fixed_measurement_edit_test");
  try {
    await query(`INSERT INTO public.preliminary_survey_v2_fixed_assignments(
      measurement_target_business_id,measurement_date,assignee_user_id,confirmed_by_user_id,
      confirmation_path,source_fingerprint,source_snapshot)
      VALUES (735,DATE '2026-09-21',13,2,'admin_override','local-fixed-test','{}'::jsonb)`);
    const fixedPlan = await source(735, "2026-09-22");
    const group = await query(`SELECT t.id AS target_id,t.code,a.measurement_date,a.assignee_user_id,
      a.survey_code,a.public_sample_code,a.updated_at FROM public.preliminary_survey_v2_measurement_assignments a
      JOIN public.preliminary_survey_v2_plans p ON p.id=a.plan_id
      JOIN public.measurement_target_business t ON t.id=p.measurement_target_business_id
      WHERE a.measurement_date=DATE '2026-09-21' ORDER BY a.measurement_date,t.id`);
    const [fixedRow] = await query(`SELECT measurement_date,assignee_user_id,updated_at
      FROM public.preliminary_survey_v2_fixed_assignments
      WHERE measurement_target_business_id=735 AND measurement_date=DATE '2026-09-21'`);
    fixedPlan.measurement_edit = true;
    fixedPlan.measurement_changed_dates = ["2026-09-21"];
    fixedPlan.source_public_assignment_versions = group.map((row) => ({ targetId: Number(row.target_id),
      measurementDate: day(row.measurement_date), assigneeUserId: row.assignee_user_id,
      publicSampleCode: row.public_sample_code, surveyCode: row.survey_code, updatedAtMs: ms(row.updated_at) }));
    fixedPlan.source_public_fixed_versions = [{ targetId: 735, measurementDate: day(fixedRow.measurement_date),
      assigneeUserId: fixedRow.assignee_user_id, updatedAtMs: ms(fixedRow.updated_at) }];
    fixedPlan.public_code_impacts = (await proposedPublicGroup(group, 735, 15)).impacts;
    const assignment = [{ target_id: 735, measurement_date: "2026-09-21", assignee_user_id: 15,
      survey_code: "A", public_sample_code: "A", assignment_origin: "admin_override" }];
    await query(`SELECT public.apply_preliminary_survey_v2_reverse_planner(
      $1::uuid, 'local-fixed-measurement-test', 'local-fixed-measurement-test', 'local-fixed-measurement-test',
      $2::jsonb, $3::jsonb, 2, '로컬 고정 공시료 동시 수정 시험')`,
    [crypto.randomUUID(), JSON.stringify([fixedPlan]), JSON.stringify(assignment)]);
    const [afterFixed] = await query(`SELECT assignee_user_id,confirmation_path,source_snapshot FROM public.preliminary_survey_v2_fixed_assignments
      WHERE measurement_target_business_id=735 AND measurement_date=DATE '2026-09-21'`);
    assert.equal(afterFixed.assignee_user_id, 15);
    assert.equal(afterFixed.confirmation_path, "admin_override");
    assert.equal(afterFixed.source_snapshot.nonParticipantConfirmed, true);
    console.log("ZT9901 기존 fixed 배정 동시 수정 PASS");
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT fixed_measurement_edit_test");
  }
  const [otherPlansBefore] = await query(`SELECT md5(string_agg(id::text || updated_at::text, ',' ORDER BY id)) AS digest
    FROM public.preliminary_survey_v2_plans WHERE measurement_target_business_id NOT IN (684,654)`);
  for (const [code, targetId, newDate] of [["H0176", 684, "2026-09-09"], ["H0215", 654, "2026-09-15"]]) {
    const plan = await source(targetId, newDate);
    const currentAssignments = await query(`SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'measurementDate', assignment.measurement_date::text,
      'assigneeUserId', assignment.assignee_user_id,
      'surveyCode', assignment.survey_code,
      'publicSampleCode', assignment.public_sample_code,
      'updatedAtMs', floor(extract(epoch FROM assignment.updated_at) * 1000)::bigint)
      ORDER BY assignment.measurement_date), '[]'::jsonb) AS baseline
      FROM public.preliminary_survey_v2_measurement_assignments assignment WHERE assignment.plan_id=$1`,
      [plan.before_snapshot.id]);
    assert.deepEqual(plan.source_target_assignments, currentAssignments[0].baseline);
    const before = await query(`SELECT (SELECT count(*) FROM public.preliminary_survey_v2_planner_audit WHERE target_id=$1) AS audits,
      (SELECT count(*) FROM public.preliminary_survey_v2_measurement_assignments WHERE plan_id=$2) AS assignments,
      (SELECT count(*) FROM public.preliminary_survey_v2_fixed_assignments WHERE measurement_target_business_id=$1) AS fixed`,
      [targetId, plan.before_snapshot.id]);
    const [assignmentBefore] = await query(`SELECT md5(string_agg(to_jsonb(a)::text, ',' ORDER BY a.measurement_date)) AS digest
      FROM public.preliminary_survey_v2_measurement_assignments a WHERE a.plan_id=$1`, [plan.before_snapshot.id]);
    await client.query("SAVEPOINT expected_failure");
    try {
      const invalid = { ...plan, participant_user_ids: [999999], responsible_user_id: 999999 };
      await query(`SELECT public.apply_preliminary_survey_v2_reverse_planner(
        $1::uuid, 'local-transaction-test', 'local-transaction-test', 'local-transaction-test',
        $2::jsonb, '[]'::jsonb, 2, '비활성·부재 직원 차단 시험')`,
      [crypto.randomUUID(), JSON.stringify([invalid])]);
      assert.fail("invalid employee was accepted");
    } catch (error) {
      assert.equal(error.code, "22023");
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT expected_failure");
    }
    const runId = crypto.randomUUID();
    const saved = await query(`SELECT public.apply_preliminary_survey_v2_reverse_planner(
      $1::uuid, 'local-transaction-test', 'local-transaction-test', 'local-transaction-test',
      $2::jsonb, '[]'::jsonb, 2, '로컬 트랜잭션 관리자 수정 검증') AS result`, [runId, JSON.stringify([plan])]);
    assert.equal(saved[0].result.appliedCount, 1);
    const after = await query(`SELECT p.recommended_date,
      (SELECT count(*) FROM public.preliminary_survey_v2_planner_audit WHERE target_id=$1) AS audits,
      (SELECT count(*) FROM public.preliminary_survey_v2_measurement_assignments WHERE plan_id=p.id) AS assignments,
      (SELECT count(*) FROM public.preliminary_survey_v2_fixed_assignments WHERE measurement_target_business_id=$1) AS fixed
      FROM public.preliminary_survey_v2_plans p WHERE p.measurement_target_business_id=$1`, [targetId]);
    assert.equal(day(after[0].recommended_date), newDate);
    assert.equal(Number(after[0].audits), Number(before[0].audits) + 1);
    assert.equal(Number(after[0].assignments), Number(before[0].assignments));
    assert.equal(Number(after[0].fixed), Number(before[0].fixed));
    const [assignmentAfter] = await query(`SELECT md5(string_agg(to_jsonb(a)::text, ',' ORDER BY a.measurement_date)) AS digest
      FROM public.preliminary_survey_v2_measurement_assignments a WHERE a.plan_id=$1`, [plan.before_snapshot.id]);
    assert.equal(assignmentAfter.digest, assignmentBefore.digest);
    await client.query("SAVEPOINT expected_failure");
    try {
      await query(`SELECT public.apply_preliminary_survey_v2_reverse_planner(
        $1::uuid, 'local-transaction-test', 'local-transaction-test', 'local-transaction-test',
        $2::jsonb, '[]'::jsonb, 2, '중복 저장 차단 시험')`, [runId, JSON.stringify([plan])]);
      assert.fail("duplicate request was accepted");
    } catch (error) {
      assert.equal(error.code, "40001");
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT expected_failure");
    }
    await client.query("SAVEPOINT expected_failure");
    try {
      await query(`SELECT public.apply_preliminary_survey_v2_reverse_planner(
        $1::uuid, 'local-transaction-test', 'local-transaction-test', 'local-transaction-test',
        $2::jsonb, '[]'::jsonb, 2, '구버전 원천 차단 시험')`,
      [crypto.randomUUID(), JSON.stringify([plan])]);
      assert.fail("stale source was accepted");
    } catch (error) {
      assert.equal(error.code, "40001");
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT expected_failure");
    }
    await client.query("SAVEPOINT expected_failure");
    try {
      await query(`SELECT public.apply_preliminary_survey_v2_reverse_planner(
        $1::uuid, 'local-transaction-test', 'local-transaction-test', 'local-transaction-test',
        $2::jsonb, '[]'::jsonb, 13, '비관리자 저장 차단 시험')`, [crypto.randomUUID(), JSON.stringify([plan])]);
      assert.fail("non-admin request was accepted");
    } catch (error) {
      assert.equal(error.code, "42501");
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT expected_failure");
    }
    console.log(`${code}: plan + audit atomic, assignment/fixed preserved`);
  }
  const [otherPlansAfter] = await query(`SELECT md5(string_agg(id::text || updated_at::text, ',' ORDER BY id)) AS digest
    FROM public.preliminary_survey_v2_plans WHERE measurement_target_business_id NOT IN (684,654)`);
  assert.equal(otherPlansAfter.digest, otherPlansBefore.digest);
} finally {
  await client.query("ROLLBACK");
  await client.end();
}
console.log("Docker Local RPC test rolled back");
