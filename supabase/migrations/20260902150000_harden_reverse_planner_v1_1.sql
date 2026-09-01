-- Reverse Planner v1.1 운영정확성 보강. Forward-only, no backfill.

CREATE INDEX IF NOT EXISTS idx_preliminary_survey_v2_reconciliation_applied_plan
  ON public.preliminary_survey_v2_legacy_reconciliation(applied_plan_id)
  WHERE applied_plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_preliminary_survey_v2_reconciliation_applied_assignment
  ON public.preliminary_survey_v2_legacy_reconciliation(applied_assignment_id)
  WHERE applied_assignment_id IS NOT NULL;

-- 보호 plan의 공시료 표시 code는 그룹 재정규화로도 자동 변경하지 않는다.
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

DROP TRIGGER IF EXISTS trg_protect_preliminary_survey_v2_public_sample_code
  ON public.preliminary_survey_v2_measurement_assignments;
CREATE TRIGGER trg_protect_preliminary_survey_v2_public_sample_code
BEFORE UPDATE OF public_sample_code ON public.preliminary_survey_v2_measurement_assignments
FOR EACH ROW EXECUTE FUNCTION public.protect_preliminary_survey_v2_public_sample_code();

REVOKE ALL ON FUNCTION public.protect_preliminary_survey_v2_public_sample_code()
  FROM PUBLIC, anon, authenticated, service_role;

-- 기존 Apply RPC의 signature를 유지하면서 override origin과 Preview/persist code 일치를 보강한다.
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
    E'        ''automatic'',\n        target_row.measurement_date::date,',
    E'        CASE WHEN p_override_reason IS NULL THEN ''automatic'' ELSE ''manual'' END,\n        target_row.measurement_date::date,'
  );
  IF corrected_definition = current_definition THEN
    corrected_definition := replace(
      current_definition,
      E'        ''automatic'',\n        target_row.measurement_date,',
      E'        CASE WHEN p_override_reason IS NULL THEN ''automatic'' ELSE ''manual'' END,\n        target_row.measurement_date,'
    );
  END IF;

  corrected_definition := replace(
    corrected_definition,
    E'  RETURN jsonb_build_object(\n    ''appliedCount'', applied_count,',
    E'  IF EXISTS (\n    SELECT 1\n    FROM jsonb_array_elements(p_assignments) expected\n    JOIN public.preliminary_survey_v2_plans plan\n      ON plan.measurement_target_business_id = (expected->>''target_id'')::bigint\n    JOIN public.preliminary_survey_v2_measurement_assignments assignment\n      ON assignment.plan_id = plan.id\n     AND assignment.measurement_date = (expected->>''measurement_date'')::date\n    WHERE assignment.public_sample_code IS DISTINCT FROM expected->>''public_sample_code''\n  ) THEN\n    RAISE EXCEPTION USING ERRCODE = ''40001'', MESSAGE = ''PUBLIC_SAMPLE_PREVIEW_MISMATCH'';\n  END IF;\n\n  RETURN jsonb_build_object(\n    ''appliedCount'', applied_count,'
  );

  IF position('CASE WHEN p_override_reason IS NULL THEN ''automatic'' ELSE ''manual'' END' IN corrected_definition) = 0
     OR position('PUBLIC_SAMPLE_PREVIEW_MISMATCH' IN corrected_definition) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REVERSE_PLANNER_V1_1_PATCH_NOT_APPLIED';
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
