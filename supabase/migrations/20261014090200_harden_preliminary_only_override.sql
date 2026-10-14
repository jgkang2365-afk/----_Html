-- Fail closed for historical plans and malformed direct service-role calls.
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
    E'    IF plan_item->>''preliminary_only'' = ''true'' THEN\n      IF p_override_reason',
    E'    IF plan_item->>''preliminary_only'' = ''true'' THEN\n      IF target_row.measurement_date::date < DATE ''2026-09-01''\n        OR EXISTS (SELECT 1 FROM public.preliminary_survey_v2_legacy_reconciliation history\n          WHERE history.applied_plan_id = (plan_item->''before_snapshot''->>''id'')::uuid)\n        OR EXISTS (SELECT 1 FROM public.preliminary_survey_v2_history_recovery_audit history\n          WHERE history.created_plan_id = (plan_item->''before_snapshot''->>''id'')::uuid)\n        OR jsonb_typeof(plan_item->''participant_user_ids'') <> ''array''\n        OR jsonb_array_length(plan_item->''participant_user_ids'') = 0\n        OR NOT (plan_item->''participant_user_ids'' @> jsonb_build_array((plan_item->>''responsible_user_id'')::integer))\n        OR (plan_item->>''reviewer_user_id'' IS NOT NULL AND NOT\n          (plan_item->''participant_user_ids'' @> jsonb_build_array((plan_item->>''reviewer_user_id'')::integer)))\n        OR (SELECT count(*) FROM jsonb_array_elements_text(plan_item->''participant_user_ids''))\n          <> (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(plan_item->''participant_user_ids'')) THEN\n        RAISE EXCEPTION USING ERRCODE = ''22023'', MESSAGE = ''INVALID_PRELIMINARY_ONLY_OVERRIDE'';\n      END IF;\n      IF p_override_reason');
  IF corrected_definition = current_definition THEN
    RAISE EXCEPTION 'PRELIMINARY_ONLY_HARDENING_NOT_APPLIED';
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
