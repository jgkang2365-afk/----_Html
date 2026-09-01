-- Planner audit는 Apply/override RPC로만 추가되는 append-only 이력이다.
CREATE OR REPLACE FUNCTION public.reject_preliminary_survey_v2_planner_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PLANNER_AUDIT_APPEND_ONLY';
END;
$$;

DROP TRIGGER IF EXISTS trg_preliminary_survey_v2_planner_audit_append_only
  ON public.preliminary_survey_v2_planner_audit;
CREATE TRIGGER trg_preliminary_survey_v2_planner_audit_append_only
BEFORE UPDATE OR DELETE ON public.preliminary_survey_v2_planner_audit
FOR EACH ROW EXECUTE FUNCTION public.reject_preliminary_survey_v2_planner_audit_mutation();

REVOKE ALL ON FUNCTION public.reject_preliminary_survey_v2_planner_audit_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
