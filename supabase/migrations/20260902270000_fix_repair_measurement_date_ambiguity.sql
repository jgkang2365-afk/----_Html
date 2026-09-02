-- Repair assignment helper: avoid PL/pgSQL variable/column name collisions.
CREATE OR REPLACE FUNCTION public.ensure_repair_measurement_assignments(
  p_target_id bigint,
  p_plan_id uuid,
  p_expected_assignments jsonb DEFAULT '[]'::jsonb
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target_row public.measurement_target_business%ROWTYPE;
  measurement_day jsonb;
  v_measurement_date date;
  expected_assignee integer;
  existing_assignee integer;
  preview_assignee integer;
  assignment_count integer := 0;
  base_code text;
BEGIN
  SELECT * INTO target_row
  FROM public.measurement_target_business
  WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TARGET_NOT_FOUND'; END IF;
  IF p_plan_id IS NULL THEN RAISE EXCEPTION 'REPAIR_PLAN_REQUIRED'; END IF;

  FOR measurement_day IN
    SELECT value FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(target_row.daily_staff) = 'array'
        AND jsonb_array_length(target_row.daily_staff) > 0 THEN target_row.daily_staff
        ELSE jsonb_build_array(jsonb_build_object('date', target_row.measurement_date::text))
      END)
  LOOP
    v_measurement_date := NULLIF(measurement_day->>'date', '')::date;
    IF v_measurement_date IS NULL THEN RAISE EXCEPTION 'REPAIR_MEASUREMENT_DATE_REQUIRED'; END IF;

    SELECT fixed.assignee_user_id INTO expected_assignee
    FROM public.preliminary_survey_v2_fixed_assignments AS fixed
    WHERE fixed.measurement_target_business_id = p_target_id
      AND fixed.measurement_date = v_measurement_date
    ORDER BY fixed.updated_at DESC, fixed.id DESC LIMIT 1;

    SELECT assignment.assignee_user_id INTO existing_assignee
    FROM public.preliminary_survey_v2_measurement_assignments AS assignment
    JOIN public.preliminary_survey_v2_plans AS existing_plan ON existing_plan.id = assignment.plan_id
    WHERE existing_plan.measurement_target_business_id = p_target_id
      AND assignment.measurement_date = v_measurement_date
    ORDER BY assignment.updated_at DESC, assignment.id DESC LIMIT 1;

    SELECT (item->>'assigneeUserId')::integer INTO preview_assignee
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_expected_assignments) = 'array'
      THEN p_expected_assignments ELSE '[]'::jsonb END) AS items(item)
    WHERE (item->>'targetId')::bigint = p_target_id
      AND (item->>'measurementDate')::date = v_measurement_date
    ORDER BY item->>'assigneeUserId' LIMIT 1;

    IF expected_assignee IS NOT NULL AND preview_assignee IS NOT NULL
       AND expected_assignee IS DISTINCT FROM preview_assignee THEN
      RAISE EXCEPTION 'REPAIR_MEASUREMENT_ASSIGNMENT_CONFLICT';
    END IF;
    IF existing_assignee IS NOT NULL AND preview_assignee IS NOT NULL
       AND existing_assignee IS DISTINCT FROM preview_assignee THEN
      RAISE EXCEPTION 'REPAIR_SOURCE_CHANGED';
    END IF;

    IF expected_assignee IS NULL THEN expected_assignee := existing_assignee; END IF;
    IF expected_assignee IS NULL THEN expected_assignee := preview_assignee; END IF;
    IF expected_assignee IS NULL THEN RAISE EXCEPTION 'REPAIR_MEASUREMENT_ASSIGNMENT_SOURCE_REQUIRED'; END IF;
    IF existing_assignee IS NOT NULL AND existing_assignee IS DISTINCT FROM expected_assignee THEN
      RAISE EXCEPTION 'REPAIR_MEASUREMENT_ASSIGNMENT_CONFLICT';
    END IF;

    SELECT upper(btrim(u.survey_code)) INTO base_code
    FROM public.users AS u
    WHERE u.id = expected_assignee AND u.is_active IS NOT FALSE;
    IF base_code NOT IN ('A','B','C','D','F','G') THEN
      RAISE EXCEPTION 'MEASUREMENT_ASSIGNMENT_SURVEY_CODE_REQUIRED';
    END IF;

    INSERT INTO public.preliminary_survey_v2_measurement_assignments
      (plan_id, measurement_date, assignee_user_id, survey_code, public_sample_code, assignment_reason)
    VALUES (p_plan_id, v_measurement_date, expected_assignee, base_code, NULL, 'confirmed-document-repair')
    ON CONFLICT (plan_id, measurement_date) DO NOTHING;
    assignment_count := assignment_count + 1;
  END LOOP;

  WITH affected AS (
    SELECT DISTINCT assignment.measurement_date, assignment.assignee_user_id
    FROM public.preliminary_survey_v2_measurement_assignments AS assignment
    WHERE assignment.plan_id = p_plan_id
  ), group_members AS (
    SELECT assignment.id AS assignment_id, plan.measurement_target_business_id AS target_id,
      assignment.measurement_date, assignment.assignee_user_id
    FROM public.preliminary_survey_v2_measurement_assignments AS assignment
    JOIN public.preliminary_survey_v2_plans AS plan ON plan.id = assignment.plan_id
    JOIN affected ON affected.measurement_date = assignment.measurement_date
      AND affected.assignee_user_id = assignment.assignee_user_id
    UNION ALL
    SELECT NULL::uuid, fixed.measurement_target_business_id, fixed.measurement_date, fixed.assignee_user_id
    FROM public.preliminary_survey_v2_fixed_assignments AS fixed
    JOIN affected ON affected.measurement_date = fixed.measurement_date
      AND affected.assignee_user_id = fixed.assignee_user_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.preliminary_survey_v2_measurement_assignments AS assignment
      JOIN public.preliminary_survey_v2_plans AS plan ON plan.id = assignment.plan_id
      WHERE plan.measurement_target_business_id = fixed.measurement_target_business_id
        AND assignment.measurement_date = fixed.measurement_date
    )
  ), ranked AS (
    SELECT member.assignment_id AS id, upper(btrim(base_user.survey_code)) AS base_code,
      row_number() OVER (PARTITION BY member.measurement_date, member.assignee_user_id ORDER BY target.code, target.id) AS position
    FROM group_members AS member
    JOIN public.measurement_target_business AS target ON target.id = member.target_id
    JOIN public.users AS base_user ON base_user.id = member.assignee_user_id
  )
  UPDATE public.preliminary_survey_v2_measurement_assignments AS assignment
  SET survey_code = ranked.base_code,
      public_sample_code = repeat(ranked.base_code, ranked.position::integer),
      updated_at = CURRENT_TIMESTAMP
  FROM ranked
  WHERE assignment.id = ranked.id AND ranked.id IS NOT NULL;

  RETURN assignment_count;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_repair_measurement_assignments(bigint, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
