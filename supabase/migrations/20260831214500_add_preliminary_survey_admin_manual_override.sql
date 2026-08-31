-- 관리자 수정 모달 전용 수동 override.
-- 자동추천/일반 repair 규칙은 유지하고, 관리자 직접 판단만 별도 RPC로 제한적으로 허용한다.

-- 관리자 직접수정에서는 동일일 4건 이상도 경고 후 저장할 수 있으므로 반복코드 길이를 고정 3자에서 해제한다.
ALTER TABLE public.preliminary_survey_v2_measurement_assignments
  DROP CONSTRAINT IF EXISTS preliminary_survey_v2_measurement_assignments_survey_code_check;
ALTER TABLE public.preliminary_survey_v2_measurement_assignments
  ADD CONSTRAINT preliminary_survey_v2_measurement_assignments_survey_code_check
  CHECK (survey_code ~ '^(A+|B+|C+|D+|F+|G+)$');

CREATE OR REPLACE FUNCTION public.validate_preliminary_survey_v2_measurement_assignment()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  configured_survey_code text;
BEGIN
  SELECT upper(btrim(COALESCE(survey_code, ''))) INTO configured_survey_code
  FROM public.users
  WHERE id = NEW.assignee_user_id AND is_active IS NOT FALSE AND job = '측정';

  IF configured_survey_code NOT IN ('A', 'B', 'C', 'D', 'F', 'G') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_SURVEY_CODE_REQUIRED';
  END IF;
  IF NEW.survey_code IS NULL OR NEW.survey_code !~ ('^' || configured_survey_code || '+$') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_SURVEY_CODE_MISMATCH';
  END IF;
  NEW.survey_code_source := 'users.survey_code';
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.preliminary_survey_v2_admin_manual_override_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_target_business_id bigint NOT NULL REFERENCES public.measurement_target_business(id) ON DELETE RESTRICT,
  plan_id uuid REFERENCES public.preliminary_survey_v2_plans(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('plan', 'measurement_assignment')),
  measurement_date date,
  before_snapshot jsonb,
  after_snapshot jsonb NOT NULL,
  policy_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  changed_by_user_id integer NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.preliminary_survey_v2_admin_manual_override_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.preliminary_survey_v2_admin_manual_override_audit
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.preliminary_survey_v2_admin_manual_override_audit TO service_role;

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
  source_rule_type text;
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
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'TARGET_NOT_FOUND'; END IF;

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
  source_rule_type := CASE WHEN target_row.business_type = 'existing' THEN 'existing' ELSE 'new' END;

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
      source_rule_type, p_survey_method,
      jsonb_build_object('reason', '관리자 수정 모달 직접수정', 'adminOverride', true,
        'policyWarnings', COALESCE(p_policy_warnings, '[]'::jsonb)),
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
        source_rule_type = source_rule_type,
        survey_method = p_survey_method,
        recommendation_reason = jsonb_build_object(
          'reason', '관리자 수정 모달 직접수정', 'adminOverride', true,
          'policyWarnings', COALESCE(p_policy_warnings, '[]'::jsonb)),
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

CREATE OR REPLACE FUNCTION public.admin_override_preliminary_survey_v2_measurement_assignment(
  p_target_id bigint,
  p_measurement_date date,
  p_expected_assignee_user_id integer,
  p_assignee_user_id integer,
  p_policy_warnings jsonb,
  p_changed_by_user_id integer
) RETURNS public.preliminary_survey_v2_measurement_assignments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target_row public.measurement_target_business%ROWTYPE;
  plan_row public.preliminary_survey_v2_plans%ROWTYPE;
  assignment_row public.preliminary_survey_v2_measurement_assignments%ROWTYPE;
  before_snapshot jsonb;
  after_snapshot jsonb;
  old_assignee_user_id integer;
  configured_survey_code text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_changed_by_user_id AND role = '관리자' AND is_active IS NOT FALSE
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ADMIN_OVERRIDE_FORBIDDEN';
  END IF;
  IF p_target_id IS NULL OR p_measurement_date IS NULL OR p_assignee_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_ADMIN_OVERRIDE_INPUT';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'preliminary-measurement-assignment|' || p_measurement_date::text, 0
  ));

  SELECT * INTO target_row FROM public.measurement_target_business
  WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'TARGET_NOT_FOUND'; END IF;

  IF jsonb_typeof(target_row.daily_staff) = 'array' AND jsonb_array_length(target_row.daily_staff) > 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(target_row.daily_staff) staff_day(value)
      WHERE staff_day.value->>'date' = p_measurement_date::text
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_DATE_NOT_IN_TARGET';
    END IF;
  ELSIF target_row.measurement_date::date IS DISTINCT FROM p_measurement_date THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_DATE_NOT_IN_TARGET';
  END IF;

  SELECT * INTO plan_row FROM public.preliminary_survey_v2_plans
  WHERE measurement_target_business_id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'V2_PLAN_NOT_FOUND'; END IF;

  SELECT upper(btrim(COALESCE(survey_code, ''))) INTO configured_survey_code
  FROM public.users
  WHERE id = p_assignee_user_id AND job = '측정' AND is_active IS NOT FALSE;
  IF configured_survey_code NOT IN ('A','B','C','D','F','G') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_SURVEY_CODE_REQUIRED';
  END IF;

  SELECT * INTO assignment_row
  FROM public.preliminary_survey_v2_measurement_assignments
  WHERE plan_id = plan_row.id AND measurement_date = p_measurement_date
  FOR UPDATE;

  IF assignment_row.id IS NOT NULL AND p_expected_assignee_user_id IS NOT NULL
     AND assignment_row.assignee_user_id IS DISTINCT FROM p_expected_assignee_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_SOURCE_CHANGED';
  END IF;
  old_assignee_user_id := assignment_row.assignee_user_id;

  SELECT jsonb_build_object(
    'assignment', CASE WHEN assignment_row.id IS NULL THEN NULL ELSE to_jsonb(assignment_row) END,
    'groups', COALESCE(jsonb_agg(to_jsonb(group_assignment) ORDER BY group_assignment.assignee_user_id, group_assignment.id)
      FILTER (WHERE group_assignment.id IS NOT NULL), '[]'::jsonb)
  ) INTO before_snapshot
  FROM public.preliminary_survey_v2_measurement_assignments group_assignment
  WHERE group_assignment.measurement_date = p_measurement_date
    AND (group_assignment.assignee_user_id = p_assignee_user_id
      OR (old_assignee_user_id IS NOT NULL AND group_assignment.assignee_user_id = old_assignee_user_id));

  PERFORM set_config('app.preliminary_survey_admin_repair', 'on', true);

  IF assignment_row.id IS NULL THEN
    INSERT INTO public.preliminary_survey_v2_measurement_assignments (
      plan_id, measurement_date, assignee_user_id, survey_code, assignment_reason
    ) VALUES (
      plan_row.id, p_measurement_date, p_assignee_user_id, configured_survey_code,
      '관리자 수정 모달 직접수정'
    ) RETURNING * INTO assignment_row;
  ELSE
    UPDATE public.preliminary_survey_v2_measurement_assignments
    SET assignee_user_id = p_assignee_user_id,
        survey_code = configured_survey_code,
        assignment_reason = '관리자 수정 모달 직접수정',
        approval_required = false,
        approval_group_fingerprint = NULL,
        approved_by_user_id = NULL,
        approved_at = NULL
    WHERE id = assignment_row.id
    RETURNING * INTO assignment_row;
  END IF;

  -- 이전/신규 담당자 그룹을 모두 동일 날짜 기준으로 C/CC/CCC/CCCC... 재정규화한다.
  WITH affected AS (
    SELECT DISTINCT assignee_user_id
    FROM (VALUES (old_assignee_user_id), (p_assignee_user_id)) AS ids(assignee_user_id)
    WHERE assignee_user_id IS NOT NULL
  ), ranked AS (
    SELECT assignment.id,
      repeat(upper(btrim(user_row.survey_code)), row_number() OVER (
        PARTITION BY assignment.measurement_date, assignment.assignee_user_id
        ORDER BY grouped_plan.measurement_target_business_id, assignment.created_at, assignment.id
      )::integer) AS next_code
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    JOIN public.preliminary_survey_v2_plans grouped_plan ON grouped_plan.id = assignment.plan_id
    JOIN public.users user_row ON user_row.id = assignment.assignee_user_id
    JOIN affected ON affected.assignee_user_id = assignment.assignee_user_id
    WHERE assignment.measurement_date = p_measurement_date
  )
  UPDATE public.preliminary_survey_v2_measurement_assignments assignment
  SET survey_code = ranked.next_code,
      approval_required = false,
      approval_group_fingerprint = NULL,
      approved_by_user_id = NULL,
      approved_at = NULL
  FROM ranked
  WHERE assignment.id = ranked.id;

  SELECT jsonb_build_object(
    'assignment', to_jsonb(updated_assignment),
    'groups', COALESCE((
      SELECT jsonb_agg(to_jsonb(group_assignment) ORDER BY group_assignment.assignee_user_id, group_assignment.id)
      FROM public.preliminary_survey_v2_measurement_assignments group_assignment
      WHERE group_assignment.measurement_date = p_measurement_date
        AND (group_assignment.assignee_user_id = p_assignee_user_id
          OR (old_assignee_user_id IS NOT NULL AND group_assignment.assignee_user_id = old_assignee_user_id))
    ), '[]'::jsonb)
  ) INTO after_snapshot
  FROM public.preliminary_survey_v2_measurement_assignments updated_assignment
  WHERE updated_assignment.id = assignment_row.id;

  INSERT INTO public.preliminary_survey_v2_admin_manual_override_audit (
    measurement_target_business_id, plan_id, event_type, measurement_date,
    before_snapshot, after_snapshot, policy_warnings, changed_by_user_id
  ) VALUES (
    p_target_id, plan_row.id, 'measurement_assignment', p_measurement_date,
    before_snapshot, after_snapshot, COALESCE(p_policy_warnings, '[]'::jsonb), p_changed_by_user_id
  );

  SELECT * INTO assignment_row
  FROM public.preliminary_survey_v2_measurement_assignments
  WHERE id = assignment_row.id;
  RETURN assignment_row;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_override_preliminary_survey_v2_plan(
  bigint, date, text, jsonb, jsonb, integer, integer, jsonb, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_override_preliminary_survey_v2_plan(
  bigint, date, text, jsonb, jsonb, integer, integer, jsonb, integer
) TO service_role;

REVOKE ALL ON FUNCTION public.admin_override_preliminary_survey_v2_measurement_assignment(
  bigint, date, integer, integer, jsonb, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_override_preliminary_survey_v2_measurement_assignment(
  bigint, date, integer, integer, jsonb, integer
) TO service_role;

NOTIFY pgrst, 'reload schema';
