-- Reverse Planner stores one plan per business. Its date columns and collision
-- checks must use the first actual measurement day, even when the target's
-- legacy measurement_date text contains several comma-separated dates.
CREATE OR REPLACE FUNCTION public.preliminary_survey_v2_first_measurement_date(
  p_measurement_date text,
  p_daily_staff jsonb
) RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $function$
  SELECT COALESCE(
    (SELECT min((day->>'date')::date)
     FROM jsonb_array_elements(
       CASE WHEN jsonb_typeof(p_daily_staff) = 'array' THEN p_daily_staff ELSE '[]'::jsonb END
     ) AS day),
    NULLIF(btrim(split_part(p_measurement_date, ',', 1)), '')::date
  );
$function$;

REVOKE ALL ON FUNCTION public.preliminary_survey_v2_first_measurement_date(text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

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

  -- Keep the raw source text comparison intact for stale-source detection.
  -- Only date comparisons and date-valued persisted snapshots use the first day.
  IF (length(current_definition) - length(replace(current_definition, 'target_row.measurement_date::date', '')))
       / length('target_row.measurement_date::date') <> 5
     OR (length(current_definition) - length(replace(current_definition, 'actual.measurement_date::date', '')))
       / length('actual.measurement_date::date') <> 1
     OR (length(current_definition) - length(replace(current_definition, 'impacted_target.measurement_date::date', '')))
       / length('impacted_target.measurement_date::date') <> 1 THEN
    RAISE EXCEPTION 'REVERSE_PLANNER_MULTIDAY_CAST_SHAPE_CHANGED';
  END IF;

  corrected_definition := replace(current_definition,
    'target_row.measurement_date::date',
    'public.preliminary_survey_v2_first_measurement_date(target_row.measurement_date, target_row.daily_staff)');
  corrected_definition := replace(corrected_definition,
    'actual.measurement_date::date',
    'public.preliminary_survey_v2_first_measurement_date(actual.measurement_date, actual.daily_staff)');
  corrected_definition := replace(corrected_definition,
    'impacted_target.measurement_date::date',
    'public.preliminary_survey_v2_first_measurement_date(impacted_target.measurement_date, impacted_target.daily_staff)');
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
