-- 20260830140000 helper의 PL/pgSQL 변수와 assignment.plan_id 식별자 모호성을
-- forward-safe alias로 해소한다. target/journal/history 원천에는 쓰지 않는다.
CREATE OR REPLACE FUNCTION public.invalidate_preliminary_survey_v2_current_plan_before_journal(
  p_target_id bigint,
  p_reason text DEFAULT 'target_source_changed_before_journal'
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan_id uuid;
BEGIN
  IF public.is_preliminary_survey_v2_true_confirmed(p_target_id) THEN
    RETURN false;
  END IF;

  SELECT plan.id INTO v_plan_id
  FROM public.preliminary_survey_v2_plans AS plan
  WHERE plan.measurement_target_business_id = p_target_id
  FOR UPDATE;
  IF v_plan_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.preliminary_survey_v2_legacy_reconciliation AS reconciliation
  SET applied_plan_id = NULL,
      applied_assignment_id = NULL,
      plan_after = COALESCE(reconciliation.plan_after, '{}'::jsonb) || jsonb_build_object(
        'lifecycle_invalidated_plan_id', v_plan_id,
        'lifecycle_invalidation_reason', p_reason,
        'lifecycle_invalidated_at', CURRENT_TIMESTAMP
      ),
      assignment_after = COALESCE(reconciliation.assignment_after, '{}'::jsonb) || jsonb_build_object(
        'lifecycle_invalidated_plan_id', v_plan_id,
        'lifecycle_invalidation_reason', p_reason,
        'lifecycle_invalidated_at', CURRENT_TIMESTAMP
      )
  WHERE reconciliation.applied_plan_id = v_plan_id
     OR reconciliation.applied_assignment_id IN (
       SELECT assignment.id
       FROM public.preliminary_survey_v2_measurement_assignments AS assignment
       WHERE assignment.plan_id = v_plan_id
     );

  UPDATE public.preliminary_survey_v2_history_recovery_audit AS audit
  SET created_plan_id = NULL,
      plan_after = COALESCE(audit.plan_after, '{}'::jsonb) || jsonb_build_object(
        'lifecycle_invalidated_plan_id', v_plan_id,
        'lifecycle_invalidation_reason', p_reason,
        'lifecycle_invalidated_at', CURRENT_TIMESTAMP
      )
  WHERE audit.created_plan_id = v_plan_id;

  PERFORM public.delete_preliminary_survey_v2_plan_and_rebalance_assignments(p_target_id, false, NULL);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.invalidate_preliminary_survey_v2_current_plan_before_journal(bigint, text)
  FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
