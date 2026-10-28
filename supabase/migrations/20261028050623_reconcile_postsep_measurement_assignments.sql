-- Current actual dates are daily_staff dates for multi-day work and measurement_date otherwise.
-- This is a pure source projection; it does not mutate target or historical rows.
CREATE OR REPLACE FUNCTION public.preliminary_survey_v2_actual_measurement_dates(
  p_target public.measurement_target_business
) RETURNS date[] LANGUAGE sql STABLE SET search_path TO '' AS $actual_dates$
  SELECT CASE
    WHEN CASE WHEN jsonb_typeof(p_target.daily_staff) = 'array'
      THEN jsonb_array_length(p_target.daily_staff) > 0 ELSE false END
      THEN ARRAY(SELECT (day->>'date')::date
        FROM jsonb_array_elements(p_target.daily_staff) day
        WHERE day->>'date' ~ '^\d{4}-\d{2}-\d{2}$')
    ELSE ARRAY[public.preliminary_survey_v2_first_measurement_date(
      p_target.measurement_date, p_target.daily_staff)]
  END;
$actual_dates$;

CREATE OR REPLACE FUNCTION public.apply_preliminary_survey_v2_reverse_planner(p_planner_run_id uuid, p_source_fingerprint text, p_canonical_sha text, p_planner_version text, p_plans jsonb, p_assignments jsonb, p_actor_user_id integer, p_override_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  plan_item jsonb;
  assignment_item jsonb;
  target_row public.measurement_target_business;
  persisted_plan_id uuid;
  actor_role text;
  actor_manager boolean;
  affected_groups jsonb := '[]'::jsonb;
  applied_count integer := 0;
  participant_id integer;
  expected_occupancy jsonb;
  current_occupancy jsonb;
  expected_schedule jsonb;
  current_schedule jsonb;
  expected_actual jsonb;
  current_actual jsonb;
  expected_users jsonb;
  current_users jsonb;
  expected_fixed jsonb;
  current_fixed jsonb;
  expected_protected boolean;
  current_protected boolean;
  expected_assignment_scope jsonb;
  expected_assignment_occupancy jsonb;
  current_assignment_occupancy jsonb;
  expected_public_assignments jsonb;
  current_public_assignments jsonb;
  expected_public_fixed jsonb;
  current_public_fixed jsonb;
  actual_public_impacts jsonb;
  impact_item jsonb;
  stale_assignment record;
  stale_removed jsonb;
BEGIN
  SELECT role, (role = '관리자' OR is_preliminary_survey_manager IS TRUE)
  INTO actor_role, actor_manager
  FROM public.users
  WHERE id = p_actor_user_id AND is_active IS NOT FALSE;
  IF actor_manager IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PLANNER_MANAGER_REQUIRED';
  END IF;
  IF p_override_reason IS NOT NULL
     AND (actor_role <> '관리자' OR btrim(p_override_reason) = '') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ADMIN_OVERRIDE_REQUIRED';
  END IF;
  IF btrim(COALESCE(p_source_fingerprint, '')) = ''
     OR jsonb_typeof(p_plans) <> 'array'
     OR jsonb_typeof(p_assignments) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_REVERSE_PLANNER_PAYLOAD';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(resource.lock_key, 0))
  FROM (
    SELECT DISTINCT lock_key
    FROM (
      SELECT CASE WHEN plan_payload.value->>'survey_method' = 'phone'
        THEN 'reverse-planner-survey|phone|' || (plan_payload.value->>'preliminary_date') || '|' || (plan_payload.value->>'responsible_user_id')
        ELSE 'reverse-planner-survey|field|' || (plan_payload.value->>'preliminary_date') || '|' || participant.value
      END AS lock_key
      FROM jsonb_array_elements(p_plans) plan_payload(value)
      LEFT JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN plan_payload.value->>'survey_method' = 'field' THEN plan_payload.value->'participant_user_ids' ELSE '[null]'::jsonb END
      ) participant ON true
      UNION ALL
      SELECT 'reverse-planner-public-group|' || (assignment_payload.value->>'measurement_date') || '|' || (assignment_payload.value->>'assignee_user_id')
      FROM jsonb_array_elements(p_assignments) assignment_payload(value)
      UNION ALL
      SELECT 'reverse-planner-public-group|' || (assignment_payload.value->>'measurement_date') || '|' || assignment.assignee_user_id
      FROM jsonb_array_elements(p_assignments) assignment_payload(value)
      JOIN public.preliminary_survey_v2_plans source_plan
        ON source_plan.measurement_target_business_id = (assignment_payload.value->>'target_id')::bigint
      JOIN public.preliminary_survey_v2_measurement_assignments assignment
        ON assignment.plan_id = source_plan.id
       AND assignment.measurement_date = (assignment_payload.value->>'measurement_date')::date
    ) all_keys
    WHERE lock_key IS NOT NULL
  ) resource
  ORDER BY resource.lock_key;

  IF p_override_reason IS NOT NULL THEN
    PERFORM set_config('app.preliminary_survey_admin_repair', 'on', true);
  END IF;

  -- 같은 유선 responsible/date 또는 방문 participant/date 계산을 직렬화한다.
  FOR plan_item IN
    SELECT value FROM jsonb_array_elements(p_plans)
    ORDER BY value->>'preliminary_date', value->>'survey_method',
      (value->>'responsible_user_id')::integer, (value->>'target_id')::bigint
  LOOP
    IF plan_item->>'survey_method' = 'phone' THEN
      PERFORM pg_advisory_xact_lock(hashtextextended(
        'reverse-planner-survey|phone|' || (plan_item->>'preliminary_date') || '|' || (plan_item->>'responsible_user_id'), 0
      ));
    ELSE
      FOR participant_id IN
        SELECT value::integer FROM jsonb_array_elements_text(plan_item->'participant_user_ids')
        ORDER BY value::integer
      LOOP
        PERFORM pg_advisory_xact_lock(hashtextextended(
          'reverse-planner-survey|field|' || (plan_item->>'preliminary_date') || '|' || participant_id::text, 0
        ));
      END LOOP;
    END IF;
  END LOOP;

  -- 동일 공시료 그룹 Apply를 transaction 단위로 결정론적 직렬화한다.
  FOR assignment_item IN
    SELECT value FROM jsonb_array_elements(p_assignments)
    ORDER BY value->>'measurement_date', (value->>'assignee_user_id')::integer, (value->>'target_id')::bigint
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'reverse-planner-public-group|' || (assignment_item->>'measurement_date') || '|' || (assignment_item->>'assignee_user_id'), 0
    ));
  END LOOP;

  -- baseline 조회 이후 관련 schedule/actual source가 바뀌지 않게 유지한다.
  -- plan/assignment write 경로 전체를 짧게 직렬화하고 보호 원천의 phantom INSERT를 막는다.
  -- target UPDATE trigger가 target -> plan 순서로 잠그므로 같은 순서를 지킨다.
  LOCK TABLE public.measurement_target_business IN SHARE MODE;
  LOCK TABLE public.preliminary_survey_v2_plans IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.preliminary_survey_v2_measurement_assignments IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.measurement_journal IN SHARE MODE;
  LOCK TABLE public.preliminary_survey_v2_legacy_reconciliation IN SHARE MODE;
  LOCK TABLE public.preliminary_survey_v2_history_recovery_audit IN SHARE MODE;
  LOCK TABLE public.users IN SHARE MODE;
  LOCK TABLE public.user_schedule_blocks IN SHARE MODE;
  LOCK TABLE public.preliminary_survey_v2_fixed_assignments IN SHARE ROW EXCLUSIVE MODE;

  FOR plan_item IN
    SELECT value FROM jsonb_array_elements(p_plans)
    ORDER BY (value->>'target_id')::bigint
  LOOP
    IF plan_item->>'mutation' NOT IN ('KEEP_EXISTING', 'CREATE', 'REPLACE') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_MUTATION_INTENT';
    END IF;
    IF p_override_reason IS NULL AND plan_item->>'decision' <> 'AUTO_ASSIGNED' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MANUAL_DECISION_NOT_APPLICABLE';
    END IF;

    SELECT * INTO target_row
    FROM public.measurement_target_business
    WHERE id = (plan_item->>'target_id')::bigint
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'TARGET_NOT_FOUND';
    END IF;
    IF public.preliminary_survey_v2_first_measurement_date(target_row.measurement_date, target_row.daily_staff) >= DATE '2026-08-01'
       AND public.preliminary_survey_v2_first_measurement_date(target_row.measurement_date, target_row.daily_staff) < DATE '2026-09-01'
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(target_row.daily_staff) = 'array' THEN target_row.daily_staff ELSE '[]'::jsonb END
         ) day
         WHERE day->>'date' >= '2026-08-01' AND day->>'date' < '2026-09-01'
       ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TRANSITION_BOUNDARY_REVIEW_REQUIRED';
    END IF;
    IF target_row.measurement_date::text IS DISTINCT FROM plan_item->>'source_measurement_date'
       OR COALESCE(target_row.measurer_id, -1)
          IS DISTINCT FROM COALESCE((plan_item->>'source_report_writer_id')::integer, -1)
       OR COALESCE(target_row.collaborators, '')
          IS DISTINCT FROM COALESCE(plan_item->>'source_collaborators', '')
       OR COALESCE(target_row.daily_staff, 'null'::jsonb)
          IS DISTINCT FROM COALESCE(plan_item->'source_daily_staff', 'null'::jsonb) THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'SOURCE_CHANGED';
    END IF;
    expected_protected := COALESCE((plan_item->>'source_protected')::boolean, false);
    SELECT (
      EXISTS (
        SELECT 1 FROM public.measurement_journal journal
        WHERE journal.code = target_row.code
          AND journal.measurement_year = target_row.year
          AND replace(btrim(journal.measurement_period), '(수시)', '')
            = replace(btrim(target_row.period), '(수시)', '')
      )
      OR EXISTS (
        SELECT 1 FROM public.preliminary_survey_v2_plans protected_plan
        WHERE protected_plan.measurement_target_business_id = target_row.id
          AND (
            EXISTS (SELECT 1 FROM public.preliminary_survey_v2_legacy_reconciliation reconciliation
              WHERE reconciliation.applied_plan_id = protected_plan.id)
            OR EXISTS (SELECT 1 FROM public.preliminary_survey_v2_history_recovery_audit history
              WHERE history.created_plan_id = protected_plan.id)
          )
      )
    ) INTO current_protected;
    IF current_protected IS DISTINCT FROM expected_protected THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'SOURCE_CHANGED';
    END IF;

    expected_users := COALESCE(plan_item->'source_users', '[]'::jsonb);
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', source_user.id,
      'active', source_user.is_active IS NOT FALSE,
      'experienced', source_user.is_preliminary_survey_experienced IS TRUE,
      'baseCode', CASE WHEN source_user.survey_code IS NULL THEN NULL ELSE upper(btrim(source_user.survey_code)) END
    ) ORDER BY source_user.id), '[]'::jsonb)
    INTO current_users
    FROM public.users source_user
    WHERE source_user.job = '측정';
    IF current_users IS DISTINCT FROM expected_users THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'SOURCE_CHANGED';
    END IF;

    expected_fixed := COALESCE(plan_item->'source_fixed_versions', '[]'::jsonb);
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'measurementDate', fixed.measurement_date::text,
      'assigneeUserId', fixed.assignee_user_id,
      'updatedAtMs', floor(extract(epoch FROM fixed.updated_at) * 1000)::bigint,
      'nonParticipantConfirmed', COALESCE((fixed.source_snapshot->>'nonParticipantConfirmed')::boolean, false)
    ) ORDER BY fixed.measurement_date), '[]'::jsonb)
    INTO current_fixed
    FROM public.preliminary_survey_v2_fixed_assignments fixed
    WHERE fixed.measurement_target_business_id = target_row.id;
    IF current_fixed IS DISTINCT FROM expected_fixed THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'SOURCE_CHANGED';
    END IF;

    expected_assignment_scope := COALESCE(plan_item->'source_assignment_scope_keys', '[]'::jsonb);
    expected_assignment_occupancy := COALESCE(plan_item->'source_assignment_occupancy_versions', '[]'::jsonb);
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'targetId', assignment_plan.measurement_target_business_id,
      'measurementDate', assignment.measurement_date::text,
      'assigneeUserId', assignment.assignee_user_id,
      'updatedAtMs', floor(extract(epoch FROM assignment.updated_at) * 1000)::bigint
    ) ORDER BY assignment.measurement_date, assignment_plan.measurement_target_business_id, assignment.assignee_user_id), '[]'::jsonb)
    INTO current_assignment_occupancy
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    JOIN public.preliminary_survey_v2_plans assignment_plan ON assignment_plan.id = assignment.plan_id
    JOIN public.measurement_target_business occupancy_target
      ON occupancy_target.id = assignment_plan.measurement_target_business_id
    WHERE assignment.measurement_date IN (
      SELECT DISTINCT (scope_item->>'measurementDate')::date
      FROM jsonb_array_elements(expected_assignment_scope) scope_item
    )
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(expected_assignment_scope) scope_item
        WHERE (scope_item->>'targetId')::bigint = assignment_plan.measurement_target_business_id
          AND (scope_item->>'measurementDate')::date = assignment.measurement_date
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.preliminary_survey_v2_fixed_assignments fixed
        WHERE fixed.measurement_target_business_id = assignment_plan.measurement_target_business_id
          AND fixed.measurement_date = assignment.measurement_date
      )
      AND (
        NOT EXISTS (SELECT 1 FROM unnest(public.preliminary_survey_v2_actual_measurement_dates(occupancy_target)) actual_day
          WHERE actual_day >= DATE '2026-09-01')
        OR assignment.measurement_date = ANY(public.preliminary_survey_v2_actual_measurement_dates(occupancy_target))
      );
    IF current_assignment_occupancy IS DISTINCT FROM expected_assignment_occupancy THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'SOURCE_CHANGED';
    END IF;

    expected_schedule := COALESCE(plan_item->'source_schedule_blocks', '[]'::jsonb);
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'userId', block.user_id, 'startDate', block.start_date::text, 'endDate', block.end_date::text
    ) ORDER BY block.user_id, block.start_date, block.end_date), '[]'::jsonb)
    INTO current_schedule
    FROM public.user_schedule_blocks block
    WHERE block.start_date <= (plan_item->>'preliminary_date')::date
      AND block.end_date >= (plan_item->>'preliminary_date')::date
      AND block.user_id IN (
        SELECT CASE WHEN plan_item->>'survey_method' = 'phone'
          THEN (plan_item->>'responsible_user_id')::integer ELSE worker.value::integer END
        FROM jsonb_array_elements_text(
          CASE WHEN plan_item->>'survey_method' = 'field' THEN plan_item->'participant_user_ids' ELSE '[0]'::jsonb END
        ) worker
      );
    IF current_schedule IS DISTINCT FROM expected_schedule THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'SOURCE_CHANGED';
    END IF;

    expected_actual := COALESCE(plan_item->'source_actual_measurement_versions', '[]'::jsonb);
    IF plan_item->>'survey_method' = 'field' THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'targetId', actual.id,
        'targetUpdatedAtMs', CASE WHEN actual.updated_at IS NULL THEN NULL
          ELSE floor(extract(epoch FROM actual.updated_at) * 1000)::bigint END,
        'fixedUpdatedAtMs', COALESCE((
          SELECT jsonb_agg(floor(extract(epoch FROM fixed.updated_at) * 1000)::bigint ORDER BY fixed.updated_at)
          FROM public.preliminary_survey_v2_fixed_assignments fixed
          WHERE fixed.measurement_target_business_id = actual.id
            AND fixed.measurement_date = (plan_item->>'preliminary_date')::date
        ), '[]'::jsonb)
      ) ORDER BY actual.id), '[]'::jsonb)
      INTO current_actual
      FROM public.measurement_target_business actual
      WHERE NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_plans) batch_plan
        WHERE (batch_plan->>'target_id')::bigint = actual.id
      )
        AND (
          public.preliminary_survey_v2_first_measurement_date(actual.measurement_date, actual.daily_staff) = (plan_item->>'preliminary_date')::date
          OR (jsonb_typeof(actual.daily_staff) = 'array' AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(actual.daily_staff) staff
            WHERE staff->>'date' = plan_item->>'preliminary_date'
          ))
        );
    ELSE
      current_actual := '[]'::jsonb;
    END IF;
    IF current_actual IS DISTINCT FROM expected_actual THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'SOURCE_CHANGED';
    END IF;

    expected_occupancy := COALESCE(plan_item->'source_occupancy_versions', '[]'::jsonb);
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'targetId', existing.measurement_target_business_id,
      'planId', existing.id::text,
      'updatedAtMs', floor(extract(epoch FROM existing.updated_at) * 1000)::bigint
    ) ORDER BY existing.measurement_target_business_id), '[]'::jsonb)
    INTO current_occupancy
    FROM public.preliminary_survey_v2_plans existing
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_plans) batch_plan
      WHERE (batch_plan->>'target_id')::bigint = existing.measurement_target_business_id
    )
      AND existing.recommended_date = (plan_item->>'preliminary_date')::date
      AND (
        (plan_item->>'survey_method' = 'phone'
          AND existing.survey_method = 'phone'
          AND existing.responsible_user_id = (plan_item->>'responsible_user_id')::integer)
        OR
        (plan_item->>'survey_method' = 'field'
          AND existing.survey_method = 'field'
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(COALESCE(existing.participant_user_ids, '[]'::jsonb)) existing_participant
            JOIN jsonb_array_elements_text(plan_item->'participant_user_ids') proposed_participant
              ON proposed_participant.value = existing_participant.value
          ))
      );
    IF current_occupancy IS DISTINCT FROM expected_occupancy THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'SOURCE_CHANGED';
    END IF;

    IF NOT (plan_item->>'preliminary_only' = 'true' AND plan_item->>'measurement_edit' = 'true') AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_assignments) item
      WHERE (item->>'target_id')::bigint = target_row.id
        AND COALESCE(item->>'assignment_origin', '') NOT IN ('confirmed', 'automatic')
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_ASSIGNMENT_ORIGIN';
    END IF;
    IF NOT (plan_item->>'preliminary_only' = 'true' AND plan_item->>'measurement_edit' = 'true') AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_assignments) item
      WHERE (item->>'target_id')::bigint = target_row.id
        AND item->>'assignment_origin' = 'confirmed'
        AND NOT EXISTS (
          SELECT 1
          FROM public.preliminary_survey_v2_fixed_assignments fixed
          WHERE fixed.measurement_target_business_id = target_row.id
            AND fixed.measurement_date = (item->>'measurement_date')::date
            AND fixed.assignee_user_id = (item->>'assignee_user_id')::integer
        )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'FIXED_ASSIGNEE_SOURCE_CHANGED';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_assignments) item
      WHERE (item->>'target_id')::bigint = target_row.id
        AND item->>'assignment_origin' = 'automatic'
        AND EXISTS (
          SELECT 1 FROM public.preliminary_survey_v2_fixed_assignments fixed
          WHERE fixed.measurement_target_business_id = target_row.id
            AND fixed.measurement_date = (item->>'measurement_date')::date
        )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'SOURCE_CHANGED';
    END IF;
    IF plan_item->>'preliminary_only' = 'true' THEN
      IF public.preliminary_survey_v2_first_measurement_date(target_row.measurement_date, target_row.daily_staff) < DATE '2026-09-01'
        OR EXISTS (SELECT 1 FROM public.preliminary_survey_v2_legacy_reconciliation history
          WHERE history.applied_plan_id = (plan_item->'before_snapshot'->>'id')::uuid)
        OR EXISTS (SELECT 1 FROM public.preliminary_survey_v2_history_recovery_audit history
          WHERE history.created_plan_id = (plan_item->'before_snapshot'->>'id')::uuid)
        OR jsonb_typeof(plan_item->'participant_user_ids') <> 'array'
        OR jsonb_array_length(plan_item->'participant_user_ids') = 0
        OR NOT (plan_item->'participant_user_ids' @> jsonb_build_array((plan_item->>'responsible_user_id')::integer))
        OR (plan_item->>'reviewer_user_id' IS NOT NULL AND NOT
          (plan_item->'participant_user_ids' @> jsonb_build_array((plan_item->>'reviewer_user_id')::integer)))
        OR (SELECT count(*) FROM jsonb_array_elements_text(plan_item->'participant_user_ids'))
          <> (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(plan_item->'participant_user_ids')) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PRELIMINARY_ONLY_OVERRIDE';
      END IF;
      IF p_override_reason IS NULL OR plan_item->>'decision' <> 'MANUAL_OVERRIDE'
         OR plan_item->>'mutation' <> 'REPLACE'
         OR jsonb_array_length(p_plans) <> 1
         OR (plan_item->>'measurement_edit' IS DISTINCT FROM 'true' AND jsonb_array_length(p_assignments) <> 0)
         OR (plan_item->>'measurement_edit' = 'true' AND jsonb_array_length(p_assignments) = 0)
         OR NOT public.is_preliminary_survey_v2_true_confirmed(target_row.id)
         OR NOT EXISTS (SELECT 1 FROM public.preliminary_survey_v2_plans existing
           WHERE existing.id = (plan_item->'before_snapshot'->>'id')::uuid
             AND existing.measurement_target_business_id = target_row.id) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PRELIMINARY_ONLY_OVERRIDE';
      END IF;
      IF EXISTS (SELECT 1 FROM public.preliminary_survey_v2_planner_audit audit
        WHERE audit.planner_run_id = p_planner_run_id AND audit.target_id = target_row.id) THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'SOURCE_CHANGED';
      END IF;
      IF (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'measurementDate', assignment.measurement_date::text,
        'assigneeUserId', assignment.assignee_user_id,
        'surveyCode', assignment.survey_code,
        'publicSampleCode', assignment.public_sample_code,
        'updatedAtMs', floor(extract(epoch FROM assignment.updated_at) * 1000)::bigint)
        ORDER BY assignment.measurement_date), '[]'::jsonb)
        FROM public.preliminary_survey_v2_measurement_assignments assignment
        WHERE assignment.plan_id = (plan_item->'before_snapshot'->>'id')::uuid)
          IS DISTINCT FROM plan_item->'source_target_assignments' THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'SOURCE_CHANGED';
      END IF;
      IF plan_item->>'measurement_edit' = 'true' THEN
        IF jsonb_typeof(plan_item->'measurement_changed_dates') <> 'array'
          OR jsonb_typeof(plan_item->'actual_measurement_team') <> 'array'
          OR jsonb_array_length(plan_item->'measurement_changed_dates') <> jsonb_array_length(p_assignments)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_assignments) item
            WHERE (item->>'target_id')::bigint <> target_row.id
              OR item->>'assignment_origin' <> 'admin_override'
              OR NOT (plan_item->'measurement_changed_dates' @> jsonb_build_array(item->>'measurement_date'))
              OR NOT EXISTS (SELECT 1 FROM public.preliminary_survey_v2_measurement_assignments original
                WHERE original.plan_id = (plan_item->'before_snapshot'->>'id')::uuid
                  AND original.measurement_date = (item->>'measurement_date')::date
                  AND original.assignee_user_id IS DISTINCT FROM (item->>'assignee_user_id')::integer)
              OR NOT EXISTS (SELECT 1 FROM public.users chosen
                WHERE chosen.id = (item->>'assignee_user_id')::integer
                  AND chosen.is_active IS TRUE AND chosen.job = '측정'
                  AND upper(btrim(chosen.survey_code)) ~ '^[ABCDFG]$'))
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(plan_item->'measurement_changed_dates') day
            WHERE (SELECT count(*) FROM jsonb_array_elements(p_assignments) item
              WHERE item->>'measurement_date' = day.value) <> 1
              OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(plan_item->'actual_measurement_team') actual_day
                WHERE actual_day->>'date' = day.value
                  AND jsonb_typeof(actual_day->'collaboratorUserIds') = 'array')) THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PUBLIC_SAMPLE_ADMIN_EDIT';
        END IF;
        expected_public_assignments := plan_item->'source_public_assignment_versions';
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'targetId', source_plan.measurement_target_business_id,
          'measurementDate', assignment.measurement_date::text,
          'assigneeUserId', assignment.assignee_user_id,
          'publicSampleCode', assignment.public_sample_code,
          'surveyCode', assignment.survey_code,
          'updatedAtMs', floor(extract(epoch FROM assignment.updated_at) * 1000)::bigint)
          ORDER BY assignment.measurement_date, source_plan.measurement_target_business_id), '[]'::jsonb)
        INTO current_public_assignments
        FROM public.preliminary_survey_v2_measurement_assignments assignment
        JOIN public.preliminary_survey_v2_plans source_plan ON source_plan.id = assignment.plan_id
        WHERE assignment.measurement_date IN (
          SELECT value::date FROM jsonb_array_elements_text(plan_item->'measurement_changed_dates'));
        expected_public_fixed := plan_item->'source_public_fixed_versions';
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'targetId', fixed.measurement_target_business_id,
          'measurementDate', fixed.measurement_date::text,
          'assigneeUserId', fixed.assignee_user_id,
          'updatedAtMs', floor(extract(epoch FROM fixed.updated_at) * 1000)::bigint)
          ORDER BY fixed.measurement_date, fixed.measurement_target_business_id), '[]'::jsonb)
        INTO current_public_fixed
        FROM public.preliminary_survey_v2_fixed_assignments fixed
        WHERE fixed.measurement_date IN (
          SELECT value::date FROM jsonb_array_elements_text(plan_item->'measurement_changed_dates'));
        IF expected_public_assignments IS NULL OR expected_public_fixed IS NULL
          OR current_public_assignments IS DISTINCT FROM expected_public_assignments
          OR current_public_fixed IS DISTINCT FROM expected_public_fixed THEN
          RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'SOURCE_CHANGED';
        END IF;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.users actor
        WHERE actor.id = (plan_item->>'responsible_user_id')::integer
          AND actor.is_active IS TRUE AND actor.job = '측정')
        OR (plan_item->>'reviewer_user_id' IS NOT NULL AND NOT EXISTS
          (SELECT 1 FROM public.users reviewer WHERE reviewer.id = (plan_item->>'reviewer_user_id')::integer
            AND reviewer.is_active IS TRUE AND reviewer.job = '측정'))
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(plan_item->'participant_user_ids') participant
          WHERE NOT EXISTS (SELECT 1 FROM public.users worker WHERE worker.id = participant.value::integer
            AND worker.is_active IS TRUE AND worker.job = '측정')) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PRELIMINARY_USER';
      END IF;
    END IF;
    IF plan_item->>'preliminary_only' IS DISTINCT FROM 'true' AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_assignments) item
      WHERE (item->>'target_id')::bigint = target_row.id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'FIXED_ASSIGNEE_NOT_CONFIRMED';
    END IF;

    -- API snapshot 이후 같은 target plan이 바뀌었으면 stale Apply를 거부한다.
    IF plan_item->>'mutation' = 'CREATE' AND EXISTS (
      SELECT 1 FROM public.preliminary_survey_v2_plans existing
      WHERE existing.measurement_target_business_id = target_row.id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'SOURCE_CHANGED';
    ELSIF plan_item->>'mutation' = 'REPLACE' AND NOT EXISTS (
      SELECT 1 FROM public.preliminary_survey_v2_plans existing
      WHERE existing.measurement_target_business_id = target_row.id
        AND existing.id = (plan_item->'before_snapshot'->>'id')::uuid
        AND existing.updated_at = (plan_item->'before_snapshot'->>'updatedAt')::timestamptz
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'SOURCE_CHANGED';
    END IF;

    -- REPLACE consumes the complete current measurement-date set. Remove only automatic
    -- orphan dates from this plan; fixed, historical and confirmed rows stay untouched.
    IF plan_item->>'mutation' = 'REPLACE' AND p_override_reason IS NULL THEN
      stale_removed := '[]'::jsonb;
      FOR stale_assignment IN
        SELECT assignment.*
        FROM public.preliminary_survey_v2_measurement_assignments assignment
        WHERE assignment.plan_id = (plan_item->'before_snapshot'->>'id')::uuid
          AND NOT (assignment.measurement_date = ANY(
            public.preliminary_survey_v2_actual_measurement_dates(target_row)))
        ORDER BY assignment.measurement_date, assignment.id
      LOOP
        IF stale_assignment.measurement_date < DATE '2026-09-01'
          OR current_protected
          OR EXISTS (SELECT 1 FROM public.preliminary_survey_v2_fixed_assignments fixed
            WHERE fixed.measurement_target_business_id = target_row.id
              AND fixed.measurement_date = stale_assignment.measurement_date) THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PROTECTED_STALE_MEASUREMENT_ASSIGNMENT';
        END IF;
        IF EXISTS (
          SELECT 1 FROM public.preliminary_survey_v2_measurement_assignments occupied
          JOIN public.preliminary_survey_v2_plans occupied_plan ON occupied_plan.id = occupied.plan_id
          JOIN public.measurement_target_business occupied_target
            ON occupied_target.id = occupied_plan.measurement_target_business_id
          WHERE occupied.id <> stale_assignment.id
            AND occupied.measurement_date = stale_assignment.measurement_date
            AND occupied.assignee_user_id = stale_assignment.assignee_user_id
            AND (
              public.is_preliminary_survey_v2_true_confirmed(occupied_target.id)
              OR EXISTS (SELECT 1 FROM public.preliminary_survey_v2_legacy_reconciliation history
                WHERE history.applied_plan_id = occupied_plan.id)
              OR EXISTS (SELECT 1 FROM public.preliminary_survey_v2_history_recovery_audit history
                WHERE history.created_plan_id = occupied_plan.id)
              OR NOT EXISTS (SELECT 1 FROM unnest(
                public.preliminary_survey_v2_actual_measurement_dates(occupied_target)) actual_day
                WHERE actual_day >= DATE '2026-09-01')
            )
        ) THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PROTECTED_PUBLIC_SAMPLE_IMPACT';
        END IF;
        affected_groups := affected_groups || jsonb_build_array(jsonb_build_object(
          'date', stale_assignment.measurement_date::text,
          'userId', stale_assignment.assignee_user_id));
        stale_removed := stale_removed || jsonb_build_array(jsonb_build_object(
          'id', stale_assignment.id,
          'date', stale_assignment.measurement_date::text,
          'assigneeUserId', stale_assignment.assignee_user_id,
          'publicSampleCode', stale_assignment.public_sample_code));
        DELETE FROM public.preliminary_survey_v2_measurement_assignments
        WHERE id = stale_assignment.id;
      END LOOP;
      plan_item := plan_item || jsonb_build_object('staleAssignmentsRemoved', stale_removed);
    END IF;

    IF plan_item->>'mutation' <> 'KEEP_EXISTING' THEN
      INSERT INTO public.preliminary_survey_v2_plans (
        measurement_target_business_id, recommended_date, responsible_user_id,
        experienced_reviewer_id, participant_user_ids, participant_names, status,
        plan_origin, source_measurement_date, source_responsible_user_id,
        source_rule_type, survey_method, recommendation_reason, route_evidence, warnings
      ) VALUES (
        target_row.id,
        (plan_item->>'preliminary_date')::date,
        (plan_item->>'responsible_user_id')::integer,
        NULLIF(plan_item->>'reviewer_user_id', '')::integer,
        plan_item->'participant_user_ids',
        plan_item->'participant_names',
        'recommended',
        CASE WHEN p_override_reason IS NULL THEN 'automatic' ELSE 'manual' END,
        public.preliminary_survey_v2_first_measurement_date(target_row.measurement_date, target_row.daily_staff),
        target_row.measurer_id,
        plan_item->>'source_rule_type',
        plan_item->>'survey_method',
        jsonb_build_object(
          'plannerRunId', p_planner_run_id,
          'sourceFingerprint', p_source_fingerprint,
          'canonicalSha', p_canonical_sha,
          'plannerVersion', p_planner_version,
          'reason', plan_item->'reasons'
        ),
        COALESCE(plan_item->'route_evidence', '{}'::jsonb),
        COALESCE(plan_item->'warnings', '[]'::jsonb)
      )
      ON CONFLICT (measurement_target_business_id) DO UPDATE SET
        recommended_date = EXCLUDED.recommended_date,
        responsible_user_id = EXCLUDED.responsible_user_id,
        experienced_reviewer_id = EXCLUDED.experienced_reviewer_id,
        participant_user_ids = EXCLUDED.participant_user_ids,
        participant_names = EXCLUDED.participant_names,
        status = EXCLUDED.status,
        plan_origin = EXCLUDED.plan_origin,
        source_measurement_date = EXCLUDED.source_measurement_date,
        source_responsible_user_id = EXCLUDED.source_responsible_user_id,
        source_rule_type = EXCLUDED.source_rule_type,
        survey_method = EXCLUDED.survey_method,
        recommendation_reason = EXCLUDED.recommendation_reason,
        route_evidence = EXCLUDED.route_evidence,
        warnings = EXCLUDED.warnings,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id INTO persisted_plan_id;

      FOR assignment_item IN
        SELECT value FROM jsonb_array_elements(p_assignments)
        WHERE (value->>'target_id')::bigint = target_row.id
        ORDER BY value->>'measurement_date'
      LOOP
        IF plan_item->>'measurement_edit' = 'true' THEN
          affected_groups := affected_groups || jsonb_build_array(jsonb_build_object(
            'date', assignment_item->>'measurement_date',
            'userId', (SELECT original.assignee_user_id
              FROM public.preliminary_survey_v2_measurement_assignments original
              WHERE original.plan_id = persisted_plan_id
                AND original.measurement_date = (assignment_item->>'measurement_date')::date)
          ));
          UPDATE public.preliminary_survey_v2_fixed_assignments fixed
          SET assignee_user_id = (assignment_item->>'assignee_user_id')::integer,
              confirmed_by_user_id = p_actor_user_id,
              confirmed_at = CURRENT_TIMESTAMP,
              confirmation_path = 'admin_override',
              source_fingerprint = p_source_fingerprint,
              source_snapshot = jsonb_build_object('plannerRunId', p_planner_run_id,
                'before', fixed.assignee_user_id, 'after', (assignment_item->>'assignee_user_id')::integer,
                'reason', p_override_reason,
                'nonParticipantConfirmed', NOT EXISTS (
                  SELECT 1 FROM jsonb_array_elements(plan_item->'actual_measurement_team') actual_day
                  WHERE actual_day->>'date' = assignment_item->>'measurement_date'
                    AND actual_day->'collaboratorUserIds' @> jsonb_build_array((assignment_item->>'assignee_user_id')::integer))),
              updated_at = CURRENT_TIMESTAMP
          WHERE fixed.measurement_target_business_id = target_row.id
            AND fixed.measurement_date = (assignment_item->>'measurement_date')::date;
        END IF;
        INSERT INTO public.preliminary_survey_v2_measurement_assignments (
          plan_id, measurement_date, assignee_user_id, survey_code,
          public_sample_code, assignment_reason
        ) VALUES (
          persisted_plan_id,
          (assignment_item->>'measurement_date')::date,
          (assignment_item->>'assignee_user_id')::integer,
          assignment_item->>'survey_code',
          assignment_item->>'public_sample_code',
          'fixed-assignee reverse planner'
        )
        ON CONFLICT (plan_id, measurement_date) DO UPDATE SET
          assignee_user_id = EXCLUDED.assignee_user_id,
          survey_code = EXCLUDED.survey_code,
          public_sample_code = EXCLUDED.public_sample_code,
          assignment_reason = EXCLUDED.assignment_reason,
          updated_at = CURRENT_TIMESTAMP;
        affected_groups := affected_groups || jsonb_build_array(jsonb_build_object(
          'date', assignment_item->>'measurement_date',
          'userId', assignment_item->>'assignee_user_id'
        ));
      END LOOP;
      applied_count := applied_count + 1;
    END IF;

    INSERT INTO public.preliminary_survey_v2_planner_audit (
      planner_run_id, event_type, target_id, measurement_date,
      before_snapshot, after_snapshot, decision, mutation_intent,
      warnings, override_reason, source_fingerprint, canonical_sha,
      planner_version, actor_user_id
    ) VALUES (
      p_planner_run_id,
      CASE WHEN p_override_reason IS NULL THEN 'APPLY' ELSE 'MANUAL_OVERRIDE' END,
      target_row.id,
      public.preliminary_survey_v2_first_measurement_date(target_row.measurement_date, target_row.daily_staff),
      COALESCE(plan_item->'before_snapshot', '{}'::jsonb),
      plan_item,
      COALESCE(plan_item->>'decision', 'AUTO_ASSIGNED'),
      plan_item->>'mutation',
      COALESCE(plan_item->'warnings', '[]'::jsonb),
      p_override_reason,
      p_source_fingerprint,
      p_canonical_sha,
      p_planner_version,
      p_actor_user_id
    );
  END LOOP;

  WITH affected AS (
    SELECT DISTINCT
      (item->>'date')::date AS measurement_date,
      (item->>'userId')::integer AS assignee_user_id
    FROM jsonb_array_elements(affected_groups) item
  ), group_members AS (
    SELECT assignment.id AS assignment_id, plan.measurement_target_business_id AS target_id,
      assignment.measurement_date, assignment.assignee_user_id
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    JOIN public.preliminary_survey_v2_plans plan ON plan.id = assignment.plan_id
    JOIN public.measurement_target_business member_target
      ON member_target.id = plan.measurement_target_business_id
    JOIN affected ON affected.measurement_date = assignment.measurement_date
      AND affected.assignee_user_id = assignment.assignee_user_id
    WHERE NOT EXISTS (SELECT 1 FROM unnest(
      public.preliminary_survey_v2_actual_measurement_dates(member_target)) actual_day
      WHERE actual_day >= DATE '2026-09-01')
      OR assignment.measurement_date = ANY(
        public.preliminary_survey_v2_actual_measurement_dates(member_target))
    UNION ALL
    SELECT NULL::uuid, fixed.measurement_target_business_id, fixed.measurement_date, fixed.assignee_user_id
    FROM public.preliminary_survey_v2_fixed_assignments fixed
    JOIN public.measurement_target_business fixed_target
      ON fixed_target.id = fixed.measurement_target_business_id
    JOIN affected ON affected.measurement_date = fixed.measurement_date
      AND affected.assignee_user_id = fixed.assignee_user_id
    WHERE (NOT EXISTS (SELECT 1 FROM unnest(
      public.preliminary_survey_v2_actual_measurement_dates(fixed_target)) actual_day
      WHERE actual_day >= DATE '2026-09-01')
      OR fixed.measurement_date = ANY(
        public.preliminary_survey_v2_actual_measurement_dates(fixed_target)))
      AND NOT EXISTS (
      SELECT 1 FROM public.preliminary_survey_v2_measurement_assignments assignment
      JOIN public.preliminary_survey_v2_plans plan ON plan.id = assignment.plan_id
      WHERE plan.measurement_target_business_id = fixed.measurement_target_business_id
        AND assignment.measurement_date = fixed.measurement_date
    )
  ), ranked AS (
    SELECT member.assignment_id AS id, upper(btrim(base_user.survey_code)) AS base_code,
      row_number() OVER (PARTITION BY member.measurement_date, member.assignee_user_id
        ORDER BY target.code, target.id) AS position
    FROM group_members member
    JOIN public.users base_user ON base_user.id = member.assignee_user_id
    JOIN public.measurement_target_business target ON target.id = member.target_id
  )
  UPDATE public.preliminary_survey_v2_measurement_assignments assignment
  SET public_sample_code = repeat(ranked.base_code, ranked.position::integer),
      updated_at = CURRENT_TIMESTAMP
  FROM ranked
  WHERE assignment.id = ranked.id
    AND assignment.public_sample_code IS DISTINCT FROM repeat(ranked.base_code, ranked.position::integer);

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_assignments) expected
    JOIN public.preliminary_survey_v2_plans plan
      ON plan.measurement_target_business_id = (expected->>'target_id')::bigint
    JOIN public.preliminary_survey_v2_measurement_assignments assignment
      ON assignment.plan_id = plan.id
     AND assignment.measurement_date = (expected->>'measurement_date')::date
    WHERE assignment.public_sample_code IS DISTINCT FROM expected->>'public_sample_code'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'PUBLIC_SAMPLE_PREVIEW_MISMATCH';
  END IF;

  FOR plan_item IN SELECT value FROM jsonb_array_elements(p_plans)
    WHERE value->>'measurement_edit' = 'true'
  LOOP
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'targetId', (source_row->>'targetId')::bigint,
      'businessCode', target.code,
      'measurementDate', source_row->>'measurementDate',
      'beforeAssigneeUserId', (source_row->>'assigneeUserId')::integer,
      'afterAssigneeUserId', assignment.assignee_user_id,
      'beforeCode', COALESCE(source_row->>'publicSampleCode', source_row->>'surveyCode'),
      'afterCode', assignment.public_sample_code)
      ORDER BY (source_row->>'targetId')::bigint, source_row->>'measurementDate'), '[]'::jsonb)
    INTO actual_public_impacts
    FROM jsonb_array_elements(plan_item->'source_public_assignment_versions') source_row
    JOIN public.preliminary_survey_v2_plans source_plan
      ON source_plan.measurement_target_business_id = (source_row->>'targetId')::bigint
    JOIN public.preliminary_survey_v2_measurement_assignments assignment
      ON assignment.plan_id = source_plan.id
     AND assignment.measurement_date = (source_row->>'measurementDate')::date
    JOIN public.measurement_target_business target ON target.id = source_plan.measurement_target_business_id
    WHERE (source_row->>'assigneeUserId')::integer IS DISTINCT FROM assignment.assignee_user_id
      OR COALESCE(source_row->>'publicSampleCode', source_row->>'surveyCode')
        IS DISTINCT FROM assignment.public_sample_code;
    IF actual_public_impacts IS DISTINCT FROM (
      SELECT COALESCE(jsonb_agg(value ORDER BY (value->>'targetId')::bigint, value->>'measurementDate'), '[]'::jsonb)
      FROM jsonb_array_elements(plan_item->'public_code_impacts') impact(value)
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'PUBLIC_SAMPLE_PREVIEW_MISMATCH';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(actual_public_impacts) impact
      JOIN public.preliminary_survey_v2_plans impacted_plan
        ON impacted_plan.measurement_target_business_id = (impact->>'targetId')::bigint
      JOIN public.measurement_target_business impacted_target
        ON impacted_target.id = impacted_plan.measurement_target_business_id
      WHERE public.preliminary_survey_v2_first_measurement_date(impacted_target.measurement_date, impacted_target.daily_staff) < DATE '2026-09-01'
        OR EXISTS (SELECT 1 FROM public.preliminary_survey_v2_legacy_reconciliation history
          WHERE history.applied_plan_id = impacted_plan.id)
        OR EXISTS (SELECT 1 FROM public.preliminary_survey_v2_history_recovery_audit history
          WHERE history.created_plan_id = impacted_plan.id)) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PROTECTED_PUBLIC_SAMPLE_IMPACT';
    END IF;
    FOR impact_item IN SELECT value FROM jsonb_array_elements(actual_public_impacts)
      WHERE (value->>'targetId')::bigint <> (plan_item->>'target_id')::bigint
    LOOP
      INSERT INTO public.preliminary_survey_v2_planner_audit (
        planner_run_id, event_type, target_id, measurement_date,
        before_snapshot, after_snapshot, decision, mutation_intent,
        warnings, override_reason, source_fingerprint, canonical_sha,
        planner_version, actor_user_id
      ) VALUES (
        p_planner_run_id, 'MANUAL_OVERRIDE', (impact_item->>'targetId')::bigint,
        (impact_item->>'measurementDate')::date,
        jsonb_build_object('assigneeUserId', impact_item->'beforeAssigneeUserId',
          'publicSampleCode', impact_item->'beforeCode'),
        jsonb_build_object('measurement_edit_impact', true,
          'sourceTargetId', plan_item->'target_id',
          'assigneeUserId', impact_item->'afterAssigneeUserId',
          'publicSampleCode', impact_item->'afterCode'),
        'MANUAL_OVERRIDE', 'NONE', '[]'::jsonb, p_override_reason,
        p_source_fingerprint, p_canonical_sha, p_planner_version, p_actor_user_id
      );
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'appliedCount', applied_count,
    'plannerRunId', p_planner_run_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.preliminary_survey_v2_actual_measurement_dates(public.measurement_target_business)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.apply_preliminary_survey_v2_reverse_planner(
  uuid, text, text, text, jsonb, jsonb, integer, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_preliminary_survey_v2_reverse_planner(
  uuid, text, text, text, jsonb, jsonb, integer, text
) TO service_role;

-- An assignment is current when its date belongs to the target's actual measurement dates.
-- Targets entirely before September retain their existing assignment behavior.
CREATE OR REPLACE FUNCTION public.preliminary_survey_v2_assignment_is_current(
  p_target_id bigint, p_assignment_date date
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $current_assignment$
  SELECT COALESCE((
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM unnest(public.preliminary_survey_v2_actual_measurement_dates(target_row)) actual_day
      WHERE actual_day >= DATE '2026-09-01'
    ) THEN p_assignment_date = ANY(public.preliminary_survey_v2_actual_measurement_dates(target_row))
    ELSE true END
    FROM public.measurement_target_business target_row
    WHERE target_row.id = p_target_id
  ), false);
$current_assignment$;

CREATE OR REPLACE FUNCTION public.persist_preliminary_survey_v2_plan_and_measurement_assignments(
  p_plans jsonb,
  p_assignments jsonb,
  p_assignment_baseline jsonb,
  p_approve_third_assignment boolean DEFAULT false,
  p_approved_by_user_id integer DEFAULT NULL
) RETURNS SETOF public.preliminary_survey_v2_plans
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  assignment_item jsonb;
  plan_item jsonb;
  business_row public.measurement_target_business;
  configured_survey_code text;
  legacy_plans jsonb;
  expected_measurement_dates text[];
  current_assignment_baseline jsonb;
  hard_max_exceeded boolean;
  new_approval_required boolean;
BEGIN
  IF p_plans IS NULL OR jsonb_typeof(p_plans) <> 'array' OR jsonb_array_length(p_plans) = 0
     OR p_assignments IS NULL OR jsonb_typeof(p_assignments) <> 'array'
     OR p_assignment_baseline IS NULL OR jsonb_typeof(p_assignment_baseline) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PLAN_ASSIGNMENT_PAYLOAD';
  END IF;
  IF p_approve_third_assignment AND NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_approved_by_user_id
      AND (role = '관리자' OR is_preliminary_survey_manager IS TRUE)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_ASSIGNMENT_APPROVER';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_assignments) assignment_payload
    GROUP BY assignment_payload->>'measurement_target_business_id', assignment_payload->>'measurement_date'
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DUPLICATE_MEASUREMENT_ASSIGNMENT';
  END IF;

  FOR assignment_item IN
    SELECT DISTINCT jsonb_build_object('measurement_date', value->>'measurement_date')
    FROM jsonb_array_elements(p_assignments)
    ORDER BY jsonb_build_object('measurement_date', value->>'measurement_date')
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'preliminary-measurement-assignment|' || COALESCE(assignment_item->>'measurement_date', ''), 0));
  END LOOP;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'targetId', existing_plan.measurement_target_business_id,
      'measurementDate', existing_assignment.measurement_date::text,
      'userId', existing_assignment.assignee_user_id
    ) ORDER BY existing_plan.measurement_target_business_id,
      existing_assignment.measurement_date, existing_assignment.assignee_user_id), '[]'::jsonb)
  INTO current_assignment_baseline
  FROM public.preliminary_survey_v2_measurement_assignments existing_assignment
  JOIN public.preliminary_survey_v2_plans existing_plan ON existing_plan.id = existing_assignment.plan_id
  WHERE public.preliminary_survey_v2_assignment_is_current(existing_plan.measurement_target_business_id, existing_assignment.measurement_date)
    AND existing_assignment.measurement_date IN (
    SELECT DISTINCT (assignment_payload->>'measurement_date')::date
    FROM jsonb_array_elements(p_assignments) assignment_payload
  ) AND existing_plan.measurement_target_business_id NOT IN (
    SELECT DISTINCT (plan_payload->>'measurement_target_business_id')::bigint
    FROM jsonb_array_elements(p_plans) plan_payload
  );
  IF current_assignment_baseline IS DISTINCT FROM p_assignment_baseline THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DRAFT_ASSIGNMENT_BASELINE_CHANGED';
  END IF;

  FOR plan_item IN SELECT value FROM jsonb_array_elements(p_plans) LOOP
    IF (plan_item->>'measurement_target_business_id') IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PLAN_BUSINESS_ID_REQUIRED';
    END IF;
    SELECT * INTO business_row
    FROM public.measurement_target_business target_business
    WHERE target_business.id = (plan_item->>'measurement_target_business_id')::bigint
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'TARGET_NOT_FOUND';
    END IF;
    IF (plan_item->>'source_address') IS DISTINCT FROM business_row.address
       OR COALESCE(plan_item->'source_daily_staff', 'null'::jsonb)
          IS DISTINCT FROM COALESCE(business_row.daily_staff, 'null'::jsonb)
       OR (plan_item->>'source_collaborators') IS DISTINCT FROM business_row.collaborators THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DRAFT_SOURCE_CONTEXT_CHANGED';
    END IF;
    IF business_row.measurement_end_date IS NOT NULL
       AND business_row.measurement_end_date::date <> business_row.measurement_date::date THEN
      IF business_row.daily_staff IS NULL OR jsonb_typeof(business_row.daily_staff) <> 'array' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_DAILY_STAFF_INCOMPLETE';
      END IF;
      SELECT array_agg(DISTINCT day_payload->>'date' ORDER BY day_payload->>'date')
      INTO expected_measurement_dates
      FROM jsonb_array_elements(business_row.daily_staff) day_payload
      WHERE day_payload->>'date' ~ '^\d{4}-\d{2}-\d{2}$';
      IF cardinality(expected_measurement_dates) < 2
         OR expected_measurement_dates[1] <> business_row.measurement_date::text
         OR expected_measurement_dates[cardinality(expected_measurement_dates)] <> business_row.measurement_end_date::text
         OR cardinality(expected_measurement_dates) <> jsonb_array_length(business_row.daily_staff) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_DAILY_STAFF_INCOMPLETE';
      END IF;
    ELSE
      expected_measurement_dates := ARRAY[business_row.measurement_date::text];
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_assignments) assignment_payload
      WHERE (assignment_payload->>'measurement_target_business_id')::bigint = business_row.id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PLAN_MEASUREMENT_ASSIGNMENT_REQUIRED';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_assignments) assignment_payload
      WHERE (assignment_payload->>'measurement_target_business_id')::bigint = business_row.id
        AND NOT (assignment_payload->>'measurement_date' = ANY(expected_measurement_dates))
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_DATE_MISMATCH';
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(expected_measurement_dates) expected_date
      WHERE NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_assignments) assignment_payload
        WHERE (assignment_payload->>'measurement_target_business_id')::bigint = business_row.id
          AND assignment_payload->>'measurement_date' = expected_date
      )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_DAILY_STAFF_INCOMPLETE';
    END IF;
  END LOOP;

  FOR assignment_item IN SELECT value FROM jsonb_array_elements(p_assignments) LOOP
    IF (assignment_item->>'measurement_target_business_id') IS NULL
       OR (assignment_item->>'measurement_date') IS NULL
       OR (assignment_item->>'assignee_user_id') IS NULL
       OR (assignment_item->>'survey_code') NOT IN ('A', 'B', 'C', 'D', 'F', 'G')
       OR btrim(COALESCE(assignment_item->>'assignment_reason', '')) = '' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_MEASUREMENT_ASSIGNMENT_PAYLOAD';
    END IF;
    SELECT upper(btrim(COALESCE(survey_code, '')))
    INTO configured_survey_code
    FROM public.users
    WHERE id = (assignment_item->>'assignee_user_id')::integer
      AND is_active IS NOT FALSE;
    IF configured_survey_code NOT IN ('A', 'B', 'C', 'D', 'F', 'G')
       OR configured_survey_code <> assignment_item->>'survey_code' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_SURVEY_CODE_MISMATCH';
    END IF;
  END LOOP;

  -- 이 apply가 생성·변경하는 그룹만 계산한다. unrelated legacy 4건 그룹은 차단하지 않는다.
  WITH proposed_keys AS (
    SELECT DISTINCT (assignment_payload->>'measurement_date')::date AS measurement_date,
      (assignment_payload->>'assignee_user_id')::integer AS assignee_user_id
    FROM jsonb_array_elements(p_assignments) assignment_payload
  ), final_rows AS (
    SELECT existing_plan.measurement_target_business_id AS target_id,
      existing_assignment.measurement_date, existing_assignment.assignee_user_id
    FROM public.preliminary_survey_v2_measurement_assignments existing_assignment
    JOIN public.preliminary_survey_v2_plans existing_plan ON existing_plan.id = existing_assignment.plan_id
    JOIN proposed_keys USING (measurement_date, assignee_user_id)
    WHERE public.preliminary_survey_v2_assignment_is_current(existing_plan.measurement_target_business_id, existing_assignment.measurement_date)
      AND existing_plan.measurement_target_business_id NOT IN (
      SELECT DISTINCT (plan_payload->>'measurement_target_business_id')::bigint
      FROM jsonb_array_elements(p_plans) plan_payload
    )
    UNION ALL
    SELECT (assignment_payload->>'measurement_target_business_id')::bigint,
      (assignment_payload->>'measurement_date')::date,
      (assignment_payload->>'assignee_user_id')::integer
    FROM jsonb_array_elements(p_assignments) assignment_payload
  ), grouped AS (
    SELECT measurement_date, assignee_user_id, count(*) AS assignment_count,
      md5(measurement_date::text || '|' || assignee_user_id::text || '|' ||
        string_agg(target_id::text, ',' ORDER BY target_id)) AS fingerprint
    FROM final_rows
    GROUP BY measurement_date, assignee_user_id
  )
  SELECT COALESCE(bool_or(grouped.assignment_count > 3), false),
    COALESCE(bool_or(grouped.assignment_count = 3 AND NOT EXISTS (
      SELECT 1
      FROM public.preliminary_survey_v2_measurement_assignments approved_assignment
      WHERE approved_assignment.approval_required IS TRUE
        AND approved_assignment.approval_group_fingerprint = grouped.fingerprint
        AND approved_assignment.approved_by_user_id IS NOT NULL
        AND approved_assignment.approved_at IS NOT NULL
    )), false)
  INTO hard_max_exceeded, new_approval_required
  FROM grouped;

  IF hard_max_exceeded THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_HARD_MAX_EXCEEDED';
  END IF;
  IF new_approval_required AND (
    p_approve_third_assignment IS NOT TRUE OR p_approved_by_user_id IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_APPROVAL_REQUIRED';
  END IF;

  -- Confirmed plans and protected stale rows require a separate reviewed correction.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_plans) plan_payload
    JOIN public.measurement_target_business target_business
      ON target_business.id = (plan_payload->>'measurement_target_business_id')::bigint
    WHERE EXISTS (SELECT 1 FROM unnest(public.preliminary_survey_v2_actual_measurement_dates(target_business)) day_date
      WHERE day_date >= DATE '2026-09-01')
      AND public.is_preliminary_survey_v2_true_confirmed(target_business.id)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TRUE_CONFIRMED_PLAN_PROTECTED';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.preliminary_survey_v2_measurement_assignments old_assignment
    JOIN public.preliminary_survey_v2_plans old_plan ON old_plan.id = old_assignment.plan_id
    JOIN public.measurement_target_business target_business
      ON target_business.id = old_plan.measurement_target_business_id
    WHERE old_plan.measurement_target_business_id IN (
      SELECT (plan_payload->>'measurement_target_business_id')::bigint
      FROM jsonb_array_elements(p_plans) plan_payload)
      AND EXISTS (SELECT 1 FROM unnest(public.preliminary_survey_v2_actual_measurement_dates(target_business)) day_date
        WHERE day_date >= DATE '2026-09-01')
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_assignments) proposal
        WHERE (proposal->>'measurement_target_business_id')::bigint = target_business.id
          AND (proposal->>'measurement_date')::date = old_assignment.measurement_date)
      AND (old_assignment.measurement_date < DATE '2026-09-01'
        OR EXISTS (SELECT 1 FROM public.preliminary_survey_v2_fixed_assignments fixed
          WHERE fixed.measurement_target_business_id = target_business.id
            AND fixed.measurement_date = old_assignment.measurement_date)
        OR EXISTS (SELECT 1 FROM public.preliminary_survey_v2_legacy_reconciliation legacy
          WHERE legacy.applied_plan_id = old_plan.id)
        OR EXISTS (SELECT 1 FROM public.preliminary_survey_v2_history_recovery_audit history
          WHERE history.created_plan_id = old_plan.id)
        OR EXISTS (SELECT 1
          FROM public.preliminary_survey_v2_measurement_assignments peer
          JOIN public.preliminary_survey_v2_plans peer_plan ON peer_plan.id = peer.plan_id
          WHERE peer.measurement_date = old_assignment.measurement_date
            AND peer.assignee_user_id = old_assignment.assignee_user_id
            AND peer.id <> old_assignment.id
            AND (public.is_preliminary_survey_v2_true_confirmed(peer_plan.measurement_target_business_id)
              OR EXISTS (SELECT 1 FROM public.preliminary_survey_v2_fixed_assignments fixed
                WHERE fixed.measurement_target_business_id = peer_plan.measurement_target_business_id
                  AND fixed.measurement_date = peer.measurement_date)
              OR EXISTS (SELECT 1 FROM public.preliminary_survey_v2_legacy_reconciliation legacy
                WHERE legacy.applied_plan_id = peer_plan.id)
              OR EXISTS (SELECT 1 FROM public.preliminary_survey_v2_history_recovery_audit history
                WHERE history.created_plan_id = peer_plan.id))))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'STALE_ASSIGNMENT_PROTECTED';
  END IF;

  SELECT jsonb_agg(
    plan_payload || jsonb_build_object('target' || '_id', plan_payload->'measurement_target_business_id')
  )
  INTO legacy_plans
  FROM jsonb_array_elements(p_plans) plan_payload;

  RETURN QUERY
  SELECT * FROM public.persist_preliminary_survey_v2_plan_batch_unlocked(legacy_plans);

  DELETE FROM public.preliminary_survey_v2_measurement_assignments existing_assignment
  USING public.preliminary_survey_v2_plans target_plan
  WHERE existing_assignment.plan_id = target_plan.id
    AND target_plan.measurement_target_business_id IN (
      SELECT (plan_payload->>'measurement_target_business_id')::bigint
      FROM jsonb_array_elements(p_plans) plan_payload
    )
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_assignments) proposed_assignment
      WHERE (proposed_assignment->>'measurement_target_business_id')::bigint = target_plan.measurement_target_business_id
        AND proposed_assignment->>'measurement_date' = existing_assignment.measurement_date::text
    );

  -- 한 statement에서 최종 그룹과 기존 exact-group 승인을 계산해 모든 row를 CHECK-valid하게 쓴다.
  WITH proposed_rows AS (
    SELECT (assignment_payload->>'measurement_target_business_id')::bigint AS target_id,
      (assignment_payload->>'measurement_date')::date AS measurement_date,
      (assignment_payload->>'assignee_user_id')::integer AS assignee_user_id,
      assignment_payload->>'survey_code' AS survey_code,
      assignment_payload->>'assignment_reason' AS assignment_reason
    FROM jsonb_array_elements(p_assignments) assignment_payload
  ), proposed_keys AS (
    SELECT DISTINCT measurement_date, assignee_user_id FROM proposed_rows
  ), final_rows AS (
    SELECT existing_plan.measurement_target_business_id AS target_id,
      existing_assignment.measurement_date, existing_assignment.assignee_user_id,
      false AS is_proposed
    FROM public.preliminary_survey_v2_measurement_assignments existing_assignment
    JOIN public.preliminary_survey_v2_plans existing_plan ON existing_plan.id = existing_assignment.plan_id
    JOIN proposed_keys USING (measurement_date, assignee_user_id)
    WHERE public.preliminary_survey_v2_assignment_is_current(existing_plan.measurement_target_business_id, existing_assignment.measurement_date)
      AND existing_plan.measurement_target_business_id NOT IN (
      SELECT DISTINCT (plan_payload->>'measurement_target_business_id')::bigint
      FROM jsonb_array_elements(p_plans) plan_payload
    )
    UNION ALL
    SELECT target_id, measurement_date, assignee_user_id, true FROM proposed_rows
  ), grouped AS (
    SELECT measurement_date, assignee_user_id, count(*) AS assignment_count,
      md5(measurement_date::text || '|' || assignee_user_id::text || '|' ||
        string_agg(target_id::text, ',' ORDER BY target_id)) AS fingerprint
    FROM final_rows
    GROUP BY measurement_date, assignee_user_id
  ), ranked AS (
    SELECT final_row.*,
      grouped.assignment_count,
      grouped.fingerprint,
      row_number() OVER (
        PARTITION BY final_row.measurement_date, final_row.assignee_user_id
        ORDER BY final_row.target_id
      ) AS assignment_position
    FROM final_rows final_row
    JOIN grouped USING (measurement_date, assignee_user_id)
  ), prior_approvals AS (
    SELECT DISTINCT ON (approved_assignment.approval_group_fingerprint)
      approved_assignment.approval_group_fingerprint AS fingerprint,
      approved_assignment.approved_by_user_id,
      approved_assignment.approved_at
    FROM public.preliminary_survey_v2_measurement_assignments approved_assignment
    WHERE approved_assignment.approval_required IS TRUE
      AND approved_assignment.approval_group_fingerprint IS NOT NULL
      AND approved_assignment.approved_by_user_id IS NOT NULL
      AND approved_assignment.approved_at IS NOT NULL
    ORDER BY approved_assignment.approval_group_fingerprint, approved_assignment.approved_at
  ), canonical_proposed AS (
    SELECT proposed_row.*, ranked.assignment_count, ranked.assignment_position, ranked.fingerprint,
      prior_approval.approved_by_user_id AS prior_approved_by_user_id,
      prior_approval.approved_at AS prior_approved_at
    FROM proposed_rows proposed_row
    JOIN ranked ON ranked.is_proposed
      AND ranked.target_id = proposed_row.target_id
      AND ranked.measurement_date = proposed_row.measurement_date
      AND ranked.assignee_user_id = proposed_row.assignee_user_id
    LEFT JOIN prior_approvals prior_approval ON prior_approval.fingerprint = ranked.fingerprint
  )
  INSERT INTO public.preliminary_survey_v2_measurement_assignments (
    plan_id, measurement_date, assignee_user_id, survey_code, assignment_reason,
    approval_required, approval_group_fingerprint, approved_by_user_id, approved_at
  )
  SELECT target_plan.id,
    canonical.measurement_date,
    canonical.assignee_user_id,
    canonical.survey_code,
    canonical.assignment_reason,
    canonical.assignment_count = 3 AND canonical.assignment_position = 3,
    CASE WHEN canonical.assignment_count = 3 AND canonical.assignment_position = 3
      THEN canonical.fingerprint ELSE NULL END,
    CASE WHEN canonical.assignment_count = 3 AND canonical.assignment_position = 3
      THEN COALESCE(canonical.prior_approved_by_user_id, p_approved_by_user_id) ELSE NULL END,
    CASE WHEN canonical.assignment_count = 3 AND canonical.assignment_position = 3
      THEN COALESCE(canonical.prior_approved_at, CURRENT_TIMESTAMP) ELSE NULL END
  FROM canonical_proposed canonical
  JOIN public.preliminary_survey_v2_plans target_plan
    ON target_plan.measurement_target_business_id = canonical.target_id
  ON CONFLICT (plan_id, measurement_date) DO UPDATE SET
    assignee_user_id = EXCLUDED.assignee_user_id,
    survey_code = EXCLUDED.survey_code,
    survey_code_source = EXCLUDED.survey_code_source,
    assignment_reason = EXCLUDED.assignment_reason,
    approval_required = EXCLUDED.approval_required,
    approval_group_fingerprint = EXCLUDED.approval_group_fingerprint,
    approved_by_user_id = EXCLUDED.approved_by_user_id,
    approved_at = EXCLUDED.approved_at,
    updated_at = CURRENT_TIMESTAMP;

  RETURN;
END;
$$;


CREATE OR REPLACE FUNCTION public.persist_preliminary_survey_v2_plan_and_assignment_groups(
  p_plans jsonb,
  p_assignments jsonb,
  p_assignment_baseline jsonb,
  p_approve_third_assignment boolean DEFAULT false,
  p_approved_by_user_id integer DEFAULT NULL
) RETURNS SETOF public.preliminary_survey_v2_plans
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  hard_max_exceeded boolean;
  new_approval_required boolean;
  affected_dates jsonb;
  old_affected_keys jsonb;
BEGIN
  IF p_plans IS NULL OR jsonb_typeof(p_plans) <> 'array' OR jsonb_array_length(p_plans) = 0
     OR p_assignments IS NULL OR jsonb_typeof(p_assignments) <> 'array'
     OR p_assignment_baseline IS NULL OR jsonb_typeof(p_assignment_baseline) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PLAN_ASSIGNMENT_PAYLOAD';
  END IF;

  -- 이전 날짜와 제안 날짜를 같은 namespace/정렬 순서로 잠근다.
  SELECT COALESCE(jsonb_agg(affected.measurement_date ORDER BY affected.measurement_date), '[]'::jsonb)
  INTO affected_dates
  FROM (
    SELECT DISTINCT (item->>'measurement_date')::date AS measurement_date
    FROM jsonb_array_elements(p_assignments) item
    UNION
    SELECT DISTINCT assignment.measurement_date
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
    WHERE target_plan.measurement_target_business_id IN (
      SELECT DISTINCT (item->>'measurement_target_business_id')::bigint
      FROM jsonb_array_elements(p_plans) item
    )
  ) affected;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'preliminary-measurement-assignment|' || lock_date::text, 0))
  FROM (
    SELECT value::text::date AS lock_date
    FROM jsonb_array_elements_text(affected_dates)
    ORDER BY lock_date
  ) dates;

  -- 잠금 뒤 현재 assignment에서 이번 target이 속한 이전 그룹을 캡처한다.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'measurement_date', affected.measurement_date,
    'assignee_user_id', affected.assignee_user_id
  ) ORDER BY affected.measurement_date, affected.assignee_user_id), '[]'::jsonb)
  INTO old_affected_keys
  FROM (
    SELECT DISTINCT assignment.measurement_date, assignment.assignee_user_id
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
    WHERE target_plan.measurement_target_business_id IN (
      SELECT DISTINCT (item->>'measurement_target_business_id')::bigint
      FROM jsonb_array_elements(p_plans) item
    )
  ) affected;

  -- 저장 전 최종 예상 상태: affected(old UNION proposed) 안의 기존 row에서
  -- 재적용 target을 제거한 뒤 proposed row를 더한다.
  WITH proposed_keys AS (
    SELECT DISTINCT (item->>'measurement_date')::date AS measurement_date,
      (item->>'assignee_user_id')::integer AS assignee_user_id
    FROM jsonb_array_elements(p_assignments) item
  ), affected_keys AS (
    SELECT (item->>'measurement_date')::date AS measurement_date,
      (item->>'assignee_user_id')::integer AS assignee_user_id
    FROM jsonb_array_elements(old_affected_keys) item
    UNION
    SELECT measurement_date, assignee_user_id FROM proposed_keys
  ), reapplied_targets AS (
    SELECT DISTINCT (item->>'measurement_target_business_id')::bigint AS target_id
    FROM jsonb_array_elements(p_plans) item
  ), final_rows AS (
    SELECT target_plan.measurement_target_business_id AS target_id,
      existing.measurement_date, existing.assignee_user_id
    FROM public.preliminary_survey_v2_measurement_assignments existing
    JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = existing.plan_id
    JOIN affected_keys USING (measurement_date, assignee_user_id)
    WHERE public.preliminary_survey_v2_assignment_is_current(target_plan.measurement_target_business_id, existing.measurement_date)
      AND NOT EXISTS (
      SELECT 1 FROM reapplied_targets reapplied
      WHERE reapplied.target_id = target_plan.measurement_target_business_id
    )
    UNION ALL
    SELECT (item->>'measurement_target_business_id')::bigint,
      (item->>'measurement_date')::date,
      (item->>'assignee_user_id')::integer
    FROM jsonb_array_elements(p_assignments) item
  ), grouped AS (
    SELECT measurement_date, assignee_user_id, count(*) AS assignment_count,
      md5(measurement_date::text || '|' || assignee_user_id::text || '|' ||
        string_agg(target_id::text, ',' ORDER BY target_id)) AS fingerprint
    FROM final_rows
    GROUP BY measurement_date, assignee_user_id
  )
  SELECT COALESCE(bool_or(grouped.assignment_count > 3), false),
    COALESCE(bool_or(grouped.assignment_count = 3 AND NOT EXISTS (
      SELECT 1
      FROM public.preliminary_survey_v2_measurement_assignments approved
      WHERE approved.approval_required IS TRUE
        AND approved.approval_group_fingerprint = grouped.fingerprint
        AND approved.approved_by_user_id IS NOT NULL
        AND approved.approved_at IS NOT NULL
    )), false)
  INTO hard_max_exceeded, new_approval_required
  FROM grouped;

  IF hard_max_exceeded THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_HARD_MAX_EXCEEDED';
  END IF;
  IF new_approval_required AND (
    p_approve_third_assignment IS NOT TRUE OR p_approved_by_user_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.users
      WHERE id = p_approved_by_user_id
        AND (role = '관리자' OR is_preliminary_survey_manager IS TRUE)
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_APPROVAL_REQUIRED';
  END IF;

  RETURN QUERY SELECT * FROM public.persist_preliminary_survey_v2_plan_and_measurement_assignments(
    p_plans,
    p_assignments,
    p_assignment_baseline,
    new_approval_required,
    CASE WHEN new_approval_required THEN p_approved_by_user_id ELSE NULL END
  );

  -- 저장 후에도 동일한 old/new 합집합을 최종 canonical group으로 정규화한다.
  WITH proposed_keys AS (
    SELECT DISTINCT (item->>'measurement_date')::date AS measurement_date,
      (item->>'assignee_user_id')::integer AS assignee_user_id
    FROM jsonb_array_elements(p_assignments) item
  ), affected_keys AS (
    SELECT (item->>'measurement_date')::date AS measurement_date,
      (item->>'assignee_user_id')::integer AS assignee_user_id
    FROM jsonb_array_elements(old_affected_keys) item
    UNION
    SELECT measurement_date, assignee_user_id FROM proposed_keys
  ), grouped AS (
    SELECT assignment.measurement_date, assignment.assignee_user_id, count(*) AS assignment_count,
      md5(assignment.measurement_date::text || '|' || assignment.assignee_user_id::text || '|' ||
        string_agg(target_plan.measurement_target_business_id::text, ','
          ORDER BY target_plan.measurement_target_business_id)) AS fingerprint
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
    JOIN affected_keys USING (measurement_date, assignee_user_id)
    WHERE public.preliminary_survey_v2_assignment_is_current(target_plan.measurement_target_business_id, assignment.measurement_date)
    GROUP BY assignment.measurement_date, assignment.assignee_user_id
  ), ranked AS (
    SELECT assignment.id, assignment.approval_group_fingerprint AS previous_fingerprint,
      assignment.approved_by_user_id AS previous_approver,
      assignment.approved_at AS previous_approved_at,
      grouped.assignment_count,
      row_number() OVER (
        PARTITION BY assignment.measurement_date, assignment.assignee_user_id
        ORDER BY target_plan.measurement_target_business_id
      ) AS assignment_position,
      grouped.fingerprint
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
    JOIN grouped USING (measurement_date, assignee_user_id)
    WHERE public.preliminary_survey_v2_assignment_is_current(target_plan.measurement_target_business_id, assignment.measurement_date)
  )
  UPDATE public.preliminary_survey_v2_measurement_assignments assignment
  SET approval_required = ranked.assignment_count = 3 AND ranked.assignment_position = 3,
    approval_group_fingerprint = CASE
      WHEN ranked.assignment_count = 3 AND ranked.assignment_position = 3 THEN ranked.fingerprint ELSE NULL END,
    approved_by_user_id = CASE
      WHEN ranked.assignment_count <> 3 OR ranked.assignment_position <> 3 THEN NULL
      WHEN ranked.previous_fingerprint = ranked.fingerprint AND ranked.previous_approver IS NOT NULL
        THEN ranked.previous_approver
      ELSE p_approved_by_user_id END,
    approved_at = CASE
      WHEN ranked.assignment_count <> 3 OR ranked.assignment_position <> 3 THEN NULL
      WHEN ranked.previous_fingerprint = ranked.fingerprint AND ranked.previous_approved_at IS NOT NULL
        THEN ranked.previous_approved_at
      ELSE CURRENT_TIMESTAMP END,
    updated_at = CURRENT_TIMESTAMP
  FROM ranked
  WHERE ranked.id = assignment.id;
END;
$$;


REVOKE ALL ON FUNCTION public.preliminary_survey_v2_assignment_is_current(bigint, date)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.persist_preliminary_survey_v2_plan_and_measurement_assignments(
  jsonb, jsonb, jsonb, boolean, integer
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.persist_preliminary_survey_v2_plan_and_assignment_groups(
  jsonb, jsonb, jsonb, boolean, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_preliminary_survey_v2_plan_and_assignment_groups(
  jsonb, jsonb, jsonb, boolean, integer
) TO service_role;

NOTIFY pgrst, 'reload schema';
