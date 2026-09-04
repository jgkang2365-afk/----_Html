-- Allow a user-confirmed fixed measurement assignee to return to automatic planning.
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
