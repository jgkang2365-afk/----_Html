-- v1 migration을 먼저 적용한 환경의 confirm/apply RPC에도 8월 전환 보호를 추가한다.
-- fresh 환경은 최초 migration에 guard가 이미 포함되어 있어 no-op이다.
DO $$
DECLARE
  function_definition text;
  corrected_definition text;
BEGIN
  SELECT pg_get_functiondef(proc.oid) INTO function_definition
  FROM pg_proc proc JOIN pg_namespace namespace ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'public'
    AND proc.proname = 'confirm_preliminary_survey_v2_fixed_assignment';
  IF function_definition IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42883', MESSAGE = 'REVERSE_PLANNER_CONFIRM_RPC_NOT_FOUND';
  END IF;
  corrected_definition := replace(
    function_definition,
    E'  IF p_measurement_date IS DISTINCT FROM target_row.measurement_date::date AND NOT EXISTS (',
    E'  IF p_measurement_date >= DATE ''2026-08-01'' AND p_measurement_date < DATE ''2026-09-01'' THEN\n    RAISE EXCEPTION USING ERRCODE = ''22023'', MESSAGE = ''TRANSITION_BOUNDARY_REVIEW_REQUIRED'';\n  END IF;\n  IF p_measurement_date IS DISTINCT FROM target_row.measurement_date::date AND NOT EXISTS ('
  );
  IF corrected_definition IS DISTINCT FROM function_definition THEN EXECUTE corrected_definition; END IF;

  SELECT pg_get_functiondef(proc.oid) INTO function_definition
  FROM pg_proc proc JOIN pg_namespace namespace ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'public'
    AND proc.proname = 'apply_preliminary_survey_v2_reverse_planner';
  IF function_definition IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42883', MESSAGE = 'REVERSE_PLANNER_APPLY_RPC_NOT_FOUND';
  END IF;
  corrected_definition := replace(
    function_definition,
    E'    IF target_row.measurement_date::text IS DISTINCT FROM plan_item->>''source_measurement_date''',
    E'    IF target_row.measurement_date::date >= DATE ''2026-08-01''\n       AND target_row.measurement_date::date < DATE ''2026-09-01''\n       OR EXISTS (\n         SELECT 1 FROM jsonb_array_elements(\n           CASE WHEN jsonb_typeof(target_row.daily_staff) = ''array'' THEN target_row.daily_staff ELSE ''[]''::jsonb END\n         ) day\n         WHERE day->>''date'' >= ''2026-08-01'' AND day->>''date'' < ''2026-09-01''\n       ) THEN\n      RAISE EXCEPTION USING ERRCODE = ''22023'', MESSAGE = ''TRANSITION_BOUNDARY_REVIEW_REQUIRED'';\n    END IF;\n    IF target_row.measurement_date::text IS DISTINCT FROM plan_item->>''source_measurement_date'''
  );
  IF corrected_definition IS DISTINCT FROM function_definition THEN EXECUTE corrected_definition; END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
