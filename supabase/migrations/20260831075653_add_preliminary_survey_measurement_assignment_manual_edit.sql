-- 권한자가 비찐확정 사업장의 실제 측정일별 공시료 담당자를 최소 수정한다.
-- 같은 날짜의 이전/신규 담당자 그룹은 기존 153000 trigger가 한 transaction에서 재정규화한다.
CREATE TABLE public.preliminary_survey_v2_measurement_assignment_manual_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid REFERENCES public.preliminary_survey_v2_measurement_assignments(id) ON DELETE SET NULL,
  plan_id uuid REFERENCES public.preliminary_survey_v2_plans(id) ON DELETE SET NULL,
  measurement_target_business_id bigint NOT NULL REFERENCES public.measurement_target_business(id) ON DELETE RESTRICT,
  measurement_date date NOT NULL,
  before_assignment jsonb NOT NULL,
  after_assignment jsonb NOT NULL,
  before_groups jsonb NOT NULL,
  after_groups jsonb NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  changed_by_user_id integer NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.preliminary_survey_v2_measurement_assignment_manual_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.preliminary_survey_v2_measurement_assignment_manual_audit
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.preliminary_survey_v2_measurement_assignment_manual_audit TO service_role;

CREATE OR REPLACE FUNCTION public.update_preliminary_survey_v2_measurement_assignment(
  p_assignment_id uuid,
  p_expected_assignee_user_id integer,
  p_assignee_user_id integer,
  p_reason text,
  p_changed_by_user_id integer,
  p_approve_third_assignment boolean DEFAULT false,
  p_expected_approval_group_fingerprint text DEFAULT NULL
) RETURNS SETOF public.preliminary_survey_v2_measurement_assignments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  assignment_row public.preliminary_survey_v2_measurement_assignments%ROWTYPE;
  plan_row public.preliminary_survey_v2_plans%ROWTYPE;
  target_row public.measurement_target_business%ROWTYPE;
  actor_is_admin boolean := false;
  actor_can_manage boolean := false;
  configured_survey_code text;
  new_group_count integer;
  before_assignment jsonb;
  after_assignment jsonb;
  before_groups jsonb;
  after_groups jsonb;
  exception_after_groups jsonb;
  after_target_ids bigint[];
  proposed_target_ids bigint[];
  proposed_group_fingerprint text;
  approval_timestamp timestamptz;
BEGIN
  IF p_assignment_id IS NULL OR p_expected_assignee_user_id IS NULL OR p_assignee_user_id IS NULL
     OR p_changed_by_user_id IS NULL OR btrim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_MEASUREMENT_ASSIGNMENT_MANUAL_EDIT';
  END IF;

  SELECT role = '관리자', role = '관리자' OR is_preliminary_survey_manager IS TRUE
    INTO actor_is_admin, actor_can_manage
  FROM public.users
  WHERE id = p_changed_by_user_id AND is_active IS NOT FALSE;
  IF actor_can_manage IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MEASUREMENT_ASSIGNMENT_MANUAL_EDIT_FORBIDDEN';
  END IF;
  IF p_approve_third_assignment IS TRUE AND actor_is_admin IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MEASUREMENT_ASSIGNMENT_ADMIN_EXCEPTION_REQUIRED';
  END IF;

  SELECT * INTO assignment_row
  FROM public.preliminary_survey_v2_measurement_assignments
  WHERE id = p_assignment_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MEASUREMENT_ASSIGNMENT_NOT_FOUND'; END IF;
  IF assignment_row.assignee_user_id <> p_expected_assignee_user_id THEN
    RAISE EXCEPTION 'MEASUREMENT_ASSIGNMENT_SOURCE_CHANGED';
  END IF;
  IF assignment_row.assignee_user_id = p_assignee_user_id THEN
    RAISE EXCEPTION 'MEASUREMENT_ASSIGNMENT_ASSIGNEE_UNCHANGED';
  END IF;

  SELECT * INTO plan_row FROM public.preliminary_survey_v2_plans WHERE id = assignment_row.plan_id FOR UPDATE;
  SELECT * INTO target_row FROM public.measurement_target_business
  WHERE id = plan_row.measurement_target_business_id FOR UPDATE;
  IF public.is_preliminary_survey_v2_true_confirmed(target_row.id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TRUE_CONFIRMED_LOCKED';
  END IF;

  IF jsonb_typeof(target_row.daily_staff) = 'array' AND jsonb_array_length(target_row.daily_staff) > 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(target_row.daily_staff) AS staff_day(value)
      WHERE staff_day.value->>'date' = assignment_row.measurement_date::text
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_DATE_NOT_IN_TARGET';
    END IF;
  ELSIF target_row.measurement_date::text <> assignment_row.measurement_date::text THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_DATE_NOT_IN_TARGET';
  END IF;

  SELECT upper(btrim(COALESCE(survey_code, ''))) INTO configured_survey_code
  FROM public.users
  WHERE id = p_assignee_user_id AND is_active IS NOT FALSE AND job = '측정';
  IF configured_survey_code NOT IN ('A', 'B', 'C', 'D', 'F', 'G') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_SURVEY_CODE_REQUIRED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_schedule_blocks
    WHERE user_id = p_assignee_user_id
      AND assignment_row.measurement_date BETWEEN start_date AND end_date
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_USER_SCHEDULE_BLOCKED';
  END IF;

  -- 같은 날짜의 모든 수동수정을 직렬화하고 이전/신규 그룹 전체를 안정된 순서로 잠근다.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'preliminary-survey-measurement-assignment|' || assignment_row.measurement_date::text, 0
  ));
  PERFORM 1
  FROM public.preliminary_survey_v2_measurement_assignments locked_assignment
  WHERE locked_assignment.measurement_date = assignment_row.measurement_date
    AND locked_assignment.assignee_user_id IN (assignment_row.assignee_user_id, p_assignee_user_id)
  ORDER BY locked_assignment.assignee_user_id, locked_assignment.id
  FOR UPDATE;

  SELECT count(*) + 1 INTO new_group_count
  FROM public.preliminary_survey_v2_measurement_assignments grouped_assignment
  WHERE grouped_assignment.measurement_date = assignment_row.measurement_date
    AND grouped_assignment.assignee_user_id = p_assignee_user_id
    AND grouped_assignment.id <> assignment_row.id;
  IF new_group_count >= 4 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_HARD_MAX_EXCEEDED';
  END IF;
  SELECT array_agg(target_id ORDER BY target_id) INTO proposed_target_ids
  FROM (
    SELECT grouped_plan.measurement_target_business_id AS target_id
    FROM public.preliminary_survey_v2_measurement_assignments grouped_assignment
    JOIN public.preliminary_survey_v2_plans grouped_plan ON grouped_plan.id = grouped_assignment.plan_id
    WHERE grouped_assignment.measurement_date = assignment_row.measurement_date
      AND grouped_assignment.assignee_user_id = p_assignee_user_id
      AND grouped_assignment.id <> assignment_row.id
    UNION ALL
    SELECT target_row.id
  ) proposed_group;
  proposed_group_fingerprint := md5(
    assignment_row.measurement_date::text || '|' || p_assignee_user_id::text || '|' ||
    array_to_string(proposed_target_ids, ',')
  );
  IF new_group_count = 3 AND (p_approve_third_assignment IS NOT TRUE OR actor_is_admin IS NOT TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'MEASUREMENT_ASSIGNMENT_ADMIN_EXCEPTION_REQUIRED:' || proposed_group_fingerprint;
  END IF;
  IF p_approve_third_assignment IS TRUE AND new_group_count <> 3 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'MEASUREMENT_ASSIGNMENT_SOURCE_CHANGED';
  END IF;
  IF new_group_count = 3 AND p_expected_approval_group_fingerprint IS DISTINCT FROM proposed_group_fingerprint THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'MEASUREMENT_ASSIGNMENT_SOURCE_CHANGED';
  END IF;

  SELECT to_jsonb(assignment_row) INTO before_assignment;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'assignmentId', grouped_assignment.id,
    'targetId', grouped_plan.measurement_target_business_id,
    'assigneeUserId', grouped_assignment.assignee_user_id,
    'surveyCode', grouped_assignment.survey_code
  ) ORDER BY grouped_assignment.assignee_user_id, grouped_plan.measurement_target_business_id), '[]'::jsonb)
  INTO before_groups
  FROM public.preliminary_survey_v2_measurement_assignments grouped_assignment
  JOIN public.preliminary_survey_v2_plans grouped_plan ON grouped_plan.id = grouped_assignment.plan_id
  WHERE grouped_assignment.measurement_date = assignment_row.measurement_date
    AND grouped_assignment.assignee_user_id IN (assignment_row.assignee_user_id, p_assignee_user_id);

  UPDATE public.preliminary_survey_v2_measurement_assignments
  SET assignee_user_id = p_assignee_user_id,
      survey_code = configured_survey_code,
      assignment_reason = '권한자 날짜별 공시료 수동 수정: ' || btrim(p_reason)
  WHERE id = assignment_row.id;

  approval_timestamp := clock_timestamp();
  -- 이동 전/후 두 그룹 모두 canonical 코드와 승인 metadata를 함께 정규화한다.
  WITH affected_keys AS (
    SELECT assignment_row.measurement_date AS measurement_date, assignment_row.assignee_user_id AS assignee_user_id
    UNION
    SELECT assignment_row.measurement_date, p_assignee_user_id
  ), grouped AS (
    SELECT assignment.measurement_date, assignment.assignee_user_id, count(*) AS assignment_count,
      md5(assignment.measurement_date::text || '|' || assignment.assignee_user_id::text || '|' ||
        string_agg(grouped_plan.measurement_target_business_id::text, ',' ORDER BY grouped_plan.measurement_target_business_id)) AS fingerprint
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    JOIN public.preliminary_survey_v2_plans grouped_plan ON grouped_plan.id = assignment.plan_id
    JOIN affected_keys USING (measurement_date, assignee_user_id)
    GROUP BY assignment.measurement_date, assignment.assignee_user_id
  ), ranked AS (
    SELECT assignment.id, grouped.assignment_count, grouped.fingerprint,
      repeat(upper(btrim(user_row.survey_code)), row_number() OVER (
        PARTITION BY assignment.measurement_date, assignment.assignee_user_id
        ORDER BY grouped_plan.measurement_target_business_id, assignment.created_at, assignment.id
      )::integer) AS next_survey_code,
      row_number() OVER (
        PARTITION BY assignment.measurement_date, assignment.assignee_user_id
        ORDER BY grouped_plan.measurement_target_business_id, assignment.created_at, assignment.id
      ) AS assignment_position,
      assignment.approval_group_fingerprint AS previous_fingerprint,
      assignment.approved_by_user_id AS previous_approver,
      assignment.approved_at AS previous_approved_at
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    JOIN public.preliminary_survey_v2_plans grouped_plan ON grouped_plan.id = assignment.plan_id
    JOIN public.users user_row ON user_row.id = assignment.assignee_user_id
    JOIN grouped USING (measurement_date, assignee_user_id)
  )
  UPDATE public.preliminary_survey_v2_measurement_assignments assignment
  SET survey_code = ranked.next_survey_code,
    approval_required = ranked.assignment_count = 3 AND ranked.assignment_position = 3,
    approval_group_fingerprint = CASE
      WHEN ranked.assignment_count = 3 AND ranked.assignment_position = 3 THEN ranked.fingerprint ELSE NULL END,
    approved_by_user_id = CASE
      WHEN ranked.assignment_count <> 3 OR ranked.assignment_position <> 3 THEN NULL
      WHEN ranked.fingerprint = proposed_group_fingerprint THEN p_changed_by_user_id
      WHEN ranked.previous_fingerprint = ranked.fingerprint THEN ranked.previous_approver
      ELSE NULL END,
    approved_at = CASE
      WHEN ranked.assignment_count <> 3 OR ranked.assignment_position <> 3 THEN NULL
      WHEN ranked.fingerprint = proposed_group_fingerprint THEN approval_timestamp
      WHEN ranked.previous_fingerprint = ranked.fingerprint THEN ranked.previous_approved_at
      ELSE NULL END
  FROM ranked
  WHERE assignment.id = ranked.id;

  SELECT to_jsonb(updated_assignment) INTO after_assignment
  FROM public.preliminary_survey_v2_measurement_assignments updated_assignment
  WHERE updated_assignment.id = assignment_row.id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'assignmentId', grouped_assignment.id,
    'targetId', grouped_plan.measurement_target_business_id,
    'assigneeUserId', grouped_assignment.assignee_user_id,
    'surveyCode', grouped_assignment.survey_code
  ) ORDER BY grouped_assignment.assignee_user_id, grouped_plan.measurement_target_business_id), '[]'::jsonb)
  INTO after_groups
  FROM public.preliminary_survey_v2_measurement_assignments grouped_assignment
  JOIN public.preliminary_survey_v2_plans grouped_plan ON grouped_plan.id = grouped_assignment.plan_id
  WHERE grouped_assignment.measurement_date = assignment_row.measurement_date
    AND grouped_assignment.assignee_user_id IN (assignment_row.assignee_user_id, p_assignee_user_id);

  SELECT array_agg(grouped_plan.measurement_target_business_id ORDER BY grouped_plan.measurement_target_business_id),
    jsonb_agg(jsonb_build_object(
      'targetId', grouped_plan.measurement_target_business_id,
      'surveyCode', grouped_assignment.survey_code
    ) ORDER BY grouped_plan.measurement_target_business_id)
  INTO after_target_ids, exception_after_groups
  FROM public.preliminary_survey_v2_measurement_assignments grouped_assignment
  JOIN public.preliminary_survey_v2_plans grouped_plan ON grouped_plan.id = grouped_assignment.plan_id
  WHERE grouped_assignment.measurement_date = assignment_row.measurement_date
    AND grouped_assignment.assignee_user_id = p_assignee_user_id;

  INSERT INTO public.preliminary_survey_v2_measurement_assignment_manual_audit(
    assignment_id, plan_id, measurement_target_business_id, measurement_date,
    before_assignment, after_assignment, before_groups, after_groups, reason, changed_by_user_id
  ) VALUES (
    assignment_row.id, assignment_row.plan_id, target_row.id, assignment_row.measurement_date,
    before_assignment, after_assignment, before_groups, after_groups, btrim(p_reason), p_changed_by_user_id
  );

  IF new_group_count = 3 THEN
    INSERT INTO public.preliminary_survey_v2_measurement_assignment_exception_audit(
      event_fingerprint, measurement_date, assignee_user_id, measurement_target_business_ids,
      before_survey_codes, after_survey_codes, approved_by_user_id
    ) VALUES (
      md5(proposed_group_fingerprint || '|' || approval_timestamp::text),
      assignment_row.measurement_date, p_assignee_user_id, after_target_ids,
      before_groups, exception_after_groups, p_changed_by_user_id
    );
  END IF;

  RETURN QUERY SELECT * FROM public.preliminary_survey_v2_measurement_assignments WHERE id = assignment_row.id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_preliminary_survey_v2_measurement_assignment(uuid, integer, integer, text, integer, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_preliminary_survey_v2_measurement_assignment(uuid, integer, integer, text, integer, boolean, text)
  TO service_role;

COMMENT ON FUNCTION public.update_preliminary_survey_v2_measurement_assignment(uuid, integer, integer, text, integer, boolean, text) IS
  '서버 권한검사 후 비찐확정 날짜별 공시료 담당자를 최소 수정하고 영향 그룹 코드를 원자 재정규화한다.';

-- 최초실시/타기관 신규 찐확정의 잘못된 유선 방식은 plan의 survey_method 한 필드만 방문으로 보정한다.
ALTER TABLE public.preliminary_survey_v2_policy_repair_audit
  DROP CONSTRAINT IF EXISTS preliminary_survey_v2_policy_repair_audit_repaired_fields_check;
ALTER TABLE public.preliminary_survey_v2_policy_repair_audit
  ADD CONSTRAINT preliminary_survey_v2_policy_repair_audit_repaired_fields_check
  CHECK (repaired_fields IN ('["recommended_date"]'::jsonb, '["survey_method"]'::jsonb));
ALTER TABLE public.preliminary_survey_v2_policy_repair_audit
  DROP CONSTRAINT IF EXISTS preliminary_survey_v2_policy_repair_audit_provenance_check;
ALTER TABLE public.preliminary_survey_v2_policy_repair_audit
  ADD CONSTRAINT preliminary_survey_v2_policy_repair_audit_provenance_check
  CHECK (provenance IN ('true_confirmed_policy_date_repair', 'true_confirmed_policy_method_repair'));

CREATE OR REPLACE FUNCTION public.repair_true_confirmed_preliminary_v2_policy_method(
  p_target_id bigint,
  p_expected_plan_id uuid,
  p_expected_survey_method text,
  p_reason text,
  p_changed_by_user_id integer
) RETURNS public.preliminary_survey_v2_plans
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target_row public.measurement_target_business%ROWTYPE;
  plan_row public.preliminary_survey_v2_plans%ROWTYPE;
  repaired_plan public.preliminary_survey_v2_plans%ROWTYPE;
  actor_can_manage boolean := false;
  working_day_distance integer;
BEGIN
  IF btrim(COALESCE(p_reason, '')) = '' THEN RAISE EXCEPTION 'REPAIR_REASON_REQUIRED'; END IF;
  SELECT role = '관리자' OR is_preliminary_survey_manager IS TRUE INTO actor_can_manage
  FROM public.users WHERE id = p_changed_by_user_id AND is_active IS NOT FALSE;
  IF actor_can_manage IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POLICY_METHOD_REPAIR_FORBIDDEN';
  END IF;
  -- 희소한 관리자 repair 동안 hard-rule 원천의 동시 변경을 막고 transaction 안에서 다시 검증한다.
  LOCK TABLE public.preliminary_survey_v2_plans IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.measurement_target_business IN SHARE MODE;
  LOCK TABLE public.user_schedule_blocks IN SHARE MODE;
  LOCK TABLE public.preliminary_survey IN SHARE MODE;
  SELECT * INTO target_row FROM public.measurement_target_business WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TARGET_NOT_FOUND'; END IF;
  IF NOT public.is_preliminary_survey_v2_true_confirmed(target_row.id) THEN RAISE EXCEPTION 'TRUE_CONFIRMED_REQUIRED'; END IF;
  IF target_row.business_type NOT IN ('first_measurement', 'external_new') THEN
    RAISE EXCEPTION 'POLICY_METHOD_REPAIR_NOT_REQUIRED';
  END IF;
  SELECT * INTO plan_row FROM public.preliminary_survey_v2_plans
  WHERE measurement_target_business_id = target_row.id FOR UPDATE;
  IF NOT FOUND OR plan_row.id IS DISTINCT FROM p_expected_plan_id
     OR plan_row.survey_method IS DISTINCT FROM p_expected_survey_method THEN
    RAISE EXCEPTION 'REPAIR_SOURCE_CHANGED';
  END IF;
  IF plan_row.survey_method = 'field' THEN RAISE EXCEPTION 'POLICY_METHOD_REPAIR_NOT_REQUIRED'; END IF;

  IF NOT public.preliminary_survey_v2_history_is_working_day(plan_row.recommended_date) THEN
    RAISE EXCEPTION 'POLICY_METHOD_REPAIR_NON_WORKING_DAY';
  END IF;
  working_day_distance := public.preliminary_survey_v2_history_working_days_before(
    plan_row.recommended_date, target_row.measurement_date::date
  );
  IF (target_row.business_type = 'first_measurement' AND working_day_distance NOT BETWEEN 3 AND 20)
     OR (target_row.business_type = 'external_new' AND working_day_distance NOT BETWEEN 3 AND 25) THEN
    RAISE EXCEPTION 'POLICY_METHOD_REPAIR_OUTSIDE_CANDIDATE_RANGE';
  END IF;
  IF jsonb_typeof(plan_row.participant_user_ids) <> 'array' OR jsonb_array_length(plan_row.participant_user_ids) = 0
     OR NOT (plan_row.participant_user_ids @> to_jsonb(ARRAY[plan_row.responsible_user_id])) THEN
    RAISE EXCEPTION 'POLICY_METHOD_REPAIR_PARTICIPANT_CONTEXT_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(plan_row.participant_user_ids) AS participant_id(value)
    LEFT JOIN public.users user_row ON user_row.id = participant_id.value::integer
    WHERE user_row.id IS NULL OR user_row.job <> '측정' OR user_row.is_active IS NOT TRUE
      OR user_row.id BETWEEN 9000 AND 9999
  ) OR NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(plan_row.participant_user_ids) AS participant_id(value)
    JOIN public.users user_row ON user_row.id = participant_id.value::integer
    WHERE user_row.is_preliminary_survey_experienced IS TRUE
  ) THEN RAISE EXCEPTION 'POLICY_METHOD_REPAIR_PARTICIPANT_INELIGIBLE'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_schedule_blocks schedule_block
    WHERE plan_row.recommended_date BETWEEN schedule_block.start_date AND schedule_block.end_date
      AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(plan_row.participant_user_ids) AS participant_id(value)
        WHERE participant_id.value::integer = schedule_block.user_id)
  ) THEN RAISE EXCEPTION 'POLICY_METHOD_REPAIR_USER_UNAVAILABLE'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.preliminary_survey_v2_plans other_plan
    WHERE other_plan.id <> plan_row.id AND other_plan.recommended_date = plan_row.recommended_date
      AND other_plan.survey_method = 'field'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(plan_row.participant_user_ids) AS current_participant(value)
        JOIN jsonb_array_elements_text(other_plan.participant_user_ids) AS other_participant(value)
          ON other_participant.value = current_participant.value)
  ) THEN RAISE EXCEPTION 'POLICY_METHOD_REPAIR_FIELD_ROUTE_MANUAL_REVIEW'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.preliminary_survey legacy_survey
    JOIN jsonb_array_elements_text(plan_row.participant_names) AS participant_name(value)
      ON position(lower(participant_name.value) IN lower(COALESCE(legacy_survey.actual_measurer, ''))) > 0
    WHERE legacy_survey.measurement_date = plan_row.recommended_date
  ) THEN RAISE EXCEPTION 'POLICY_METHOD_REPAIR_ACTUAL_MEASUREMENT_CONFLICT'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.measurement_target_business measurement_target
    JOIN jsonb_array_elements_text(plan_row.participant_user_ids) AS participant_id(value) ON true
    JOIN public.users participant_user ON participant_user.id = participant_id.value::integer
    WHERE measurement_target.id <> target_row.id AND (
      ((jsonb_typeof(measurement_target.daily_staff) IS DISTINCT FROM 'array' OR jsonb_array_length(measurement_target.daily_staff) = 0)
        AND measurement_target.measurement_date = plan_row.recommended_date::text
        AND EXISTS (SELECT 1 FROM unnest(string_to_array(COALESCE(measurement_target.collaborators, ''), ',')) AS collaborator(value)
          WHERE btrim(collaborator.value) IN (participant_user.id::text, participant_user.name)))
      OR (jsonb_typeof(measurement_target.daily_staff) = 'array' AND jsonb_array_length(measurement_target.daily_staff) > 0 AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(measurement_target.daily_staff) AS staff_day(value)
        WHERE staff_day.value->>'date' = plan_row.recommended_date::text
          AND ((staff_day.value->>'main_measurer_id') IN (participant_user.id::text, participant_user.name)
            OR EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(CASE jsonb_typeof(COALESCE(NULLIF(staff_day.value->'helper_ids', 'null'::jsonb), staff_day.value->'collaborators'))
                WHEN 'array' THEN COALESCE(NULLIF(staff_day.value->'helper_ids', 'null'::jsonb), staff_day.value->'collaborators')
                WHEN 'string' THEN to_jsonb(string_to_array(COALESCE(NULLIF(staff_day.value->'helper_ids', 'null'::jsonb), staff_day.value->'collaborators') #>> '{}', ','))
                ELSE '[]'::jsonb END) AS helper(value)
              WHERE btrim(helper.value) IN (participant_user.id::text, participant_user.name)
            ))
      ))
    )
  ) THEN RAISE EXCEPTION 'POLICY_METHOD_REPAIR_MEASUREMENT_TARGET_CONFLICT'; END IF;

  PERFORM set_config('app.preliminary_survey_admin_repair', 'on', true);
  UPDATE public.preliminary_survey_v2_plans SET survey_method = 'field'
  WHERE id = plan_row.id RETURNING * INTO repaired_plan;
  INSERT INTO public.preliminary_survey_v2_policy_repair_audit(
    measurement_target_business_id, plan_id, repaired_fields, before_plan, after_plan,
    reason, provenance, changed_by_user_id
  ) VALUES (
    target_row.id, plan_row.id, '["survey_method"]'::jsonb, to_jsonb(plan_row), to_jsonb(repaired_plan),
    btrim(p_reason), 'true_confirmed_policy_method_repair', p_changed_by_user_id
  );
  RETURN repaired_plan;
END;
$$;

REVOKE ALL ON FUNCTION public.repair_true_confirmed_preliminary_v2_policy_method(bigint, uuid, text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_true_confirmed_preliminary_v2_policy_method(bigint, uuid, text, text, integer)
  TO service_role;

NOTIFY pgrst, 'reload schema';

-- Rollback(별도 승인): 위 RPC를 DROP하고 manual audit table을 보존 또는 별도 승인 후 DROP한다.
