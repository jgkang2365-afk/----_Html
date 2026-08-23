-- PR #42 forward-only assignment persistence fix.
--
-- 1. PL/pgSQL 변수와 SQL relation alias의 `plan` 이름 충돌을 제거한다.
-- 2. 승인 metadata를 최종 (measurement_date, assignee_user_id, sorted target_ids)
--    그룹으로 계산해 모든 INSERT/UPDATE 중간 row가 CHECK-valid하도록 저장한다.
--
-- 기존 CHECK, true-confirmed guard, wrapper RPC와 과거 migration은 변경하지 않는다.

CREATE OR REPLACE FUNCTION public.persist_preliminary_survey_v2_plan_and_measurement_assignments(
  p_plans jsonb,
  p_assignments jsonb,
  p_assignment_baseline jsonb,
  p_approve_third_assignment boolean DEFAULT false,
  p_approved_by_user_id integer DEFAULT NULL
) RETURNS SETOF public.preliminary_survey_v2_plans
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  assignment_item jsonb;
  plan_item jsonb;
  business_row public.measurement_target_business;
  configured_survey_code text;
  legacy_plans jsonb;
  expected_measurement_dates text[];
  current_assignment_baseline jsonb;
  hard_max_exceeded boolean;
  new_approval_required boolean;
BEGIN
  IF p_plans IS NULL OR jsonb_typeof(p_plans) <> 'array' OR jsonb_array_length(p_plans) = 0
     OR p_assignments IS NULL OR jsonb_typeof(p_assignments) <> 'array'
     OR p_assignment_baseline IS NULL OR jsonb_typeof(p_assignment_baseline) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PLAN_ASSIGNMENT_PAYLOAD';
  END IF;
  IF p_approve_third_assignment AND NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_approved_by_user_id
      AND (role = '관리자' OR is_preliminary_survey_manager IS TRUE)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_ASSIGNMENT_APPROVER';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_assignments) assignment_payload
    GROUP BY assignment_payload->>'measurement_target_business_id', assignment_payload->>'measurement_date'
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DUPLICATE_MEASUREMENT_ASSIGNMENT';
  END IF;

  FOR assignment_item IN
    SELECT DISTINCT jsonb_build_object('measurement_date', value->>'measurement_date')
    FROM jsonb_array_elements(p_assignments)
    ORDER BY jsonb_build_object('measurement_date', value->>'measurement_date')
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'preliminary-measurement-assignment|' || COALESCE(assignment_item->>'measurement_date', ''), 0));
  END LOOP;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'targetId', existing_plan.measurement_target_business_id,
      'measurementDate', existing_assignment.measurement_date::text,
      'userId', existing_assignment.assignee_user_id
    ) ORDER BY existing_plan.measurement_target_business_id,
      existing_assignment.measurement_date, existing_assignment.assignee_user_id), '[]'::jsonb)
  INTO current_assignment_baseline
  FROM public.preliminary_survey_v2_measurement_assignments existing_assignment
  JOIN public.preliminary_survey_v2_plans existing_plan ON existing_plan.id = existing_assignment.plan_id
  WHERE existing_assignment.measurement_date IN (
    SELECT DISTINCT (assignment_payload->>'measurement_date')::date
    FROM jsonb_array_elements(p_assignments) assignment_payload
  ) AND existing_plan.measurement_target_business_id NOT IN (
    SELECT DISTINCT (plan_payload->>'measurement_target_business_id')::bigint
    FROM jsonb_array_elements(p_plans) plan_payload
  );
  IF current_assignment_baseline IS DISTINCT FROM p_assignment_baseline THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DRAFT_ASSIGNMENT_BASELINE_CHANGED';
  END IF;

  FOR plan_item IN SELECT value FROM jsonb_array_elements(p_plans) LOOP
    IF (plan_item->>'measurement_target_business_id') IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PLAN_BUSINESS_ID_REQUIRED';
    END IF;
    SELECT * INTO business_row
    FROM public.measurement_target_business target_business
    WHERE target_business.id = (plan_item->>'measurement_target_business_id')::bigint
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'TARGET_NOT_FOUND';
    END IF;
    IF (plan_item->>'source_address') IS DISTINCT FROM business_row.address
       OR COALESCE(plan_item->'source_daily_staff', 'null'::jsonb)
          IS DISTINCT FROM COALESCE(business_row.daily_staff, 'null'::jsonb)
       OR (plan_item->>'source_collaborators') IS DISTINCT FROM business_row.collaborators THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DRAFT_SOURCE_CONTEXT_CHANGED';
    END IF;
    IF business_row.measurement_end_date IS NOT NULL
       AND business_row.measurement_end_date::date <> business_row.measurement_date::date THEN
      IF business_row.daily_staff IS NULL OR jsonb_typeof(business_row.daily_staff) <> 'array' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_DAILY_STAFF_INCOMPLETE';
      END IF;
      SELECT array_agg(DISTINCT day_payload->>'date' ORDER BY day_payload->>'date')
      INTO expected_measurement_dates
      FROM jsonb_array_elements(business_row.daily_staff) day_payload
      WHERE day_payload->>'date' ~ '^\d{4}-\d{2}-\d{2}$';
      IF cardinality(expected_measurement_dates) < 2
         OR expected_measurement_dates[1] <> business_row.measurement_date::text
         OR expected_measurement_dates[cardinality(expected_measurement_dates)] <> business_row.measurement_end_date::text
         OR cardinality(expected_measurement_dates) <> jsonb_array_length(business_row.daily_staff) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_DAILY_STAFF_INCOMPLETE';
      END IF;
    ELSE
      expected_measurement_dates := ARRAY[business_row.measurement_date::text];
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_assignments) assignment_payload
      WHERE (assignment_payload->>'measurement_target_business_id')::bigint = business_row.id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PLAN_MEASUREMENT_ASSIGNMENT_REQUIRED';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_assignments) assignment_payload
      WHERE (assignment_payload->>'measurement_target_business_id')::bigint = business_row.id
        AND NOT (assignment_payload->>'measurement_date' = ANY(expected_measurement_dates))
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_DATE_MISMATCH';
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(expected_measurement_dates) expected_date
      WHERE NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_assignments) assignment_payload
        WHERE (assignment_payload->>'measurement_target_business_id')::bigint = business_row.id
          AND assignment_payload->>'measurement_date' = expected_date
      )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_DAILY_STAFF_INCOMPLETE';
    END IF;
  END LOOP;

  FOR assignment_item IN SELECT value FROM jsonb_array_elements(p_assignments) LOOP
    IF (assignment_item->>'measurement_target_business_id') IS NULL
       OR (assignment_item->>'measurement_date') IS NULL
       OR (assignment_item->>'assignee_user_id') IS NULL
       OR (assignment_item->>'survey_code') NOT IN ('A', 'B', 'C', 'D', 'F', 'G')
       OR btrim(COALESCE(assignment_item->>'assignment_reason', '')) = '' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_MEASUREMENT_ASSIGNMENT_PAYLOAD';
    END IF;
    SELECT upper(btrim(COALESCE(survey_code, '')))
    INTO configured_survey_code
    FROM public.users
    WHERE id = (assignment_item->>'assignee_user_id')::integer
      AND is_active IS NOT FALSE;
    IF configured_survey_code NOT IN ('A', 'B', 'C', 'D', 'F', 'G')
       OR configured_survey_code <> assignment_item->>'survey_code' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_SURVEY_CODE_MISMATCH';
    END IF;
  END LOOP;

  -- 이 apply가 생성·변경하는 그룹만 계산한다. unrelated legacy 4건 그룹은 차단하지 않는다.
  WITH proposed_keys AS (
    SELECT DISTINCT (assignment_payload->>'measurement_date')::date AS measurement_date,
      (assignment_payload->>'assignee_user_id')::integer AS assignee_user_id
    FROM jsonb_array_elements(p_assignments) assignment_payload
  ), final_rows AS (
    SELECT existing_plan.measurement_target_business_id AS target_id,
      existing_assignment.measurement_date, existing_assignment.assignee_user_id
    FROM public.preliminary_survey_v2_measurement_assignments existing_assignment
    JOIN public.preliminary_survey_v2_plans existing_plan ON existing_plan.id = existing_assignment.plan_id
    JOIN proposed_keys USING (measurement_date, assignee_user_id)
    WHERE existing_plan.measurement_target_business_id NOT IN (
      SELECT DISTINCT (plan_payload->>'measurement_target_business_id')::bigint
      FROM jsonb_array_elements(p_plans) plan_payload
    )
    UNION ALL
    SELECT (assignment_payload->>'measurement_target_business_id')::bigint,
      (assignment_payload->>'measurement_date')::date,
      (assignment_payload->>'assignee_user_id')::integer
    FROM jsonb_array_elements(p_assignments) assignment_payload
  ), grouped AS (
    SELECT measurement_date, assignee_user_id, count(*) AS assignment_count,
      md5(measurement_date::text || '|' || assignee_user_id::text || '|' ||
        string_agg(target_id::text, ',' ORDER BY target_id)) AS fingerprint
    FROM final_rows
    GROUP BY measurement_date, assignee_user_id
  )
  SELECT COALESCE(bool_or(grouped.assignment_count > 3), false),
    COALESCE(bool_or(grouped.assignment_count = 3 AND NOT EXISTS (
      SELECT 1
      FROM public.preliminary_survey_v2_measurement_assignments approved_assignment
      WHERE approved_assignment.approval_required IS TRUE
        AND approved_assignment.approval_group_fingerprint = grouped.fingerprint
        AND approved_assignment.approved_by_user_id IS NOT NULL
        AND approved_assignment.approved_at IS NOT NULL
    )), false)
  INTO hard_max_exceeded, new_approval_required
  FROM grouped;

  IF hard_max_exceeded THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_HARD_MAX_EXCEEDED';
  END IF;
  IF new_approval_required AND (
    p_approve_third_assignment IS NOT TRUE OR p_approved_by_user_id IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_APPROVAL_REQUIRED';
  END IF;

  SELECT jsonb_agg(
    plan_payload || jsonb_build_object('target' || '_id', plan_payload->'measurement_target_business_id')
  )
  INTO legacy_plans
  FROM jsonb_array_elements(p_plans) plan_payload;

  RETURN QUERY
  SELECT * FROM public.persist_preliminary_survey_v2_plan_batch_unlocked(legacy_plans);

  DELETE FROM public.preliminary_survey_v2_measurement_assignments existing_assignment
  USING public.preliminary_survey_v2_plans target_plan
  WHERE existing_assignment.plan_id = target_plan.id
    AND target_plan.measurement_target_business_id IN (
      SELECT (plan_payload->>'measurement_target_business_id')::bigint
      FROM jsonb_array_elements(p_plans) plan_payload
    )
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_assignments) proposed_assignment
      WHERE (proposed_assignment->>'measurement_target_business_id')::bigint = target_plan.measurement_target_business_id
        AND proposed_assignment->>'measurement_date' = existing_assignment.measurement_date::text
    );

  -- 한 statement에서 최종 그룹과 기존 exact-group 승인을 계산해 모든 row를 CHECK-valid하게 쓴다.
  WITH proposed_rows AS (
    SELECT (assignment_payload->>'measurement_target_business_id')::bigint AS target_id,
      (assignment_payload->>'measurement_date')::date AS measurement_date,
      (assignment_payload->>'assignee_user_id')::integer AS assignee_user_id,
      assignment_payload->>'survey_code' AS survey_code,
      assignment_payload->>'assignment_reason' AS assignment_reason
    FROM jsonb_array_elements(p_assignments) assignment_payload
  ), proposed_keys AS (
    SELECT DISTINCT measurement_date, assignee_user_id FROM proposed_rows
  ), final_rows AS (
    SELECT existing_plan.measurement_target_business_id AS target_id,
      existing_assignment.measurement_date, existing_assignment.assignee_user_id,
      false AS is_proposed
    FROM public.preliminary_survey_v2_measurement_assignments existing_assignment
    JOIN public.preliminary_survey_v2_plans existing_plan ON existing_plan.id = existing_assignment.plan_id
    JOIN proposed_keys USING (measurement_date, assignee_user_id)
    WHERE existing_plan.measurement_target_business_id NOT IN (
      SELECT DISTINCT (plan_payload->>'measurement_target_business_id')::bigint
      FROM jsonb_array_elements(p_plans) plan_payload
    )
    UNION ALL
    SELECT target_id, measurement_date, assignee_user_id, true FROM proposed_rows
  ), grouped AS (
    SELECT measurement_date, assignee_user_id, count(*) AS assignment_count,
      md5(measurement_date::text || '|' || assignee_user_id::text || '|' ||
        string_agg(target_id::text, ',' ORDER BY target_id)) AS fingerprint
    FROM final_rows
    GROUP BY measurement_date, assignee_user_id
  ), ranked AS (
    SELECT final_row.*,
      grouped.assignment_count,
      grouped.fingerprint,
      row_number() OVER (
        PARTITION BY final_row.measurement_date, final_row.assignee_user_id
        ORDER BY final_row.target_id
      ) AS assignment_position
    FROM final_rows final_row
    JOIN grouped USING (measurement_date, assignee_user_id)
  ), prior_approvals AS (
    SELECT DISTINCT ON (approved_assignment.approval_group_fingerprint)
      approved_assignment.approval_group_fingerprint AS fingerprint,
      approved_assignment.approved_by_user_id,
      approved_assignment.approved_at
    FROM public.preliminary_survey_v2_measurement_assignments approved_assignment
    WHERE approved_assignment.approval_required IS TRUE
      AND approved_assignment.approval_group_fingerprint IS NOT NULL
      AND approved_assignment.approved_by_user_id IS NOT NULL
      AND approved_assignment.approved_at IS NOT NULL
    ORDER BY approved_assignment.approval_group_fingerprint, approved_assignment.approved_at
  ), canonical_proposed AS (
    SELECT proposed_row.*, ranked.assignment_count, ranked.assignment_position, ranked.fingerprint,
      prior_approval.approved_by_user_id AS prior_approved_by_user_id,
      prior_approval.approved_at AS prior_approved_at
    FROM proposed_rows proposed_row
    JOIN ranked ON ranked.is_proposed
      AND ranked.target_id = proposed_row.target_id
      AND ranked.measurement_date = proposed_row.measurement_date
      AND ranked.assignee_user_id = proposed_row.assignee_user_id
    LEFT JOIN prior_approvals prior_approval ON prior_approval.fingerprint = ranked.fingerprint
  )
  INSERT INTO public.preliminary_survey_v2_measurement_assignments (
    plan_id, measurement_date, assignee_user_id, survey_code, assignment_reason,
    approval_required, approval_group_fingerprint, approved_by_user_id, approved_at
  )
  SELECT target_plan.id,
    canonical.measurement_date,
    canonical.assignee_user_id,
    canonical.survey_code,
    canonical.assignment_reason,
    canonical.assignment_count = 3 AND canonical.assignment_position = 3,
    CASE WHEN canonical.assignment_count = 3 AND canonical.assignment_position = 3
      THEN canonical.fingerprint ELSE NULL END,
    CASE WHEN canonical.assignment_count = 3 AND canonical.assignment_position = 3
      THEN COALESCE(canonical.prior_approved_by_user_id, p_approved_by_user_id) ELSE NULL END,
    CASE WHEN canonical.assignment_count = 3 AND canonical.assignment_position = 3
      THEN COALESCE(canonical.prior_approved_at, CURRENT_TIMESTAMP) ELSE NULL END
  FROM canonical_proposed canonical
  JOIN public.preliminary_survey_v2_plans target_plan
    ON target_plan.measurement_target_business_id = canonical.target_id
  ON CONFLICT (plan_id, measurement_date) DO UPDATE SET
    assignee_user_id = EXCLUDED.assignee_user_id,
    survey_code = EXCLUDED.survey_code,
    survey_code_source = EXCLUDED.survey_code_source,
    assignment_reason = EXCLUDED.assignment_reason,
    approval_required = EXCLUDED.approval_required,
    approval_group_fingerprint = EXCLUDED.approval_group_fingerprint,
    approved_by_user_id = EXCLUDED.approved_by_user_id,
    approved_at = EXCLUDED.approved_at,
    updated_at = CURRENT_TIMESTAMP;

  RETURN;
END;
$$;

-- Core RPC는 wrapper SECURITY DEFINER 경로에서만 사용한다.
REVOKE ALL ON FUNCTION public.persist_preliminary_survey_v2_plan_and_measurement_assignments(
  jsonb, jsonb, jsonb, boolean, integer
) FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- Rollback (별도 승인 후): 이 함수 정의를 20260822153000 버전으로 복원한다.
