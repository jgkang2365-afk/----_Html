-- 관리자 예비조사 정비 RPC 감사기록 old값 버그 수정
--
-- 배경: 20260817_add_preliminary_survey_exception_log.sql 의 RPC에서
--   UPDATE preliminary_survey_v2_plans ... RETURNING * INTO plan_row
-- 가 plan_row를 새 값으로 덮어써서, 감사기록의 old_participant_user_ids/names가
-- 실제 변경 전 값이 아니라 변경 후 값으로 기록되던 문제가 있었다.
-- (old_link_measurer_id는 target_row 스냅샷을 사용해 정상이었다.)
--
-- 수정: UPDATE 이전의 plan 값을 old_plan 변수에 보존하고 감사기록에는 old_plan을 사용한다.
-- 기존 감사기록 행은 수정하지 않는다. (운영 반영 시 이미 잘못 기록된 행은 별도 보정 필요)

CREATE OR REPLACE FUNCTION public.admin_repair_preliminary_survey_connection(
  p_target_id bigint,
  p_participant_user_ids jsonb,
  p_participant_names jsonb,
  p_link_measurer_id integer,
  p_reason text,
  p_changed_by text
) RETURNS public.preliminary_survey_v2_plans
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target_row public.measurement_target_business;
  plan_row public.preliminary_survey_v2_plans;
  old_plan public.preliminary_survey_v2_plans;
  link_name text;
  staff_names text[] := ARRAY[]::text[];
  staff_extra text[] := ARRAY[]::text[];
  journal_confirmed boolean;
  v_idx integer;
  v_id integer;
  v_name text;
BEGIN
  -- 1. 변경 사유 필수
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'REASON_REQUIRED';
  END IF;

  -- 2. 예비조사자 목록 구조 검증
  IF p_participant_user_ids IS NULL OR jsonb_typeof(p_participant_user_ids) <> 'array'
     OR p_participant_names IS NULL OR jsonb_typeof(p_participant_names) <> 'array'
     OR jsonb_array_length(p_participant_user_ids) = 0
     OR jsonb_array_length(p_participant_user_ids) <> jsonb_array_length(p_participant_names) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PARTICIPANTS';
  END IF;

  -- 3. 대상 사업장 존재 + 행 잠금
  SELECT * INTO target_row FROM public.measurement_target_business WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'TARGET_NOT_FOUND'; END IF;

  -- 4. V2 예비조사 계획 존재 + 행 잠금, 변경 전 값 보존
  SELECT * INTO plan_row FROM public.preliminary_survey_v2_plans
    WHERE measurement_target_business_id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'V2_PLAN_NOT_FOUND'; END IF;
  old_plan := plan_row;

  -- 5. 확정 상태(sequence_number 부여) 확인
  SELECT EXISTS (
    SELECT 1 FROM public.measurement_journal AS journal
    WHERE journal.code = target_row.code
      AND journal.measurement_year = target_row.year
      AND btrim(journal.measurement_period) = btrim(target_row.period)
      AND journal.sequence_number IS NOT NULL
  ) INTO journal_confirmed;
  IF NOT journal_confirmed THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'SEQUENCE_NUMBER_NOT_CONFIRMED';
  END IF;

  -- 6. 예비조사자 id/name 쌍 검증
  v_idx := 0;
  FOR v_idx IN 0 .. jsonb_array_length(p_participant_user_ids) - 1 LOOP
    v_id := (p_participant_user_ids->>v_idx)::integer;
    v_name := p_participant_names->>v_idx;
    IF NOT EXISTS (
      SELECT 1 FROM public.users AS u
      WHERE u.id = v_id AND u.name = v_name
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PARTICIPANT_MISMATCH_AT_' || (v_idx + 1)::text;
    END IF;
  END LOOP;
  IF (SELECT COUNT(*) FROM (SELECT DISTINCT value::text AS v FROM jsonb_array_elements(p_participant_user_ids)) s)
     <> jsonb_array_length(p_participant_user_ids) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PARTICIPANT_DUPLICATE';
  END IF;

  -- 7. 실제 측정 인원 합집합
  SELECT COALESCE(array_agg(btrim(t)), ARRAY[]::text[]) INTO staff_names
  FROM unnest(string_to_array(COALESCE(target_row.collaborators, ''), ',')) AS t
  WHERE btrim(t) <> '';

  IF target_row.daily_staff IS NOT NULL AND jsonb_typeof(target_row.daily_staff) = 'array' THEN
    SELECT COALESCE(array_agg(DISTINCT btrim(collab)), ARRAY[]::text[]) INTO staff_extra
    FROM jsonb_array_elements(target_row.daily_staff) AS day(entry)
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(entry->'collaborators') = 'array' THEN entry->'collaborators'
        ELSE to_jsonb(string_to_array(COALESCE(entry->>'collaborators', ''), ','))
      END
    ) AS t(collab)
    WHERE btrim(collab) <> '';
    staff_names := staff_names || staff_extra;
  END IF;

  -- 8. 예·측(link_measurer_id) 검증
  IF p_link_measurer_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'LINK_MEASURER_REQUIRED';
  END IF;
  SELECT name INTO link_name FROM public.users WHERE id = p_link_measurer_id;
  IF link_name IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'LINK_MEASURER_NOT_FOUND';
  END IF;
  IF NOT p_participant_user_ids @> jsonb_build_array(p_link_measurer_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'LINK_MEASURER_NOT_IN_PARTICIPANTS';
  END IF;
  IF NOT (link_name = ANY(staff_names)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'LINK_MEASURER_NOT_IN_STAFF';
  END IF;

  -- 9. V2 예비조사자 정정
  UPDATE public.preliminary_survey_v2_plans
  SET participant_user_ids = p_participant_user_ids,
      participant_names = p_participant_names,
      responsible_user_id = p_link_measurer_id,
      plan_origin = 'manual',
      updated_at = CURRENT_TIMESTAMP
  WHERE id = plan_row.id
  RETURNING * INTO plan_row;

  -- 10. 예·측 지정
  UPDATE public.measurement_target_business
  SET link_measurer_id = p_link_measurer_id,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = p_target_id;

  -- 11. 감사기록 (변경 전 값은 old_plan 스냅샷 사용)
  INSERT INTO public.preliminary_survey_exception_log (
    measurement_target_business_id, code,
    old_participant_user_ids, new_participant_user_ids,
    old_participant_names, new_participant_names,
    old_link_measurer_id, new_link_measurer_id,
    changed_by, reason
  ) VALUES (
    p_target_id, target_row.code,
    COALESCE(old_plan.participant_user_ids, '[]'::jsonb), p_participant_user_ids,
    COALESCE(old_plan.participant_names, '[]'::jsonb), p_participant_names,
    target_row.link_measurer_id, p_link_measurer_id,
    COALESCE(p_changed_by, 'admin'), btrim(p_reason)
  );

  RETURN plan_row;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_repair_preliminary_survey_connection(
  bigint, jsonb, jsonb, integer, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_repair_preliminary_survey_connection(
  bigint, jsonb, jsonb, integer, text, text
) TO service_role;

NOTIFY pgrst, 'reload schema';
