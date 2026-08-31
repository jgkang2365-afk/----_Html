-- 20260831214500의 관리자 plan override에서 PL/pgSQL 변수와 컬럼명이 겹치지 않도록 forward 보정한다.
CREATE OR REPLACE FUNCTION public.admin_override_preliminary_survey_v2_plan(
  p_target_id bigint,
  p_recommended_date date,
  p_survey_method text,
  p_participant_user_ids jsonb,
  p_participant_names jsonb,
  p_responsible_user_id integer,
  p_experienced_reviewer_user_id integer,
  p_policy_warnings jsonb,
  p_changed_by_user_id integer
) RETURNS public.preliminary_survey_v2_plans
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target_row public.measurement_target_business%ROWTYPE;
  plan_row public.preliminary_survey_v2_plans%ROWTYPE;
  before_plan jsonb;
  valid_user_count integer;
  next_source_rule_type text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_changed_by_user_id AND role = '관리자' AND is_active IS NOT FALSE
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ADMIN_OVERRIDE_FORBIDDEN';
  END IF;
  IF p_target_id IS NULL OR p_recommended_date IS NULL OR p_survey_method NOT IN ('field', 'phone')
     OR jsonb_typeof(p_participant_user_ids) <> 'array' OR jsonb_typeof(p_participant_names) <> 'array'
     OR jsonb_array_length(p_participant_user_ids) = 0
     OR jsonb_array_length(p_participant_user_ids) <> jsonb_array_length(p_participant_names)
     OR p_responsible_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_ADMIN_OVERRIDE_INPUT';
  END IF;

  SELECT * INTO target_row
  FROM public.measurement_target_business
  WHERE id = p_target_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'TARGET_NOT_FOUND';
  END IF;

  SELECT count(*) INTO valid_user_count
  FROM jsonb_array_elements_text(p_participant_user_ids) WITH ORDINALITY participant(id, ordinal)
  JOIN jsonb_array_elements_text(p_participant_names) WITH ORDINALITY participant_name(name, ordinal) USING (ordinal)
  JOIN public.users user_row
    ON user_row.id = participant.id::integer
   AND user_row.name = participant_name.name
   AND user_row.job = '측정'
   AND user_row.is_active IS NOT FALSE;
  IF valid_user_count <> jsonb_array_length(p_participant_user_ids) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PARTICIPANT_MISMATCH';
  END IF;
  IF NOT (p_participant_user_ids @> jsonb_build_array(p_responsible_user_id)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'RESPONSIBLE_NOT_IN_PARTICIPANTS';
  END IF;
  IF p_experienced_reviewer_user_id IS NOT NULL
     AND NOT (p_participant_user_ids @> jsonb_build_array(p_experienced_reviewer_user_id)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'REVIEWER_NOT_IN_PARTICIPANTS';
  END IF;

  SELECT * INTO plan_row
  FROM public.preliminary_survey_v2_plans
  WHERE measurement_target_business_id = p_target_id
  FOR UPDATE;
  before_plan := CASE WHEN FOUND THEN to_jsonb(plan_row) ELSE NULL END;
  next_source_rule_type := CASE WHEN target_row.business_type = 'existing' THEN 'existing' ELSE 'new' END;

  -- 찐확정 trigger bypass는 이 관리자 전용 transaction에서만 사용한다.
  PERFORM set_config('app.preliminary_survey_admin_repair', 'on', true);

  IF plan_row.id IS NULL THEN
    INSERT INTO public.preliminary_survey_v2_plans (
      measurement_target_business_id, recommended_date, responsible_user_id,
      experienced_reviewer_id, participant_user_ids, participant_names,
      status, plan_origin, source_measurement_date, source_address,
      source_daily_staff, source_collaborators, source_responsible_user_id,
      source_rule_type, survey_method, recommendation_reason, route_evidence, warnings
    ) VALUES (
      p_target_id, p_recommended_date, p_responsible_user_id,
      p_experienced_reviewer_user_id, p_participant_user_ids, p_participant_names,
      'recommended', 'manual', target_row.measurement_date, target_row.address,
      target_row.daily_staff, target_row.collaborators, target_row.measurer_id,
      next_source_rule_type, p_survey_method,
      jsonb_build_object(
        'reason', '관리자 수정 모달 직접수정',
        'adminOverride', true,
        'policyWarnings', COALESCE(p_policy_warnings, '[]'::jsonb)
      ),
      '{}'::jsonb, COALESCE(p_policy_warnings, '[]'::jsonb)
    ) RETURNING * INTO plan_row;
  ELSE
    UPDATE public.preliminary_survey_v2_plans AS current_plan
    SET recommended_date = p_recommended_date,
        responsible_user_id = p_responsible_user_id,
        experienced_reviewer_id = p_experienced_reviewer_user_id,
        participant_user_ids = p_participant_user_ids,
        participant_names = p_participant_names,
        status = 'recommended',
        plan_origin = 'manual',
        source_measurement_date = target_row.measurement_date,
        source_address = target_row.address,
        source_daily_staff = target_row.daily_staff,
        source_collaborators = target_row.collaborators,
        source_responsible_user_id = target_row.measurer_id,
        source_rule_type = next_source_rule_type,
        survey_method = p_survey_method,
        recommendation_reason = jsonb_build_object(
          'reason', '관리자 수정 모달 직접수정',
          'adminOverride', true,
          'policyWarnings', COALESCE(p_policy_warnings, '[]'::jsonb)
        ),
        warnings = COALESCE(p_policy_warnings, '[]'::jsonb),
        updated_at = CURRENT_TIMESTAMP
    WHERE current_plan.id = plan_row.id
    RETURNING * INTO plan_row;
  END IF;

  INSERT INTO public.preliminary_survey_v2_admin_manual_override_audit (
    measurement_target_business_id, plan_id, event_type,
    before_snapshot, after_snapshot, policy_warnings, changed_by_user_id
  ) VALUES (
    p_target_id, plan_row.id, 'plan',
    before_plan, to_jsonb(plan_row), COALESCE(p_policy_warnings, '[]'::jsonb), p_changed_by_user_id
  );

  RETURN plan_row;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_override_preliminary_survey_v2_plan(
  bigint, date, text, jsonb, jsonb, integer, integer, jsonb, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_override_preliminary_survey_v2_plan(
  bigint, date, text, jsonb, jsonb, integer, integer, jsonb, integer
) TO service_role;

NOTIFY pgrst, 'reload schema';
