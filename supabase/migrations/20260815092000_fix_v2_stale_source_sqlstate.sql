-- V2 stale-source SQLSTATE 수정 (20260815091000 후속)
-- 문제: V2_PLAN_SOURCE_CHANGED 검증이 serialization_failure SQLSTATE를 사용했다.
--   PostgREST/DB 계층이 serialization_failure를 retry 가능한 직렬화 충돌로 취급해
--   요청이 무한 재시도(hang)된다. stale-source는 업무 validation 오류이므로
--   retry 대상 SQLSTATE를 사용하면 안 된다.
-- 수정: stale-source 검증 SQLSTATE를 22023(invalid_parameter_value, retry 대상 아님)으로 교체
--   - 메시지는 그대로 유지 (V2_PLAN_SOURCE_CHANGED / V2_PLAN_SOURCE_CHANGED_AT_<idx>)
--   - 다른 validation SQLSTATE/권한/TEXT source 비교/upsert/TEXT signature는 그대로 유지

-- ---------- 단건 RPC: stale-source SQLSTATE 교체(serialization_failure -> 22023) ----------
CREATE OR REPLACE FUNCTION public.persist_preliminary_survey_v2_plan(
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
  -- source stale 검증: measurement_date는 TEXT이므로 원본 TEXT equality 비교 (cast 금지)
  -- 업무 validation이므로 ERRCODE는 retry 대상이 아닌 22023을 사용
  IF target_row.measurement_date IS DISTINCT FROM p_source_measurement_date
    OR target_row.measurer_id IS DISTINCT FROM p_source_responsible_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'V2_PLAN_SOURCE_CHANGED';
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
    p_status, p_plan_origin, p_source_measurement_date::date, p_source_responsible_user_id,
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

-- ---------- batch RPC: stale-source SQLSTATE 교체(serialization_failure -> 22023) ----------
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
    -- source stale 검증: 원본 TEXT equality (cast 금지). 업무 validation이므로 22023 사용.
    IF target_row.measurement_date IS DISTINCT FROM (plan->>'source_measurement_date')
       OR target_row.measurer_id IS DISTINCT FROM (plan->>'source_responsible_user_id')::integer THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'V2_PLAN_SOURCE_CHANGED_AT_' || v_idx::text;
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

-- ---------- 권한 유지: PUBLIC/anon/authenticated 제거, service_role만 허용 ----------
REVOKE ALL ON FUNCTION public.v2_classify_rule_type(public.measurement_target_business) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v2_classify_rule_type(public.measurement_target_business) TO service_role;

REVOKE ALL ON FUNCTION public.persist_preliminary_survey_v2_plan(
  bigint, date, integer, integer, jsonb, jsonb, text, text, text, integer, text, text, jsonb, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_preliminary_survey_v2_plan(
  bigint, date, integer, integer, jsonb, jsonb, text, text, text, integer, text, text, jsonb, jsonb, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.persist_preliminary_survey_v2_plan_batch(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_preliminary_survey_v2_plan_batch(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';

