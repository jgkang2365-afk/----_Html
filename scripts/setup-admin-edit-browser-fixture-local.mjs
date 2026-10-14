// Isolated Docker Local fixture for a real browser save. Never run against a remote DB.
import assert from "node:assert/strict";
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.development.local", quiet: true });
assert.match(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", /^http:\/\/127\.0\.0\.1:/);
const code = "ZT9901";
const name = "[LOCAL TEST] 예비조사 관리자 수정";
const db = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:55322/postgres" });
await db.connect();
try {
  await db.query("BEGIN");
  const existing = await db.query("SELECT id, business_name FROM public.measurement_target_business WHERE code=$1", [code]);
  if (existing.rowCount) {
    assert.equal(existing.rows[0].business_name, name);
    await db.query(`UPDATE public.measurement_target_business fixture SET is_registered = source.is_registered
      FROM public.measurement_target_business source WHERE fixture.id=$1 AND source.id=684
        AND fixture.is_registered IS DISTINCT FROM source.is_registered`, [existing.rows[0].id]);
    console.log(`Existing Docker Local fixture: ${code}, target=${existing.rows[0].id}`);
  } else {
    const source = await db.query(`SELECT t.id, t.code, t.year, t.period, p.id AS plan_id
      FROM public.measurement_target_business t
      JOIN public.preliminary_survey_v2_plans p ON p.measurement_target_business_id=t.id
      WHERE t.id=684 AND t.code='H0176' AND t.measurement_date='2026-09-21'`);
    assert.equal(source.rowCount, 1, "H0176 source changed; fixture creation stopped");
    await db.query("INSERT INTO public.business_info(code, business_name) VALUES ($1,$2)", [code, name]);
    const target = await db.query(`INSERT INTO public.measurement_target_business(
        code, year, period, business_name, measurement_date, measurement_start_date,
        measurement_end_date, measurer_id, collaborators, daily_staff,
        preliminary_survey_rule_type, business_type, requires_field_preliminary_survey, address,
        is_registered
      ) SELECT $1, year, period, $2, measurement_date, measurement_start_date,
        measurement_end_date, measurer_id, collaborators, daily_staff,
        preliminary_survey_rule_type, business_type, requires_field_preliminary_survey, address,
        is_registered
      FROM public.measurement_target_business WHERE id=684 RETURNING id`, [code, name]);
    assert.equal(target.rowCount, 1);
    const targetId = target.rows[0].id;
    const plan = await db.query(`INSERT INTO public.preliminary_survey_v2_plans(
        measurement_target_business_id, recommended_date, responsible_user_id,
        experienced_reviewer_id, participant_user_ids, participant_names, status,
        plan_origin, source_measurement_date, source_responsible_user_id,
        source_rule_type, survey_method, recommendation_reason, route_evidence, warnings
      ) SELECT $1, recommended_date, responsible_user_id, experienced_reviewer_id,
        participant_user_ids, participant_names, status, plan_origin,
        source_measurement_date, source_responsible_user_id, source_rule_type,
        survey_method, recommendation_reason, route_evidence, warnings
      FROM public.preliminary_survey_v2_plans WHERE id=$2 RETURNING id`,
      [targetId, source.rows[0].plan_id]);
    assert.equal(plan.rowCount, 1);
    await db.query(`INSERT INTO public.preliminary_survey_v2_measurement_assignments(
        plan_id, measurement_date, assignee_user_id, survey_code,
        assignment_reason, public_sample_code
      ) VALUES ($1, DATE '2026-09-21', 16, 'F', 'Docker Local 관리자 수정 브라우저 fixture', 'F')`,
      [plan.rows[0].id]);
    await db.query(`INSERT INTO public.measurement_journal(
        code, measurement_year, measurement_period, designated_office,
        business_name, measurement_start_date, measurement_end_date
      ) SELECT $1, measurement_year, measurement_period, designated_office,
        $2, measurement_start_date, measurement_end_date
      FROM public.measurement_journal WHERE code='H0176'
        AND measurement_year=$3 AND measurement_period=$4`,
      [code, name, source.rows[0].year, source.rows[0].period]);
    console.log(`Created Docker Local fixture: ${code}, target=${targetId}`);
  }
  await db.query("COMMIT");
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  await db.end();
}
