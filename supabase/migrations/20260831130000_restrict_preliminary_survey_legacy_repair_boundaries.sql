-- Canonical true-confirmed 기준과 legacy write RPC의 service-only 경계를 맞춘다.
-- 기존 migration은 수정하지 않고 최종 함수/권한 상태만 forward 보정한다.

CREATE OR REPLACE FUNCTION public.admin_repair_preliminary_survey_connection(
  p_target_id bigint,
  p_participant_user_ids jsonb,
  p_participant_names jsonb,
  p_link_measurer_id integer,
  p_reason text,
  p_changed_by text
) RETURNS public.preliminary_survey_v2_plans
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target_row public.measurement_target_business;
  plan_row public.preliminary_survey_v2_plans;
  old_plan public.preliminary_survey_v2_plans;
  link_name text;
  staff_names text[] := ARRAY[]::text[];
  staff_extra text[] := ARRAY[]::text[];
  v_idx integer;
  v_id integer;
  v_name text;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'REASON_REQUIRED';
  END IF;

  IF p_participant_user_ids IS NULL OR jsonb_typeof(p_participant_user_ids) <> 'array'
     OR p_participant_names IS NULL OR jsonb_typeof(p_participant_names) <> 'array'
     OR jsonb_array_length(p_participant_user_ids) = 0
     OR jsonb_array_length(p_participant_user_ids) <> jsonb_array_length(p_participant_names) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PARTICIPANTS';
  END IF;

  SELECT * INTO target_row
  FROM public.measurement_target_business
  WHERE id = p_target_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'TARGET_NOT_FOUND';
  END IF;

  SELECT * INTO plan_row
  FROM public.preliminary_survey_v2_plans
  WHERE measurement_target_business_id = p_target_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'V2_PLAN_NOT_FOUND';
  END IF;
  old_plan := plan_row;

  -- sequence_number와 무관하게 measurement_journal row 존재 자체가 찐확정이다.
  IF NOT public.is_preliminary_survey_v2_true_confirmed(p_target_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TRUE_CONFIRMED_REQUIRED';
  END IF;

  FOR v_idx IN 0 .. jsonb_array_length(p_participant_user_ids) - 1 LOOP
    v_id := (p_participant_user_ids->>v_idx)::integer;
    v_name := p_participant_names->>v_idx;
    IF NOT EXISTS (
      SELECT 1 FROM public.users AS u WHERE u.id = v_id AND u.name = v_name
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PARTICIPANT_MISMATCH_AT_' || (v_idx + 1)::text;
    END IF;
  END LOOP;
  IF (
    SELECT COUNT(*)
    FROM (SELECT DISTINCT value::text FROM jsonb_array_elements(p_participant_user_ids)) AS unique_ids
  ) <> jsonb_array_length(p_participant_user_ids) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PARTICIPANT_DUPLICATE';
  END IF;

  SELECT COALESCE(array_agg(btrim(value)), ARRAY[]::text[])
  INTO staff_names
  FROM unnest(string_to_array(COALESCE(target_row.collaborators, ''), ',')) AS collaborator(value)
  WHERE btrim(value) <> '';

  IF target_row.daily_staff IS NOT NULL AND jsonb_typeof(target_row.daily_staff) = 'array' THEN
    SELECT COALESCE(array_agg(DISTINCT btrim(value)), ARRAY[]::text[])
    INTO staff_extra
    FROM jsonb_array_elements(target_row.daily_staff) AS staff_day(entry)
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(entry->'collaborators') = 'array' THEN entry->'collaborators'
        ELSE to_jsonb(string_to_array(COALESCE(entry->>'collaborators', ''), ','))
      END
    ) AS collaborator(value)
    WHERE btrim(value) <> '';
    staff_names := staff_names || staff_extra;
  END IF;

  IF p_link_measurer_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'LINK_MEASURER_REQUIRED';
  END IF;
  SELECT name INTO link_name FROM public.users WHERE id = p_link_measurer_id;
  IF link_name IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'LINK_MEASURER_NOT_FOUND';
  END IF;
  IF NOT p_participant_user_ids @> jsonb_build_array(p_link_measurer_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'LINK_MEASURER_NOT_IN_PARTICIPANTS';
  END IF;
  IF NOT (link_name = ANY(staff_names)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'LINK_MEASURER_NOT_IN_STAFF';
  END IF;

  -- 기존 true-confirmed trigger의 owner-only bypass를 이 repair transaction에만 사용한다.
  PERFORM set_config('app.preliminary_survey_admin_repair', 'on', true);

  UPDATE public.preliminary_survey_v2_plans
  SET participant_user_ids = p_participant_user_ids,
      participant_names = p_participant_names,
      responsible_user_id = p_link_measurer_id,
      plan_origin = 'manual',
      updated_at = CURRENT_TIMESTAMP
  WHERE id = plan_row.id
  RETURNING * INTO plan_row;

  UPDATE public.measurement_target_business
  SET link_measurer_id = p_link_measurer_id,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = p_target_id;

  INSERT INTO public.preliminary_survey_exception_log (
    measurement_target_business_id, code,
    old_participant_user_ids, new_participant_user_ids,
    old_participant_names, new_participant_names,
    old_link_measurer_id, new_link_measurer_id,
    changed_by, reason
  ) VALUES (
    p_target_id, target_row.code,
    COALESCE(old_plan.participant_user_ids, '[]'::jsonb), p_participant_user_ids,
    COALESCE(old_plan.participant_names, '[]'::jsonb), p_participant_names,
    target_row.link_measurer_id, p_link_measurer_id,
    COALESCE(p_changed_by, 'admin'), btrim(p_reason)
  );

  RETURN plan_row;
END;
$$;

-- SECURITY DEFINER write RPC는 server-only로 유지한다. PUBLIC revoke만으로는
-- 과거 explicit anon/authenticated grant가 제거되지 않으므로 역할별로 명시한다.
REVOKE ALL ON FUNCTION public.admin_repair_preliminary_survey_connection(
  bigint, jsonb, jsonb, integer, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_repair_preliminary_survey_connection(
  bigint, jsonb, jsonb, integer, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.confirm_preliminary_survey_group(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_preliminary_survey_group(jsonb)
  TO service_role;

NOTIFY pgrst, 'reload schema';

-- Rollback (별도 승인): 20260817_fix_admin_repair_audit_old_participants.sql의 함수 본문과
-- 당시 ACL을 복원한다. 단, anon/authenticated 직접 EXECUTE 재부여는 보안상 금지한다.
