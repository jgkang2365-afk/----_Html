-- measurement_target_business가 예비조사 활성 여부와 측정계획의 단일 원천이다.
-- 측정일지 전의 현재 V2 작업층만 정리하며 target/journal/history는 절대 삭제하지 않는다.
CREATE OR REPLACE FUNCTION public.sync_preliminary_survey_v2_target_lifecycle()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  plan_id uuid;
BEGIN
  IF NEW.measurement_date IS NOT DISTINCT FROM OLD.measurement_date
     AND NEW.is_registered IS NOT DISTINCT FROM OLD.is_registered THEN
    RETURN NEW;
  END IF;
  -- 일지 생성 후에는 upstream 변경으로 V2 원천을 재구성하지 않는다.
  IF public.is_preliminary_survey_v2_true_confirmed(NEW.id) THEN RETURN NEW; END IF;
  -- 유효 계획이 사라지거나 기준 측정일이 달라진 경우에만 stale current plan을 정리한다.
  IF NEW.measurement_date IS NOT NULL
     AND btrim(COALESCE(NEW.is_registered, '')) IN ('실시', '확정')
     AND NEW.measurement_date IS NOT DISTINCT FROM OLD.measurement_date THEN
    RETURN NEW;
  END IF;
  SELECT id INTO plan_id FROM public.preliminary_survey_v2_plans
    WHERE measurement_target_business_id = NEW.id FOR UPDATE;
  IF plan_id IS NULL THEN RETURN NEW; END IF;
  -- reconciliation/history가 참조하는 보존 plan은 제거하지 않는다. 활성 목록에서는 target 조건으로 제외된다.
  IF EXISTS (SELECT 1 FROM public.preliminary_survey_v2_legacy_reconciliation WHERE applied_plan_id = plan_id)
     OR EXISTS (SELECT 1 FROM public.preliminary_survey_v2_history_recovery_audit WHERE created_plan_id = plan_id) THEN
    RETURN NEW;
  END IF;
  -- 현재 V2 layer 정리는 일반 삭제와 동일한 advisory lock·승인 metadata 정규화 경로를 쓴다.
  PERFORM public.delete_preliminary_survey_v2_plan_and_rebalance_assignments(NEW.id, false, NULL);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_preliminary_survey_v2_target_lifecycle ON public.measurement_target_business;
CREATE TRIGGER trg_sync_preliminary_survey_v2_target_lifecycle
AFTER UPDATE OF measurement_date, is_registered ON public.measurement_target_business
FOR EACH ROW EXECUTE FUNCTION public.sync_preliminary_survey_v2_target_lifecycle();

REVOKE ALL ON FUNCTION public.sync_preliminary_survey_v2_target_lifecycle() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';

-- Rollback (별도 승인): DROP TRIGGER ...; DROP FUNCTION public.sync_preliminary_survey_v2_target_lifecycle();
