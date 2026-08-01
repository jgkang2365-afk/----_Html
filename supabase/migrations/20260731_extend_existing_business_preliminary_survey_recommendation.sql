-- 기존업체도 예비조사 추천 대상으로 확장한다.
-- 20260731_add_preliminary_survey_recommendation_mvp.sql 적용 후 실행한다.

ALTER TABLE public.preliminary_survey_plans
  ADD COLUMN IF NOT EXISTS source_rule_type TEXT;

UPDATE public.preliminary_survey_plans AS plan
SET source_rule_type = target.preliminary_survey_rule_type
FROM public.measurement_target_business AS target
WHERE target.id = plan.measurement_target_business_id
  AND plan.source_rule_type IS NULL;

ALTER TABLE public.preliminary_survey_plans
  ALTER COLUMN source_rule_type SET NOT NULL,
  DROP CONSTRAINT IF EXISTS preliminary_survey_plans_source_rule_type_check,
  DROP CONSTRAINT IF EXISTS preliminary_survey_plans_visit_mode_check,
  DROP CONSTRAINT IF EXISTS preliminary_survey_plans_existing_visit_participants_check;

ALTER TABLE public.preliminary_survey_plans
  ADD CONSTRAINT preliminary_survey_plans_source_rule_type_check
  CHECK (source_rule_type IN (
    'existing', 'general_new', 'other_org_new', 'unconfirmed_new'
  )),
  ADD CONSTRAINT preliminary_survey_plans_visit_mode_check
  CHECK (visit_mode IN (
    'existing_field_visit', 'experienced_solo_visit', 'joint_field_visit'
  )),
  ADD CONSTRAINT preliminary_survey_plans_existing_visit_participants_check
  CHECK (visit_mode <> 'existing_field_visit' OR experienced_user_id IS NULL);

CREATE OR REPLACE FUNCTION public.persist_preliminary_survey_recommendation(
  p_target_id BIGINT,
  p_expected_target_updated_at TIMESTAMPTZ,
  p_status TEXT,
  p_responsible_user_id INTEGER,
  p_experienced_user_id INTEGER,
  p_visit_mode TEXT,
  p_recommended_date DATE,
  p_source_measurer_id INTEGER,
  p_source_measurement_date DATE,
  p_source_address TEXT,
  p_recommendation_reason JSONB,
  p_recommendation_score INTEGER,
  p_warnings JSONB,
  p_alternatives JSONB,
  p_actor_user_id INTEGER
)
RETURNS SETOF public.preliminary_survey_plans
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_updated_at TIMESTAMPTZ;
  target_rule_type TEXT;
  active_plan public.preliminary_survey_plans;
BEGIN
  IF p_status NOT IN ('pending', 'recommended') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PLAN_STATUS';
  END IF;

  SELECT updated_at, preliminary_survey_rule_type
  INTO target_updated_at, target_rule_type
  FROM public.measurement_target_business
  WHERE id = p_target_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'TARGET_NOT_FOUND';
  END IF;
  IF target_updated_at IS DISTINCT FROM p_expected_target_updated_at THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'PLAN_SOURCE_CHANGED';
  END IF;

  SELECT * INTO active_plan
  FROM public.preliminary_survey_plans
  WHERE measurement_target_business_id = p_target_id
    AND status IN ('pending', 'recommended', 'confirmed', 'needs_review')
  FOR UPDATE;

  IF FOUND AND active_plan.status = 'confirmed' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONFIRMED_PLAN_REQUIRES_CANCEL';
  END IF;

  IF FOUND THEN
    RETURN QUERY
    UPDATE public.preliminary_survey_plans
    SET
      responsible_user_id = p_responsible_user_id,
      experienced_user_id = p_experienced_user_id,
      visit_mode = p_visit_mode,
      recommended_date = p_recommended_date,
      confirmed_date = NULL,
      status = p_status,
      source_measurer_id = p_source_measurer_id,
      source_measurement_date = p_source_measurement_date,
      source_address = p_source_address,
      source_rule_type = target_rule_type,
      source_target_updated_at = p_expected_target_updated_at,
      recommendation_reason = COALESCE(p_recommendation_reason, '{}'::JSONB),
      recommendation_score = p_recommendation_score,
      warnings = COALESCE(p_warnings, '[]'::JSONB),
      alternatives = COALESCE(p_alternatives, '[]'::JSONB),
      review_reasons = '[]'::JSONB,
      holiday_verification_status = CASE
        WHEN COALESCE(p_warnings, '[]'::JSONB) @> '["HOLIDAY_DATA_REVIEW_REQUIRED"]'::JSONB
          THEN 'incomplete'
        ELSE 'verified'
      END,
      holiday_verification_override_by = NULL,
      holiday_verification_override_at = NULL,
      holiday_verification_override_reason = NULL,
      holiday_calendar_status_snapshot = JSONB_BUILD_OBJECT(
        'reviewedYearFrom', 2025,
        'reviewedYearTo', 2027,
        'source', 'application_snapshot',
        'status', CASE
          WHEN COALESCE(p_warnings, '[]'::JSONB) @> '["HOLIDAY_DATA_REVIEW_REQUIRED"]'::JSONB
            THEN 'incomplete'
          ELSE 'verified'
        END
      ),
      confirmed_by = NULL,
      confirmed_at = NULL
    WHERE id = active_plan.id
    RETURNING *;
  ELSE
    RETURN QUERY
    INSERT INTO public.preliminary_survey_plans (
      measurement_target_business_id,
      responsible_user_id,
      experienced_user_id,
      visit_mode,
      recommended_date,
      status,
      source_measurer_id,
      source_measurement_date,
      source_address,
      source_rule_type,
      source_target_updated_at,
      recommendation_reason,
      recommendation_score,
      warnings,
      alternatives,
      holiday_verification_status,
      holiday_calendar_status_snapshot,
      created_by
    )
    VALUES (
      p_target_id,
      p_responsible_user_id,
      p_experienced_user_id,
      p_visit_mode,
      p_recommended_date,
      p_status,
      p_source_measurer_id,
      p_source_measurement_date,
      p_source_address,
      target_rule_type,
      p_expected_target_updated_at,
      COALESCE(p_recommendation_reason, '{}'::JSONB),
      p_recommendation_score,
      COALESCE(p_warnings, '[]'::JSONB),
      COALESCE(p_alternatives, '[]'::JSONB),
      CASE
        WHEN COALESCE(p_warnings, '[]'::JSONB) @> '["HOLIDAY_DATA_REVIEW_REQUIRED"]'::JSONB
          THEN 'incomplete'
        ELSE 'verified'
      END,
      JSONB_BUILD_OBJECT(
        'reviewedYearFrom', 2025,
        'reviewedYearTo', 2027,
        'source', 'application_snapshot',
        'status', CASE
          WHEN COALESCE(p_warnings, '[]'::JSONB) @> '["HOLIDAY_DATA_REVIEW_REQUIRED"]'::JSONB
            THEN 'incomplete'
          ELSE 'verified'
        END
      ),
      p_actor_user_id
    )
    RETURNING *;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_preliminary_survey_recommendation(
  BIGINT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER, TEXT, DATE, INTEGER, DATE,
  TEXT, JSONB, INTEGER, JSONB, JSONB, INTEGER
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.persist_preliminary_survey_recommendation(
  BIGINT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER, TEXT, DATE, INTEGER, DATE,
  TEXT, JSONB, INTEGER, JSONB, JSONB, INTEGER
) TO service_role;

NOTIFY pgrst, 'reload schema';
