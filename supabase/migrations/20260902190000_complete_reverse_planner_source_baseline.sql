-- Reverse Planner v1.1 source fingerprint의 동시성 경계를 완결한다. Forward-only, no backfill.

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
    E'  current_occupancy jsonb;\nBEGIN',
    E'  current_occupancy jsonb;\n  expected_schedule jsonb;\n  current_schedule jsonb;\n  expected_actual jsonb;\n  current_actual jsonb;\nBEGIN'
  );

  -- 모든 resource key를 먼저 정렬 획득한다. 뒤의 개별 lock은 같은 transaction의 재진입이므로 안전하다.
  corrected_definition := replace(
    corrected_definition,
    E'  IF p_override_reason IS NOT NULL THEN',
    E'  PERFORM pg_advisory_xact_lock(hashtextextended(resource.lock_key, 0))\n  FROM (\n    SELECT DISTINCT lock_key\n    FROM (\n      SELECT CASE WHEN plan_item->>''survey_method'' = ''phone''\n        THEN ''reverse-planner-survey|phone|'' || plan_item->>''preliminary_date'' || ''|'' || plan_item->>''responsible_user_id''\n        ELSE ''reverse-planner-survey|field|'' || plan_item->>''preliminary_date'' || ''|'' || participant.value\n      END AS lock_key\n      FROM jsonb_array_elements(p_plans) plan_item\n      LEFT JOIN LATERAL jsonb_array_elements_text(\n        CASE WHEN plan_item->>''survey_method'' = ''field'' THEN plan_item->''participant_user_ids'' ELSE ''[null]''::jsonb END\n      ) participant ON true\n      UNION ALL\n      SELECT ''reverse-planner-public-group|'' || assignment_item->>''measurement_date'' || ''|'' || assignment_item->>''assignee_user_id''\n      FROM jsonb_array_elements(p_assignments) assignment_item\n    ) all_keys\n    WHERE lock_key IS NOT NULL\n  ) resource\n  ORDER BY resource.lock_key;\n\n  IF p_override_reason IS NOT NULL THEN'
  );

  corrected_definition := replace(
    corrected_definition,
    E'  FOR plan_item IN\n    SELECT value FROM jsonb_array_elements(p_plans)\n    ORDER BY (value->>''target_id'')::bigint',
    E'  -- baseline 조회 이후 관련 schedule/actual source가 바뀌지 않게 유지한다.\n  LOCK TABLE public.user_schedule_blocks IN SHARE MODE;\n  LOCK TABLE public.measurement_target_business IN SHARE MODE;\n  LOCK TABLE public.preliminary_survey_v2_fixed_assignments IN SHARE MODE;\n\n  FOR plan_item IN\n    SELECT value FROM jsonb_array_elements(p_plans)\n    ORDER BY (value->>''target_id'')::bigint'
  );

  corrected_definition := replace(
    corrected_definition,
    E'    expected_occupancy := COALESCE(plan_item->''source_occupancy_versions'', ''[]''::jsonb);',
    E'    expected_schedule := COALESCE(plan_item->''source_schedule_blocks'', ''[]''::jsonb);\n    SELECT COALESCE(jsonb_agg(jsonb_build_object(\n      ''userId'', block.user_id, ''startDate'', block.start_date::text, ''endDate'', block.end_date::text\n    ) ORDER BY block.user_id, block.start_date, block.end_date), ''[]''::jsonb)\n    INTO current_schedule\n    FROM public.user_schedule_blocks block\n    WHERE block.start_date <= (plan_item->>''preliminary_date'')::date\n      AND block.end_date >= (plan_item->>''preliminary_date'')::date\n      AND block.user_id IN (\n        SELECT CASE WHEN plan_item->>''survey_method'' = ''phone''\n          THEN (plan_item->>''responsible_user_id'')::integer ELSE worker.value::integer END\n        FROM jsonb_array_elements_text(\n          CASE WHEN plan_item->>''survey_method'' = ''field'' THEN plan_item->''participant_user_ids'' ELSE ''[0]''::jsonb END\n        ) worker\n      );\n    IF current_schedule IS DISTINCT FROM expected_schedule THEN\n      RAISE EXCEPTION USING ERRCODE = ''40001'', MESSAGE = ''SOURCE_CHANGED'';\n    END IF;\n\n    expected_actual := COALESCE(plan_item->''source_actual_measurement_versions'', ''[]''::jsonb);\n    IF plan_item->>''survey_method'' = ''field'' THEN\n      SELECT COALESCE(jsonb_agg(jsonb_build_object(\n        ''targetId'', actual.id,\n        ''targetUpdatedAtMs'', CASE WHEN actual.updated_at IS NULL THEN NULL\n          ELSE floor(extract(epoch FROM actual.updated_at) * 1000)::bigint END,\n        ''fixedUpdatedAtMs'', COALESCE((\n          SELECT jsonb_agg(floor(extract(epoch FROM fixed.updated_at) * 1000)::bigint ORDER BY fixed.updated_at)\n          FROM public.preliminary_survey_v2_fixed_assignments fixed\n          WHERE fixed.measurement_target_business_id = actual.id\n            AND fixed.measurement_date = (plan_item->>''preliminary_date'')::date\n        ), ''[]''::jsonb)\n      ) ORDER BY actual.id), ''[]''::jsonb)\n      INTO current_actual\n      FROM public.measurement_target_business actual\n      WHERE NOT EXISTS (\n        SELECT 1 FROM jsonb_array_elements(p_plans) batch_plan\n        WHERE (batch_plan->>''target_id'')::bigint = actual.id\n      )\n        AND (\n          actual.measurement_date = (plan_item->>''preliminary_date'')::date\n          OR (jsonb_typeof(actual.daily_staff) = ''array'' AND EXISTS (\n            SELECT 1 FROM jsonb_array_elements(actual.daily_staff) staff\n            WHERE staff->>''date'' = plan_item->>''preliminary_date''\n          ))\n        );\n    ELSE\n      current_actual := ''[]''::jsonb;\n    END IF;\n    IF current_actual IS DISTINCT FROM expected_actual THEN\n      RAISE EXCEPTION USING ERRCODE = ''40001'', MESSAGE = ''SOURCE_CHANGED'';\n    END IF;\n\n    expected_occupancy := COALESCE(plan_item->''source_occupancy_versions'', ''[]''::jsonb);'
  );

  corrected_definition := replace(
    corrected_definition,
    E'    WHERE existing.measurement_target_business_id <> target_row.id\n      AND existing.recommended_date',
    E'    WHERE NOT EXISTS (\n      SELECT 1 FROM jsonb_array_elements(p_plans) batch_plan\n      WHERE (batch_plan->>''target_id'')::bigint = existing.measurement_target_business_id\n    )\n      AND existing.recommended_date'
  );

  -- public code position에는 아직 assignment가 없는 fixed confirmation도 포함한다.
  corrected_definition := replace(
    corrected_definition,
    E'  ), ranked AS (\n    SELECT\n      assignment.id,\n      upper(btrim(base_user.survey_code)) AS base_code,\n      row_number() OVER (\n        PARTITION BY assignment.measurement_date, assignment.assignee_user_id\n        ORDER BY target.code, target.id\n      ) AS position\n    FROM public.preliminary_survey_v2_measurement_assignments assignment\n    JOIN public.users base_user ON base_user.id = assignment.assignee_user_id\n    JOIN public.preliminary_survey_v2_plans plan ON plan.id = assignment.plan_id\n    JOIN public.measurement_target_business target\n      ON target.id = plan.measurement_target_business_id\n    JOIN affected\n      ON affected.measurement_date = assignment.measurement_date\n     AND affected.assignee_user_id = assignment.assignee_user_id\n  )',
    E'  ), group_members AS (\n    SELECT assignment.id AS assignment_id, plan.measurement_target_business_id AS target_id,\n      assignment.measurement_date, assignment.assignee_user_id\n    FROM public.preliminary_survey_v2_measurement_assignments assignment\n    JOIN public.preliminary_survey_v2_plans plan ON plan.id = assignment.plan_id\n    JOIN affected ON affected.measurement_date = assignment.measurement_date\n      AND affected.assignee_user_id = assignment.assignee_user_id\n    UNION ALL\n    SELECT NULL::uuid, fixed.measurement_target_business_id, fixed.measurement_date, fixed.assignee_user_id\n    FROM public.preliminary_survey_v2_fixed_assignments fixed\n    JOIN affected ON affected.measurement_date = fixed.measurement_date\n      AND affected.assignee_user_id = fixed.assignee_user_id\n    WHERE NOT EXISTS (\n      SELECT 1 FROM public.preliminary_survey_v2_measurement_assignments assignment\n      JOIN public.preliminary_survey_v2_plans plan ON plan.id = assignment.plan_id\n      WHERE plan.measurement_target_business_id = fixed.measurement_target_business_id\n        AND assignment.measurement_date = fixed.measurement_date\n    )\n  ), ranked AS (\n    SELECT member.assignment_id AS id, upper(btrim(base_user.survey_code)) AS base_code,\n      row_number() OVER (PARTITION BY member.measurement_date, member.assignee_user_id\n        ORDER BY target.code, target.id) AS position\n    FROM group_members member\n    JOIN public.users base_user ON base_user.id = member.assignee_user_id\n    JOIN public.measurement_target_business target ON target.id = member.target_id\n  )'
  );

  IF position('LOCK TABLE public.user_schedule_blocks IN SHARE MODE' IN corrected_definition) = 0
     OR position('source_actual_measurement_versions' IN corrected_definition) = 0
     OR position('group_members AS' IN corrected_definition) = 0
     OR position('batch_plan' IN corrected_definition) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REVERSE_PLANNER_COMPLETE_BASELINE_PATCH_NOT_APPLIED';
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
