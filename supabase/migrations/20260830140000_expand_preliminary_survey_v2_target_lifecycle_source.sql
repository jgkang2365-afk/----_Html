-- 측정대상사업장의 전체 계획 원천 변경은 측정일지 생성 전 current V2 layer만 무효화한다.
-- 일반 삭제의 history 보호는 유지한다. lifecycle 전용 detach는 기존 audit/reconciliation
-- row와 원본 snapshot을 보존하고 참조 FK만 null로 바꾼 뒤 같은 safe-delete RPC를 호출한다.
-- 이 helper는 이미 저장된 stale plan을 target 단위로 안전하게 정리할 때도 사용한다.
CREATE OR REPLACE FUNCTION public.invalidate_preliminary_survey_v2_current_plan_before_journal(
  p_target_id bigint,
  p_reason text DEFAULT 'target_source_changed_before_journal'
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  plan_id uuid;
BEGIN
  -- 측정일지가 이미 있으면 upstream 원천의 일반 재구성은 금지한다.
  IF public.is_preliminary_survey_v2_true_confirmed(p_target_id) THEN
    RETURN false;
  END IF;

  SELECT id INTO plan_id
  FROM public.preliminary_survey_v2_plans
  WHERE measurement_target_business_id = p_target_id
  FOR UPDATE;
  IF plan_id IS NULL THEN
    RETURN false;
  END IF;

  -- history/reconciliation의 원본 snapshot은 유지한다. 현재 stale plan/assignment FK만
  -- lifecycle provenance와 함께 해제해야 기존 safe-delete RPC가 current layer를 정리할 수 있다.
  UPDATE public.preliminary_survey_v2_legacy_reconciliation AS reconciliation
  SET applied_plan_id = NULL,
      applied_assignment_id = NULL,
      plan_after = COALESCE(reconciliation.plan_after, '{}'::jsonb) || jsonb_build_object(
        'lifecycle_invalidated_plan_id', plan_id,
        'lifecycle_invalidation_reason', p_reason,
        'lifecycle_invalidated_at', CURRENT_TIMESTAMP
      ),
      assignment_after = COALESCE(reconciliation.assignment_after, '{}'::jsonb) || jsonb_build_object(
        'lifecycle_invalidated_plan_id', plan_id,
        'lifecycle_invalidation_reason', p_reason,
        'lifecycle_invalidated_at', CURRENT_TIMESTAMP
      )
  WHERE reconciliation.applied_plan_id = plan_id
     OR reconciliation.applied_assignment_id IN (
       SELECT assignment.id
       FROM public.preliminary_survey_v2_measurement_assignments AS assignment
       WHERE assignment.plan_id = plan_id
     );

  UPDATE public.preliminary_survey_v2_history_recovery_audit AS audit
  SET created_plan_id = NULL,
      plan_after = COALESCE(audit.plan_after, '{}'::jsonb) || jsonb_build_object(
        'lifecycle_invalidated_plan_id', plan_id,
        'lifecycle_invalidation_reason', p_reason,
        'lifecycle_invalidated_at', CURRENT_TIMESTAMP
      )
  WHERE audit.created_plan_id = plan_id;

  -- 날짜별 advisory lock, target/plan FOR UPDATE, 3건 approval metadata 정규화는 검증된
  -- 기존 safe-delete 경로 하나만 사용한다. 오류면 trigger transaction 전체가 rollback된다.
  PERFORM public.delete_preliminary_survey_v2_plan_and_rebalance_assignments(p_target_id, false, NULL);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_preliminary_survey_v2_target_lifecycle()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.measurement_date IS NOT DISTINCT FROM OLD.measurement_date
     AND NEW.measurement_end_date IS NOT DISTINCT FROM OLD.measurement_end_date
     AND NEW.daily_staff IS NOT DISTINCT FROM OLD.daily_staff
     AND NEW.measurer_id IS NOT DISTINCT FROM OLD.measurer_id
     AND NEW.collaborators IS NOT DISTINCT FROM OLD.collaborators
     AND NEW.business_type IS NOT DISTINCT FROM OLD.business_type
     AND NEW.process_changed IS NOT DISTINCT FROM OLD.process_changed
     AND NEW.is_registered IS NOT DISTINCT FROM OLD.is_registered
     AND NEW.address IS NOT DISTINCT FROM OLD.address THEN
    RETURN NEW;
  END IF;

  PERFORM public.invalidate_preliminary_survey_v2_current_plan_before_journal(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_preliminary_survey_v2_target_lifecycle ON public.measurement_target_business;
CREATE TRIGGER trg_sync_preliminary_survey_v2_target_lifecycle
AFTER UPDATE OF measurement_date, measurement_end_date, daily_staff, measurer_id, collaborators,
  business_type, process_changed, is_registered, address
ON public.measurement_target_business
FOR EACH ROW EXECUTE FUNCTION public.sync_preliminary_survey_v2_target_lifecycle();

REVOKE ALL ON FUNCTION public.sync_preliminary_survey_v2_target_lifecycle() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invalidate_preliminary_survey_v2_current_plan_before_journal(bigint, text)
  FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';

-- Rollback (별도 승인): 기존 20260830114500의 function/trigger 정의로 복원한다.
