-- Reverse Planner Apply의 actual measurement baseline에서
-- measurement_target_business.measurement_date(text)와 date를 직접 비교하던 오류를 보정한다.
-- Forward-only, no backfill. 이미 보정된 환경에서는 no-op이다.
DO $$
DECLARE
  current_definition text;
  corrected_definition text;
  broken_pattern text := E'actual.measurement_date = (plan_item->>''preliminary_date'')::date';
  fixed_pattern text := E'actual.measurement_date::date = (plan_item->>''preliminary_date'')::date';
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

  IF position(fixed_pattern IN current_definition) > 0 THEN
    corrected_definition := current_definition;
  ELSIF position(broken_pattern IN current_definition) > 0 THEN
    corrected_definition := replace(current_definition, broken_pattern, fixed_pattern);
  ELSE
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REVERSE_PLANNER_ACTUAL_DATE_CAST_PATCH_NOT_APPLIED';
  END IF;

  IF corrected_definition IS DISTINCT FROM current_definition THEN
    EXECUTE corrected_definition;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_preliminary_survey_v2_reverse_planner(
  uuid, text, text, text, jsonb, jsonb, integer, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_preliminary_survey_v2_reverse_planner(
  uuid, text, text, text, jsonb, jsonb, integer, text
) TO service_role;

NOTIFY pgrst, 'reload schema';
