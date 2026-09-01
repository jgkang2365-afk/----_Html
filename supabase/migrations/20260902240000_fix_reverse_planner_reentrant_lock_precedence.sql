-- 재진입 resource lock의 JSON 연산자 우선순위를 명시한다. Forward-only, no backfill.

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
    E'''reverse-planner-survey|phone|'' || plan_item->>''preliminary_date'' || ''|'' || plan_item->>''responsible_user_id''',
    E'''reverse-planner-survey|phone|'' || (plan_item->>''preliminary_date'') || ''|'' || (plan_item->>''responsible_user_id'')');
  corrected_definition := replace(corrected_definition,
    E'''reverse-planner-survey|field|'' || plan_item->>''preliminary_date'' || ''|'' || participant_id::text',
    E'''reverse-planner-survey|field|'' || (plan_item->>''preliminary_date'') || ''|'' || participant_id::text');
  corrected_definition := replace(corrected_definition,
    E'''reverse-planner-public-group|'' || assignment_item->>''measurement_date'' || ''|'' || assignment_item->>''assignee_user_id''',
    E'''reverse-planner-public-group|'' || (assignment_item->>''measurement_date'') || ''|'' || (assignment_item->>''assignee_user_id'')');

  IF corrected_definition = current_definition THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REVERSE_PLANNER_REENTRANT_LOCK_PRECEDENCE_PATCH_NOT_APPLIED';
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
