-- Reverse Planner Apply의 table lock 순서를 target lifecycle writer와 맞춘다.
-- Forward-only function replacement. Business data/backfill 없음.

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
    E'  LOCK TABLE public.preliminary_survey_v2_plans IN SHARE ROW EXCLUSIVE MODE;\n  LOCK TABLE public.preliminary_survey_v2_measurement_assignments IN SHARE ROW EXCLUSIVE MODE;\n  LOCK TABLE public.measurement_journal IN SHARE MODE;\n  LOCK TABLE public.preliminary_survey_v2_legacy_reconciliation IN SHARE MODE;\n  LOCK TABLE public.preliminary_survey_v2_history_recovery_audit IN SHARE MODE;\n  LOCK TABLE public.users IN SHARE MODE;\n  LOCK TABLE public.user_schedule_blocks IN SHARE MODE;\n  LOCK TABLE public.measurement_target_business IN SHARE MODE;\n  LOCK TABLE public.preliminary_survey_v2_fixed_assignments IN SHARE MODE;',
    E'  -- target UPDATE trigger가 target -> plan 순서로 잠그므로 같은 순서를 지킨다.\n  LOCK TABLE public.measurement_target_business IN SHARE MODE;\n  LOCK TABLE public.preliminary_survey_v2_plans IN SHARE ROW EXCLUSIVE MODE;\n  LOCK TABLE public.preliminary_survey_v2_measurement_assignments IN SHARE ROW EXCLUSIVE MODE;\n  LOCK TABLE public.measurement_journal IN SHARE MODE;\n  LOCK TABLE public.preliminary_survey_v2_legacy_reconciliation IN SHARE MODE;\n  LOCK TABLE public.preliminary_survey_v2_history_recovery_audit IN SHARE MODE;\n  LOCK TABLE public.users IN SHARE MODE;\n  LOCK TABLE public.user_schedule_blocks IN SHARE MODE;\n  LOCK TABLE public.preliminary_survey_v2_fixed_assignments IN SHARE MODE;'
  );

  IF corrected_definition = current_definition
     OR position('target UPDATE trigger가 target -> plan 순서' IN corrected_definition) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REVERSE_PLANNER_TABLE_LOCK_ORDER_PATCH_NOT_APPLIED';
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
