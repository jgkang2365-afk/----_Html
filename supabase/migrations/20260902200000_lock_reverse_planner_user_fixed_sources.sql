-- Reverse Planner v1.1 user/fixed source를 transaction 안에서 재검증한다. Forward-only, no backfill.

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
    E'  current_actual jsonb;\nBEGIN',
    E'  current_actual jsonb;\n  expected_users jsonb;\n  current_users jsonb;\n  expected_fixed jsonb;\n  current_fixed jsonb;\nBEGIN'
  );

  corrected_definition := replace(
    corrected_definition,
    E'  LOCK TABLE public.user_schedule_blocks IN SHARE MODE;',
    E'  LOCK TABLE public.users IN SHARE MODE;\n  LOCK TABLE public.user_schedule_blocks IN SHARE MODE;'
  );

  corrected_definition := replace(
    corrected_definition,
    E'    expected_schedule := COALESCE(plan_item->''source_schedule_blocks'', ''[]''::jsonb);',
    E'    expected_users := COALESCE(plan_item->''source_users'', ''[]''::jsonb);\n    SELECT COALESCE(jsonb_agg(jsonb_build_object(\n      ''id'', source_user.id,\n      ''active'', source_user.is_active IS NOT FALSE,\n      ''experienced'', source_user.is_preliminary_survey_experienced IS TRUE,\n      ''baseCode'', CASE WHEN source_user.survey_code IS NULL THEN NULL ELSE upper(btrim(source_user.survey_code)) END\n    ) ORDER BY source_user.id), ''[]''::jsonb)\n    INTO current_users\n    FROM public.users source_user\n    WHERE source_user.job = ''측정'';\n    IF current_users IS DISTINCT FROM expected_users THEN\n      RAISE EXCEPTION USING ERRCODE = ''40001'', MESSAGE = ''SOURCE_CHANGED'';\n    END IF;\n\n    expected_fixed := COALESCE(plan_item->''source_fixed_versions'', ''[]''::jsonb);\n    SELECT COALESCE(jsonb_agg(jsonb_build_object(\n      ''measurementDate'', fixed.measurement_date::text,\n      ''assigneeUserId'', fixed.assignee_user_id,\n      ''updatedAtMs'', floor(extract(epoch FROM fixed.updated_at) * 1000)::bigint,\n      ''nonParticipantConfirmed'', COALESCE((fixed.source_snapshot->>''nonParticipantConfirmed'')::boolean, false)\n    ) ORDER BY fixed.measurement_date), ''[]''::jsonb)\n    INTO current_fixed\n    FROM public.preliminary_survey_v2_fixed_assignments fixed\n    WHERE fixed.measurement_target_business_id = target_row.id;\n    IF current_fixed IS DISTINCT FROM expected_fixed THEN\n      RAISE EXCEPTION USING ERRCODE = ''40001'', MESSAGE = ''SOURCE_CHANGED'';\n    END IF;\n\n    expected_schedule := COALESCE(plan_item->''source_schedule_blocks'', ''[]''::jsonb);'
  );

  IF position('LOCK TABLE public.users IN SHARE MODE' IN corrected_definition) = 0
     OR position('source_users' IN corrected_definition) = 0
     OR position('source_fixed_versions' IN corrected_definition) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REVERSE_PLANNER_USER_FIXED_BASELINE_PATCH_NOT_APPLIED';
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
