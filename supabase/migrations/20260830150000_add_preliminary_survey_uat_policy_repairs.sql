-- UAT 정책 repair: 찐확정 측정일지는 보존하고, 명시적으로 승인된 예비조사일만 최소 변경한다.
CREATE TABLE IF NOT EXISTS public.preliminary_survey_v2_policy_repair_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_target_business_id bigint NOT NULL REFERENCES public.measurement_target_business(id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL REFERENCES public.preliminary_survey_v2_plans(id) ON DELETE RESTRICT,
  repaired_fields jsonb NOT NULL CHECK (repaired_fields = '["recommended_date"]'::jsonb),
  before_plan jsonb NOT NULL,
  after_plan jsonb NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  provenance text NOT NULL CHECK (provenance = 'true_confirmed_policy_date_repair'),
  changed_by_user_id integer NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.preliminary_survey_v2_policy_repair_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.preliminary_survey_v2_policy_repair_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.preliminary_survey_v2_policy_repair_audit TO service_role;

CREATE OR REPLACE FUNCTION public.repair_true_confirmed_preliminary_v2_policy_date(
  p_target_id bigint,
  p_expected_plan_id uuid,
  p_expected_source_measurement_date date,
  p_expected_recommended_date date,
  p_recommended_date date,
  p_reason text,
  p_changed_by_user_id integer
) RETURNS public.preliminary_survey_v2_plans
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target_row public.measurement_target_business%ROWTYPE;
  plan_row public.preliminary_survey_v2_plans%ROWTYPE;
  repaired_plan public.preliminary_survey_v2_plans%ROWTYPE;
BEGIN
  IF btrim(COALESCE(p_reason, '')) = '' THEN RAISE EXCEPTION 'REPAIR_REASON_REQUIRED'; END IF;
  SELECT * INTO target_row FROM public.measurement_target_business WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TARGET_NOT_FOUND'; END IF;
  IF NOT public.is_preliminary_survey_v2_true_confirmed(target_row.id) THEN RAISE EXCEPTION 'TRUE_CONFIRMED_REQUIRED'; END IF;
  IF target_row.measurement_date::date IS DISTINCT FROM p_expected_source_measurement_date THEN
    RAISE EXCEPTION 'REPAIR_SOURCE_CHANGED';
  END IF;
  SELECT * INTO plan_row FROM public.preliminary_survey_v2_plans
    WHERE measurement_target_business_id = target_row.id FOR UPDATE;
  IF NOT FOUND OR plan_row.id IS DISTINCT FROM p_expected_plan_id
     OR plan_row.recommended_date IS DISTINCT FROM p_expected_recommended_date THEN
    RAISE EXCEPTION 'REPAIR_SOURCE_CHANGED';
  END IF;
  IF p_recommended_date IS NULL OR p_recommended_date >= target_row.measurement_date::date THEN
    RAISE EXCEPTION 'INVALID_RECOMMENDED_DATE';
  END IF;

  -- 후보일 정책(한국 공휴일 포함)은 서버 route가 authoritative planner와 동일하게 검증한다.
  -- DB는 stale source·찐확정·최소 field 변경·감사로그를 transaction으로 보장한다.
  PERFORM set_config('app.preliminary_survey_admin_repair', 'on', true);
  UPDATE public.preliminary_survey_v2_plans SET recommended_date = p_recommended_date
    WHERE id = plan_row.id RETURNING * INTO repaired_plan;
  INSERT INTO public.preliminary_survey_v2_policy_repair_audit(
    measurement_target_business_id, plan_id, repaired_fields, before_plan, after_plan,
    reason, provenance, changed_by_user_id
  ) VALUES (
    target_row.id, plan_row.id, '["recommended_date"]'::jsonb, to_jsonb(plan_row), to_jsonb(repaired_plan),
    btrim(p_reason), 'true_confirmed_policy_date_repair', p_changed_by_user_id
  );
  RETURN repaired_plan;
END;
$$;

REVOKE ALL ON FUNCTION public.repair_true_confirmed_preliminary_v2_policy_date(bigint, uuid, date, date, date, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_true_confirmed_preliminary_v2_policy_date(bigint, uuid, date, date, date, text, integer)
  TO service_role;

NOTIFY pgrst, 'reload schema';

-- Rollback (별도 승인 후):
-- REVOKE EXECUTE ON FUNCTION public.repair_true_confirmed_preliminary_v2_policy_date(bigint, uuid, date, date, date, text, integer) FROM service_role;
-- DROP FUNCTION IF EXISTS public.repair_true_confirmed_preliminary_v2_policy_date(bigint, uuid, date, date, date, text, integer);
-- DROP TABLE IF EXISTS public.preliminary_survey_v2_policy_repair_audit;
