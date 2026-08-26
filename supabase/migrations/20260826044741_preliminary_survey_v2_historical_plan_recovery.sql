-- 2026-08-01~2026-08-26 true-confirmed 대상 중 V2 plan이 없는 행만
-- legacy 조사자와 현재 역사 정책으로 복원한다. 일반 true-confirmed guard는 유지한다.

CREATE TABLE IF NOT EXISTS public.preliminary_survey_v2_history_recovery_batches (
  batch_id uuid PRIMARY KEY,
  manifest_sha text NOT NULL CHECK (manifest_sha ~ '^[0-9a-f]{64}$'),
  context_hash text NOT NULL CHECK (context_hash ~ '^[0-9a-f]{64}$'),
  expected_scope integer NOT NULL CHECK (expected_scope >= 0),
  expected_plan_inserts integer NOT NULL CHECK (expected_plan_inserts >= 0),
  status text NOT NULL CHECK (status IN ('applied', 'rolled_back')),
  applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rolled_back_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.preliminary_survey_v2_history_recovery_audit (
  batch_id uuid NOT NULL REFERENCES public.preliminary_survey_v2_history_recovery_batches(batch_id),
  measurement_target_business_id bigint NOT NULL REFERENCES public.measurement_target_business(id),
  legacy_preliminary_survey_id bigint REFERENCES public.preliminary_survey(id),
  classification text NOT NULL,
  source_hash text NOT NULL DEFAULT '',
  target_hash text NOT NULL,
  manifest_row jsonb NOT NULL,
  plan_before jsonb,
  plan_after jsonb,
  created_plan_id uuid REFERENCES public.preliminary_survey_v2_plans(id) ON DELETE SET NULL,
  rolled_back_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (batch_id, measurement_target_business_id)
);

ALTER TABLE public.preliminary_survey_v2_history_recovery_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.preliminary_survey_v2_history_recovery_audit ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_preliminary_survey_v2_history_audit_target
  ON public.preliminary_survey_v2_history_recovery_audit(measurement_target_business_id);
CREATE INDEX IF NOT EXISTS idx_preliminary_survey_v2_history_audit_legacy
  ON public.preliminary_survey_v2_history_recovery_audit(legacy_preliminary_survey_id);
CREATE INDEX IF NOT EXISTS idx_preliminary_survey_v2_history_audit_created_plan
  ON public.preliminary_survey_v2_history_recovery_audit(created_plan_id);
REVOKE ALL ON TABLE public.preliminary_survey_v2_history_recovery_batches FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.preliminary_survey_v2_history_recovery_audit FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.preliminary_survey_v2_history_recovery_batches FROM service_role;
REVOKE ALL ON TABLE public.preliminary_survey_v2_history_recovery_audit FROM service_role;
GRANT SELECT ON TABLE public.preliminary_survey_v2_history_recovery_batches TO service_role;
GRANT SELECT ON TABLE public.preliminary_survey_v2_history_recovery_audit TO service_role;

CREATE OR REPLACE FUNCTION public.preliminary_survey_v2_history_source_hash(p_legacy_id bigint)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT encode(extensions.digest(convert_to(jsonb_build_array(
    source.id, source.code, source.year, source.period, source.measurement_date,
    source.preliminary_surveyor, source.updated_at
  )::text, 'UTF8'), 'sha256'), 'hex')
  FROM public.preliminary_survey source
  WHERE source.id = p_legacy_id;
$$;

CREATE OR REPLACE FUNCTION public.preliminary_survey_v2_history_target_hash(p_target_id bigint)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT encode(extensions.digest(convert_to(jsonb_build_array(
    target.id, target.code, target.year, target.period, target.measurement_date,
    target.business_type, target.preliminary_survey_rule_type,
    target.process_changed, target.updated_at
  )::text, 'UTF8'), 'sha256'), 'hex')
  FROM public.measurement_target_business target
  WHERE target.id = p_target_id;
$$;

CREATE OR REPLACE FUNCTION public.preliminary_survey_v2_history_context_hash()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT encode(extensions.digest(convert_to(jsonb_build_object(
    'plans', COALESCE((SELECT jsonb_agg(jsonb_build_array(
      plan.id, plan.measurement_target_business_id, plan.recommended_date,
      plan.responsible_user_id, plan.experienced_reviewer_id,
      plan.participant_user_ids, plan.participant_names, plan.status,
      plan.plan_origin, plan.survey_method, plan.updated_at
    ) ORDER BY plan.id) FROM public.preliminary_survey_v2_plans plan), '[]'::jsonb),
    'users', COALESCE((SELECT jsonb_agg(jsonb_build_array(
      user_row.id, user_row.name, user_row.is_active,
      user_row.is_preliminary_survey_experienced,
      user_row.is_preliminary_survey_support_assignable, user_row.updated_at
    ) ORDER BY user_row.id) FROM public.users user_row), '[]'::jsonb),
    'blocks', COALESCE((SELECT jsonb_agg(jsonb_build_array(
      block.id, block.user_id, block.start_date, block.end_date, block.updated_at
    ) ORDER BY block.id) FROM public.user_schedule_blocks block), '[]'::jsonb),
    'targets', COALESCE((SELECT jsonb_agg(jsonb_build_array(
      target.id, target.code, target.year, target.period, target.measurement_date,
      target.measurement_end_date, target.collaborators,
      target.daily_staff, target.business_type, target.preliminary_survey_rule_type,
      target.process_changed, target.updated_at
    ) ORDER BY target.id) FROM public.measurement_target_business target
      WHERE target.year = 2026), '[]'::jsonb),
    'legacy', COALESCE((SELECT jsonb_agg(jsonb_build_array(
      source.id, source.code, source.year, source.period, source.measurement_date,
      source.preliminary_surveyor, source.actual_measurer, source.updated_at
    ) ORDER BY source.id) FROM public.preliminary_survey source
      WHERE source.year = 2026), '[]'::jsonb),
    'journals', COALESCE((SELECT jsonb_agg(jsonb_build_array(
      journal.id, journal.code, journal.measurement_year,
      journal.measurement_period, journal.updated_at
    ) ORDER BY journal.id) FROM public.measurement_journal journal
      WHERE journal.measurement_year = 2026), '[]'::jsonb),
    'policy', COALESCE((SELECT jsonb_agg(to_jsonb(policy) ORDER BY policy.policy_key)
      FROM public.preliminary_survey_policy_settings policy), '[]'::jsonb)
  )::text, 'UTF8'), 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION public.preliminary_survey_v2_history_manifest_sha(p_manifest jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER
SET search_path = public AS $$
  SELECT encode(extensions.digest(convert_to(p_manifest::text, 'UTF8'), 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION public.preliminary_survey_v2_history_is_working_day(p_date date)
RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER
SET search_path = public AS $$
  SELECT extract(isodow FROM p_date) BETWEEN 1 AND 5
    AND p_date <> ALL(ARRAY[
      DATE '2026-01-01', DATE '2026-02-16', DATE '2026-02-17', DATE '2026-02-18',
      DATE '2026-03-01', DATE '2026-03-02', DATE '2026-05-05', DATE '2026-05-24',
      DATE '2026-05-25', DATE '2026-06-03', DATE '2026-06-06', DATE '2026-08-15',
      DATE '2026-08-17', DATE '2026-09-24', DATE '2026-09-25', DATE '2026-09-26',
      DATE '2026-10-03', DATE '2026-10-05', DATE '2026-10-09', DATE '2026-12-25'
    ]);
$$;

CREATE OR REPLACE FUNCTION public.preliminary_survey_v2_history_working_days_before(
  p_earlier date,
  p_later date
) RETURNS integer
LANGUAGE sql IMMUTABLE SECURITY INVOKER
SET search_path = public AS $$
  SELECT count(*)::integer
  FROM generate_series(p_earlier, p_later - 1, interval '1 day') day(value)
  WHERE public.preliminary_survey_v2_history_is_working_day(day.value::date);
$$;

CREATE OR REPLACE FUNCTION public.recover_preliminary_survey_v2_historical_plans(
  p_batch_id uuid,
  p_manifest jsonb,
  p_manifest_sha text,
  p_context_hash text,
  p_expected_scope integer,
  p_expected_plan_inserts integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  batch_row public.preliminary_survey_v2_history_recovery_batches%ROWTYPE;
  item jsonb;
  target_row public.measurement_target_business%ROWTYPE;
  source_row public.preliminary_survey%ROWTYPE;
  current_plan public.preliminary_survey_v2_plans%ROWTYPE;
  inserted_plan public.preliminary_survey_v2_plans%ROWTYPE;
  resolved_ids jsonb;
  resolved_names jsonb;
  resolved_count integer;
  expected_token_count integer;
  derived_responsible integer;
  derived_reviewer integer;
  actual_distance integer;
  inserted_count integer := 0;
  preserved_count integer := 0;
  unresolved_count integer := 0;
  protected_codes constant text[] := ARRAY[
    'H0399','H0524','H0288','H0528','H0348','H0126','H0281','H0260','H0063','H0077'
  ];
BEGIN
  IF p_batch_id IS NULL OR jsonb_typeof(p_manifest) <> 'array'
     OR p_expected_scope < 0 OR p_expected_plan_inserts < 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_HISTORY_RECOVERY_INPUT';
  END IF;
  IF public.preliminary_survey_v2_history_manifest_sha(p_manifest) IS DISTINCT FROM lower(p_manifest_sha) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'HISTORY_RECOVERY_MANIFEST_SHA_MISMATCH';
  END IF;

  SELECT * INTO batch_row FROM public.preliminary_survey_v2_history_recovery_batches
  WHERE batch_id = p_batch_id FOR UPDATE;
  IF batch_row.batch_id IS NOT NULL THEN
    IF batch_row.status <> 'applied' OR batch_row.manifest_sha <> lower(p_manifest_sha)
       OR batch_row.context_hash <> lower(p_context_hash)
       OR batch_row.expected_scope <> p_expected_scope
       OR batch_row.expected_plan_inserts <> p_expected_plan_inserts THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'STALE_HISTORY_RECOVERY_BATCH';
    END IF;
    IF (SELECT count(*) FROM public.preliminary_survey_v2_history_recovery_audit audit
        WHERE audit.batch_id = p_batch_id) <> p_expected_scope
       OR (SELECT count(*) FROM public.preliminary_survey_v2_history_recovery_audit audit
           JOIN public.preliminary_survey_v2_plans plan ON plan.id = audit.created_plan_id
           WHERE audit.batch_id = p_batch_id
             AND plan.recommendation_reason->>'batchId' = p_batch_id::text)
          <> p_expected_plan_inserts THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'HISTORY_RECOVERY_BATCH_STATE_CHANGED';
    END IF;
    RETURN jsonb_build_object('batchId', p_batch_id, 'manifestRows', p_expected_scope,
      'planInserted', 0, 'alreadyApplied', p_expected_scope, 'additionalChanges', 0);
  END IF;

  IF jsonb_array_length(p_manifest) <> p_expected_scope
     OR (SELECT count(DISTINCT (value->>'targetId')::bigint) FROM jsonb_array_elements(p_manifest)) <> p_expected_scope THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'HISTORY_RECOVERY_EXPECTED_SCOPE_MISMATCH';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_manifest) manifest(value)
      WHERE value->>'classification' = 'HISTORICAL_EXACT_RECOVERY') <> p_expected_plan_inserts THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'HISTORY_RECOVERY_EXPECTED_INSERT_MISMATCH';
  END IF;
  IF public.preliminary_survey_v2_history_context_hash() IS DISTINCT FROM lower(p_context_hash) THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'STALE_HISTORY_RECOVERY_CONTEXT';
  END IF;
  IF (SELECT count(*) FROM public.preliminary_survey_policy_settings
      WHERE policy_key = 'process_changed_preliminary_survey' AND enabled IS FALSE) <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'AUTOMATION_POLICY_MUST_REMAIN_OFF';
  END IF;
  IF (SELECT count(*) FROM public.measurement_target_business
      WHERE year = 2026 AND measurement_date >= '2026-08-01' AND measurement_date <= '2026-08-26') <> p_expected_scope THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'HISTORY_RECOVERY_TARGET_SCOPE_CHANGED';
  END IF;

  INSERT INTO public.preliminary_survey_v2_history_recovery_batches(
    batch_id, manifest_sha, context_hash, expected_scope, expected_plan_inserts, status
  ) VALUES (p_batch_id, lower(p_manifest_sha), lower(p_context_hash),
    p_expected_scope, p_expected_plan_inserts, 'applied');
  PERFORM set_config('app.preliminary_survey_admin_repair', 'on', true);

  FOR item IN SELECT value FROM jsonb_array_elements(p_manifest) manifest(value)
              ORDER BY value->>'measurementDate', (value->>'targetId')::bigint LOOP
    SELECT * INTO STRICT target_row FROM public.measurement_target_business
    WHERE id = (item->>'targetId')::bigint FOR UPDATE;
    IF target_row.measurement_date <> item->>'measurementDate'
       OR target_row.code <> item->>'code'
       OR target_row.year <> (item->>'year')::integer
       OR target_row.period <> item->>'period'
       OR item->>'contextHash' IS DISTINCT FROM lower(p_context_hash)
       OR public.preliminary_survey_v2_history_target_hash(target_row.id) <> item->>'targetHash' THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'STALE_HISTORY_RECOVERY_TARGET';
    END IF;
    IF item->>'classification' NOT IN (
      'EXISTING_V2_PRESERVED', 'HISTORICAL_EXACT_RECOVERY',
      'NO_VALID_HISTORICAL_DATE', 'AMBIGUOUS_LEGACY_SOURCE',
      'USER_MAPPING_CONFLICT', 'PROTECTED_PRESERVED'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_HISTORY_RECOVERY_CLASSIFICATION';
    END IF;

    current_plan := NULL;
    SELECT * INTO current_plan FROM public.preliminary_survey_v2_plans
    WHERE measurement_target_business_id = target_row.id FOR UPDATE;

    source_row := NULL;
    IF item->>'legacyPreliminarySurveyId' IS NOT NULL THEN
      SELECT * INTO STRICT source_row FROM public.preliminary_survey
      WHERE id = (item->>'legacyPreliminarySurveyId')::bigint FOR UPDATE;
      IF source_row.code <> target_row.code OR source_row.year <> target_row.year
         OR source_row.measurement_date::text <> target_row.measurement_date
         OR btrim(regexp_replace(source_row.period, '[[:space:]]*[(]수시[)][[:space:]]*$', ''))
            <> btrim(regexp_replace(target_row.period, '[[:space:]]*[(]수시[)][[:space:]]*$', ''))
         OR public.preliminary_survey_v2_history_source_hash(source_row.id) <> item->>'sourceHash' THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'STALE_HISTORY_RECOVERY_LEGACY_SOURCE';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM public.preliminary_survey duplicate
        WHERE duplicate.id <> source_row.id
          AND duplicate.code = source_row.code
          AND duplicate.year = source_row.year
          AND duplicate.measurement_date = source_row.measurement_date
          AND (
            btrim(duplicate.period) = btrim(source_row.period)
            OR (
              NOT EXISTS (
                SELECT 1 FROM public.preliminary_survey exact_source
                WHERE exact_source.code = source_row.code
                  AND exact_source.year = source_row.year
                  AND exact_source.measurement_date = source_row.measurement_date
                  AND btrim(exact_source.period) = btrim(target_row.period)
              )
              AND btrim(regexp_replace(duplicate.period, '[[:space:]]*[(]수시[)][[:space:]]*$', '')) =
                  btrim(regexp_replace(source_row.period, '[[:space:]]*[(]수시[)][[:space:]]*$', ''))
            )
          )
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'AMBIGUOUS_HISTORY_RECOVERY_LEGACY_SOURCE';
      END IF;
    END IF;

    IF item->>'classification' = 'EXISTING_V2_PRESERVED' THEN
      IF current_plan.id IS NULL OR current_plan.id::text <> item->>'existingPlanId' THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'EXISTING_HISTORY_PLAN_CHANGED';
      END IF;
      preserved_count := preserved_count + 1;
    ELSIF item->>'classification' = 'PROTECTED_PRESERVED' THEN
      IF current_plan.id IS NOT NULL OR NOT (target_row.code = ANY(protected_codes)) THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'PROTECTED_HISTORY_SCOPE_CHANGED';
      END IF;
      unresolved_count := unresolved_count + 1;
    ELSIF item->>'classification' = 'HISTORICAL_EXACT_RECOVERY' THEN
      IF current_plan.id IS NOT NULL OR source_row.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'HISTORY_RECOVERY_PLAN_GAP_CHANGED';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.measurement_journal journal
        WHERE journal.code = target_row.code AND journal.measurement_year = target_row.year
          AND btrim(regexp_replace(journal.measurement_period, '[[:space:]]*[(]수시[)][[:space:]]*$', '')) =
              btrim(regexp_replace(target_row.period, '[[:space:]]*[(]수시[)][[:space:]]*$', ''))) THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'HISTORY_RECOVERY_TRUE_CONFIRMED_CHANGED';
      END IF;

      SELECT count(*) INTO expected_token_count FROM regexp_split_to_table(
        COALESCE(source_row.preliminary_surveyor, ''), '[,|]') token WHERE btrim(token) <> '';
      SELECT count(*), jsonb_agg(user_row.id ORDER BY token.ordinality),
        jsonb_agg(btrim(token.name) ORDER BY token.ordinality)
      INTO resolved_count, resolved_ids, resolved_names
      FROM regexp_split_to_table(COALESCE(source_row.preliminary_surveyor, ''), '[,|]')
        WITH ORDINALITY token(name, ordinality)
      JOIN public.users user_row ON btrim(user_row.name) = btrim(token.name)
      WHERE btrim(token.name) <> '' AND user_row.is_active IS NOT FALSE;
      IF resolved_count <> expected_token_count OR resolved_count = 0
         OR resolved_ids IS DISTINCT FROM item->'participantUserIds'
         OR resolved_names IS DISTINCT FROM item->'participantNames' THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'HISTORY_RECOVERY_USER_MAPPING_CHANGED';
      END IF;
      SELECT user_row.id INTO derived_responsible
      FROM regexp_split_to_table(source_row.preliminary_surveyor, '[,|]')
        WITH ORDINALITY token(name, ordinality)
      JOIN public.users user_row ON btrim(user_row.name) = btrim(token.name)
      WHERE btrim(token.name) <> '' AND user_row.is_active IS NOT FALSE
      ORDER BY CASE WHEN user_row.is_preliminary_survey_experienced IS FALSE THEN 0 ELSE 1 END,
        token.ordinality LIMIT 1;
      SELECT user_row.id INTO derived_reviewer
      FROM regexp_split_to_table(source_row.preliminary_surveyor, '[,|]')
        WITH ORDINALITY token(name, ordinality)
      JOIN public.users user_row ON btrim(user_row.name) = btrim(token.name)
      WHERE btrim(token.name) <> '' AND user_row.id <> derived_responsible
        AND user_row.is_active IS NOT FALSE
        AND user_row.is_preliminary_survey_experienced IS TRUE
      ORDER BY user_row.id LIMIT 1;
      IF derived_responsible IS DISTINCT FROM (item->>'derivedResponsibleUserId')::integer
         OR derived_responsible IS DISTINCT FROM (item->>'sourceResponsibleUserId')::integer
         OR COALESCE(derived_reviewer, 0) IS DISTINCT FROM COALESCE((item->>'derivedReviewerUserId')::integer, 0) THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'HISTORY_RECOVERY_ROLE_DERIVATION_CHANGED';
      END IF;

      actual_distance := public.preliminary_survey_v2_history_working_days_before(
        (item->>'derivedPreliminaryDate')::date, target_row.measurement_date::date);
      IF actual_distance < 3 OR actual_distance > 25
         OR actual_distance <> (item->>'workingDaysBefore')::integer
         OR NOT public.preliminary_survey_v2_history_is_working_day((item->>'derivedPreliminaryDate')::date) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'HISTORY_RECOVERY_DATE_POLICY_MISMATCH';
      END IF;
      IF EXISTS (SELECT 1 FROM public.user_schedule_blocks block
        WHERE block.user_id IN (SELECT value::integer FROM jsonb_array_elements_text(item->'participantUserIds'))
          AND block.start_date <= (item->>'derivedPreliminaryDate')::date
          AND block.end_date >= (item->>'derivedPreliminaryDate')::date) THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'HISTORY_RECOVERY_SCHEDULE_CHANGED';
      END IF;
      IF (SELECT count(*) FROM public.preliminary_survey_v2_plans plan
          WHERE plan.status = 'recommended' AND plan.survey_method = 'phone'
            AND plan.recommended_date = (item->>'derivedPreliminaryDate')::date
            AND plan.responsible_user_id = derived_responsible) >= 3 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'HISTORY_RECOVERY_PHONE_CAPACITY_EXCEEDED';
      END IF;

      INSERT INTO public.preliminary_survey_v2_plans(
        measurement_target_business_id, recommended_date, responsible_user_id,
        experienced_reviewer_id, participant_user_ids, participant_names,
        status, plan_origin, source_measurement_date, source_responsible_user_id,
        source_rule_type, survey_method, recommendation_reason, route_evidence, warnings
      ) VALUES (
        target_row.id, (item->>'derivedPreliminaryDate')::date, derived_responsible,
        derived_reviewer, item->'participantUserIds', item->'participantNames',
        'recommended', 'manual', target_row.measurement_date::date, derived_responsible,
        'existing', 'phone', jsonb_build_object(
          'reason', 'HISTORICAL_REPLAY_2026_08_26',
          'dateSource', 'current_policy_historical_replay',
          'surveyorSource', 'legacy_preliminary_survey',
          'legacyPreliminarySurveyId', source_row.id,
          'batchId', p_batch_id
        ), '{}'::jsonb, '["LEGACY_HISTORICAL_REPLAY_2026_08_26"]'::jsonb
      ) RETURNING * INTO inserted_plan;
      inserted_count := inserted_count + 1;
    ELSE
      IF current_plan.id IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'UNRESOLVED_HISTORY_PLAN_CHANGED';
      END IF;
      unresolved_count := unresolved_count + 1;
    END IF;

    INSERT INTO public.preliminary_survey_v2_history_recovery_audit(
      batch_id, measurement_target_business_id, legacy_preliminary_survey_id,
      classification, source_hash, target_hash, manifest_row,
      plan_before, plan_after, created_plan_id
    ) VALUES (
      p_batch_id, target_row.id, source_row.id, item->>'classification',
      COALESCE(item->>'sourceHash', ''), item->>'targetHash', item,
      CASE WHEN current_plan.id IS NULL THEN NULL ELSE to_jsonb(current_plan) END,
      CASE WHEN inserted_plan.id IS NOT NULL THEN to_jsonb(inserted_plan)
           WHEN current_plan.id IS NOT NULL THEN to_jsonb(current_plan) ELSE NULL END,
      inserted_plan.id
    );
    inserted_plan := NULL;
  END LOOP;

  IF inserted_count <> p_expected_plan_inserts THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'HISTORY_RECOVERY_ACTUAL_INSERT_MISMATCH';
  END IF;
  RETURN jsonb_build_object('batchId', p_batch_id, 'manifestRows', p_expected_scope,
    'planInserted', inserted_count, 'preserved', preserved_count,
    'unresolved', unresolved_count, 'alreadyApplied', 0,
    'additionalChanges', inserted_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.rollback_preliminary_survey_v2_historical_plans(
  p_batch_id uuid,
  p_expected_plan_deletes integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  batch_row public.preliminary_survey_v2_history_recovery_batches%ROWTYPE;
  actual_count integer;
BEGIN
  SELECT * INTO STRICT batch_row FROM public.preliminary_survey_v2_history_recovery_batches
  WHERE batch_id = p_batch_id FOR UPDATE;
  IF batch_row.status <> 'applied' OR batch_row.expected_plan_inserts <> p_expected_plan_deletes THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'HISTORY_RECOVERY_ROLLBACK_BATCH_MISMATCH';
  END IF;
  SELECT count(*) INTO actual_count
  FROM public.preliminary_survey_v2_history_recovery_audit audit
  JOIN public.preliminary_survey_v2_plans plan ON plan.id = audit.created_plan_id
  WHERE audit.batch_id = p_batch_id
    AND plan.recommendation_reason->>'batchId' = p_batch_id::text;
  IF actual_count <> p_expected_plan_deletes THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'HISTORY_RECOVERY_ROLLBACK_STATE_CHANGED';
  END IF;
  PERFORM set_config('app.preliminary_survey_admin_repair', 'on', true);
  UPDATE public.preliminary_survey_v2_history_recovery_audit
  SET rolled_back_at = CURRENT_TIMESTAMP
  WHERE batch_id = p_batch_id AND created_plan_id IS NOT NULL;
  DELETE FROM public.preliminary_survey_v2_plans plan
  USING public.preliminary_survey_v2_history_recovery_audit audit
  WHERE audit.batch_id = p_batch_id AND audit.created_plan_id = plan.id
    AND plan.recommendation_reason->>'batchId' = p_batch_id::text;
  UPDATE public.preliminary_survey_v2_history_recovery_batches
  SET status = 'rolled_back', rolled_back_at = CURRENT_TIMESTAMP WHERE batch_id = p_batch_id;
  RETURN jsonb_build_object('batchId', p_batch_id, 'planDeleted', actual_count);
END;
$$;

ALTER FUNCTION public.preliminary_survey_v2_history_source_hash(bigint) OWNER TO postgres;
ALTER FUNCTION public.preliminary_survey_v2_history_target_hash(bigint) OWNER TO postgres;
ALTER FUNCTION public.preliminary_survey_v2_history_context_hash() OWNER TO postgres;
ALTER FUNCTION public.preliminary_survey_v2_history_manifest_sha(jsonb) OWNER TO postgres;
ALTER FUNCTION public.preliminary_survey_v2_history_is_working_day(date) OWNER TO postgres;
ALTER FUNCTION public.preliminary_survey_v2_history_working_days_before(date,date) OWNER TO postgres;
ALTER FUNCTION public.recover_preliminary_survey_v2_historical_plans(uuid,jsonb,text,text,integer,integer) OWNER TO postgres;
ALTER FUNCTION public.rollback_preliminary_survey_v2_historical_plans(uuid,integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.preliminary_survey_v2_history_source_hash(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preliminary_survey_v2_history_target_hash(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preliminary_survey_v2_history_context_hash() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preliminary_survey_v2_history_manifest_sha(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preliminary_survey_v2_history_is_working_day(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preliminary_survey_v2_history_working_days_before(date,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recover_preliminary_survey_v2_historical_plans(uuid,jsonb,text,text,integer,integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rollback_preliminary_survey_v2_historical_plans(uuid,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preliminary_survey_v2_history_source_hash(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.preliminary_survey_v2_history_target_hash(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.preliminary_survey_v2_history_context_hash() TO service_role;
GRANT EXECUTE ON FUNCTION public.preliminary_survey_v2_history_manifest_sha(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_preliminary_survey_v2_historical_plans(uuid,jsonb,text,text,integer,integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.rollback_preliminary_survey_v2_historical_plans(uuid,integer)
  TO service_role;

NOTIFY pgrst, 'reload schema';
