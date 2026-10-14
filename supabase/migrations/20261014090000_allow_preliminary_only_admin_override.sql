-- A true-confirmed administrator may correct only the persisted preliminary plan.
-- The existing reverse-planner transaction, protection guard and append-only audit remain authoritative.
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

  corrected_definition := replace(current_definition,
    E'    IF NOT EXISTS (\n      SELECT 1 FROM jsonb_array_elements(p_assignments) item\n      WHERE (item->>''target_id'')::bigint = target_row.id\n    ) THEN',
    E'    IF plan_item->>''preliminary_only'' = ''true'' THEN\n      IF p_override_reason IS NULL OR plan_item->>''decision'' <> ''MANUAL_OVERRIDE''\n         OR plan_item->>''mutation'' <> ''REPLACE''\n         OR jsonb_array_length(p_plans) <> 1 OR jsonb_array_length(p_assignments) <> 0\n         OR NOT public.is_preliminary_survey_v2_true_confirmed(target_row.id)\n         OR NOT EXISTS (SELECT 1 FROM public.preliminary_survey_v2_plans existing\n           WHERE existing.id = (plan_item->''before_snapshot''->>''id'')::uuid\n             AND existing.measurement_target_business_id = target_row.id) THEN\n        RAISE EXCEPTION USING ERRCODE = ''22023'', MESSAGE = ''INVALID_PRELIMINARY_ONLY_OVERRIDE'';\n      END IF;\n      IF EXISTS (SELECT 1 FROM public.preliminary_survey_v2_planner_audit audit\n        WHERE audit.planner_run_id = p_planner_run_id AND audit.target_id = target_row.id) THEN\n        RAISE EXCEPTION USING ERRCODE = ''40001'', MESSAGE = ''SOURCE_CHANGED'';\n      END IF;\n      IF (SELECT COALESCE(jsonb_agg(jsonb_build_object(\n        ''measurementDate'', assignment.measurement_date::text,\n        ''assigneeUserId'', assignment.assignee_user_id,\n        ''surveyCode'', assignment.survey_code,\n        ''publicSampleCode'', assignment.public_sample_code,\n        ''updatedAtMs'', floor(extract(epoch FROM assignment.updated_at) * 1000)::bigint)\n        ORDER BY assignment.measurement_date), ''[]''::jsonb)\n        FROM public.preliminary_survey_v2_measurement_assignments assignment\n        WHERE assignment.plan_id = (plan_item->''before_snapshot''->>''id'')::uuid)\n          IS DISTINCT FROM plan_item->''source_target_assignments'' THEN\n        RAISE EXCEPTION USING ERRCODE = ''40001'', MESSAGE = ''SOURCE_CHANGED'';\n      END IF;\n      IF NOT EXISTS (SELECT 1 FROM public.users actor\n        WHERE actor.id = (plan_item->>''responsible_user_id'')::integer\n          AND actor.is_active IS TRUE AND actor.job = ''측정'')\n        OR (plan_item->>''reviewer_user_id'' IS NOT NULL AND NOT EXISTS\n          (SELECT 1 FROM public.users reviewer WHERE reviewer.id = (plan_item->>''reviewer_user_id'')::integer\n            AND reviewer.is_active IS TRUE AND reviewer.job = ''측정''))\n        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(plan_item->''participant_user_ids'') participant\n          WHERE NOT EXISTS (SELECT 1 FROM public.users worker WHERE worker.id = participant.value::integer\n            AND worker.is_active IS TRUE AND worker.job = ''측정'')) THEN\n        RAISE EXCEPTION USING ERRCODE = ''22023'', MESSAGE = ''INVALID_PRELIMINARY_USER'';\n      END IF;\n    END IF;\n    IF plan_item->>''preliminary_only'' IS DISTINCT FROM ''true'' AND NOT EXISTS (\n      SELECT 1 FROM jsonb_array_elements(p_assignments) item\n      WHERE (item->>''target_id'')::bigint = target_row.id\n    ) THEN');

  IF corrected_definition = current_definition
     OR position('INVALID_PRELIMINARY_ONLY_OVERRIDE' IN corrected_definition) = 0
     OR position('source_target_assignments' IN corrected_definition) = 0 THEN
    RAISE EXCEPTION 'PRELIMINARY_ONLY_RPC_PATCH_NOT_APPLIED';
  END IF;
  EXECUTE corrected_definition;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS preliminary_survey_v2_planner_audit_run_target_unique
  ON public.preliminary_survey_v2_planner_audit(planner_run_id, target_id)
  WHERE after_snapshot->>'preliminary_only' = 'true';

REVOKE ALL ON FUNCTION public.apply_preliminary_survey_v2_reverse_planner(
  uuid, text, text, text, jsonb, jsonb, integer, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_preliminary_survey_v2_reverse_planner(
  uuid, text, text, text, jsonb, jsonb, integer, text
) TO service_role;
NOTIFY pgrst, 'reload schema';
