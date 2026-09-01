-- Reverse Planner v1.1 survey occupancy를 resource lock 뒤 재검증한다. Forward-only, no backfill.

DO $$
DECLARE
  current_definition text;
  corrected_definition text;
BEGIN
  SELECT pg_get_functiondef(proc.oid)
  INTO current_definition
  FROM pg_proc proc
  JOIN pg_namespace namespace ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'public'
    AND proc.proname = 'apply_preliminary_survey_v2_reverse_planner'
    AND pg_get_function_identity_arguments(proc.oid)
      = 'p_planner_run_id uuid, p_source_fingerprint text, p_canonical_sha text, p_planner_version text, p_plans jsonb, p_assignments jsonb, p_actor_user_id integer, p_override_reason text';

  IF current_definition IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42883', MESSAGE = 'REVERSE_PLANNER_APPLY_RPC_NOT_FOUND';
  END IF;

  corrected_definition := replace(
    current_definition,
    E'  applied_count integer := 0;\nBEGIN',
    E'  applied_count integer := 0;\n  participant_id integer;\n  expected_occupancy jsonb;\n  current_occupancy jsonb;\nBEGIN'
  );

  corrected_definition := replace(
    corrected_definition,
    E'  -- 동일 공시료 그룹 Apply를 transaction 단위로 결정론적 직렬화한다.',
    E'  -- 같은 유선 responsible/date 또는 방문 participant/date 계산을 직렬화한다.\n  FOR plan_item IN\n    SELECT value FROM jsonb_array_elements(p_plans)\n    ORDER BY value->>''preliminary_date'', value->>''survey_method'',\n      (value->>''responsible_user_id'')::integer, (value->>''target_id'')::bigint\n  LOOP\n    IF plan_item->>''survey_method'' = ''phone'' THEN\n      PERFORM pg_advisory_xact_lock(hashtextextended(\n        ''reverse-planner-survey|phone|'' || plan_item->>''preliminary_date'' || ''|'' || plan_item->>''responsible_user_id'', 0\n      ));\n    ELSE\n      FOR participant_id IN\n        SELECT value::integer FROM jsonb_array_elements_text(plan_item->''participant_user_ids'')\n        ORDER BY value::integer\n      LOOP\n        PERFORM pg_advisory_xact_lock(hashtextextended(\n          ''reverse-planner-survey|field|'' || plan_item->>''preliminary_date'' || ''|'' || participant_id::text, 0\n        ));\n      END LOOP;\n    END IF;\n  END LOOP;\n\n  -- 동일 공시료 그룹 Apply를 transaction 단위로 결정론적 직렬화한다.'
  );

  corrected_definition := replace(
    corrected_definition,
    E'    IF EXISTS (\n      SELECT 1 FROM jsonb_array_elements(p_assignments) item',
    E'    expected_occupancy := COALESCE(plan_item->''source_occupancy_versions'', ''[]''::jsonb);\n    SELECT COALESCE(jsonb_agg(jsonb_build_object(\n      ''targetId'', existing.measurement_target_business_id,\n      ''planId'', existing.id::text,\n      ''updatedAtMs'', floor(extract(epoch FROM existing.updated_at) * 1000)::bigint\n    ) ORDER BY existing.measurement_target_business_id), ''[]''::jsonb)\n    INTO current_occupancy\n    FROM public.preliminary_survey_v2_plans existing\n    WHERE existing.measurement_target_business_id <> target_row.id\n      AND existing.recommended_date = (plan_item->>''preliminary_date'')::date\n      AND (\n        (plan_item->>''survey_method'' = ''phone''\n          AND existing.survey_method = ''phone''\n          AND existing.responsible_user_id = (plan_item->>''responsible_user_id'')::integer)\n        OR\n        (plan_item->>''survey_method'' = ''field''\n          AND existing.survey_method = ''field''\n          AND EXISTS (\n            SELECT 1\n            FROM jsonb_array_elements_text(COALESCE(existing.participant_user_ids, ''[]''::jsonb)) existing_participant\n            JOIN jsonb_array_elements_text(plan_item->''participant_user_ids'') proposed_participant\n              ON proposed_participant.value = existing_participant.value\n          ))\n      );\n    IF current_occupancy IS DISTINCT FROM expected_occupancy THEN\n      RAISE EXCEPTION USING ERRCODE = ''40001'', MESSAGE = ''SOURCE_CHANGED'';\n    END IF;\n\n    IF EXISTS (\n      SELECT 1 FROM jsonb_array_elements(p_assignments) item'
  );

  IF position('reverse-planner-survey|phone|' IN corrected_definition) = 0
     OR position('source_occupancy_versions' IN corrected_definition) = 0
     OR position('current_occupancy IS DISTINCT FROM expected_occupancy' IN corrected_definition) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REVERSE_PLANNER_OCCUPANCY_BASELINE_PATCH_NOT_APPLIED';
  END IF;
  EXECUTE corrected_definition;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_preliminary_survey_v2_reverse_planner(
  uuid, text, text, text, jsonb, jsonb, integer, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_preliminary_survey_v2_reverse_planner(
  uuid, text, text, text, jsonb, jsonb, integer, text
) TO service_role;

NOTIFY pgrst, 'reload schema';
