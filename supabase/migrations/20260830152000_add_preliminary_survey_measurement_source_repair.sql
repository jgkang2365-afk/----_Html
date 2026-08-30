-- H0038/H0098 같은 날짜별 참여자·보고서 담당자 원천의 최소 관리자 repair와 audit.
CREATE TABLE IF NOT EXISTS public.preliminary_survey_v2_measurement_source_repair_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_target_business_id bigint NOT NULL REFERENCES public.measurement_target_business(id) ON DELETE RESTRICT,
  measurement_date date NOT NULL,
  before_source jsonb NOT NULL,
  after_source jsonb NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  changed_by_user_id integer NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE public.preliminary_survey_v2_measurement_source_repair_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.preliminary_survey_v2_measurement_source_repair_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.preliminary_survey_v2_measurement_source_repair_audit TO service_role;

CREATE OR REPLACE FUNCTION public.repair_preliminary_survey_measurement_source(
  p_target_id bigint, p_expected_measurement_date date, p_expected_daily_staff jsonb,
  p_expected_collaborators text, p_expected_measurer_id integer, p_measurement_date date,
  p_participant_names text[], p_report_writer_user_id integer, p_reason text, p_changed_by_user_id integer
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target_row public.measurement_target_business%ROWTYPE; next_daily_staff jsonb; before_source jsonb; after_source jsonb;
BEGIN
  IF btrim(COALESCE(p_reason, '')) = '' OR p_measurement_date IS NULL THEN RAISE EXCEPTION 'INVALID_MEASUREMENT_SOURCE_REPAIR'; END IF;
  SELECT * INTO target_row FROM public.measurement_target_business WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TARGET_NOT_FOUND'; END IF;
  IF target_row.measurement_date::date IS DISTINCT FROM p_expected_measurement_date
     OR target_row.daily_staff IS DISTINCT FROM p_expected_daily_staff
     OR target_row.collaborators IS DISTINCT FROM p_expected_collaborators
     OR target_row.measurer_id IS DISTINCT FROM p_expected_measurer_id THEN RAISE EXCEPTION 'REPAIR_SOURCE_CHANGED'; END IF;
  IF (SELECT count(*) FROM unnest(COALESCE(p_participant_names, ARRAY[]::text[])) name
        JOIN public.users u ON u.name = name AND u.job = '측정' AND u.is_active IS TRUE)
     <> cardinality(COALESCE(p_participant_names, ARRAY[]::text[])) THEN RAISE EXCEPTION 'PARTICIPANT_MISMATCH'; END IF;
  IF p_report_writer_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_report_writer_user_id AND u.job = '측정' AND u.is_active IS TRUE) THEN RAISE EXCEPTION 'REPORT_WRITER_MISMATCH'; END IF;
  before_source := jsonb_build_object('measurement_date', target_row.measurement_date, 'daily_staff', target_row.daily_staff, 'collaborators', target_row.collaborators, 'measurer_id', target_row.measurer_id);
  IF jsonb_typeof(target_row.daily_staff) = 'array' THEN
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(target_row.daily_staff) day WHERE (day->>'date')::date = p_measurement_date) THEN RAISE EXCEPTION 'MEASUREMENT_DATE_NOT_FOUND'; END IF;
    SELECT jsonb_agg(CASE WHEN (day->>'date')::date = p_measurement_date THEN
      day || jsonb_build_object('collaborators', to_jsonb(COALESCE(p_participant_names, ARRAY[]::text[]))) ||
      CASE WHEN p_report_writer_user_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('measurer_id', p_report_writer_user_id) END
      ELSE day END ORDER BY ordinality) INTO next_daily_staff
    FROM jsonb_array_elements(target_row.daily_staff) WITH ORDINALITY rows(day, ordinality);
    UPDATE public.measurement_target_business SET daily_staff = next_daily_staff WHERE id = target_row.id;
  ELSIF target_row.measurement_date::date = p_measurement_date THEN
    UPDATE public.measurement_target_business SET collaborators = array_to_string(COALESCE(p_participant_names, ARRAY[]::text[]), ', '),
      measurer_id = COALESCE(p_report_writer_user_id, measurer_id) WHERE id = target_row.id;
  ELSE RAISE EXCEPTION 'MEASUREMENT_DATE_NOT_FOUND'; END IF;
  SELECT jsonb_build_object('measurement_date', measurement_date, 'daily_staff', daily_staff, 'collaborators', collaborators, 'measurer_id', measurer_id)
    INTO after_source FROM public.measurement_target_business WHERE id = target_row.id;
  INSERT INTO public.preliminary_survey_v2_measurement_source_repair_audit(measurement_target_business_id, measurement_date, before_source, after_source, reason, changed_by_user_id)
    VALUES (target_row.id, p_measurement_date, before_source, after_source, btrim(p_reason), p_changed_by_user_id);
END; $$;
REVOKE ALL ON FUNCTION public.repair_preliminary_survey_measurement_source(bigint,date,jsonb,text,integer,date,text[],integer,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_preliminary_survey_measurement_source(bigint,date,jsonb,text,integer,date,text[],integer,text,integer) TO service_role;
NOTIFY pgrst, 'reload schema';

-- Rollback (별도 승인 후): REVOKE EXECUTE, DROP FUNCTION, DROP audit table. 대상·일지·plan row는 삭제하지 않는다.
