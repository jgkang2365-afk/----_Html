-- 자동 측정자는 fixed confirmation row 없이 Apply하고, 명시 fixed와 측정자 점유 baseline은
-- transaction lock 아래에서 재검증한다. Forward-only function replacement; backfill 없음.

DO $$
DECLARE
  current_definition text;
  corrected_definition text;
BEGIN
  SELECT pg_get_functiondef(proc.oid) INTO current_definition
  FROM pg_proc proc JOIN pg_namespace namespace ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'public'
    AND proc.proname = 'apply_preliminary_survey_v2_reverse_planner'
    AND pg_get_function_identity_arguments(proc.oid)
      = 'p_planner_run_id uuid, p_source_fingerprint text, p_canonical_sha text, p_planner_version text, p_plans jsonb, p_assignments jsonb, p_actor_user_id integer, p_override_reason text';

  IF current_definition IS NULL THEN RAISE EXCEPTION 'REVERSE_PLANNER_APPLY_RPC_NOT_FOUND'; END IF;

  corrected_definition := replace(
    current_definition,
    E'  expected_protected boolean;\n  current_protected boolean;',
    E'  expected_protected boolean;\n  current_protected boolean;\n  expected_assignment_scope jsonb;\n  expected_assignment_occupancy jsonb;\n  current_assignment_occupancy jsonb;'
  );

  corrected_definition := replace(
    corrected_definition,
    E'    IF current_fixed IS DISTINCT FROM expected_fixed THEN\n      RAISE EXCEPTION USING ERRCODE = ''40001'', MESSAGE = ''SOURCE_CHANGED'';\n    END IF;\n\n    expected_schedule :=',
    E'    IF current_fixed IS DISTINCT FROM expected_fixed THEN\n      RAISE EXCEPTION USING ERRCODE = ''40001'', MESSAGE = ''SOURCE_CHANGED'';\n    END IF;\n\n    expected_assignment_scope := COALESCE(plan_item->''source_assignment_scope_keys'', ''[]''::jsonb);\n    expected_assignment_occupancy := COALESCE(plan_item->''source_assignment_occupancy_versions'', ''[]''::jsonb);\n    SELECT COALESCE(jsonb_agg(jsonb_build_object(\n      ''targetId'', assignment_plan.measurement_target_business_id,\n      ''measurementDate'', assignment.measurement_date::text,\n      ''assigneeUserId'', assignment.assignee_user_id,\n      ''updatedAtMs'', floor(extract(epoch FROM assignment.updated_at) * 1000)::bigint\n    ) ORDER BY assignment.measurement_date, assignment_plan.measurement_target_business_id, assignment.assignee_user_id), ''[]''::jsonb)\n    INTO current_assignment_occupancy\n    FROM public.preliminary_survey_v2_measurement_assignments assignment\n    JOIN public.preliminary_survey_v2_plans assignment_plan ON assignment_plan.id = assignment.plan_id\n    WHERE assignment.measurement_date IN (\n      SELECT DISTINCT (scope_item->>''measurementDate'')::date\n      FROM jsonb_array_elements(expected_assignment_scope) scope_item\n    )\n      AND NOT EXISTS (\n        SELECT 1 FROM jsonb_array_elements(expected_assignment_scope) scope_item\n        WHERE (scope_item->>''targetId'')::bigint = assignment_plan.measurement_target_business_id\n          AND (scope_item->>''measurementDate'')::date = assignment.measurement_date\n      )\n      AND NOT EXISTS (\n        SELECT 1 FROM public.preliminary_survey_v2_fixed_assignments fixed\n        WHERE fixed.measurement_target_business_id = assignment_plan.measurement_target_business_id\n          AND fixed.measurement_date = assignment.measurement_date\n      );\n    IF current_assignment_occupancy IS DISTINCT FROM expected_assignment_occupancy THEN\n      RAISE EXCEPTION USING ERRCODE = ''40001'', MESSAGE = ''SOURCE_CHANGED'';\n    END IF;\n\n    expected_schedule :='
  );

  corrected_definition := replace(
    corrected_definition,
    E'    IF EXISTS (\n      SELECT 1 FROM jsonb_array_elements(p_assignments) item\n      WHERE (item->>''target_id'')::bigint = target_row.id\n        AND NOT EXISTS (\n          SELECT 1\n          FROM public.preliminary_survey_v2_fixed_assignments fixed\n          WHERE fixed.measurement_target_business_id = target_row.id\n            AND fixed.measurement_date = (item->>''measurement_date'')::date\n            AND fixed.assignee_user_id = (item->>''assignee_user_id'')::integer\n        )\n    ) THEN\n      RAISE EXCEPTION USING ERRCODE = ''22023'', MESSAGE = ''FIXED_ASSIGNEE_SOURCE_CHANGED'';\n    END IF;',
    E'    IF EXISTS (\n      SELECT 1 FROM jsonb_array_elements(p_assignments) item\n      WHERE (item->>''target_id'')::bigint = target_row.id\n        AND COALESCE(item->>''assignment_origin'', '''') NOT IN (''confirmed'', ''automatic'')\n    ) THEN\n      RAISE EXCEPTION USING ERRCODE = ''22023'', MESSAGE = ''INVALID_ASSIGNMENT_ORIGIN'';\n    END IF;\n    IF EXISTS (\n      SELECT 1 FROM jsonb_array_elements(p_assignments) item\n      WHERE (item->>''target_id'')::bigint = target_row.id\n        AND item->>''assignment_origin'' = ''confirmed''\n        AND NOT EXISTS (\n          SELECT 1\n          FROM public.preliminary_survey_v2_fixed_assignments fixed\n          WHERE fixed.measurement_target_business_id = target_row.id\n            AND fixed.measurement_date = (item->>''measurement_date'')::date\n            AND fixed.assignee_user_id = (item->>''assignee_user_id'')::integer\n        )\n    ) THEN\n      RAISE EXCEPTION USING ERRCODE = ''22023'', MESSAGE = ''FIXED_ASSIGNEE_SOURCE_CHANGED'';\n    END IF;\n    IF EXISTS (\n      SELECT 1 FROM jsonb_array_elements(p_assignments) item\n      WHERE (item->>''target_id'')::bigint = target_row.id\n        AND item->>''assignment_origin'' = ''automatic''\n        AND EXISTS (\n          SELECT 1 FROM public.preliminary_survey_v2_fixed_assignments fixed\n          WHERE fixed.measurement_target_business_id = target_row.id\n            AND fixed.measurement_date = (item->>''measurement_date'')::date\n        )\n    ) THEN\n      RAISE EXCEPTION USING ERRCODE = ''40001'', MESSAGE = ''SOURCE_CHANGED'';\n    END IF;'
  );

  IF corrected_definition = current_definition
     OR position('expected_assignment_occupancy' IN corrected_definition) = 0
     OR position('INVALID_ASSIGNMENT_ORIGIN' IN corrected_definition) = 0
     OR position('assignment_origin'' = ''automatic' IN corrected_definition) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AUTOMATIC_ASSIGNMENT_RPC_PATCH_NOT_APPLIED';
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
