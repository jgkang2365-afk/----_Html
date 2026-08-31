-- Forward-only: 관리자 측정 원천 repair는 current V2 plan/assignment를 무효화하지 않는다.
-- 140000 lifecycle의 일반 upstream 변경 정책은 유지하고, 152000 RPC가 같은 transaction에서만
-- 설정하는 owner-only local flag만 예외로 처리한다.
CREATE OR REPLACE FUNCTION public.sync_preliminary_survey_v2_target_lifecycle()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('app.preliminary_survey_measurement_source_repair', true) = 'on'
     AND NEW.measurement_date IS NOT DISTINCT FROM OLD.measurement_date
     AND NEW.measurement_end_date IS NOT DISTINCT FROM OLD.measurement_end_date
     AND NEW.business_type IS NOT DISTINCT FROM OLD.business_type
     AND NEW.process_changed IS NOT DISTINCT FROM OLD.process_changed
     AND NEW.is_registered IS NOT DISTINCT FROM OLD.is_registered
     AND NEW.address IS NOT DISTINCT FROM OLD.address THEN
    RETURN NEW;
  END IF;
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

-- assignment의 승인 metadata 정규화와 별개로, 삭제/이동 뒤 남은 old group의 A/AA/AAA를
-- 항상 현재 순서로 다시 계산한다. survey_code만 UPDATE하므로 이 trigger는 재귀하지 않는다.
CREATE OR REPLACE FUNCTION public.normalize_preliminary_survey_v2_public_sample_codes_after_group_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  old_measurement_date date := OLD.measurement_date;
  old_assignee_user_id integer := OLD.assignee_user_id;
  new_measurement_date date;
  new_assignee_user_id integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    new_measurement_date := NEW.measurement_date;
    new_assignee_user_id := NEW.assignee_user_id;
  END IF;
  WITH affected_keys AS (
    SELECT old_measurement_date AS measurement_date, old_assignee_user_id AS assignee_user_id
    UNION
    SELECT new_measurement_date, new_assignee_user_id WHERE new_measurement_date IS NOT NULL
  ), ranked AS (
    SELECT assignment.id,
      repeat(upper(btrim(user_row.survey_code)), row_number() OVER (
        PARTITION BY assignment.measurement_date, assignment.assignee_user_id
        ORDER BY target_plan.measurement_target_business_id, assignment.created_at, assignment.id
      )::integer) AS next_survey_code
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    JOIN affected_keys ON affected_keys.measurement_date = assignment.measurement_date
      AND affected_keys.assignee_user_id = assignment.assignee_user_id
    JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
    JOIN public.users user_row ON user_row.id = assignment.assignee_user_id
  )
  UPDATE public.preliminary_survey_v2_measurement_assignments assignment
  SET survey_code = ranked.next_survey_code
  FROM ranked
  WHERE assignment.id = ranked.id
    AND assignment.survey_code IS DISTINCT FROM ranked.next_survey_code;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_preliminary_survey_v2_public_sample_codes_after_group_change
  ON public.preliminary_survey_v2_measurement_assignments;
CREATE TRIGGER trg_normalize_preliminary_survey_v2_public_sample_codes_after_group_change
AFTER DELETE OR UPDATE OF measurement_date, assignee_user_id
ON public.preliminary_survey_v2_measurement_assignments
FOR EACH ROW EXECUTE FUNCTION public.normalize_preliminary_survey_v2_public_sample_codes_after_group_change();

REVOKE ALL ON FUNCTION public.normalize_preliminary_survey_v2_public_sample_codes_after_group_change()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_preliminary_survey_v2_target_lifecycle()
  FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';

-- Rollback (별도 승인): 위 trigger를 DROP하고 140000 lifecycle function을 복원한다.
