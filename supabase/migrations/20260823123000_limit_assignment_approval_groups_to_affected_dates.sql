-- 20260823120000이 적용된 환경의 forward-only 보완.
-- 제안한 측정일만 hard max/승인 사전검증하고, 저장 전·후 그룹 모두의 승인 메타데이터를 정규화한다.
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

  -- 새 날짜뿐 아니라 이번 저장으로 비워지거나 줄어드는 기존 날짜도 같은 순서로 잠근다.
  -- 기존 RPC와 같은 lock namespace를 써서 wrapper와 실제 저장 사이 경쟁을 막는다.
  SELECT COALESCE(jsonb_agg(affected.measurement_date ORDER BY affected.measurement_date), '[]'::jsonb)
  INTO affected_dates
  FROM (
    SELECT DISTINCT (item->>'measurement_date')::date AS measurement_date
    FROM jsonb_array_elements(p_assignments) item
    UNION
    SELECT DISTINCT assignment.measurement_date
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    JOIN public.preliminary_survey_v2_plans plan ON plan.id = assignment.plan_id
    WHERE plan.measurement_target_business_id IN (
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

  -- 잠금 뒤의 현재값을 old key로 고정해 저장 후 new key와 함께 정규화한다.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'measurement_date', affected.measurement_date,
    'assignee_user_id', affected.assignee_user_id
  ) ORDER BY affected.measurement_date, affected.assignee_user_id), '[]'::jsonb)
  INTO old_affected_keys
  FROM (
    SELECT DISTINCT assignment.measurement_date, assignment.assignee_user_id
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    JOIN public.preliminary_survey_v2_plans plan ON plan.id = assignment.plan_id
    WHERE plan.measurement_target_business_id IN (
      SELECT DISTINCT (item->>'measurement_target_business_id')::bigint
      FROM jsonb_array_elements(p_plans) item
    )
  ) affected;

  -- 다른 날짜 또는 같은 날짜의 다른 측정자 legacy 4건 그룹은 이번 제안과 무관하므로 차단하지 않는다.
  WITH proposed_keys AS (
    SELECT DISTINCT (item->>'measurement_date')::date AS measurement_date,
      (item->>'assignee_user_id')::integer AS assignee_user_id
    FROM jsonb_array_elements(p_assignments) item
  ), final_rows AS (
    SELECT plan.measurement_target_business_id AS target_id,
      existing.measurement_date, existing.assignee_user_id, false AS is_proposed
    FROM public.preliminary_survey_v2_measurement_assignments existing
    JOIN public.preliminary_survey_v2_plans plan ON plan.id = existing.plan_id
    WHERE plan.measurement_target_business_id NOT IN (
      SELECT DISTINCT (item->>'measurement_target_business_id')::bigint
      FROM jsonb_array_elements(p_plans) item
    )
      AND (existing.measurement_date, existing.assignee_user_id) IN (
        SELECT measurement_date, assignee_user_id FROM proposed_keys
      )
    UNION ALL
    SELECT (item->>'measurement_target_business_id')::bigint,
      (item->>'measurement_date')::date, (item->>'assignee_user_id')::integer, true
    FROM jsonb_array_elements(p_assignments) item
  ), grouped AS (
    SELECT measurement_date, assignee_user_id, count(*) AS assignment_count,
      bool_or(is_proposed) AS has_proposed,
      md5(measurement_date::text || '|' || assignee_user_id::text || '|' ||
        string_agg(target_id::text, ',' ORDER BY target_id)) AS fingerprint
    FROM final_rows
    GROUP BY measurement_date, assignee_user_id
  )
  SELECT coalesce(bool_or(assignment_count > 3), false),
    coalesce(bool_or(assignment_count = 3 AND has_proposed AND NOT EXISTS (
      SELECT 1
      FROM public.preliminary_survey_v2_measurement_assignments approved
      WHERE approved.approval_required IS TRUE
        AND approved.approval_group_fingerprint = grouped.fingerprint
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

  -- old affected key와 저장 후 new key의 합집합을 canonical target 집합으로 다시 계산한다.
  -- 3건에서 2건이 된 이전 그룹은 승인 메타데이터를 지우고, 동일 3건 지문만 승인 이력을 보존한다.
  WITH affected_keys AS (
    SELECT (item->>'measurement_date')::date AS measurement_date,
      (item->>'assignee_user_id')::integer AS assignee_user_id
    FROM jsonb_array_elements(old_affected_keys) item
    UNION
    SELECT DISTINCT assignment.measurement_date, assignment.assignee_user_id
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    JOIN public.preliminary_survey_v2_plans plan ON plan.id = assignment.plan_id
    WHERE plan.measurement_target_business_id IN (
      SELECT DISTINCT (item->>'measurement_target_business_id')::bigint
      FROM jsonb_array_elements(p_plans) item
    )
  ), grouped AS (
    SELECT assignment.measurement_date, assignment.assignee_user_id, count(*) AS assignment_count,
      md5(assignment.measurement_date::text || '|' || assignment.assignee_user_id::text || '|' ||
        string_agg(plan.measurement_target_business_id::text, ',' ORDER BY plan.measurement_target_business_id)) AS fingerprint
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    JOIN public.preliminary_survey_v2_plans plan ON plan.id = assignment.plan_id
    JOIN affected_keys USING (measurement_date, assignee_user_id)
    GROUP BY assignment.measurement_date, assignment.assignee_user_id
  ), ranked AS (
    SELECT assignment.id, assignment.approval_group_fingerprint AS previous_fingerprint,
      assignment.approved_by_user_id AS previous_approver,
      assignment.approved_at AS previous_approved_at,
      grouped.assignment_count,
      row_number() OVER (
        PARTITION BY assignment.measurement_date, assignment.assignee_user_id
        ORDER BY plan.measurement_target_business_id
      ) AS assignment_position,
      grouped.fingerprint
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    JOIN public.preliminary_survey_v2_plans plan ON plan.id = assignment.plan_id
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

NOTIFY pgrst, 'reload schema';

-- Rollback (별도 승인 후): 이 함수 정의를 20260823120000 버전으로 복원한다.
