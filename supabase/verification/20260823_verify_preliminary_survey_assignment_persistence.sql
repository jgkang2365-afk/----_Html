\set ON_ERROR_STOP on

-- Local Supabase only. Run after all PR #42 migrations on a disposable/reset DB.
-- This script rolls back its test fixtures and never targets a linked project.
BEGIN;

INSERT INTO public.users (id, name, role, is_active, survey_code, is_preliminary_survey_manager)
VALUES
  (9901, 'PR42 관리자 C', '관리자', true, 'C', true),
  (9902, 'PR42 측정자 G', '사용자', true, 'G', false)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  role = EXCLUDED.role,
  is_active = EXCLUDED.is_active,
  survey_code = EXCLUDED.survey_code,
  is_preliminary_survey_manager = EXCLUDED.is_preliminary_survey_manager;

INSERT INTO public.measurement_target_business (
  id, year, period, code, business_name, measurement_date, measurement_end_date,
  measurer_id, collaborators, address
)
SELECT fixture.id, 2026, '하반기', 'PR42-' || fixture.id::text,
  'PR42 Local ' || fixture.id::text, fixture.measurement_date::text,
  fixture.measurement_date, 9901, 'PR42 관리자 C', 'PR42 검증 주소'
FROM (
  SELECT series AS id,
    ('2026-09-10'::date + ((series - 991001) / 10)::integer) AS measurement_date
  FROM generate_series(991001, 991099) series
) fixture
ON CONFLICT (id) DO UPDATE SET
  measurement_date = EXCLUDED.measurement_date,
  measurement_end_date = EXCLUDED.measurement_end_date,
  measurer_id = EXCLUDED.measurer_id,
  collaborators = EXCLUDED.collaborators,
  address = EXCLUDED.address;

CREATE OR REPLACE FUNCTION pg_temp.pr42_plan_payload(p_target_ids bigint[])
RETURNS jsonb LANGUAGE sql AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'measurement_target_business_id', business.id,
    'target_id', business.id,
    'recommended_date', (business.measurement_date::date - 7)::text,
    'responsible_user_id', 9901,
    'experienced_reviewer_id', NULL,
    'participant_user_ids', jsonb_build_array(9901),
    'participant_names', jsonb_build_array('PR42 관리자 C'),
    'status', 'recommended',
    'plan_origin', 'automatic',
    'source_measurement_date', business.measurement_date,
    'source_responsible_user_id', 9901,
    'source_rule_type', 'existing',
    'survey_method', 'phone',
    'recommendation_reason', '{}'::jsonb,
    'route_evidence', '{}'::jsonb,
    'warnings', '[]'::jsonb,
    'source_address', business.address,
    'source_daily_staff', business.daily_staff,
    'source_collaborators', business.collaborators
  ) ORDER BY business.id), '[]'::jsonb)
  FROM public.measurement_target_business business
  WHERE business.id = ANY(p_target_ids);
$$;

CREATE OR REPLACE FUNCTION pg_temp.pr42_assignment_payload(
  p_target_ids bigint[], p_assignee_ids integer[], p_dates date[]
) RETURNS jsonb LANGUAGE sql AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'measurement_target_business_id', target_id,
    'measurement_date', measurement_date::text,
    'assignee_user_id', assignee_user_id,
    'survey_code', CASE assignee_user_id WHEN 9901 THEN 'C' ELSE 'G' END,
    'assignment_reason', 'PR42_LOCAL_REGRESSION'
  ) ORDER BY ordinal), '[]'::jsonb)
  FROM unnest(p_target_ids, p_assignee_ids, p_dates)
    WITH ORDINALITY AS payload(target_id, assignee_user_id, measurement_date, ordinal);
$$;

CREATE OR REPLACE FUNCTION pg_temp.pr42_assignment_baseline(
  p_target_ids bigint[], p_dates date[]
) RETURNS jsonb LANGUAGE sql AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'targetId', target_plan.measurement_target_business_id,
    'measurementDate', assignment.measurement_date::text,
    'userId', assignment.assignee_user_id
  ) ORDER BY target_plan.measurement_target_business_id,
    assignment.measurement_date, assignment.assignee_user_id), '[]'::jsonb)
  FROM public.preliminary_survey_v2_measurement_assignments assignment
  JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
  WHERE assignment.measurement_date = ANY(p_dates)
    AND NOT (target_plan.measurement_target_business_id = ANY(p_target_ids));
$$;

CREATE OR REPLACE FUNCTION pg_temp.pr42_apply(
  p_target_ids bigint[], p_assignee_ids integer[], p_dates date[],
  p_approve boolean DEFAULT false, p_approver integer DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM * FROM public.persist_preliminary_survey_v2_plan_and_assignment_groups(
    pg_temp.pr42_plan_payload(p_target_ids),
    pg_temp.pr42_assignment_payload(p_target_ids, p_assignee_ids, p_dates),
    pg_temp.pr42_assignment_baseline(p_target_ids, p_dates),
    p_approve,
    p_approver
  );
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.pr42_assert(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS NOT TRUE THEN
    RAISE EXCEPTION 'PR42_ASSERT_FAILED: %', p_message;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.pr42_seed_legacy_four(
  p_target_ids bigint[], p_assignee_id integer, p_date date
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM * FROM public.persist_preliminary_survey_v2_plan_batch_unlocked(
    pg_temp.pr42_plan_payload(p_target_ids)
  );
  INSERT INTO public.preliminary_survey_v2_measurement_assignments (
    plan_id, measurement_date, assignee_user_id, survey_code, assignment_reason,
    approval_required, approval_group_fingerprint, approved_by_user_id, approved_at
  )
  SELECT target_plan.id, p_date, p_assignee_id,
    CASE p_assignee_id WHEN 9901 THEN 'C' ELSE 'G' END,
    'PR42_LEGACY_FOUR', false, NULL, NULL, NULL
  FROM public.preliminary_survey_v2_plans target_plan
  WHERE target_plan.measurement_target_business_id = ANY(p_target_ids);
END;
$$;

-- TEST 1~6: alias collision, 1/2/3 metadata, approval required, approval, exact-group preservation.
SELECT pg_temp.pr42_apply(ARRAY[991001]::bigint[], ARRAY[9901], ARRAY['2026-09-10'::date]);
SELECT pg_temp.pr42_assert((
  SELECT count(*) = 1 AND bool_and(NOT assignment.approval_required
    AND assignment.approval_group_fingerprint IS NULL
    AND assignment.approved_by_user_id IS NULL AND assignment.approved_at IS NULL)
  FROM public.preliminary_survey_v2_measurement_assignments assignment
  JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
  WHERE target_plan.measurement_target_business_id = 991001
), 'TEST 1/2: core 호출과 1건 metadata');

SELECT pg_temp.pr42_apply(
  ARRAY[991001,991002]::bigint[], ARRAY[9901,9901],
  ARRAY['2026-09-10'::date,'2026-09-10'::date]
);
SELECT pg_temp.pr42_assert((
  SELECT count(*) = 2 AND bool_and(NOT assignment.approval_required
    AND assignment.approval_group_fingerprint IS NULL
    AND assignment.approved_by_user_id IS NULL AND assignment.approved_at IS NULL)
  FROM public.preliminary_survey_v2_measurement_assignments assignment
  JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
  WHERE target_plan.measurement_target_business_id = ANY(ARRAY[991001,991002]::bigint[])
), 'TEST 3: 2건 metadata');

DO $test$
DECLARE before_count integer;
BEGIN
  SELECT count(*) INTO before_count
  FROM public.preliminary_survey_v2_measurement_assignments assignment
  JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
  WHERE target_plan.measurement_target_business_id = ANY(ARRAY[991001,991002,991003]::bigint[]);
  BEGIN
    PERFORM pg_temp.pr42_apply(
      ARRAY[991001,991002,991003]::bigint[], ARRAY[9901,9901,9901],
      ARRAY['2026-09-10'::date,'2026-09-10'::date,'2026-09-10'::date]
    );
    RAISE EXCEPTION 'TEST 4 expected approval error';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'MEASUREMENT_ASSIGNMENT_APPROVAL_REQUIRED' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.pr42_assert((
    SELECT count(*) = before_count
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
    WHERE target_plan.measurement_target_business_id = ANY(ARRAY[991001,991002,991003]::bigint[])
  ), 'TEST 4/16: 승인 부족 atomic rollback');
END;
$test$;

SELECT pg_temp.pr42_apply(
  ARRAY[991001,991002,991003]::bigint[], ARRAY[9901,9901,9901],
  ARRAY['2026-09-10'::date,'2026-09-10'::date,'2026-09-10'::date], true, 9901
);
SELECT pg_temp.pr42_assert((
  SELECT count(*) FILTER (WHERE assignment.approval_required) = 1
    AND count(*) FILTER (WHERE assignment.approval_group_fingerprint ~ '^[a-f0-9]{32}$') = 1
    AND count(*) FILTER (WHERE assignment.approved_by_user_id = 9901 AND assignment.approved_at IS NOT NULL) = 1
  FROM public.preliminary_survey_v2_measurement_assignments assignment
  JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
  WHERE target_plan.measurement_target_business_id = ANY(ARRAY[991001,991002,991003]::bigint[])
), 'TEST 5: 신규 3건 승인');

DO $test$
DECLARE old_fingerprint text; old_approver integer; old_approved_at timestamptz;
BEGIN
  SELECT assignment.approval_group_fingerprint, assignment.approved_by_user_id, assignment.approved_at
  INTO old_fingerprint, old_approver, old_approved_at
  FROM public.preliminary_survey_v2_measurement_assignments assignment
  JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
  WHERE target_plan.measurement_target_business_id = ANY(ARRAY[991001,991002,991003]::bigint[])
    AND assignment.approval_required;
  PERFORM pg_temp.pr42_apply(
    ARRAY[991001,991002,991003]::bigint[], ARRAY[9901,9901,9901],
    ARRAY['2026-09-10'::date,'2026-09-10'::date,'2026-09-10'::date]
  );
  PERFORM pg_temp.pr42_assert(EXISTS (
    SELECT 1 FROM public.preliminary_survey_v2_measurement_assignments assignment
    WHERE assignment.approval_required
      AND assignment.approval_group_fingerprint = old_fingerprint
      AND assignment.approved_by_user_id = old_approver
      AND assignment.approved_at = old_approved_at
  ), 'TEST 6: exact 3건 승인 보존');
END;
$test$;

-- TEST 7/9/11/15: approved 3건에서 한 target을 다른 assignee로 이동.
SELECT pg_temp.pr42_apply(
  ARRAY[991003]::bigint[], ARRAY[9902], ARRAY['2026-09-10'::date]
);
SELECT pg_temp.pr42_assert((
  SELECT count(*) = 3 AND bool_and(NOT assignment.approval_required
    AND assignment.approval_group_fingerprint IS NULL
    AND assignment.approved_by_user_id IS NULL AND assignment.approved_at IS NULL)
  FROM public.preliminary_survey_v2_measurement_assignments assignment
  JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
  WHERE target_plan.measurement_target_business_id = ANY(ARRAY[991001,991002,991003]::bigint[])
), 'TEST 7/9/11/15: old/new group 정규화와 stale fingerprint 제거');

-- TEST 8: A,B,C 승인 후 C를 다른 assignee로 이동하고 D를 넣으면 새 승인이 필요하다.
SELECT pg_temp.pr42_apply(
  ARRAY[991011,991012,991013]::bigint[], ARRAY[9901,9901,9901],
  ARRAY['2026-09-11'::date,'2026-09-11'::date,'2026-09-11'::date], true, 9901
);
DO $test$
DECLARE old_fingerprint text;
BEGIN
  SELECT assignment.approval_group_fingerprint INTO old_fingerprint
  FROM public.preliminary_survey_v2_measurement_assignments assignment
  JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
  WHERE target_plan.measurement_target_business_id = ANY(ARRAY[991011,991012,991013]::bigint[])
    AND assignment.approval_required;
  BEGIN
    PERFORM pg_temp.pr42_apply(
      ARRAY[991013,991014]::bigint[], ARRAY[9902,9901],
      ARRAY['2026-09-11'::date,'2026-09-11'::date]
    );
    RAISE EXCEPTION 'TEST 8 expected replacement approval error';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'MEASUREMENT_ASSIGNMENT_APPROVAL_REQUIRED' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.pr42_apply(
    ARRAY[991013,991014]::bigint[], ARRAY[9902,9901],
    ARRAY['2026-09-11'::date,'2026-09-11'::date], true, 9901
  );
  PERFORM pg_temp.pr42_assert(EXISTS (
    SELECT 1 FROM public.preliminary_survey_v2_measurement_assignments assignment
    WHERE assignment.approval_required
      AND assignment.approval_group_fingerprint IS DISTINCT FROM old_fingerprint
  ), 'TEST 8: target 교체 새 fingerprint');
END;
$test$;

-- TEST 10: 측정일 변경은 old 3건 승인을 제거한다.
SELECT pg_temp.pr42_apply(
  ARRAY[991021,991022,991023]::bigint[], ARRAY[9901,9901,9901],
  ARRAY['2026-09-12'::date,'2026-09-12'::date,'2026-09-12'::date], true, 9901
);
UPDATE public.measurement_target_business
SET measurement_date = '2026-09-13', measurement_end_date = '2026-09-13'
WHERE id = 991023;
SELECT pg_temp.pr42_apply(ARRAY[991023]::bigint[], ARRAY[9901], ARRAY['2026-09-13'::date]);
SELECT pg_temp.pr42_assert((
  SELECT bool_and(NOT assignment.approval_required
    AND assignment.approval_group_fingerprint IS NULL
    AND assignment.approved_by_user_id IS NULL AND assignment.approved_at IS NULL)
  FROM public.preliminary_survey_v2_measurement_assignments assignment
  JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
  WHERE target_plan.measurement_target_business_id = ANY(ARRAY[991021,991022,991023]::bigint[])
), 'TEST 10: 날짜 변경 승인 무효화');

-- TEST 12/16: 4건 hard max는 승인 flag로 우회할 수 없고 부분 저장이 없다.
DO $test$
BEGIN
  BEGIN
    PERFORM pg_temp.pr42_apply(
      ARRAY[991031,991032,991033,991034]::bigint[], ARRAY[9901,9901,9901,9901],
      ARRAY['2026-09-13'::date,'2026-09-13'::date,'2026-09-13'::date,'2026-09-13'::date],
      true, 9901
    );
    RAISE EXCEPTION 'TEST 12 expected hard max error';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'MEASUREMENT_ASSIGNMENT_HARD_MAX_EXCEEDED' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.pr42_assert(NOT EXISTS (
    SELECT 1 FROM public.preliminary_survey_v2_plans
    WHERE measurement_target_business_id = ANY(ARRAY[991031,991032,991033,991034]::bigint[])
  ), 'TEST 12/16: hard max atomic rollback');
END;
$test$;

-- TEST 13: unrelated 다른 날짜 legacy 4건은 정상 apply를 막지 않는다.
SELECT pg_temp.pr42_seed_legacy_four(
  ARRAY[991041,991042,991043,991044]::bigint[], 9902, '2026-09-14'::date
);
SELECT pg_temp.pr42_apply(ARRAY[991051]::bigint[], ARRAY[9901], ARRAY['2026-09-15'::date]);
SELECT pg_temp.pr42_assert(EXISTS (
  SELECT 1 FROM public.preliminary_survey_v2_measurement_assignments assignment
  JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
  WHERE target_plan.measurement_target_business_id = 991051
), 'TEST 13: unrelated date legacy 4건 허용');
SELECT pg_temp.pr42_assert((
  SELECT count(*) = 4 AND bool_and(assignment.assignee_user_id = 9902
    AND NOT assignment.approval_required
    AND assignment.approval_group_fingerprint IS NULL
    AND assignment.approved_by_user_id IS NULL AND assignment.approved_at IS NULL)
  FROM public.preliminary_survey_v2_measurement_assignments assignment
  JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
  WHERE target_plan.measurement_target_business_id = ANY(ARRAY[991041,991042,991043,991044]::bigint[])
), 'TEST 13: unrelated date legacy 4건 불변');

-- TEST 14: 같은 날짜라도 다른 assignee legacy 4건은 정상 apply를 막지 않는다.
SELECT pg_temp.pr42_seed_legacy_four(
  ARRAY[991061,991062,991063,991064]::bigint[], 9902, '2026-09-16'::date
);
SELECT pg_temp.pr42_apply(ARRAY[991065]::bigint[], ARRAY[9901], ARRAY['2026-09-16'::date]);
SELECT pg_temp.pr42_assert(EXISTS (
  SELECT 1 FROM public.preliminary_survey_v2_measurement_assignments assignment
  JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
  WHERE target_plan.measurement_target_business_id = 991065
), 'TEST 14: same date unrelated assignee legacy 4건 허용');
SELECT pg_temp.pr42_assert((
  SELECT count(*) = 4 AND bool_and(assignment.assignee_user_id = 9902
    AND NOT assignment.approval_required
    AND assignment.approval_group_fingerprint IS NULL
    AND assignment.approved_by_user_id IS NULL AND assignment.approved_at IS NULL)
  FROM public.preliminary_survey_v2_measurement_assignments assignment
  JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
  WHERE target_plan.measurement_target_business_id = ANY(ARRAY[991061,991062,991063,991064]::bigint[])
), 'TEST 14: same date unrelated assignee legacy 4건 불변');

-- NEW TEST A: old legacy 4→3은 old group의 신규 승인이 필요하며 실패는 원자적이다.
SELECT pg_temp.pr42_seed_legacy_four(
  ARRAY[991081,991082,991083,991084]::bigint[], 9901, '2026-09-18'::date
);
DO $test$
DECLARE before_plan jsonb; before_assignments jsonb;
BEGIN
  SELECT to_jsonb(target_plan) INTO before_plan
  FROM public.preliminary_survey_v2_plans target_plan
  WHERE target_plan.measurement_target_business_id = 991084;
  SELECT jsonb_agg(to_jsonb(snapshot) ORDER BY snapshot.target_id) INTO before_assignments
  FROM (
    SELECT target_plan.measurement_target_business_id AS target_id, assignment.*
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
    WHERE target_plan.measurement_target_business_id = ANY(ARRAY[991081,991082,991083,991084]::bigint[])
  ) snapshot;
  BEGIN
    PERFORM pg_temp.pr42_apply(
      ARRAY[991084]::bigint[], ARRAY[9902], ARRAY['2026-09-18'::date]
    );
    RAISE EXCEPTION 'NEW TEST A expected approval error';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'MEASUREMENT_ASSIGNMENT_APPROVAL_REQUIRED' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.pr42_assert(before_plan = (
    SELECT to_jsonb(target_plan)
    FROM public.preliminary_survey_v2_plans target_plan
    WHERE target_plan.measurement_target_business_id = 991084
  ), 'NEW TEST A: plan atomic rollback');
  PERFORM pg_temp.pr42_assert(before_assignments = (
    SELECT jsonb_agg(to_jsonb(snapshot) ORDER BY snapshot.target_id)
    FROM (
      SELECT target_plan.measurement_target_business_id AS target_id, assignment.*
      FROM public.preliminary_survey_v2_measurement_assignments assignment
      JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
      WHERE target_plan.measurement_target_business_id = ANY(ARRAY[991081,991082,991083,991084]::bigint[])
    ) snapshot
  ), 'NEW TEST A: assignment/approval atomic rollback');
END;
$test$;

-- NEW TEST B: 같은 old 4→3을 관리자가 승인하면 old/new 그룹을 모두 정상화한다.
SELECT pg_temp.pr42_apply(
  ARRAY[991084]::bigint[], ARRAY[9902], ARRAY['2026-09-18'::date], true, 9901
);
SELECT pg_temp.pr42_assert((
  SELECT count(*) = 3
    AND count(*) FILTER (WHERE assignment.approval_required) = 1
    AND count(*) FILTER (WHERE assignment.approval_group_fingerprint =
      md5('2026-09-18|9901|991081,991082,991083')) = 1
    AND count(*) FILTER (WHERE assignment.approved_by_user_id = 9901
      AND assignment.approved_at IS NOT NULL) = 1
  FROM public.preliminary_survey_v2_measurement_assignments assignment
  JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
  WHERE target_plan.measurement_target_business_id = ANY(ARRAY[991081,991082,991083]::bigint[])
), 'NEW TEST B: old 4→3 canonical 승인');
SELECT pg_temp.pr42_assert((
  SELECT count(*) = 1 AND bool_and(NOT assignment.approval_required
    AND assignment.approval_group_fingerprint IS NULL
    AND assignment.approved_by_user_id IS NULL AND assignment.approved_at IS NULL)
  FROM public.preliminary_survey_v2_measurement_assignments assignment
  JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
  WHERE target_plan.measurement_target_business_id = 991084
    AND assignment.assignee_user_id = 9902
), 'NEW TEST B: new 1건 metadata');

-- NEW TEST C: old legacy 5→4는 승인 flag와 관계없이 차단하고 전체 rollback한다.
SELECT pg_temp.pr42_seed_legacy_four(
  ARRAY[991091,991092,991093,991094,991095]::bigint[], 9901, '2026-09-19'::date
);
DO $test$
DECLARE before_plan jsonb; before_assignments jsonb;
BEGIN
  SELECT to_jsonb(target_plan) INTO before_plan
  FROM public.preliminary_survey_v2_plans target_plan
  WHERE target_plan.measurement_target_business_id = 991095;
  SELECT jsonb_agg(to_jsonb(snapshot) ORDER BY snapshot.target_id) INTO before_assignments
  FROM (
    SELECT target_plan.measurement_target_business_id AS target_id, assignment.*
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
    WHERE target_plan.measurement_target_business_id = ANY(ARRAY[991091,991092,991093,991094,991095]::bigint[])
  ) snapshot;
  BEGIN
    PERFORM pg_temp.pr42_apply(
      ARRAY[991095]::bigint[], ARRAY[9902], ARRAY['2026-09-19'::date], true, 9901
    );
    RAISE EXCEPTION 'NEW TEST C expected hard max error';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'MEASUREMENT_ASSIGNMENT_HARD_MAX_EXCEEDED' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.pr42_assert(before_plan = (
    SELECT to_jsonb(target_plan)
    FROM public.preliminary_survey_v2_plans target_plan
    WHERE target_plan.measurement_target_business_id = 991095
  ), 'NEW TEST C: plan atomic rollback');
  PERFORM pg_temp.pr42_assert(before_assignments = (
    SELECT jsonb_agg(to_jsonb(snapshot) ORDER BY snapshot.target_id)
    FROM (
      SELECT target_plan.measurement_target_business_id AS target_id, assignment.*
      FROM public.preliminary_survey_v2_measurement_assignments assignment
      JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
      WHERE target_plan.measurement_target_business_id = ANY(ARRAY[991091,991092,991093,991094,991095]::bigint[])
    ) snapshot
  ), 'NEW TEST C: assignment/approval atomic rollback');
END;
$test$;

-- TEST 17: measurement_journal 기반 true-confirmed lock 유지.
SELECT pg_temp.pr42_apply(ARRAY[991072]::bigint[], ARRAY[9901], ARRAY['2026-09-17'::date]);
INSERT INTO public.business_info (code, business_name)
VALUES ('PR42-991072', 'PR42 Local 991072');
INSERT INTO public.measurement_journal (
  code, measurement_year, measurement_period, designated_office, business_name
) VALUES ('PR42-991072', 2026, '하반기', 'PR42 검증기관', 'PR42 Local 991072');
DO $test$
BEGIN
  BEGIN
    PERFORM pg_temp.pr42_apply(ARRAY[991072]::bigint[], ARRAY[9902], ARRAY['2026-09-17'::date]);
    RAISE EXCEPTION 'TEST 17 expected true-confirmed lock';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'TRUE_CONFIRMED_LOCKED' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.pr42_assert((
    SELECT assignment.assignee_user_id = 9901
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
    WHERE target_plan.measurement_target_business_id = 991072
  ), 'TEST 17: true-confirmed rollback');
END;
$test$;

SELECT 'PR42_ASSIGNMENT_PERSISTENCE_VERIFICATION_OK' AS result;
ROLLBACK;
