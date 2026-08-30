-- service_role는 RLS를 우회하므로 명시 권한을 SELECT/INSERT로 재설정해 audit append-only를 강제한다.
REVOKE ALL ON TABLE public.preliminary_survey_v2_policy_repair_audit FROM service_role;
GRANT SELECT, INSERT ON TABLE public.preliminary_survey_v2_policy_repair_audit TO service_role;

REVOKE ALL ON TABLE public.preliminary_survey_v2_measurement_assignment_exception_audit FROM service_role;
GRANT SELECT, INSERT ON TABLE public.preliminary_survey_v2_measurement_assignment_exception_audit TO service_role;

REVOKE ALL ON TABLE public.preliminary_survey_v2_measurement_source_repair_audit FROM service_role;
GRANT SELECT, INSERT ON TABLE public.preliminary_survey_v2_measurement_source_repair_audit TO service_role;

NOTIFY pgrst, 'reload schema';

-- Direct service-role RPC도 현재 운영 정책의 날짜·인력 hard rule을 우회하지 못하게 한다.
-- 경로·용량의 세부 최적화는 route server가 계속 authoritative하게 검증하되, DB는 정책 후보와
-- 인력 가용성의 결정적 제약을 transaction 안에서 다시 확인한다.
CREATE OR REPLACE FUNCTION public.repair_true_confirmed_preliminary_v2_policy_date(
  p_target_id bigint,
  p_expected_plan_id uuid,
  p_expected_source_measurement_date date,
  p_expected_recommended_date date,
  p_recommended_date date,
  p_reason text,
  p_changed_by_user_id integer
) RETURNS public.preliminary_survey_v2_plans
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target_row public.measurement_target_business%ROWTYPE;
  plan_row public.preliminary_survey_v2_plans%ROWTYPE;
  repaired_plan public.preliminary_survey_v2_plans%ROWTYPE;
  working_day_distance integer;
BEGIN
  IF btrim(COALESCE(p_reason, '')) = '' THEN RAISE EXCEPTION 'REPAIR_REASON_REQUIRED'; END IF;
  SELECT * INTO target_row FROM public.measurement_target_business WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TARGET_NOT_FOUND'; END IF;
  IF NOT public.is_preliminary_survey_v2_true_confirmed(target_row.id) THEN RAISE EXCEPTION 'TRUE_CONFIRMED_REQUIRED'; END IF;
  IF target_row.measurement_date::date IS DISTINCT FROM p_expected_source_measurement_date THEN RAISE EXCEPTION 'REPAIR_SOURCE_CHANGED'; END IF;
  SELECT * INTO plan_row FROM public.preliminary_survey_v2_plans
    WHERE measurement_target_business_id = target_row.id FOR UPDATE;
  IF NOT FOUND OR plan_row.id IS DISTINCT FROM p_expected_plan_id
     OR plan_row.recommended_date IS DISTINCT FROM p_expected_recommended_date THEN RAISE EXCEPTION 'REPAIR_SOURCE_CHANGED'; END IF;
  IF p_recommended_date IS NULL OR target_row.business_type NOT IN ('existing', 'first_measurement', 'external_new') THEN
    RAISE EXCEPTION 'INVALID_RECOMMENDED_DATE';
  END IF;
  IF NOT public.preliminary_survey_v2_history_is_working_day(p_recommended_date) THEN
    RAISE EXCEPTION 'POLICY_DATE_REPAIR_NON_WORKING_DAY';
  END IF;
  working_day_distance := public.preliminary_survey_v2_history_working_days_before(p_recommended_date, target_row.measurement_date::date);
  IF (target_row.business_type = 'first_measurement' AND working_day_distance NOT BETWEEN 3 AND 20)
     OR (target_row.business_type IN ('existing', 'external_new') AND working_day_distance NOT BETWEEN 3 AND 25) THEN
    RAISE EXCEPTION 'POLICY_DATE_REPAIR_OUTSIDE_CANDIDATE_RANGE';
  END IF;
  IF target_row.business_type IN ('first_measurement', 'external_new') AND plan_row.survey_method <> 'field' THEN
    RAISE EXCEPTION 'POLICY_DATE_REPAIR_METHOD_MISMATCH';
  END IF;
  IF jsonb_typeof(plan_row.participant_user_ids) <> 'array' OR jsonb_array_length(plan_row.participant_user_ids) = 0
     OR NOT (plan_row.participant_user_ids @> to_jsonb(ARRAY[plan_row.responsible_user_id])) THEN
    RAISE EXCEPTION 'POLICY_DATE_REPAIR_PARTICIPANT_CONTEXT_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(plan_row.participant_user_ids) AS participant_id(value)
    LEFT JOIN public.users user_row ON user_row.id = participant_id.value::integer
    WHERE user_row.id IS NULL OR user_row.job <> '측정' OR user_row.is_active IS NOT TRUE
      OR user_row.id BETWEEN 9000 AND 9999
  ) THEN RAISE EXCEPTION 'POLICY_DATE_REPAIR_PARTICIPANT_INELIGIBLE'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_schedule_blocks schedule_block
    WHERE p_recommended_date BETWEEN schedule_block.start_date AND schedule_block.end_date
      AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(plan_row.participant_user_ids) AS participant_id(value)
        WHERE participant_id.value::integer = schedule_block.user_id)
  ) THEN RAISE EXCEPTION 'POLICY_DATE_REPAIR_USER_UNAVAILABLE'; END IF;

  PERFORM set_config('app.preliminary_survey_admin_repair', 'on', true);
  UPDATE public.preliminary_survey_v2_plans SET recommended_date = p_recommended_date
    WHERE id = plan_row.id RETURNING * INTO repaired_plan;
  INSERT INTO public.preliminary_survey_v2_policy_repair_audit(
    measurement_target_business_id, plan_id, repaired_fields, before_plan, after_plan,
    reason, provenance, changed_by_user_id
  ) VALUES (
    target_row.id, plan_row.id, '["recommended_date"]'::jsonb, to_jsonb(plan_row), to_jsonb(repaired_plan),
    btrim(p_reason), 'true_confirmed_policy_date_repair', p_changed_by_user_id
  );
  RETURN repaired_plan;
END;
$$;

REVOKE ALL ON FUNCTION public.repair_true_confirmed_preliminary_v2_policy_date(bigint, uuid, date, date, date, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_true_confirmed_preliminary_v2_policy_date(bigint, uuid, date, date, date, text, integer)
  TO service_role;
NOTIFY pgrst, 'reload schema';

-- Rollback (별도 승인): 이 forward function을 150000 정의로 복원한다. UPDATE/DELETE는 audit에 부여하지 않는다.
