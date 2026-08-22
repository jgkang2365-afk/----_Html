-- PR #42 forward-only 보완: 이미 적용된 20260822153000 환경도
-- 3건 그룹 승인 지문과 4건 hard maximum을 동일하게 적용한다.
ALTER TABLE public.preliminary_survey_v2_measurement_assignments
  ADD COLUMN IF NOT EXISTS approval_group_fingerprint text;

-- 구형 3건 승인 row는 현재의 (측정일, 측정자, 정렬 target IDs) 구성으로만 지문을 만든다.
-- 구성 자체를 변경하거나 미승인 row를 승인하지 않는다.
WITH grouped AS (
  SELECT assignment.measurement_date, assignment.assignee_user_id, count(*) AS assignment_count,
    md5(assignment.measurement_date::text || '|' || assignment.assignee_user_id::text || '|' ||
      string_agg(plan.measurement_target_business_id::text, ',' ORDER BY plan.measurement_target_business_id)) AS fingerprint
  FROM public.preliminary_survey_v2_measurement_assignments assignment
  JOIN public.preliminary_survey_v2_plans plan ON plan.id = assignment.plan_id
  GROUP BY assignment.measurement_date, assignment.assignee_user_id
), ranked AS (
  SELECT assignment.id, grouped.assignment_count, grouped.fingerprint
  FROM public.preliminary_survey_v2_measurement_assignments assignment
  JOIN grouped USING (measurement_date, assignee_user_id)
)
UPDATE public.preliminary_survey_v2_measurement_assignments assignment
SET approval_group_fingerprint = ranked.fingerprint
FROM ranked
WHERE ranked.id = assignment.id
  AND ranked.assignment_count = 3
  AND assignment.approval_required IS TRUE
  AND assignment.approved_by_user_id IS NOT NULL
  AND assignment.approved_at IS NOT NULL;

ALTER TABLE public.preliminary_survey_v2_measurement_assignments
  DROP CONSTRAINT IF EXISTS preliminary_survey_v2_assignment_approval_check;
ALTER TABLE public.preliminary_survey_v2_measurement_assignments
  ADD CONSTRAINT preliminary_survey_v2_assignment_approval_check CHECK (
    (approval_required = false AND approval_group_fingerprint IS NULL
      AND approved_by_user_id IS NULL AND approved_at IS NULL)
    OR (approval_required = true AND (approval_group_fingerprint IS NULL
      OR approval_group_fingerprint ~ '^[a-f0-9]{32}$')
      AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
  );

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
BEGIN
  IF p_plans IS NULL OR jsonb_typeof(p_plans) <> 'array' OR jsonb_array_length(p_plans) = 0
     OR p_assignments IS NULL OR jsonb_typeof(p_assignments) <> 'array'
     OR p_assignment_baseline IS NULL OR jsonb_typeof(p_assignment_baseline) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PLAN_ASSIGNMENT_PAYLOAD';
  END IF;

  -- 기존 RPC와 동일한 측정일 advisory lock을 먼저 획득해 사전검증과 실제 저장 사이 경쟁을 막는다.
  PERFORM pg_advisory_xact_lock(hashtextextended(lock_date::text, 0))
  FROM (
    SELECT DISTINCT (item->>'measurement_date')::date AS lock_date
    FROM jsonb_array_elements(p_assignments) item
    ORDER BY lock_date
  ) dates;

  WITH final_rows AS (
    SELECT plan.measurement_target_business_id AS target_id,
      existing.measurement_date, existing.assignee_user_id, false AS is_proposed
    FROM public.preliminary_survey_v2_measurement_assignments existing
    JOIN public.preliminary_survey_v2_plans plan ON plan.id = existing.plan_id
    WHERE plan.measurement_target_business_id NOT IN (
      SELECT DISTINCT (item->>'measurement_target_business_id')::bigint
      FROM jsonb_array_elements(p_plans) item
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

  -- 구형 RPC의 source/baseline/찐확정 검증과 원자 plan+assignment 저장을 그대로 재사용한다.
  -- 그룹 승인이 새로 필요할 때만 승인 입력을 전달하며 client row boolean은 사용하지 않는다.
  RETURN QUERY SELECT * FROM public.persist_preliminary_survey_v2_plan_and_measurement_assignments(
    p_plans,
    p_assignments,
    p_assignment_baseline,
    new_approval_required,
    CASE WHEN new_approval_required THEN p_approved_by_user_id ELSE NULL END
  );

  -- 실제 저장 후 영향받은 그룹을 canonical target 집합으로 다시 계산한다.
  WITH affected_keys AS (
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

REVOKE ALL ON FUNCTION public.persist_preliminary_survey_v2_plan_and_assignment_groups(jsonb, jsonb, jsonb, boolean, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.persist_preliminary_survey_v2_plan_and_measurement_assignments(jsonb, jsonb, jsonb, boolean, integer)
  FROM service_role;
GRANT EXECUTE ON FUNCTION public.persist_preliminary_survey_v2_plan_and_assignment_groups(jsonb, jsonb, jsonb, boolean, integer)
  TO service_role;

NOTIFY pgrst, 'reload schema';

-- Rollback (별도 승인 후): 새 RPC 제거, approval constraint를 직전 정의로 복원한 뒤
-- approval_group_fingerprint column을 제거한다. 이미 생성된 3건 승인 이력 보존 여부를 먼저 확인한다.
