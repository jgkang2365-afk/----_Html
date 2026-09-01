-- Forward safety fix: 찐확정 누락 공시료 보정도 정상 assignment group과 같은 잠금·건수·코드 규칙을 지킨다.
-- 이 repair는 관리자 CCC 예외 경로가 아니므로 기존 2건 그룹의 3번째와 기존 3건 그룹의 4번째를 모두 차단한다.
CREATE OR REPLACE FUNCTION public.repair_true_confirmed_preliminary_v2_missing_batch(
  p_repairs jsonb,
  p_changed_by_user_id integer
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  item jsonb;
  target_row public.measurement_target_business%ROWTYPE;
  plan_row public.preliminary_survey_v2_plans%ROWTYPE;
  repaired_plan public.preliminary_survey_v2_plans%ROWTYPE;
  reconciliation_row public.preliminary_survey_v2_legacy_reconciliation%ROWTYPE;
  before_snapshot jsonb;
  after_assignments jsonb;
  expected_assignment jsonb;
  incoming_participant_ids jsonb;
  incoming_participant_names jsonb;
  configured_survey_code text;
  existing_assignment_group_count integer;
  assigned_count integer;
  repaired_count integer := 0;
  filled jsonb;
BEGIN
  IF jsonb_typeof(p_repairs) <> 'array' OR jsonb_array_length(p_repairs) = 0 THEN RAISE EXCEPTION 'INVALID_REPAIR_BATCH'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_repairs)) <> (SELECT count(DISTINCT (value->>'targetId')::bigint) FROM jsonb_array_elements(p_repairs)) THEN RAISE EXCEPTION 'DUPLICATE_REPAIR_TARGET'; END IF;

  -- 정상 assignment wrapper와 같은 순서로 날짜 lock을 먼저 잡아 target row lock과의 교착을 피한다.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'preliminary-measurement-assignment|' || lock_date::text, 0))
  FROM (
    SELECT DISTINCT (repair.value->'measurementAssignments'->0->>'measurementDate')::date AS lock_date
    FROM jsonb_array_elements(p_repairs) AS repair(value)
    WHERE COALESCE((repair.value->>'fillMeasurementAssignment')::boolean, false)
    ORDER BY lock_date
  ) repair_dates;

  FOR item IN SELECT value FROM jsonb_array_elements(p_repairs) ORDER BY (value->>'targetId')::bigint LOOP
    SELECT * INTO target_row FROM public.measurement_target_business WHERE id = (item->>'targetId')::bigint FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'TARGET_NOT_FOUND'; END IF;
    IF target_row.measurement_date::date IS DISTINCT FROM (item->>'sourceMeasurementDate')::date OR target_row.measurer_id IS DISTINCT FROM NULLIF(item->>'sourceMeasurerId', '')::integer THEN RAISE EXCEPTION 'REPAIR_SOURCE_CHANGED'; END IF;
    IF NOT public.is_preliminary_survey_v2_true_confirmed(target_row.id) THEN RAISE EXCEPTION 'TRUE_CONFIRMED_REQUIRED'; END IF;

    SELECT * INTO plan_row FROM public.preliminary_survey_v2_plans WHERE measurement_target_business_id = target_row.id FOR UPDATE;
    IF (plan_row.id IS NULL) IS DISTINCT FROM (NULLIF(item->>'existingPlanId', '') IS NULL) THEN RAISE EXCEPTION 'REPAIR_SOURCE_CHANGED'; END IF;
    IF plan_row.id IS NOT NULL AND plan_row.id IS DISTINCT FROM NULLIF(item->>'existingPlanId', '')::uuid THEN RAISE EXCEPTION 'REPAIR_SOURCE_CHANGED'; END IF;
    IF COALESCE((item->>'fillDate')::boolean, false) AND plan_row.recommended_date IS NOT NULL THEN RAISE EXCEPTION 'NON_NULL_OVERWRITE_FORBIDDEN'; END IF;
    IF COALESCE((item->>'fillSurveyors')::boolean, false) AND (
      jsonb_array_length(COALESCE(plan_row.participant_user_ids, '[]'::jsonb)) > 0 OR jsonb_array_length(COALESCE(plan_row.participant_names, '[]'::jsonb)) > 0
      OR plan_row.responsible_user_id IS NOT NULL OR plan_row.experienced_reviewer_id IS NOT NULL
    ) THEN RAISE EXCEPTION 'NON_NULL_OVERWRITE_FORBIDDEN'; END IF;

    incoming_participant_ids := item->'participantUserIds';
    incoming_participant_names := item->'participantNames';
    IF plan_row.id IS NOT NULL AND NOT COALESCE((item->>'fillDate')::boolean, false)
       AND (item->>'recommendedDate')::date IS DISTINCT FROM plan_row.recommended_date THEN RAISE EXCEPTION 'REPAIR_SOURCE_CHANGED'; END IF;
    IF plan_row.id IS NOT NULL AND NOT COALESCE((item->>'fillSurveyors')::boolean, false) AND (
      incoming_participant_ids IS DISTINCT FROM plan_row.participant_user_ids
      OR incoming_participant_names IS DISTINCT FROM plan_row.participant_names
      OR NULLIF(item->>'responsibleUserId', '')::integer IS DISTINCT FROM plan_row.responsible_user_id
      OR NULLIF(item->>'experiencedReviewerUserId', '')::integer IS DISTINCT FROM plan_row.experienced_reviewer_id
    ) THEN RAISE EXCEPTION 'REPAIR_SOURCE_CHANGED'; END IF;

    IF COALESCE((item->>'fillSurveyors')::boolean, false) OR COALESCE((item->>'fillMeasurementAssignment')::boolean, false) THEN
      SELECT * INTO reconciliation_row FROM public.preliminary_survey_v2_legacy_reconciliation
      WHERE measurement_target_business_id = target_row.id AND measurement_date = target_row.measurement_date::date AND rolled_back_at IS NULL
      ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
      IF NOT FOUND OR NULLIF(item->>'reconciliationId', '')::uuid IS DISTINCT FROM reconciliation_row.id THEN RAISE EXCEPTION 'REPAIR_SOURCE_CHANGED'; END IF;
    END IF;
    IF jsonb_typeof(incoming_participant_ids) <> 'array' OR jsonb_array_length(incoming_participant_ids) = 0
       OR (COALESCE((item->>'fillSurveyors')::boolean, false) AND incoming_participant_ids IS DISTINCT FROM reconciliation_row.matched_responsible_user_ids) THEN RAISE EXCEPTION 'REPAIR_EXACT_SURVEYOR_SOURCE_REQUIRED'; END IF;
    IF COALESCE((item->>'fillMeasurementAssignment')::boolean, false) AND (jsonb_typeof(item->'measurementAssignments') <> 'array' OR jsonb_array_length(item->'measurementAssignments') <> 1) THEN RAISE EXCEPTION 'REPAIR_EXACT_PUBLIC_SAMPLE_SOURCE_REQUIRED'; END IF;
    expected_assignment := (item->'measurementAssignments')->0;
    IF COALESCE((item->>'fillMeasurementAssignment')::boolean, false) AND (
      (expected_assignment->>'measurementDate')::date IS DISTINCT FROM target_row.measurement_date::date
      OR (expected_assignment->>'assigneeUserId')::integer IS DISTINCT FROM reconciliation_row.matched_public_sample_user_id
      OR upper(btrim(expected_assignment->>'surveyCode')) IS DISTINCT FROM upper(btrim(reconciliation_row.normalized_current_survey_code))
    ) THEN RAISE EXCEPTION 'REPAIR_EXACT_PUBLIC_SAMPLE_SOURCE_REQUIRED'; END IF;
    IF COALESCE((item->>'fillMeasurementAssignment')::boolean, false) AND EXISTS (
      SELECT 1 FROM public.preliminary_survey_v2_measurement_assignments assignment
      WHERE assignment.plan_id = plan_row.id AND assignment.measurement_date = target_row.measurement_date::date
    ) THEN RAISE EXCEPTION 'NON_NULL_OVERWRITE_FORBIDDEN'; END IF;

    IF jsonb_typeof(incoming_participant_names) <> 'array' OR jsonb_array_length(incoming_participant_names) <> jsonb_array_length(incoming_participant_ids) THEN RAISE EXCEPTION 'PARTICIPANT_MISMATCH'; END IF;
    SELECT count(*) INTO assigned_count
    FROM jsonb_array_elements_text(incoming_participant_ids) WITH ORDINALITY participant(id, ordinal)
    JOIN jsonb_array_elements_text(incoming_participant_names) WITH ORDINALITY participant_name(name, ordinal) USING (ordinal)
    JOIN public.users user_row ON user_row.id = participant.id::integer AND user_row.name = participant_name.name AND user_row.is_active IS TRUE AND user_row.job = '측정';
    IF assigned_count <> jsonb_array_length(incoming_participant_ids)
       OR NOT (incoming_participant_ids @> to_jsonb(ARRAY[(item->>'responsibleUserId')::integer]))
       OR (NULLIF(item->>'experiencedReviewerUserId', '') IS NOT NULL AND NOT (incoming_participant_ids @> to_jsonb(ARRAY[(item->>'experiencedReviewerUserId')::integer]))) THEN RAISE EXCEPTION 'PARTICIPANT_MISMATCH'; END IF;
    IF (item->>'recommendedDate')::date IS NULL OR (item->>'recommendedDate')::date >= target_row.measurement_date::date THEN RAISE EXCEPTION 'INVALID_RECOMMENDED_DATE'; END IF;

    IF COALESCE((item->>'fillMeasurementAssignment')::boolean, false) THEN
      SELECT upper(btrim(COALESCE(user_row.survey_code, ''))) INTO configured_survey_code
      FROM public.users user_row
      WHERE user_row.id = (expected_assignment->>'assigneeUserId')::integer AND user_row.is_active IS NOT FALSE;
      IF configured_survey_code NOT IN ('A', 'B', 'C', 'D', 'F', 'G')
         OR upper(btrim(expected_assignment->>'surveyCode')) IS DISTINCT FROM configured_survey_code THEN
        RAISE EXCEPTION 'REPAIR_EXACT_PUBLIC_SAMPLE_SOURCE_REQUIRED';
      END IF;
      SELECT count(*) INTO existing_assignment_group_count
      FROM public.preliminary_survey_v2_measurement_assignments assignment
      WHERE assignment.measurement_date = (expected_assignment->>'measurementDate')::date
        AND assignment.assignee_user_id = (expected_assignment->>'assigneeUserId')::integer;
      IF existing_assignment_group_count >= 3 THEN RAISE EXCEPTION 'MEASUREMENT_ASSIGNMENT_HARD_MAX_EXCEEDED'; END IF;
      IF existing_assignment_group_count = 2 THEN RAISE EXCEPTION 'MEASUREMENT_ASSIGNMENT_ADMIN_EXCEPTION_REQUIRED'; END IF;
    END IF;

    before_snapshot := CASE WHEN plan_row.id IS NULL THEN NULL ELSE jsonb_build_object('plan', to_jsonb(plan_row)) END;
    PERFORM set_config('app.preliminary_survey_admin_repair', 'on', true);
    IF plan_row.id IS NULL THEN
      INSERT INTO public.preliminary_survey_v2_plans (
        measurement_target_business_id, recommended_date, responsible_user_id, experienced_reviewer_id, participant_user_ids, participant_names, status, plan_origin, source_measurement_date, source_responsible_user_id, source_rule_type, survey_method, recommendation_reason, route_evidence, warnings
      ) VALUES (
        target_row.id, (item->>'recommendedDate')::date, (item->>'responsibleUserId')::integer, NULLIF(item->>'experiencedReviewerUserId', '')::integer, incoming_participant_ids, incoming_participant_names,
        'recommended', 'manual', target_row.measurement_date::date, target_row.measurer_id, item->>'sourceRuleType', item->>'surveyMethod',
        jsonb_build_object('reason', '찐확정 누락정보 보정', 'provenance', 'exact_reconciliation_then_policy'), '{}'::jsonb, '[]'::jsonb
      ) RETURNING * INTO repaired_plan;
    ELSE
      UPDATE public.preliminary_survey_v2_plans AS current_plan SET
        recommended_date = CASE WHEN COALESCE((item->>'fillDate')::boolean, false) THEN (item->>'recommendedDate')::date ELSE current_plan.recommended_date END,
        responsible_user_id = CASE WHEN COALESCE((item->>'fillSurveyors')::boolean, false) THEN (item->>'responsibleUserId')::integer ELSE current_plan.responsible_user_id END,
        experienced_reviewer_id = CASE WHEN COALESCE((item->>'fillSurveyors')::boolean, false) THEN NULLIF(item->>'experiencedReviewerUserId', '')::integer ELSE current_plan.experienced_reviewer_id END,
        participant_user_ids = CASE WHEN COALESCE((item->>'fillSurveyors')::boolean, false) THEN incoming_participant_ids ELSE current_plan.participant_user_ids END,
        participant_names = CASE WHEN COALESCE((item->>'fillSurveyors')::boolean, false) THEN incoming_participant_names ELSE current_plan.participant_names END
      WHERE current_plan.id = plan_row.id RETURNING * INTO repaired_plan;
    END IF;
    IF COALESCE((item->>'fillMeasurementAssignment')::boolean, false) THEN
      INSERT INTO public.preliminary_survey_v2_measurement_assignments (plan_id, measurement_date, assignee_user_id, survey_code, assignment_reason)
      VALUES (
        repaired_plan.id,
        (expected_assignment->>'measurementDate')::date,
        (expected_assignment->>'assigneeUserId')::integer,
        repeat(configured_survey_code, existing_assignment_group_count + 1),
        'TRUE_CONFIRMED_MISSING_DOCUMENTARY_REPAIR_EXACT_RECONCILIATION'
      );
    END IF;
    SELECT jsonb_agg(to_jsonb(assignment) ORDER BY assignment.measurement_date) INTO after_assignments FROM public.preliminary_survey_v2_measurement_assignments assignment WHERE assignment.plan_id = repaired_plan.id;
    filled := (CASE WHEN COALESCE((item->>'fillDate')::boolean, false) THEN '["recommended_date"]'::jsonb ELSE '[]'::jsonb END)
      || (CASE WHEN COALESCE((item->>'fillSurveyors')::boolean, false) THEN '["surveyors"]'::jsonb ELSE '[]'::jsonb END)
      || (CASE WHEN COALESCE((item->>'fillMeasurementAssignment')::boolean, false) THEN '["measurement_public_sample_assignment"]'::jsonb ELSE '[]'::jsonb END);
    INSERT INTO public.preliminary_survey_v2_document_repair_audit (measurement_target_business_id, plan_id, filled_fields, before_plan, after_plan, provenance, changed_by_user_id)
    VALUES (target_row.id, repaired_plan.id, filled, before_snapshot, jsonb_build_object('plan', to_jsonb(repaired_plan), 'assignments', COALESCE(after_assignments, '[]'::jsonb)), 'true_confirmed_missing_documentary_info_repair', p_changed_by_user_id);
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

-- Rollback (별도 승인): 20260830130000의 repair_true_confirmed_preliminary_v2_missing_batch 정의를 복원한다.
