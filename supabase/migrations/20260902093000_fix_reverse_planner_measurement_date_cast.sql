-- v1 migration을 먼저 적용한 환경의 RPC date cast를 forward-only로 보정한다.
-- fresh 환경은 최초 migration에 cast가 이미 포함되어 있어 no-op이다.
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
    E'        target_row.measurement_date,\n        target_row.measurer_id,',
    E'        target_row.measurement_date::date,\n        target_row.measurer_id,'
  );
  corrected_definition := replace(
    corrected_definition,
    E'      target_row.measurement_date,\n      COALESCE(plan_item->''before_snapshot'', ''{}''::jsonb),',
    E'      target_row.measurement_date::date,\n      COALESCE(plan_item->''before_snapshot'', ''{}''::jsonb),'
  );

  IF corrected_definition IS DISTINCT FROM current_definition THEN
    EXECUTE corrected_definition;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
