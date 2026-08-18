-- 예비조사 V2 주소 기반 묶음 추천 확정(저장) RPC
--
-- 배경: PR #31에서 구현한 묶음 추천(READ-ONLY) 결과를 사용자가 선택/제외한 뒤,
--       선택된 사업장만 실제 V2 plan에 확정 반영한다.
--
-- 원칙:
-- - 추천과 확정 분리. 이 RPC는 사용자의 명시적 확정 액션에서만 호출된다.
-- - 선택된 사업장 전체가 하나의 transaction으로 처리된다 (한 건 실패 = 전체 rollback).
-- - 확정 직전 서버가 현재 데이터로 재검증한다 (클라이언트 추천 값 신뢰 금지).
-- - sequence_number(확정) 대상 / manual plan 은 자동 덮어쓰기 금지.
-- - 신규 사업장 중복 방지: measurement_target_business_id 기준 upsert (idempotent).
-- - 일반 정상 확정은 관리자 예외 정비 감사로그(preliminary_survey_exception_log)에 기록하지 않는다.

DROP FUNCTION IF EXISTS public.confirm_preliminary_survey_group(jsonb);

CREATE OR REPLACE FUNCTION public.confirm_preliminary_survey_group(p_plans jsonb)
RETURNS SETOF public.preliminary_survey_v2_plans
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  item jsonb;
  target_row public.measurement_target_business;
  plan_row public.preliminary_survey_v2_plans;
  link_name text;
  staff_names text[] := ARRAY[]::text[];
  staff_extra text[] := ARRAY[]::text[];
  journal_confirmed boolean;
  v_idx integer;
  v_id integer;
  v_name text;
  v_rule_type text;
  v_survey_method text;
BEGIN
  IF p_plans IS NULL OR jsonb_typeof(p_plans) <> 'array' OR jsonb_array_length(p_plans) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_CONFIRM_PAYLOAD';
  END IF;

  -- ---------- Phase 1: 전체 검증 (하나라도 실패하면 쓰기 미실행) ----------
  FOR item IN SELECT value FROM jsonb_array_elements(p_plans) LOOP
    IF (item->>'target_id') IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CONFIRM_TARGET_ID_REQUIRED';
    END IF;
    IF (item->>'date') IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CONFIRM_DATE_REQUIRED';
    END IF;
    IF (item->>'link_measurer_id') IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'LINK_MEASURER_REQUIRED';
    END IF;

    SELECT * INTO target_row FROM public.measurement_target_business
      WHERE id = (item->>'target_id')::bigint FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'TARGET_NOT_FOUND'; END IF;

    -- 확정(sequence_number) 보호
    SELECT EXISTS (
      SELECT 1 FROM public.measurement_journal AS journal
      WHERE journal.code = target_row.code
        AND journal.measurement_year = target_row.year
        AND btrim(journal.measurement_period) = btrim(target_row.period)
        AND journal.sequence_number IS NOT NULL
    ) INTO journal_confirmed;
    IF journal_confirmed THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'SEQUENCE_NUMBER_CONFIRMED';
    END IF;

    -- manual plan 보호
    SELECT * INTO plan_row FROM public.preliminary_survey_v2_plans
      WHERE measurement_target_business_id = target_row.id FOR UPDATE;
    IF plan_row.plan_origin = 'manual' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MANUAL_PLAN_PRESERVED';
    END IF;

    -- 예비조사자 목록 검증
    IF item->'participant_user_ids' IS NULL OR jsonb_typeof(item->'participant_user_ids') <> 'array'
       OR item->'participant_names' IS NULL OR jsonb_typeof(item->'participant_names') <> 'array'
       OR jsonb_array_length(item->'participant_user_ids') = 0
       OR jsonb_array_length(item->'participant_user_ids') <> jsonb_array_length(item->'participant_names') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PARTICIPANTS';
    END IF;
    FOR v_idx IN 0 .. jsonb_array_length(item->'participant_user_ids') - 1 LOOP
      v_id := (item->'participant_user_ids'->>v_idx)::integer;
      v_name := item->'participant_names'->>v_idx;
      IF NOT EXISTS (
        SELECT 1 FROM public.users AS u WHERE u.id = v_id AND u.name = v_name
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PARTICIPANT_MISMATCH_AT_' || (v_idx + 1)::text;
      END IF;
    END LOOP;

    -- 예·측(link) 검증: 예비조사자에 포함 + 실제 측정 인원에 포함
    SELECT name INTO link_name FROM public.users WHERE id = (item->>'link_measurer_id')::integer;
    IF link_name IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'LINK_MEASURER_NOT_FOUND';
    END IF;
    IF NOT item->'participant_user_ids' @> jsonb_build_array((item->>'link_measurer_id')::integer) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'LINK_MEASURER_NOT_IN_PARTICIPANTS';
    END IF;

    SELECT COALESCE(array_agg(btrim(t)), ARRAY[]::text[]) INTO staff_names
    FROM unnest(string_to_array(COALESCE(target_row.collaborators, ''), ',')) AS t
    WHERE btrim(t) <> '';
    IF target_row.daily_staff IS NOT NULL AND jsonb_typeof(target_row.daily_staff) = 'array' THEN
      SELECT COALESCE(array_agg(DISTINCT btrim(collab)), ARRAY[]::text[]) INTO staff_extra
      FROM jsonb_array_elements(target_row.daily_staff) AS day(entry)
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(entry->'collaborators') = 'array' THEN entry->'collaborators'
          ELSE to_jsonb(string_to_array(COALESCE(entry->>'collaborators', ''), ','))
        END
      ) AS t(collab)
      WHERE btrim(collab) <> '';
      staff_names := staff_names || staff_extra;
    END IF;
    IF NOT (link_name = ANY(staff_names)) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'LINK_MEASURER_NOT_IN_STAFF';
    END IF;

    v_rule_type := public.v2_classify_rule_type(target_row);
    v_survey_method := COALESCE(plan_row.survey_method, CASE WHEN v_rule_type = 'new' THEN 'field' ELSE 'phone' END);
  END LOOP;

  -- ---------- Phase 2: 적용 (전체 upsert, 중간 오류 시 transaction rollback) ----------
  FOR item IN SELECT value FROM jsonb_array_elements(p_plans) LOOP
    SELECT * INTO target_row FROM public.measurement_target_business
      WHERE id = (item->>'target_id')::bigint FOR UPDATE;
    SELECT * INTO plan_row FROM public.preliminary_survey_v2_plans
      WHERE measurement_target_business_id = target_row.id FOR UPDATE;
    v_rule_type := public.v2_classify_rule_type(target_row);
    v_survey_method := COALESCE(plan_row.survey_method, CASE WHEN v_rule_type = 'new' THEN 'field' ELSE 'phone' END);

    RETURN QUERY
    INSERT INTO public.preliminary_survey_v2_plans (
      measurement_target_business_id, recommended_date, responsible_user_id, experienced_reviewer_id,
      participant_user_ids, participant_names, status, plan_origin, source_measurement_date,
      source_responsible_user_id, source_rule_type, survey_method, recommendation_reason, route_evidence, warnings
    ) VALUES (
      (item->>'target_id')::bigint,
      (item->>'date')::date,
      (item->>'link_measurer_id')::integer,
      (item->>'reviewer_user_id')::integer,
      COALESCE(item->'participant_user_ids', '[]'::jsonb),
      COALESCE(item->'participant_names', '[]'::jsonb),
      'recommended',
      'manual',
      -- measurement_target_business.measurement_date는 text(쉼표 구분 다중 날짜)이므로 date로 캐스트
      (target_row.measurement_date)::date,
      (target_row.measurer_id)::integer,
      v_rule_type,
      v_survey_method,
      jsonb_build_object('reason', '주소 기반 묶음 추천 확정'),
      '{}'::jsonb,
      '[]'::jsonb
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

    UPDATE public.measurement_target_business
    SET link_measurer_id = (item->>'link_measurer_id')::integer,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = (item->>'target_id')::bigint;
  END LOOP;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_preliminary_survey_group(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_preliminary_survey_group(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
