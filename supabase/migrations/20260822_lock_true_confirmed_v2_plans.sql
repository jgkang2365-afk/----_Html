-- 유효한 measurement_journal row가 하나라도 있는 대상은 찐확정이다.
-- 일반 V2 단건/배치 저장을 DB 경계에서도 차단하고 관리자 repair RPC는 유지한다.

ALTER FUNCTION public.persist_preliminary_survey_v2_plan(
  bigint, date, integer, integer, jsonb, jsonb, text, text, text, integer, text, text, jsonb, jsonb, jsonb
) RENAME TO persist_preliminary_survey_v2_plan_unlocked;

ALTER FUNCTION public.persist_preliminary_survey_v2_plan_batch(jsonb)
  RENAME TO persist_preliminary_survey_v2_plan_batch_unlocked;

CREATE FUNCTION public.persist_preliminary_survey_v2_plan(
  p_target_id bigint,
  p_recommended_date date,
  p_responsible_user_id integer,
  p_experienced_reviewer_id integer,
  p_participant_user_ids jsonb,
  p_participant_names jsonb,
  p_status text,
  p_plan_origin text,
  p_source_measurement_date text,
  p_source_responsible_user_id integer,
  p_source_rule_type text,
  p_survey_method text,
  p_recommendation_reason jsonb,
  p_route_evidence jsonb,
  p_warnings jsonb
) RETURNS SETOF public.preliminary_survey_v2_plans
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.measurement_target_business target
    JOIN public.measurement_journal journal
      ON journal.code = target.code
     AND journal.measurement_year = target.year
     AND btrim(replace(journal.measurement_period, '(수시)', '')) = btrim(replace(target.period, '(수시)', ''))
    WHERE target.id = p_target_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TRUE_CONFIRMED_LOCKED';
  END IF;

  RETURN QUERY SELECT * FROM public.persist_preliminary_survey_v2_plan_unlocked(
    p_target_id, p_recommended_date, p_responsible_user_id, p_experienced_reviewer_id,
    p_participant_user_ids, p_participant_names, p_status, p_plan_origin,
    p_source_measurement_date, p_source_responsible_user_id, p_source_rule_type,
    p_survey_method, p_recommendation_reason, p_route_evidence, p_warnings
  );
END;
$$;

CREATE FUNCTION public.persist_preliminary_survey_v2_plan_batch(p_plans jsonb)
RETURNS SETOF public.preliminary_survey_v2_plans
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_plans, '[]'::jsonb)) item
    JOIN public.measurement_target_business target ON target.id = (item->>'target_id')::bigint
    JOIN public.measurement_journal journal
      ON journal.code = target.code
     AND journal.measurement_year = target.year
     AND btrim(replace(journal.measurement_period, '(수시)', '')) = btrim(replace(target.period, '(수시)', ''))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TRUE_CONFIRMED_LOCKED';
  END IF;

  RETURN QUERY SELECT * FROM public.persist_preliminary_survey_v2_plan_batch_unlocked(p_plans);
END;
$$;

REVOKE ALL ON FUNCTION public.persist_preliminary_survey_v2_plan_unlocked(
  bigint, date, integer, integer, jsonb, jsonb, text, text, text, integer, text, text, jsonb, jsonb, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.persist_preliminary_survey_v2_plan_batch_unlocked(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.persist_preliminary_survey_v2_plan(
  bigint, date, integer, integer, jsonb, jsonb, text, text, text, integer, text, text, jsonb, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_preliminary_survey_v2_plan(
  bigint, date, integer, integer, jsonb, jsonb, text, text, text, integer, text, text, jsonb, jsonb, jsonb
) TO service_role;
REVOKE ALL ON FUNCTION public.persist_preliminary_survey_v2_plan_batch(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_preliminary_survey_v2_plan_batch(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
