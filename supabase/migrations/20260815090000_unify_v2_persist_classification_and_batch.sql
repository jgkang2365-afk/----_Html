-- V2 분류 source 통일 + atomic batch persist
-- 1) V2 분류 authoritative source = measurement_target_business.business_type
-- 2) business_type 유효 시 journal note가 덮어쓰지 않음
-- 3) business_type 없는 legacy 대상만 journal -> preliminary_survey_rule_type fallback
-- 4) calculateV2Recommendations(TS classification.ts)와 persist RPC가 동일한 분류 규칙을 사용
-- 5) 40건 전체를 하나의 PostgreSQL transaction에서 처리하는 batch persist RPC 추가
--    (한 건이라도 validation 실패 시 0건 저장, upsert 유지)

-- ---------- helper: 통일 분류 규칙 ----------
CREATE OR REPLACE FUNCTION public.v2_classify_rule_type(p_target public.measurement_target_business)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_has_journal boolean;
  journal_is_new boolean;
BEGIN
  -- business_type이 authoritative
  IF p_target.business_type = 'existing' THEN
    RETURN 'existing';
  END IF;
  IF p_target.business_type IN ('first_measurement', 'external_new') THEN
    RETURN 'new';
  END IF;

  -- business_type null: 측정일지 기반 fallback (code/year/period 일치하는 최신 일지)
  SELECT EXISTS (
    SELECT 1 FROM public.measurement_journal AS journal
    WHERE journal.code = p_target.code
      AND journal.measurement_year = p_target.year
      AND btrim(journal.measurement_period) = btrim(p_target.period)
  ) INTO v_has_journal;

  IF v_has_journal THEN
    SELECT EXISTS (
      SELECT 1
      FROM unnest(string_to_array(COALESCE(journal.note, ''), ',')) AS token(value)
      WHERE btrim(token.value) IN ('신규', '최초실시', '타기관 신규')
    ) INTO journal_is_new
    FROM public.measurement_journal AS journal
    WHERE journal.code = p_target.code
      AND journal.measurement_year = p_target.year
      AND btrim(journal.measurement_period) = btrim(p_target.period)
    ORDER BY journal.updated_at DESC NULLS LAST, journal.created_at DESC NULLS LAST, journal.id DESC
    LIMIT 1;
    RETURN CASE WHEN journal_is_new THEN 'new' ELSE 'existing' END;
  END IF;

  -- 일지 없음: legacy rule_type fallback
  IF p_target.preliminary_survey_rule_type IN ('general_new', 'other_org_new', 'unconfirmed_new') THEN
    RETURN 'new';
  END IF;
  RETURN 'existing';
END;
$$;

-- ---------- 단건 RPC: 분류 검증을 통일 helper로 교체 ----------
CREATE OR REPLACE FUNCTION public.persist_preliminary_survey_v2_plan(
  p_target_id bigint,
  p_recommended_date date,
  p_responsible_user_id integer,
  p_experienced_reviewer_id integer,
  p_participant_user_ids jsonb,
  p_participant_names jsonb,
  p_status text,
  p_plan_origin text,
  p_source_measurement_date date,
  p_source_responsible_user_id integer,
  p_source_rule_type text,
  p_survey_method text,
  p_recommendation_reason jsonb,
  p_route_evidence jsonb,
  p_warnings jsonb
) RETURNS SETOF public.preliminary_survey_v2_plans
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target_row public.measurement_target_business;
  journal_rule_type text;
BEGIN
  IF p_status NOT IN ('recommended', 'manual_required') OR p_plan_origin NOT IN ('automatic', 'manual')
    OR p_survey_method NOT IN ('field', 'phone') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_V2_PLAN_PAYLOAD';
  END IF;
  SELECT * INTO target_row FROM public.measurement_target_business WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'TARGET_NOT_FOUND'; END IF;
  IF target_row.measurement_date IS DISTINCT FROM p_source_measurement_date
    OR target_row.measurer_id IS DISTINCT FROM p_source_responsible_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'V2_PLAN_SOURCE_CHANGED';
  END IF;
  journal_rule_type := public.v2_classify_rule_type(target_row);
  IF p_source_rule_type IS DISTINCT FROM journal_rule_type THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'V2_CLASSIFICATION_SOURCE_MISMATCH';
  END IF;

  RETURN QUERY
  INSERT INTO public.preliminary_survey_v2_plans (
    measurement_target_business_id, recommended_date, responsible_user_id, experienced_reviewer_id,
    participant_user_ids, participant_names, status, plan_origin, source_measurement_date,
    source_responsible_user_id, source_rule_type, survey_method, recommendation_reason, route_evidence, warnings
  ) VALUES (
    p_target_id, p_recommended_date, p_responsible_user_id, p_experienced_reviewer_id,
    COALESCE(p_participant_user_ids, '[]'::jsonb), COALESCE(p_participant_names, '[]'::jsonb),
    p_status, p_plan_origin, p_source_measurement_date, p_source_responsible_user_id,
    p_source_rule_type, p_survey_method, COALESCE(p_recommendation_reason, '{}'::jsonb),
    COALESCE(p_route_evidence, '{}'::jsonb), COALESCE(p_warnings, '[]'::jsonb)
  ) ON CONFLICT (measurement_target_business_id) DO UPDATE SET
    recommended_date = EXCLUDED.recommended_date,
    responsible_user_id = EXCLUDED.responsible_user_id,
    experienced_reviewer_id = EXCLUDED.experienced_reviewer_id,
    participant_user_ids = EXCLUDED.participant_user_ids,
    participant_names = EXCLUDED.participant_names,
    status = EXCLUDED.status,
    plan_origin = EXCLUDED.plan_origin,
    source_measurement_date = EXCLUDED.source_measurement_date,
    source_responsible_user_id = EXCLUDED.source_responsible_user_id,
    source_rule_type = EXCLUDED.source_rule_type,
    survey_method = EXCLUDED.survey_method,
    recommendation_reason = EXCLUDED.recommendation_reason,
    route_evidence = EXCLUDED.route_evidence,
    warnings = EXCLUDED.warnings,
    updated_at = CURRENT_TIMESTAMP
  RETURNING *;
END;
$$;

-- ---------- batch persist RPC: atomic (전부 성공 또는 0건) ----------
DROP FUNCTION IF EXISTS public.persist_preliminary_survey_v2_plan_batch(jsonb);
CREATE OR REPLACE FUNCTION public.persist_preliminary_survey_v2_plan_batch(
  p_plans jsonb
) RETURNS SETOF public.preliminary_survey_v2_plans
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  plan jsonb;
  target_row public.measurement_target_business;
  journal_rule_type text;
  v_idx integer := 0;
BEGIN
  IF p_plans IS NULL OR jsonb_typeof(p_plans) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_V2_BATCH_PAYLOAD';
  END IF;

  -- Phase 1: 모든 row를 쓰기 전에 검증. 하나라도 실패하면 아래 INSERT가 실행되지 않는다.
  FOR plan IN SELECT value FROM jsonb_array_elements(p_plans) LOOP
    v_idx := v_idx + 1;
    IF (plan->>'status') NOT IN ('recommended', 'manual_required')
       OR (plan->>'plan_origin') NOT IN ('automatic', 'manual')
       OR (plan->>'survey_method') NOT IN ('field', 'phone') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_V2_PLAN_PAYLOAD_AT_' || v_idx::text;
    END IF;
    IF (plan->>'target_id') IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'V2_PLAN_TARGET_ID_MISSING_AT_' || v_idx::text;
    END IF;
    SELECT * INTO target_row FROM public.measurement_target_business
      WHERE id = (plan->>'target_id')::bigint FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'TARGET_NOT_FOUND_AT_' || v_idx::text;
    END IF;
    IF target_row.measurement_date IS DISTINCT FROM (plan->>'source_measurement_date')::date
       OR target_row.measurer_id IS DISTINCT FROM (plan->>'source_responsible_user_id')::integer THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'V2_PLAN_SOURCE_CHANGED_AT_' || v_idx::text;
    END IF;
    journal_rule_type := public.v2_classify_rule_type(target_row);
    IF (plan->>'source_rule_type') IS DISTINCT FROM journal_rule_type THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'V2_CLASSIFICATION_SOURCE_MISMATCH_AT_' || v_idx::text;
    END IF;
  END LOOP;

  -- Phase 2: 전체 upsert. Phase 1 실패 시 어떤 row도 쓰이지 않았고,
  -- Phase 2 중 오류가 나도 함수가 속한 하나의 transaction 전체가 rollback된다.
  FOR plan IN SELECT value FROM jsonb_array_elements(p_plans) LOOP
    RETURN QUERY
    INSERT INTO public.preliminary_survey_v2_plans (
      measurement_target_business_id, recommended_date, responsible_user_id, experienced_reviewer_id,
      participant_user_ids, participant_names, status, plan_origin, source_measurement_date,
      source_responsible_user_id, source_rule_type, survey_method, recommendation_reason, route_evidence, warnings
    ) VALUES (
      (plan->>'target_id')::bigint,
      (plan->>'recommended_date')::date,
      (plan->>'responsible_user_id')::integer,
      (plan->>'experienced_reviewer_id')::integer,
      COALESCE(plan->'participant_user_ids', '[]'::jsonb),
      COALESCE(plan->'participant_names', '[]'::jsonb),
      plan->>'status',
      plan->>'plan_origin',
      (plan->>'source_measurement_date')::date,
      (plan->>'source_responsible_user_id')::integer,
      plan->>'source_rule_type',
      plan->>'survey_method',
      COALESCE(plan->'recommendation_reason', '{}'::jsonb),
      COALESCE(plan->'route_evidence', '{}'::jsonb),
      COALESCE(plan->'warnings', '[]'::jsonb)
    ) ON CONFLICT (measurement_target_business_id) DO UPDATE SET
      recommended_date = EXCLUDED.recommended_date,
      responsible_user_id = EXCLUDED.responsible_user_id,
      experienced_reviewer_id = EXCLUDED.experienced_reviewer_id,
      participant_user_ids = EXCLUDED.participant_user_ids,
      participant_names = EXCLUDED.participant_names,
      status = EXCLUDED.status,
      plan_origin = EXCLUDED.plan_origin,
      source_measurement_date = EXCLUDED.source_measurement_date,
      source_responsible_user_id = EXCLUDED.source_responsible_user_id,
      source_rule_type = EXCLUDED.source_rule_type,
      survey_method = EXCLUDED.survey_method,
      recommendation_reason = EXCLUDED.recommendation_reason,
      route_evidence = EXCLUDED.route_evidence,
      warnings = EXCLUDED.warnings,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *;
  END LOOP;
  RETURN;
END;
$$;

-- ---------- 권한 ----------
REVOKE ALL ON FUNCTION public.v2_classify_rule_type(public.measurement_target_business) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.v2_classify_rule_type(public.measurement_target_business) TO service_role;

REVOKE ALL ON FUNCTION public.persist_preliminary_survey_v2_plan(
  bigint, date, integer, integer, jsonb, jsonb, text, text, date, integer, text, text, jsonb, jsonb, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.persist_preliminary_survey_v2_plan(
  bigint, date, integer, integer, jsonb, jsonb, text, text, date, integer, text, text, jsonb, jsonb, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.persist_preliminary_survey_v2_plan_batch(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.persist_preliminary_survey_v2_plan_batch(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
