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
  p_target_id bigint, p_expected_measurement_date text, p_expected_daily_staff jsonb,
  p_expected_collaborators text, p_expected_measurer_id integer, p_measurement_date date,
  p_repair_participants boolean, p_participant_names text[], p_repair_report_writer boolean,
  p_report_writer_user_id integer, p_reason text, p_changed_by_user_id integer
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target_row public.measurement_target_business%ROWTYPE;
  next_daily_staff jsonb;
  before_source jsonb;
  after_source jsonb;
  before_plan_assignment jsonb;
  after_plan_assignment jsonb;
BEGIN
  IF btrim(COALESCE(p_reason, '')) = '' OR p_measurement_date IS NULL
     OR (p_repair_participants IS NOT TRUE AND p_repair_report_writer IS NOT TRUE) THEN
    RAISE EXCEPTION 'INVALID_MEASUREMENT_SOURCE_REPAIR';
  END IF;
  SELECT * INTO target_row FROM public.measurement_target_business WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TARGET_NOT_FOUND'; END IF;
  IF target_row.measurement_date IS DISTINCT FROM p_expected_measurement_date
     OR target_row.daily_staff IS DISTINCT FROM p_expected_daily_staff
     OR target_row.collaborators IS DISTINCT FROM p_expected_collaborators
     OR target_row.measurer_id IS DISTINCT FROM p_expected_measurer_id THEN RAISE EXCEPTION 'REPAIR_SOURCE_CHANGED'; END IF;
  IF p_repair_participants IS TRUE AND (SELECT count(*) FROM unnest(COALESCE(p_participant_names, ARRAY[]::text[])) name
        JOIN public.users u ON u.name = name AND u.job = '측정' AND u.is_active IS TRUE)
     <> cardinality(COALESCE(p_participant_names, ARRAY[]::text[])) THEN RAISE EXCEPTION 'PARTICIPANT_MISMATCH'; END IF;
  IF p_repair_report_writer IS TRUE AND (p_report_writer_user_id IS NULL OR NOT EXISTS
    (SELECT 1 FROM public.users u WHERE u.id = p_report_writer_user_id AND u.job = '측정' AND u.is_active IS TRUE)) THEN
    RAISE EXCEPTION 'REPORT_WRITER_MISMATCH';
  END IF;
  before_source := jsonb_build_object('measurement_date', target_row.measurement_date, 'daily_staff', target_row.daily_staff, 'collaborators', target_row.collaborators, 'measurer_id', target_row.measurer_id);
  -- Repair가 lifecycle bypass 경로를 쓰더라도 해당 target의 V2 plan/assignment는 정확히 그대로여야 한다.
  -- ID/count/digest를 모두 저장해 trigger 정의가 바뀌어도 삭제·재생성·재배정을 transaction에서 차단한다.
  SELECT jsonb_build_object(
    'plan_ids', COALESCE((SELECT jsonb_agg(plan.id ORDER BY plan.id)
      FROM public.preliminary_survey_v2_plans plan WHERE plan.measurement_target_business_id = target_row.id), '[]'::jsonb),
    'plan_digest', COALESCE((SELECT md5(string_agg(to_jsonb(plan)::text, ',' ORDER BY plan.id))
      FROM public.preliminary_survey_v2_plans plan WHERE plan.measurement_target_business_id = target_row.id), md5('')),
    'assignment_ids', COALESCE((SELECT jsonb_agg(assignment.id ORDER BY assignment.id)
      FROM public.preliminary_survey_v2_measurement_assignments assignment
      JOIN public.preliminary_survey_v2_plans plan ON plan.id = assignment.plan_id
      WHERE plan.measurement_target_business_id = target_row.id), '[]'::jsonb),
    'assignment_count', (SELECT count(*) FROM public.preliminary_survey_v2_measurement_assignments assignment
      JOIN public.preliminary_survey_v2_plans plan ON plan.id = assignment.plan_id
      WHERE plan.measurement_target_business_id = target_row.id),
    'assignment_digest', COALESCE((SELECT md5(string_agg(to_jsonb(assignment)::text, ',' ORDER BY assignment.id))
      FROM public.preliminary_survey_v2_measurement_assignments assignment
      JOIN public.preliminary_survey_v2_plans plan ON plan.id = assignment.plan_id
      WHERE plan.measurement_target_business_id = target_row.id), md5(''))
  ) INTO before_plan_assignment;
  -- 140000 lifecycle invalidation은 일반 측정계획 변경에만 적용한다. 이 관리자 repair는
  -- 현재 plan/assignment를 보존하는 원천 역할 최소 보정이므로 transaction-local bypass를 남긴다.
  PERFORM set_config('app.preliminary_survey_measurement_source_repair', 'on', true);
  IF jsonb_typeof(target_row.daily_staff) = 'array' THEN
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(target_row.daily_staff) day WHERE (day->>'date')::date = p_measurement_date) THEN RAISE EXCEPTION 'MEASUREMENT_DATE_NOT_FOUND'; END IF;
    SELECT jsonb_agg(CASE WHEN (day->>'date')::date = p_measurement_date THEN
      day || CASE WHEN p_repair_participants IS TRUE
        THEN jsonb_build_object('collaborators', to_jsonb(COALESCE(p_participant_names, ARRAY[]::text[]))) ELSE '{}'::jsonb END ||
      CASE WHEN p_repair_report_writer IS TRUE THEN jsonb_build_object('measurer_id', p_report_writer_user_id) ELSE '{}'::jsonb END
      ELSE day END ORDER BY ordinality) INTO next_daily_staff
    FROM jsonb_array_elements(target_row.daily_staff) WITH ORDINALITY rows(day, ordinality);
    UPDATE public.measurement_target_business SET daily_staff = next_daily_staff WHERE id = target_row.id;
  ELSIF target_row.measurement_date = p_measurement_date::text THEN
    UPDATE public.measurement_target_business SET
      collaborators = CASE WHEN p_repair_participants IS TRUE THEN array_to_string(COALESCE(p_participant_names, ARRAY[]::text[]), ', ') ELSE collaborators END,
      measurer_id = CASE WHEN p_repair_report_writer IS TRUE THEN p_report_writer_user_id ELSE measurer_id END
      WHERE id = target_row.id;
  ELSE RAISE EXCEPTION 'MEASUREMENT_DATE_NOT_FOUND'; END IF;
  SELECT jsonb_build_object('measurement_date', measurement_date, 'daily_staff', daily_staff, 'collaborators', collaborators, 'measurer_id', measurer_id)
    INTO after_source FROM public.measurement_target_business WHERE id = target_row.id;
  SELECT jsonb_build_object(
    'plan_ids', COALESCE((SELECT jsonb_agg(plan.id ORDER BY plan.id)
      FROM public.preliminary_survey_v2_plans plan WHERE plan.measurement_target_business_id = target_row.id), '[]'::jsonb),
    'plan_digest', COALESCE((SELECT md5(string_agg(to_jsonb(plan)::text, ',' ORDER BY plan.id))
      FROM public.preliminary_survey_v2_plans plan WHERE plan.measurement_target_business_id = target_row.id), md5('')),
    'assignment_ids', COALESCE((SELECT jsonb_agg(assignment.id ORDER BY assignment.id)
      FROM public.preliminary_survey_v2_measurement_assignments assignment
      JOIN public.preliminary_survey_v2_plans plan ON plan.id = assignment.plan_id
      WHERE plan.measurement_target_business_id = target_row.id), '[]'::jsonb),
    'assignment_count', (SELECT count(*) FROM public.preliminary_survey_v2_measurement_assignments assignment
      JOIN public.preliminary_survey_v2_plans plan ON plan.id = assignment.plan_id
      WHERE plan.measurement_target_business_id = target_row.id),
    'assignment_digest', COALESCE((SELECT md5(string_agg(to_jsonb(assignment)::text, ',' ORDER BY assignment.id))
      FROM public.preliminary_survey_v2_measurement_assignments assignment
      JOIN public.preliminary_survey_v2_plans plan ON plan.id = assignment.plan_id
      WHERE plan.measurement_target_business_id = target_row.id), md5(''))
  ) INTO after_plan_assignment;
  IF after_plan_assignment IS DISTINCT FROM before_plan_assignment THEN
    RAISE EXCEPTION 'MEASUREMENT_SOURCE_REPAIR_PLAN_ASSIGNMENT_CHANGED';
  END IF;
  INSERT INTO public.preliminary_survey_v2_measurement_source_repair_audit(measurement_target_business_id, measurement_date, before_source, after_source, reason, changed_by_user_id)
    VALUES (target_row.id, p_measurement_date, before_source, after_source, btrim(p_reason), p_changed_by_user_id);
END; $$;
REVOKE ALL ON FUNCTION public.repair_preliminary_survey_measurement_source(bigint,text,jsonb,text,integer,date,boolean,text[],boolean,integer,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_preliminary_survey_measurement_source(bigint,text,jsonb,text,integer,date,boolean,text[],boolean,integer,text,integer) TO service_role;
NOTIFY pgrst, 'reload schema';

-- Rollback (별도 승인 후): REVOKE EXECUTE, DROP FUNCTION, DROP audit table. 대상·일지·plan row는 삭제하지 않는다.
