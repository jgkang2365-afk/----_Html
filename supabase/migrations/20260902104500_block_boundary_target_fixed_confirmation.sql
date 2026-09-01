-- 8·9월 경계 다일 target은 9월 날짜 confirm 요청도 DB 경계에서 차단한다.
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
    E'  IF p_measurement_date >= DATE ''2026-08-01'' AND p_measurement_date < DATE ''2026-09-01'' THEN',
    E'  IF (p_measurement_date >= DATE ''2026-08-01'' AND p_measurement_date < DATE ''2026-09-01'')\n     OR (target_row.measurement_date::date >= DATE ''2026-08-01'' AND target_row.measurement_date::date < DATE ''2026-09-01'')\n     OR EXISTS (\n       SELECT 1 FROM jsonb_array_elements(\n         CASE WHEN jsonb_typeof(target_row.daily_staff) = ''array'' THEN target_row.daily_staff ELSE ''[]''::jsonb END\n       ) day\n       WHERE day->>''date'' >= ''2026-08-01'' AND day->>''date'' < ''2026-09-01''\n     ) THEN'
  );
  IF corrected_definition IS DISTINCT FROM function_definition THEN
    EXECUTE corrected_definition;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
