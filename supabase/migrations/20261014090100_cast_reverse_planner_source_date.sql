-- The source target stores measurement_date as text; the V2 plan stores it as date.
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
    E'        CASE WHEN p_override_reason IS NULL THEN ''automatic'' ELSE ''manual'' END,\n        target_row.measurement_date,\n        target_row.measurer_id,',
    E'        CASE WHEN p_override_reason IS NULL THEN ''automatic'' ELSE ''manual'' END,\n        target_row.measurement_date::date,\n        target_row.measurer_id,');
  corrected_definition := replace(corrected_definition,
    E'      target_row.id,\n      target_row.measurement_date,\n      COALESCE(plan_item->''before_snapshot'', ''{}''::jsonb),',
    E'      target_row.id,\n      target_row.measurement_date::date,\n      COALESCE(plan_item->''before_snapshot'', ''{}''::jsonb),');
  IF position(E'        target_row.measurement_date::date,\n        target_row.measurer_id,' IN corrected_definition) = 0
     OR position(E'      target_row.measurement_date::date,\n      COALESCE(plan_item->''before_snapshot'', ''{}''::jsonb),' IN corrected_definition) = 0 THEN
    RAISE EXCEPTION 'REVERSE_PLANNER_SOURCE_DATE_CAST_NOT_APPLIED';
  END IF;
  IF corrected_definition <> current_definition THEN
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
