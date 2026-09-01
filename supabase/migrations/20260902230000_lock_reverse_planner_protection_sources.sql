-- Reverse Planner v1.1 보호상태 원천을 transaction 안에서 재검증한다. Forward-only, no backfill.

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
    E'  current_fixed jsonb;\nBEGIN',
    E'  current_fixed jsonb;\n  expected_protected boolean;\n  current_protected boolean;\nBEGIN'
  );

  corrected_definition := replace(
    corrected_definition,
    E'  LOCK TABLE public.users IN SHARE MODE;',
    E'  -- plan/assignment write 경로 전체를 짧게 직렬화하고 보호 원천의 phantom INSERT를 막는다.\n  LOCK TABLE public.preliminary_survey_v2_plans IN SHARE ROW EXCLUSIVE MODE;\n  LOCK TABLE public.preliminary_survey_v2_measurement_assignments IN SHARE ROW EXCLUSIVE MODE;\n  LOCK TABLE public.measurement_journal IN SHARE MODE;\n  LOCK TABLE public.preliminary_survey_v2_legacy_reconciliation IN SHARE MODE;\n  LOCK TABLE public.preliminary_survey_v2_history_recovery_audit IN SHARE MODE;\n  LOCK TABLE public.users IN SHARE MODE;'
  );

  corrected_definition := replace(
    corrected_definition,
    E'    expected_users := COALESCE(plan_item->''source_users'', ''[]''::jsonb);',
    E'    expected_protected := COALESCE((plan_item->>''source_protected'')::boolean, false);\n    SELECT (\n      EXISTS (\n        SELECT 1 FROM public.measurement_journal journal\n        WHERE journal.code = target_row.code\n          AND journal.measurement_year = target_row.year\n          AND replace(btrim(journal.measurement_period), ''(수시)'', '''')\n            = replace(btrim(target_row.period), ''(수시)'', '''')\n      )\n      OR EXISTS (\n        SELECT 1 FROM public.preliminary_survey_v2_plans protected_plan\n        WHERE protected_plan.measurement_target_business_id = target_row.id\n          AND (\n            EXISTS (SELECT 1 FROM public.preliminary_survey_v2_legacy_reconciliation reconciliation\n              WHERE reconciliation.applied_plan_id = protected_plan.id)\n            OR EXISTS (SELECT 1 FROM public.preliminary_survey_v2_history_recovery_audit history\n              WHERE history.created_plan_id = protected_plan.id)\n          )\n      )\n    ) INTO current_protected;\n    IF current_protected IS DISTINCT FROM expected_protected THEN\n      RAISE EXCEPTION USING ERRCODE = ''40001'', MESSAGE = ''SOURCE_CHANGED'';\n    END IF;\n\n    expected_users := COALESCE(plan_item->''source_users'', ''[]''::jsonb);'
  );

  IF position('source_protected' IN corrected_definition) = 0
     OR position('LOCK TABLE public.measurement_journal IN SHARE MODE' IN corrected_definition) = 0
     OR position('SHARE ROW EXCLUSIVE MODE' IN corrected_definition) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REVERSE_PLANNER_PROTECTION_BASELINE_PATCH_NOT_APPLIED';
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
