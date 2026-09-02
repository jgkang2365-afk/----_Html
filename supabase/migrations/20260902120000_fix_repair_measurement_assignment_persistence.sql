-- Repair가 plan만 남기지 않고 실제 측정일별 공시료 assignment까지 원자적으로 보장한다.
-- 기존 migration은 수정하지 않고, legacy 함수는 내부 이름으로 보존한다.

ALTER FUNCTION public.repair_true_confirmed_preliminary_survey_v2_missing_info(
  bigint, uuid, date, integer, date, integer, integer, jsonb, jsonb, text, text, boolean, boolean, integer
) RENAME TO repair_true_confirmed_preliminary_survey_v2_missing_info_legacy_v1;

CREATE OR REPLACE FUNCTION public.ensure_repair_measurement_assignments(
  p_target_id bigint,
  p_plan_id uuid,
  p_expected_assignments jsonb DEFAULT '[]'::jsonb
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target_row public.measurement_target_business%ROWTYPE;
  measurement_day jsonb;
  measurement_date date;
  expected_assignee integer;
  existing_assignee integer;
  preview_assignee integer;
  assignment_count integer := 0;
  base_code text;
BEGIN
  SELECT * INTO target_row
  FROM public.measurement_target_business
  WHERE id = p_target_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TARGET_NOT_FOUND'; END IF;
  IF p_plan_id IS NULL THEN RAISE EXCEPTION 'REPAIR_PLAN_REQUIRED'; END IF;

  FOR measurement_day IN
    SELECT value
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(target_row.daily_staff) = 'array'
        AND jsonb_array_length(target_row.daily_staff) > 0
        THEN target_row.daily_staff
        ELSE jsonb_build_array(jsonb_build_object('date', target_row.measurement_date::text))
      END
    )
  LOOP
    measurement_date := NULLIF(measurement_day->>'date', '')::date;
    IF measurement_date IS NULL THEN RAISE EXCEPTION 'REPAIR_MEASUREMENT_DATE_REQUIRED'; END IF;

    SELECT fixed.assignee_user_id INTO expected_assignee
    FROM public.preliminary_survey_v2_fixed_assignments fixed
    WHERE fixed.measurement_target_business_id = p_target_id
      AND fixed.measurement_date = measurement_date
    ORDER BY fixed.updated_at DESC, fixed.id DESC
    LIMIT 1;

    SELECT assignment.assignee_user_id INTO existing_assignee
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    JOIN public.preliminary_survey_v2_plans existing_plan ON existing_plan.id = assignment.plan_id
    WHERE existing_plan.measurement_target_business_id = p_target_id
      AND assignment.measurement_date = measurement_date
    ORDER BY assignment.updated_at DESC, assignment.id DESC
    LIMIT 1;

    SELECT (item->>'assigneeUserId')::integer INTO preview_assignee
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_expected_assignments) = 'array'
      THEN p_expected_assignments ELSE '[]'::jsonb END) item
    WHERE (item->>'targetId')::bigint = p_target_id
      AND (item->>'measurementDate')::date = measurement_date
    ORDER BY item->>'assigneeUserId'
    LIMIT 1;

    IF expected_assignee IS NOT NULL AND preview_assignee IS NOT NULL
       AND expected_assignee IS DISTINCT FROM preview_assignee THEN
      RAISE EXCEPTION 'REPAIR_MEASUREMENT_ASSIGNMENT_CONFLICT';
    END IF;
    IF existing_assignee IS NOT NULL AND preview_assignee IS NOT NULL
       AND existing_assignee IS DISTINCT FROM preview_assignee THEN
      RAISE EXCEPTION 'REPAIR_SOURCE_CHANGED';
    END IF;

    IF expected_assignee IS NULL THEN expected_assignee := existing_assignee; END IF;
    IF expected_assignee IS NULL THEN expected_assignee := preview_assignee; END IF;
    IF expected_assignee IS NULL THEN
      RAISE EXCEPTION 'REPAIR_MEASUREMENT_ASSIGNMENT_SOURCE_REQUIRED';
    END IF;
    IF existing_assignee IS NOT NULL
       AND existing_assignee IS DISTINCT FROM expected_assignee THEN
      RAISE EXCEPTION 'REPAIR_MEASUREMENT_ASSIGNMENT_CONFLICT';
    END IF;

    SELECT upper(btrim(u.survey_code)) INTO base_code
    FROM public.users u
    WHERE u.id = expected_assignee AND u.is_active IS NOT FALSE;
    IF base_code NOT IN ('A','B','C','D','F','G') THEN
      RAISE EXCEPTION 'MEASUREMENT_ASSIGNMENT_SURVEY_CODE_REQUIRED';
    END IF;

    INSERT INTO public.preliminary_survey_v2_measurement_assignments (
      plan_id, measurement_date, assignee_user_id, survey_code,
      public_sample_code, assignment_reason
    ) VALUES (
      p_plan_id, measurement_date, expected_assignee, base_code,
      NULL, 'confirmed-document-repair'
    ) ON CONFLICT (plan_id, measurement_date) DO NOTHING;
    assignment_count := assignment_count + 1;
  END LOOP;

  -- 동일 날짜·담당자 그룹은 기존 deterministic 정규화 규칙을 재사용한다.
  WITH affected AS (
    SELECT DISTINCT measurement_date, assignee_user_id
    FROM public.preliminary_survey_v2_measurement_assignments
    WHERE plan_id = p_plan_id
  ), ranked AS (
    SELECT assignment.id,
      upper(btrim(base_user.survey_code)) AS base_code,
      row_number() OVER (
        PARTITION BY assignment.measurement_date, assignment.assignee_user_id
        ORDER BY target.code, target.id
      ) AS position
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    JOIN public.preliminary_survey_v2_plans plan ON plan.id = assignment.plan_id
    JOIN public.measurement_target_business target ON target.id = plan.measurement_target_business_id
    JOIN public.users base_user ON base_user.id = assignment.assignee_user_id
    JOIN affected ON affected.measurement_date = assignment.measurement_date
      AND affected.assignee_user_id = assignment.assignee_user_id
  )
  UPDATE public.preliminary_survey_v2_measurement_assignments assignment
  SET survey_code = ranked.base_code,
      public_sample_code = repeat(ranked.base_code, ranked.position::integer),
      updated_at = CURRENT_TIMESTAMP
  FROM ranked
  WHERE assignment.id = ranked.id;

  RETURN assignment_count;
END;
$$;

-- 내부 wrapper에서만 호출되는 SECURITY DEFINER helper는 외부 실행을 허용하지 않는다.
REVOKE ALL ON FUNCTION public.ensure_repair_measurement_assignments(bigint, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.repair_true_confirmed_preliminary_survey_v2_missing_info(
  p_target_id bigint,
  p_expected_plan_id uuid,
  p_expected_measurement_date date,
  p_expected_source_measurer_id integer,
  p_recommended_date date,
  p_responsible_user_id integer,
  p_experienced_reviewer_id integer,
  p_participant_user_ids jsonb,
  p_participant_names jsonb,
  p_survey_method text,
  p_source_rule_type text,
  p_fill_date boolean,
  p_fill_surveyors boolean,
  p_changed_by_user_id integer
) RETURNS public.preliminary_survey_v2_plans
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE repaired public.preliminary_survey_v2_plans%ROWTYPE;
BEGIN
  repaired := public.repair_true_confirmed_preliminary_survey_v2_missing_info_legacy_v1(
    p_target_id, p_expected_plan_id, p_expected_measurement_date,
    p_expected_source_measurer_id, p_recommended_date, p_responsible_user_id,
    p_experienced_reviewer_id, p_participant_user_ids, p_participant_names,
    p_survey_method, p_source_rule_type, p_fill_date, p_fill_surveyors,
    p_changed_by_user_id
  );
  PERFORM public.ensure_repair_measurement_assignments(p_target_id, repaired.id, '[]'::jsonb);
  UPDATE public.preliminary_survey_v2_document_repair_audit audit
  SET filled_fields = CASE
    WHEN audit.filled_fields @> '["measurement_assignments"]'::jsonb
      THEN audit.filled_fields
    ELSE audit.filled_fields || '["measurement_assignments"]'::jsonb
  END
  WHERE audit.plan_id = repaired.id
    AND audit.measurement_target_business_id = p_target_id
    AND audit.provenance = 'true_confirmed_missing_documentary_info_repair'
    AND audit.created_at = (
      SELECT max(recent.created_at)
      FROM public.preliminary_survey_v2_document_repair_audit recent
      WHERE recent.plan_id = repaired.id
        AND recent.measurement_target_business_id = p_target_id
    );
  RETURN repaired;
END;
$$;

-- same-run automatic snapshot을 전달하는 확장 signature. 기존 14-인자 호출도 유지한다.
CREATE OR REPLACE FUNCTION public.repair_true_confirmed_preliminary_survey_v2_missing_info(
  p_target_id bigint,
  p_expected_plan_id uuid,
  p_expected_measurement_date date,
  p_expected_source_measurer_id integer,
  p_recommended_date date,
  p_responsible_user_id integer,
  p_experienced_reviewer_id integer,
  p_participant_user_ids jsonb,
  p_participant_names jsonb,
  p_survey_method text,
  p_source_rule_type text,
  p_fill_date boolean,
  p_fill_surveyors boolean,
  p_changed_by_user_id integer,
  p_expected_assignments jsonb
) RETURNS public.preliminary_survey_v2_plans
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE repaired public.preliminary_survey_v2_plans%ROWTYPE;
BEGIN
  repaired := public.repair_true_confirmed_preliminary_survey_v2_missing_info_legacy_v1(
    p_target_id, p_expected_plan_id, p_expected_measurement_date,
    p_expected_source_measurer_id, p_recommended_date, p_responsible_user_id,
    p_experienced_reviewer_id, p_participant_user_ids, p_participant_names,
    p_survey_method, p_source_rule_type, p_fill_date, p_fill_surveyors,
    p_changed_by_user_id
  );
  PERFORM public.ensure_repair_measurement_assignments(p_target_id, repaired.id, p_expected_assignments);
  UPDATE public.preliminary_survey_v2_document_repair_audit audit
  SET filled_fields = CASE WHEN audit.filled_fields @> '["measurement_assignments"]'::jsonb
    THEN audit.filled_fields ELSE audit.filled_fields || '["measurement_assignments"]'::jsonb END
  WHERE audit.plan_id = repaired.id
    AND audit.measurement_target_business_id = p_target_id
    AND audit.provenance = 'true_confirmed_missing_documentary_info_repair'
    AND audit.created_at = (SELECT max(recent.created_at)
      FROM public.preliminary_survey_v2_document_repair_audit recent
      WHERE recent.plan_id = repaired.id AND recent.measurement_target_business_id = p_target_id);
  RETURN repaired;
END;
$$;

REVOKE ALL ON FUNCTION public.repair_true_confirmed_preliminary_survey_v2_missing_info(
  bigint, uuid, date, integer, date, integer, integer, jsonb, jsonb, text, text, boolean, boolean, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_true_confirmed_preliminary_survey_v2_missing_info(
  bigint, uuid, date, integer, date, integer, integer, jsonb, jsonb, text, text, boolean, boolean, integer
) TO service_role;
REVOKE ALL ON FUNCTION public.repair_true_confirmed_preliminary_survey_v2_missing_info(
  bigint, uuid, date, integer, date, integer, integer, jsonb, jsonb, text, text, boolean, boolean, integer, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_true_confirmed_preliminary_survey_v2_missing_info(
  bigint, uuid, date, integer, date, integer, integer, jsonb, jsonb, text, text, boolean, boolean, integer, jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION public.repair_true_confirmed_preliminary_v2_missing_batch(
  p_repairs jsonb,
  p_changed_by_user_id integer
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE repair_item jsonb; repaired_count integer := 0;
BEGIN
  IF jsonb_typeof(p_repairs) <> 'array' OR jsonb_array_length(p_repairs) = 0 THEN
    RAISE EXCEPTION 'INVALID_REPAIR_BATCH';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_repairs)) IS DISTINCT FROM
     (SELECT count(DISTINCT (value->>'targetId')::bigint) FROM jsonb_array_elements(p_repairs)) THEN
    RAISE EXCEPTION 'DUPLICATE_REPAIR_TARGET';
  END IF;
  FOR repair_item IN SELECT value FROM jsonb_array_elements(p_repairs) ORDER BY (value->>'targetId')::bigint LOOP
    PERFORM public.repair_true_confirmed_preliminary_survey_v2_missing_info(
      (repair_item->>'targetId')::bigint,
      NULLIF(repair_item->>'existingPlanId', '')::uuid,
      (repair_item->>'sourceMeasurementDate')::date,
      NULLIF(repair_item->>'sourceMeasurerId', '')::integer,
      (repair_item->>'recommendedDate')::date,
      (repair_item->>'responsibleUserId')::integer,
      NULLIF(repair_item->>'experiencedReviewerUserId', '')::integer,
      repair_item->'participantUserIds', repair_item->'participantNames',
      repair_item->>'surveyMethod', repair_item->>'sourceRuleType',
      COALESCE((repair_item->>'fillDate')::boolean, false),
      COALESCE((repair_item->>'fillSurveyors')::boolean, false), p_changed_by_user_id,
      COALESCE(repair_item->'measurementAssignments', '[]'::jsonb)
    );
    repaired_count := repaired_count + 1;
  END LOOP;
  RETURN repaired_count;
END;
$$;

REVOKE ALL ON FUNCTION public.repair_true_confirmed_preliminary_v2_missing_batch(jsonb, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_true_confirmed_preliminary_v2_missing_batch(jsonb, integer)
  TO service_role;
NOTIFY pgrst, 'reload schema';
