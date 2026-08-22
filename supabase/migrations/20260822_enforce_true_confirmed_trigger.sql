-- 모든 일반 write 경로(group/legacy API 포함)에 measurement_journal 찐확정 lock을 적용한다.
-- 관리자 repair RPC만 transaction-local flag로 예외를 허용한다.

CREATE OR REPLACE FUNCTION public.guard_true_confirmed_preliminary_survey_v2_plan()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_setting('app.preliminary_survey_admin_repair', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.measurement_target_business target
    JOIN public.measurement_journal journal
      ON journal.code = target.code
     AND journal.measurement_year = target.year
     AND btrim(replace(journal.measurement_period, '(수시)', '')) = btrim(replace(target.period, '(수시)', ''))
    WHERE target.id = NEW.measurement_target_business_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TRUE_CONFIRMED_LOCKED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_true_confirmed_preliminary_survey_v2_plan
  ON public.preliminary_survey_v2_plans;
CREATE TRIGGER trg_guard_true_confirmed_preliminary_survey_v2_plan
BEFORE INSERT OR UPDATE ON public.preliminary_survey_v2_plans
FOR EACH ROW EXECUTE FUNCTION public.guard_true_confirmed_preliminary_survey_v2_plan();

ALTER FUNCTION public.admin_repair_preliminary_survey_connection(
  bigint, jsonb, jsonb, integer, text, text
) RENAME TO admin_repair_preliminary_survey_connection_unlocked;

CREATE FUNCTION public.admin_repair_preliminary_survey_connection(
  p_target_id bigint,
  p_participant_user_ids jsonb,
  p_participant_names jsonb,
  p_link_measurer_id integer,
  p_reason text,
  p_changed_by text
) RETURNS public.preliminary_survey_v2_plans
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  repaired public.preliminary_survey_v2_plans;
BEGIN
  PERFORM set_config('app.preliminary_survey_admin_repair', 'on', true);
  SELECT * INTO repaired FROM public.admin_repair_preliminary_survey_connection_unlocked(
    p_target_id, p_participant_user_ids, p_participant_names,
    p_link_measurer_id, p_reason, p_changed_by
  );
  RETURN repaired;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_repair_preliminary_survey_connection_unlocked(
  bigint, jsonb, jsonb, integer, text, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_repair_preliminary_survey_connection(
  bigint, jsonb, jsonb, integer, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_repair_preliminary_survey_connection(
  bigint, jsonb, jsonb, integer, text, text
) TO service_role;

NOTIFY pgrst, 'reload schema';
