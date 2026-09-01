-- Reverse Planner v1.1 Apply 동시성·baseline 보강. Forward-only, no backfill.

CREATE OR REPLACE FUNCTION public.protect_preliminary_survey_v2_public_sample_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  protected_assignment boolean;
BEGIN
  IF NEW.public_sample_code IS NOT DISTINCT FROM OLD.public_sample_code THEN
    RETURN NEW;
  END IF;
  -- 기존 NULL은 survey_code fallback으로 이미 같은 값을 표시한다. 자동 backfill하지 않는다.
  IF OLD.public_sample_code IS NULL AND NEW.public_sample_code IS NOT DISTINCT FROM OLD.survey_code THEN
    RETURN OLD;
  END IF;
  IF current_setting('app.preliminary_survey_admin_repair', true) = 'on' THEN
    RETURN NEW;
  END IF;
  SELECT EXISTS (
    SELECT 1
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    JOIN public.preliminary_survey_v2_plans plan ON plan.id = assignment.plan_id
    JOIN public.measurement_target_business target ON target.id = plan.measurement_target_business_id
    WHERE assignment.id = OLD.id
      AND (
        EXISTS (
          SELECT 1 FROM public.preliminary_survey_v2_legacy_reconciliation reconciliation
          WHERE reconciliation.applied_plan_id = plan.id OR reconciliation.applied_assignment_id = assignment.id
        )
        OR EXISTS (
          SELECT 1 FROM public.preliminary_survey_v2_history_recovery_audit history
          WHERE history.created_plan_id = plan.id
        )
        OR EXISTS (
          SELECT 1 FROM public.measurement_journal journal
          WHERE journal.code = target.code
            AND journal.measurement_year = target.year
            AND replace(btrim(journal.measurement_period), '(수시)', '')
              = replace(btrim(target.period), '(수시)', '')
        )
      )
  ) INTO protected_assignment;
  IF protected_assignment THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PROTECTED_PLAN_REQUIRES_REVIEW';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_preliminary_survey_v2_public_sample_code()
  FROM PUBLIC, anon, authenticated, service_role;

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
    E'  FOR plan_item IN\n    SELECT value FROM jsonb_array_elements(p_plans)',
    E'  IF p_override_reason IS NOT NULL THEN\n    PERFORM set_config(''app.preliminary_survey_admin_repair'', ''on'', true);\n  END IF;\n\n  -- 동일 공시료 그룹 Apply를 transaction 단위로 결정론적 직렬화한다.\n  FOR assignment_item IN\n    SELECT value FROM jsonb_array_elements(p_assignments)\n    ORDER BY value->>''measurement_date'', (value->>''assignee_user_id'')::integer, (value->>''target_id'')::bigint\n  LOOP\n    PERFORM pg_advisory_xact_lock(hashtextextended(\n      ''reverse-planner-public-group|'' || assignment_item->>''measurement_date'' || ''|'' || assignment_item->>''assignee_user_id'', 0\n    ));\n  END LOOP;\n\n  FOR plan_item IN\n    SELECT value FROM jsonb_array_elements(p_plans)'
  );

  corrected_definition := replace(
    corrected_definition,
    E'    IF plan_item->>''mutation'' <> ''KEEP_EXISTING'' THEN',
    E'    -- API snapshot 이후 같은 target plan이 바뀌었으면 stale Apply를 거부한다.\n    IF plan_item->>''mutation'' = ''CREATE'' AND EXISTS (\n      SELECT 1 FROM public.preliminary_survey_v2_plans existing\n      WHERE existing.measurement_target_business_id = target_row.id\n    ) THEN\n      RAISE EXCEPTION USING ERRCODE = ''40001'', MESSAGE = ''SOURCE_CHANGED'';\n    ELSIF plan_item->>''mutation'' = ''REPLACE'' AND NOT EXISTS (\n      SELECT 1 FROM public.preliminary_survey_v2_plans existing\n      WHERE existing.measurement_target_business_id = target_row.id\n        AND existing.id = (plan_item->''before_snapshot''->>''id'')::uuid\n        AND existing.updated_at = (plan_item->''before_snapshot''->>''updatedAt'')::timestamptz\n    ) THEN\n      RAISE EXCEPTION USING ERRCODE = ''40001'', MESSAGE = ''SOURCE_CHANGED'';\n    END IF;\n\n    IF plan_item->>''mutation'' <> ''KEEP_EXISTING'' THEN'
  );

  IF position('pg_advisory_xact_lock' IN corrected_definition) = 0
     OR position('app.preliminary_survey_admin_repair' IN corrected_definition) = 0
     OR position('before_snapshot''->>''updatedAt' IN corrected_definition) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REVERSE_PLANNER_V1_1_SERIALIZATION_PATCH_NOT_APPLIED';
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
