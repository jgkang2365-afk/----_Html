-- 찐확정·역사 추적을 보호하면서 plan과 귀속 측정자 배정을 원자 삭제한다.
-- 삭제로 영향을 받는 측정일·측정자 그룹은 저장 wrapper와 같은 advisory lock을 사용하고,
-- 3건 승인 metadata를 삭제 후 canonical 그룹에 맞게 다시 정규화한다.

CREATE OR REPLACE FUNCTION public.delete_preliminary_survey_v2_plan_and_rebalance_assignments(
  p_target_id bigint,
  p_approve_third_assignment boolean DEFAULT false,
  p_approved_by_user_id integer DEFAULT NULL
) RETURNS TABLE(deleted_plan_id uuid, measurement_target_business_id bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target_plan_id uuid;
  affected_dates jsonb;
  current_affected_dates jsonb;
  affected_keys jsonb;
  prior_approvals jsonb;
  hard_max_exceeded boolean;
  new_approval_required boolean;
BEGIN
  IF p_target_id IS NULL OR p_target_id <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_TARGET_ID';
  END IF;

  SELECT target_plan.id
  INTO target_plan_id
  FROM public.preliminary_survey_v2_plans target_plan
  WHERE target_plan.measurement_target_business_id = p_target_id;

  IF target_plan_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'PLAN_NOT_FOUND';
  END IF;

  SELECT COALESCE(jsonb_agg(dates.measurement_date ORDER BY dates.measurement_date), '[]'::jsonb)
  INTO affected_dates
  FROM (
    SELECT DISTINCT assignment.measurement_date
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    WHERE assignment.plan_id = target_plan_id
  ) dates;

  -- persist wrapper와 같은 namespace 및 날짜 정렬 순서로 잠근다.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'preliminary-measurement-assignment|' || lock_date::text, 0))
  FROM (
    SELECT value::text::date AS lock_date
    FROM jsonb_array_elements_text(affected_dates)
    ORDER BY lock_date
  ) dates;

  -- advisory lock 뒤 원천 target과 plan을 다시 잠그고 삭제 가능 상태를 확정한다.
  PERFORM 1
  FROM public.measurement_target_business target
  WHERE target.id = p_target_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'TARGET_NOT_FOUND';
  END IF;

  SELECT target_plan.id
  INTO target_plan_id
  FROM public.preliminary_survey_v2_plans target_plan
  WHERE target_plan.measurement_target_business_id = p_target_id
  FOR UPDATE;
  IF target_plan_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'PLAN_NOT_FOUND';
  END IF;

  SELECT COALESCE(jsonb_agg(dates.measurement_date ORDER BY dates.measurement_date), '[]'::jsonb)
  INTO current_affected_dates
  FROM (
    SELECT DISTINCT assignment.measurement_date
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    WHERE assignment.plan_id = target_plan_id
  ) dates;
  IF current_affected_dates IS DISTINCT FROM affected_dates THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'PLAN_DELETE_SOURCE_CHANGED';
  END IF;

  IF public.is_preliminary_survey_v2_true_confirmed(p_target_id) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'TRUE_CONFIRMED_LOCKED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.preliminary_survey_v2_legacy_reconciliation reconciliation
    WHERE reconciliation.applied_plan_id = target_plan_id
       OR reconciliation.applied_assignment_id IN (
         SELECT assignment.id
         FROM public.preliminary_survey_v2_measurement_assignments assignment
         WHERE assignment.plan_id = target_plan_id
       )
  ) OR EXISTS (
    SELECT 1
    FROM public.preliminary_survey_v2_history_recovery_audit audit
    WHERE audit.created_plan_id = target_plan_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'PLAN_DELETE_PROTECTED_HISTORY';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'measurement_date', keys.measurement_date,
    'assignee_user_id', keys.assignee_user_id
  ) ORDER BY keys.measurement_date, keys.assignee_user_id), '[]'::jsonb)
  INTO affected_keys
  FROM (
    SELECT DISTINCT assignment.measurement_date, assignment.assignee_user_id
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    WHERE assignment.plan_id = target_plan_id
  ) keys;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'fingerprint', assignment.approval_group_fingerprint,
    'approved_by_user_id', assignment.approved_by_user_id,
    'approved_at', assignment.approved_at
  )), '[]'::jsonb)
  INTO prior_approvals
  FROM public.preliminary_survey_v2_measurement_assignments assignment
  JOIN (
    SELECT (item->>'measurement_date')::date AS measurement_date,
      (item->>'assignee_user_id')::integer AS assignee_user_id
    FROM jsonb_array_elements(affected_keys) item
  ) keys USING (measurement_date, assignee_user_id)
  WHERE assignment.approval_required IS TRUE
    AND assignment.approval_group_fingerprint IS NOT NULL
    AND assignment.approved_by_user_id IS NOT NULL
    AND assignment.approved_at IS NOT NULL;

  DELETE FROM public.preliminary_survey_v2_plans target_plan
  WHERE target_plan.id = target_plan_id;

  WITH keys AS (
    SELECT (item->>'measurement_date')::date AS measurement_date,
      (item->>'assignee_user_id')::integer AS assignee_user_id
    FROM jsonb_array_elements(affected_keys) item
  ), grouped AS (
    SELECT assignment.measurement_date, assignment.assignee_user_id, count(*) AS assignment_count,
      md5(assignment.measurement_date::text || '|' || assignment.assignee_user_id::text || '|' ||
        string_agg(target_plan.measurement_target_business_id::text, ','
          ORDER BY target_plan.measurement_target_business_id)) AS fingerprint
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
    JOIN keys USING (measurement_date, assignee_user_id)
    GROUP BY assignment.measurement_date, assignment.assignee_user_id
  )
  SELECT COALESCE(bool_or(grouped.assignment_count > 3), false),
    COALESCE(bool_or(grouped.assignment_count = 3 AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(prior_approvals) approved
      WHERE approved->>'fingerprint' = grouped.fingerprint
        AND approved->>'approved_by_user_id' IS NOT NULL
        AND approved->>'approved_at' IS NOT NULL
    )), false)
  INTO hard_max_exceeded, new_approval_required
  FROM grouped;

  IF hard_max_exceeded THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_HARD_MAX_EXCEEDED';
  END IF;
  IF new_approval_required AND (
    p_approve_third_assignment IS NOT TRUE OR p_approved_by_user_id IS NULL OR NOT EXISTS (
      SELECT 1
      FROM public.users
      WHERE id = p_approved_by_user_id
        AND (role = '관리자' OR is_preliminary_survey_manager IS TRUE)
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_APPROVAL_REQUIRED';
  END IF;

  WITH keys AS (
    SELECT (item->>'measurement_date')::date AS measurement_date,
      (item->>'assignee_user_id')::integer AS assignee_user_id
    FROM jsonb_array_elements(affected_keys) item
  ), grouped AS (
    SELECT assignment.measurement_date, assignment.assignee_user_id, count(*) AS assignment_count,
      md5(assignment.measurement_date::text || '|' || assignment.assignee_user_id::text || '|' ||
        string_agg(target_plan.measurement_target_business_id::text, ','
          ORDER BY target_plan.measurement_target_business_id)) AS fingerprint
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
    JOIN keys USING (measurement_date, assignee_user_id)
    GROUP BY assignment.measurement_date, assignment.assignee_user_id
  ), ranked AS (
    SELECT assignment.id, grouped.assignment_count,
      row_number() OVER (
        PARTITION BY assignment.measurement_date, assignment.assignee_user_id
        ORDER BY target_plan.measurement_target_business_id
      ) AS assignment_position,
      grouped.fingerprint,
      prior.approved_by_user_id AS prior_approved_by_user_id,
      prior.approved_at AS prior_approved_at
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
    JOIN grouped USING (measurement_date, assignee_user_id)
    LEFT JOIN LATERAL (
      SELECT (approved->>'approved_by_user_id')::integer AS approved_by_user_id,
        (approved->>'approved_at')::timestamptz AS approved_at
      FROM jsonb_array_elements(prior_approvals) approved
      WHERE approved->>'fingerprint' = grouped.fingerprint
      LIMIT 1
    ) prior ON true
  )
  UPDATE public.preliminary_survey_v2_measurement_assignments assignment
  SET approval_required = ranked.assignment_count = 3 AND ranked.assignment_position = 3,
    approval_group_fingerprint = CASE
      WHEN ranked.assignment_count = 3 AND ranked.assignment_position = 3 THEN ranked.fingerprint ELSE NULL END,
    approved_by_user_id = CASE
      WHEN ranked.assignment_count <> 3 OR ranked.assignment_position <> 3 THEN NULL
      ELSE COALESCE(ranked.prior_approved_by_user_id, p_approved_by_user_id) END,
    approved_at = CASE
      WHEN ranked.assignment_count <> 3 OR ranked.assignment_position <> 3 THEN NULL
      ELSE COALESCE(ranked.prior_approved_at, CURRENT_TIMESTAMP) END,
    updated_at = CURRENT_TIMESTAMP
  FROM ranked
  WHERE ranked.id = assignment.id;

  RETURN QUERY SELECT target_plan_id, p_target_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_preliminary_survey_v2_plan_and_rebalance_assignments(
  bigint, boolean, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_preliminary_survey_v2_plan_and_rebalance_assignments(
  bigint, boolean, integer
) TO service_role;

NOTIFY pgrst, 'reload schema';

-- Rollback (별도 승인 후):
-- DROP FUNCTION public.delete_preliminary_survey_v2_plan_and_rebalance_assignments(bigint, boolean, integer);
