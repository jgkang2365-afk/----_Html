-- 찐확정 일반 잠금은 유지하면서, 예비조사 서류의 누락 필드만 채우는 전용 감사 경로다.
CREATE TABLE IF NOT EXISTS public.preliminary_survey_v2_document_repair_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_target_business_id bigint NOT NULL REFERENCES public.measurement_target_business(id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL REFERENCES public.preliminary_survey_v2_plans(id) ON DELETE RESTRICT,
  filled_fields jsonb NOT NULL CHECK (jsonb_typeof(filled_fields) = 'array'),
  before_plan jsonb,
  after_plan jsonb NOT NULL,
  provenance text NOT NULL CHECK (provenance = 'true_confirmed_missing_documentary_info_repair'),
  changed_by_user_id integer NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.preliminary_survey_v2_document_repair_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.preliminary_survey_v2_document_repair_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.preliminary_survey_v2_document_repair_audit TO service_role;

CREATE OR REPLACE FUNCTION public.repair_true_confirmed_preliminary_survey_v2_missing_info(
  p_target_id bigint,
  p_expected_plan_id uuid,
  p_expected_measurement_date date,
  p_recommended_date date,
  p_responsible_user_id integer,
  p_experienced_reviewer_id integer,
  p_participant_user_ids jsonb,
  p_participant_names jsonb,
  p_survey_method text,
  p_source_rule_type text,
  p_fill_date boolean,
  p_fill_surveyors boolean,
  p_changed_by_user_id integer
) RETURNS public.preliminary_survey_v2_plans
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target_row public.measurement_target_business%ROWTYPE;
  plan_row public.preliminary_survey_v2_plans%ROWTYPE;
  repaired public.preliminary_survey_v2_plans%ROWTYPE;
  before_json jsonb;
  participant_count integer;
  matched_user_count integer;
  filled jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO target_row FROM public.measurement_target_business WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TARGET_NOT_FOUND'; END IF;
  IF target_row.measurement_date::date IS DISTINCT FROM p_expected_measurement_date THEN
    RAISE EXCEPTION 'REPAIR_SOURCE_CHANGED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.measurement_journal journal
    WHERE journal.code = target_row.code
      AND journal.measurement_year = target_row.year
      AND btrim(replace(journal.measurement_period, '(수시)', '')) = btrim(replace(target_row.period, '(수시)', ''))
  ) THEN RAISE EXCEPTION 'TRUE_CONFIRMED_REQUIRED'; END IF;

  SELECT * INTO plan_row FROM public.preliminary_survey_v2_plans
  WHERE measurement_target_business_id = p_target_id FOR UPDATE;
  IF (plan_row.id IS NULL) IS DISTINCT FROM (p_expected_plan_id IS NULL)
     OR (plan_row.id IS NOT NULL AND plan_row.id IS DISTINCT FROM p_expected_plan_id) THEN
    RAISE EXCEPTION 'REPAIR_SOURCE_CHANGED';
  END IF;
  IF target_row.code IN ('H0524','H0288','H0528','H0348','H0126','H0281','H0260','H0063','H0077')
     OR EXISTS (SELECT 1 FROM public.preliminary_survey_v2_legacy_reconciliation r WHERE r.applied_plan_id = plan_row.id)
     OR EXISTS (SELECT 1 FROM public.preliminary_survey_v2_history_recovery_audit h WHERE h.created_plan_id = plan_row.id) THEN
    RAISE EXCEPTION 'REPAIR_PROTECTED_HISTORY';
  END IF;
  IF plan_row.id IS NULL AND NOT (p_fill_date AND p_fill_surveyors) THEN
    RAISE EXCEPTION 'REPAIR_SOURCE_CHANGED';
  END IF;
  IF plan_row.id IS NOT NULL THEN
    IF p_fill_date AND plan_row.recommended_date IS NOT NULL THEN RAISE EXCEPTION 'NON_NULL_OVERWRITE_FORBIDDEN'; END IF;
    IF p_fill_surveyors AND jsonb_array_length(plan_row.participant_user_ids) > 0 THEN RAISE EXCEPTION 'NON_NULL_OVERWRITE_FORBIDDEN'; END IF;
    IF p_fill_surveyors AND p_responsible_user_id IS DISTINCT FROM plan_row.responsible_user_id THEN RAISE EXCEPTION 'NON_NULL_OVERWRITE_FORBIDDEN'; END IF;
    IF p_fill_surveyors AND plan_row.experienced_reviewer_id IS NOT NULL
       AND p_experienced_reviewer_id IS DISTINCT FROM plan_row.experienced_reviewer_id THEN
      RAISE EXCEPTION 'NON_NULL_OVERWRITE_FORBIDDEN';
    END IF;
  END IF;
  IF p_fill_date AND (p_recommended_date IS NULL OR p_recommended_date >= target_row.measurement_date::date) THEN
    RAISE EXCEPTION 'INVALID_RECOMMENDED_DATE';
  END IF;
  IF p_fill_surveyors THEN
    IF jsonb_typeof(p_participant_user_ids) <> 'array' OR jsonb_typeof(p_participant_names) <> 'array' THEN
      RAISE EXCEPTION 'INVALID_PARTICIPANTS';
    END IF;
    participant_count := jsonb_array_length(p_participant_user_ids);
    IF participant_count = 0 OR participant_count <> jsonb_array_length(p_participant_names) THEN
      RAISE EXCEPTION 'INVALID_PARTICIPANTS';
    END IF;
    SELECT count(*) INTO matched_user_count
    FROM jsonb_array_elements_text(p_participant_user_ids) WITH ORDINALITY ids(value, ordinal)
    JOIN jsonb_array_elements_text(p_participant_names) WITH ORDINALITY names(value, ordinal)
      ON names.ordinal = ids.ordinal
    JOIN public.users u ON u.id = ids.value::integer AND u.name = names.value AND u.is_active = true AND u.job = '측정';
    IF matched_user_count <> participant_count THEN RAISE EXCEPTION 'PARTICIPANT_MISMATCH'; END IF;
    IF p_responsible_user_id IS NULL OR NOT (p_participant_user_ids @> to_jsonb(ARRAY[p_responsible_user_id])) THEN
      RAISE EXCEPTION 'RESPONSIBLE_NOT_IN_PARTICIPANTS';
    END IF;
    IF p_experienced_reviewer_id IS NOT NULL AND NOT (p_participant_user_ids @> to_jsonb(ARRAY[p_experienced_reviewer_id])) THEN
      RAISE EXCEPTION 'REVIEWER_NOT_IN_PARTICIPANTS';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.user_schedule_blocks block
      JOIN jsonb_array_elements_text(p_participant_user_ids) ids ON ids.value::integer = block.user_id
      WHERE p_recommended_date BETWEEN block.start_date AND block.end_date
    ) THEN RAISE EXCEPTION 'USER_UNAVAILABLE_ON_SURVEY_DATE'; END IF;
  END IF;

  before_json := CASE WHEN plan_row.id IS NULL THEN NULL ELSE to_jsonb(plan_row) END;
  PERFORM set_config('app.preliminary_survey_admin_repair', 'on', true);
  IF plan_row.id IS NULL THEN
    INSERT INTO public.preliminary_survey_v2_plans (
      measurement_target_business_id, recommended_date, responsible_user_id, experienced_reviewer_id,
      participant_user_ids, participant_names, status, plan_origin, source_measurement_date,
      source_responsible_user_id, source_rule_type, survey_method, recommendation_reason, route_evidence, warnings
    ) VALUES (
      p_target_id, p_recommended_date, p_responsible_user_id, p_experienced_reviewer_id,
      p_participant_user_ids, p_participant_names, 'recommended', 'manual', target_row.measurement_date::date,
      p_responsible_user_id, p_source_rule_type, p_survey_method,
      jsonb_build_object('reason', '찐확정 누락정보 보정', 'provenance', 'true_confirmed_missing_documentary_info_repair'),
      '{}'::jsonb, '[]'::jsonb
    ) RETURNING * INTO repaired;
    filled := '["recommended_date","surveyors"]'::jsonb;
  ELSE
    UPDATE public.preliminary_survey_v2_plans SET
      recommended_date = CASE WHEN p_fill_date THEN p_recommended_date ELSE recommended_date END,
      responsible_user_id = responsible_user_id,
      experienced_reviewer_id = CASE WHEN p_fill_surveyors AND experienced_reviewer_id IS NULL THEN p_experienced_reviewer_id ELSE experienced_reviewer_id END,
      participant_user_ids = CASE WHEN p_fill_surveyors THEN p_participant_user_ids ELSE participant_user_ids END,
      participant_names = CASE WHEN p_fill_surveyors THEN p_participant_names ELSE participant_names END
    WHERE id = plan_row.id RETURNING * INTO repaired;
    filled := (CASE WHEN p_fill_date THEN '["recommended_date"]'::jsonb ELSE '[]'::jsonb END)
      || (CASE WHEN p_fill_surveyors THEN '["surveyors"]'::jsonb ELSE '[]'::jsonb END);
  END IF;

  INSERT INTO public.preliminary_survey_v2_document_repair_audit(
    measurement_target_business_id, plan_id, filled_fields, before_plan, after_plan,
    provenance, changed_by_user_id
  ) VALUES (
    p_target_id, repaired.id, filled, before_json, to_jsonb(repaired),
    'true_confirmed_missing_documentary_info_repair', p_changed_by_user_id
  );
  RETURN repaired;
END;
$$;

REVOKE ALL ON FUNCTION public.repair_true_confirmed_preliminary_survey_v2_missing_info(
  bigint, uuid, date, date, integer, integer, jsonb, jsonb, text, text, boolean, boolean, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_true_confirmed_preliminary_survey_v2_missing_info(
  bigint, uuid, date, date, integer, integer, jsonb, jsonb, text, text, boolean, boolean, integer
) TO service_role;

CREATE OR REPLACE FUNCTION public.repair_true_confirmed_preliminary_v2_missing_batch(
  p_repairs jsonb,
  p_changed_by_user_id integer
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  repair_item jsonb;
  repaired_count integer := 0;
BEGIN
  IF jsonb_typeof(p_repairs) <> 'array' OR jsonb_array_length(p_repairs) = 0 THEN
    RAISE EXCEPTION 'INVALID_REPAIR_BATCH';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_repairs)) IS DISTINCT FROM
     (SELECT count(DISTINCT (value->>'targetId')::bigint) FROM jsonb_array_elements(p_repairs)) THEN
    RAISE EXCEPTION 'DUPLICATE_REPAIR_TARGET';
  END IF;
  FOR repair_item IN
    SELECT value FROM jsonb_array_elements(p_repairs) ORDER BY (value->>'targetId')::bigint
  LOOP
    PERFORM public.repair_true_confirmed_preliminary_survey_v2_missing_info(
      (repair_item->>'targetId')::bigint,
      NULLIF(repair_item->>'existingPlanId', '')::uuid,
      (repair_item->>'sourceMeasurementDate')::date,
      (repair_item->>'recommendedDate')::date,
      (repair_item->>'responsibleUserId')::integer,
      NULLIF(repair_item->>'experiencedReviewerUserId', '')::integer,
      repair_item->'participantUserIds',
      repair_item->'participantNames',
      repair_item->>'surveyMethod',
      repair_item->>'sourceRuleType',
      COALESCE((repair_item->>'fillDate')::boolean, false),
      COALESCE((repair_item->>'fillSurveyors')::boolean, false),
      p_changed_by_user_id
    );
    repaired_count := repaired_count + 1;
  END LOOP;
  RETURN repaired_count;
END;
$$;

REVOKE ALL ON FUNCTION public.repair_true_confirmed_preliminary_v2_missing_batch(jsonb, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_true_confirmed_preliminary_v2_missing_batch(jsonb, integer)
  TO service_role;

NOTIFY pgrst, 'reload schema';
