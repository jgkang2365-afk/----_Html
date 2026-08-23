-- PR #42 forward-only wrapper scope fix.
--
-- 저장 전 hard max와 3건 승인 검사를 이번 apply의 이전 그룹과 제안 그룹
-- (old_affected_keys UNION proposed_keys) 전체의 최종 예상 상태에 적용한다.
-- core RPC, CHECK constraint, true-confirmed guard와 과거 migration은 변경하지 않는다.

CREATE OR REPLACE FUNCTION public.persist_preliminary_survey_v2_plan_and_assignment_groups(
  p_plans jsonb,
  p_assignments jsonb,
  p_assignment_baseline jsonb,
  p_approve_third_assignment boolean DEFAULT false,
  p_approved_by_user_id integer DEFAULT NULL
) RETURNS SETOF public.preliminary_survey_v2_plans
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  hard_max_exceeded boolean;
  new_approval_required boolean;
  affected_dates jsonb;
  old_affected_keys jsonb;
BEGIN
  IF p_plans IS NULL OR jsonb_typeof(p_plans) <> 'array' OR jsonb_array_length(p_plans) = 0
     OR p_assignments IS NULL OR jsonb_typeof(p_assignments) <> 'array'
     OR p_assignment_baseline IS NULL OR jsonb_typeof(p_assignment_baseline) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PLAN_ASSIGNMENT_PAYLOAD';
  END IF;

  -- 이전 날짜와 제안 날짜를 같은 namespace/정렬 순서로 잠근다.
  SELECT COALESCE(jsonb_agg(affected.measurement_date ORDER BY affected.measurement_date), '[]'::jsonb)
  INTO affected_dates
  FROM (
    SELECT DISTINCT (item->>'measurement_date')::date AS measurement_date
    FROM jsonb_array_elements(p_assignments) item
    UNION
    SELECT DISTINCT assignment.measurement_date
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
    WHERE target_plan.measurement_target_business_id IN (
      SELECT DISTINCT (item->>'measurement_target_business_id')::bigint
      FROM jsonb_array_elements(p_plans) item
    )
  ) affected;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'preliminary-measurement-assignment|' || lock_date::text, 0))
  FROM (
    SELECT value::text::date AS lock_date
    FROM jsonb_array_elements_text(affected_dates)
    ORDER BY lock_date
  ) dates;

  -- 잠금 뒤 현재 assignment에서 이번 target이 속한 이전 그룹을 캡처한다.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'measurement_date', affected.measurement_date,
    'assignee_user_id', affected.assignee_user_id
  ) ORDER BY affected.measurement_date, affected.assignee_user_id), '[]'::jsonb)
  INTO old_affected_keys
  FROM (
    SELECT DISTINCT assignment.measurement_date, assignment.assignee_user_id
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
    WHERE target_plan.measurement_target_business_id IN (
      SELECT DISTINCT (item->>'measurement_target_business_id')::bigint
      FROM jsonb_array_elements(p_plans) item
    )
  ) affected;

  -- 저장 전 최종 예상 상태: affected(old UNION proposed) 안의 기존 row에서
  -- 재적용 target을 제거한 뒤 proposed row를 더한다.
  WITH proposed_keys AS (
    SELECT DISTINCT (item->>'measurement_date')::date AS measurement_date,
      (item->>'assignee_user_id')::integer AS assignee_user_id
    FROM jsonb_array_elements(p_assignments) item
  ), affected_keys AS (
    SELECT (item->>'measurement_date')::date AS measurement_date,
      (item->>'assignee_user_id')::integer AS assignee_user_id
    FROM jsonb_array_elements(old_affected_keys) item
    UNION
    SELECT measurement_date, assignee_user_id FROM proposed_keys
  ), reapplied_targets AS (
    SELECT DISTINCT (item->>'measurement_target_business_id')::bigint AS target_id
    FROM jsonb_array_elements(p_plans) item
  ), final_rows AS (
    SELECT target_plan.measurement_target_business_id AS target_id,
      existing.measurement_date, existing.assignee_user_id
    FROM public.preliminary_survey_v2_measurement_assignments existing
    JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = existing.plan_id
    JOIN affected_keys USING (measurement_date, assignee_user_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM reapplied_targets reapplied
      WHERE reapplied.target_id = target_plan.measurement_target_business_id
    )
    UNION ALL
    SELECT (item->>'measurement_target_business_id')::bigint,
      (item->>'measurement_date')::date,
      (item->>'assignee_user_id')::integer
    FROM jsonb_array_elements(p_assignments) item
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
      FROM public.preliminary_survey_v2_measurement_assignments approved
      WHERE approved.approval_required IS TRUE
        AND approved.approval_group_fingerprint = grouped.fingerprint
        AND approved.approved_by_user_id IS NOT NULL
        AND approved.approved_at IS NOT NULL
    )), false)
  INTO hard_max_exceeded, new_approval_required
  FROM grouped;

  IF hard_max_exceeded THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_HARD_MAX_EXCEEDED';
  END IF;
  IF new_approval_required AND (
    p_approve_third_assignment IS NOT TRUE OR p_approved_by_user_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.users
      WHERE id = p_approved_by_user_id
        AND (role = '관리자' OR is_preliminary_survey_manager IS TRUE)
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_APPROVAL_REQUIRED';
  END IF;

  RETURN QUERY SELECT * FROM public.persist_preliminary_survey_v2_plan_and_measurement_assignments(
    p_plans,
    p_assignments,
    p_assignment_baseline,
    new_approval_required,
    CASE WHEN new_approval_required THEN p_approved_by_user_id ELSE NULL END
  );

  -- 저장 후에도 동일한 old/new 합집합을 최종 canonical group으로 정규화한다.
  WITH proposed_keys AS (
    SELECT DISTINCT (item->>'measurement_date')::date AS measurement_date,
      (item->>'assignee_user_id')::integer AS assignee_user_id
    FROM jsonb_array_elements(p_assignments) item
  ), affected_keys AS (
    SELECT (item->>'measurement_date')::date AS measurement_date,
      (item->>'assignee_user_id')::integer AS assignee_user_id
    FROM jsonb_array_elements(old_affected_keys) item
    UNION
    SELECT measurement_date, assignee_user_id FROM proposed_keys
  ), grouped AS (
    SELECT assignment.measurement_date, assignment.assignee_user_id, count(*) AS assignment_count,
      md5(assignment.measurement_date::text || '|' || assignment.assignee_user_id::text || '|' ||
        string_agg(target_plan.measurement_target_business_id::text, ','
          ORDER BY target_plan.measurement_target_business_id)) AS fingerprint
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
    JOIN affected_keys USING (measurement_date, assignee_user_id)
    GROUP BY assignment.measurement_date, assignment.assignee_user_id
  ), ranked AS (
    SELECT assignment.id, assignment.approval_group_fingerprint AS previous_fingerprint,
      assignment.approved_by_user_id AS previous_approver,
      assignment.approved_at AS previous_approved_at,
      grouped.assignment_count,
      row_number() OVER (
        PARTITION BY assignment.measurement_date, assignment.assignee_user_id
        ORDER BY target_plan.measurement_target_business_id
      ) AS assignment_position,
      grouped.fingerprint
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
    JOIN grouped USING (measurement_date, assignee_user_id)
  )
  UPDATE public.preliminary_survey_v2_measurement_assignments assignment
  SET approval_required = ranked.assignment_count = 3 AND ranked.assignment_position = 3,
    approval_group_fingerprint = CASE
      WHEN ranked.assignment_count = 3 AND ranked.assignment_position = 3 THEN ranked.fingerprint ELSE NULL END,
    approved_by_user_id = CASE
      WHEN ranked.assignment_count <> 3 OR ranked.assignment_position <> 3 THEN NULL
      WHEN ranked.previous_fingerprint = ranked.fingerprint AND ranked.previous_approver IS NOT NULL
        THEN ranked.previous_approver
      ELSE p_approved_by_user_id END,
    approved_at = CASE
      WHEN ranked.assignment_count <> 3 OR ranked.assignment_position <> 3 THEN NULL
      WHEN ranked.previous_fingerprint = ranked.fingerprint AND ranked.previous_approved_at IS NOT NULL
        THEN ranked.previous_approved_at
      ELSE CURRENT_TIMESTAMP END,
    updated_at = CURRENT_TIMESTAMP
  FROM ranked
  WHERE ranked.id = assignment.id;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_preliminary_survey_v2_plan_and_assignment_groups(
  jsonb, jsonb, jsonb, boolean, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_preliminary_survey_v2_plan_and_assignment_groups(
  jsonb, jsonb, jsonb, boolean, integer
) TO service_role;
REVOKE ALL ON FUNCTION public.persist_preliminary_survey_v2_plan_and_measurement_assignments(
  jsonb, jsonb, jsonb, boolean, integer
) FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- Rollback (별도 승인 후): wrapper를 20260823123000 정의로 복원한다.
