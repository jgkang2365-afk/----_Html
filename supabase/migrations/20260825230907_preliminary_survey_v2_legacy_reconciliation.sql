-- 2026 하반기 preliminary_survey 원문을 보존하고, 기존 정상 V2를 건드리지 않으면서
-- 정확히 역산 가능한 공시료 assignment gap만 원자적으로 복원한다.

ALTER TABLE public.preliminary_survey_v2_measurement_assignments
  ADD COLUMN IF NOT EXISTS assignment_origin text NOT NULL DEFAULT 'v2',
  ADD COLUMN IF NOT EXISTS legacy_preliminary_survey_id bigint
    REFERENCES public.preliminary_survey(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS legacy_measurer_snapshot text,
  ADD COLUMN IF NOT EXISTS legacy_survey_code_snapshot text,
  ADD COLUMN IF NOT EXISTS reconciliation_batch_id uuid;

ALTER TABLE public.preliminary_survey_v2_measurement_assignments
  DROP CONSTRAINT IF EXISTS preliminary_survey_v2_assignment_origin_check;
ALTER TABLE public.preliminary_survey_v2_measurement_assignments
  ADD CONSTRAINT preliminary_survey_v2_assignment_origin_check CHECK (
    (assignment_origin = 'v2' AND legacy_preliminary_survey_id IS NULL
      AND legacy_measurer_snapshot IS NULL AND legacy_survey_code_snapshot IS NULL
      AND reconciliation_batch_id IS NULL)
    OR
    (assignment_origin = 'legacy_reconciled' AND legacy_preliminary_survey_id IS NOT NULL
      AND btrim(COALESCE(legacy_measurer_snapshot, '')) <> ''
      AND btrim(COALESCE(legacy_survey_code_snapshot, '')) <> ''
      AND reconciliation_batch_id IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_preliminary_survey_v2_assignment_legacy_source
  ON public.preliminary_survey_v2_measurement_assignments(legacy_preliminary_survey_id)
  WHERE legacy_preliminary_survey_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.preliminary_survey_v2_legacy_reconciliation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  measurement_target_business_id bigint
    REFERENCES public.measurement_target_business(id) ON DELETE RESTRICT,
  legacy_preliminary_survey_id bigint NOT NULL
    REFERENCES public.preliminary_survey(id) ON DELETE RESTRICT,
  code text NOT NULL,
  measurement_year integer NOT NULL,
  measurement_period text NOT NULL,
  measurement_date date NOT NULL,
  legacy_preliminary_date date,
  legacy_preliminary_surveyor text,
  legacy_public_sample_measurer text,
  legacy_survey_code_raw text,
  legacy_actual_measurer text,
  legacy_report_writer text,
  matched_responsible_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  matched_public_sample_user_id integer REFERENCES public.users(id) ON DELETE RESTRICT,
  normalized_current_survey_code text,
  source_hash text NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  classification text NOT NULL CHECK (classification IN (
    'V2_ALREADY_AUTHORITATIVE', 'PLAN_AND_ASSIGNMENT_EXACT_RECOVERY',
    'PLAN_ONLY_EXACT_RECOVERY', 'ASSIGNMENT_ONLY_EXACT_RECOVERY',
    'SNAPSHOT_ONLY', 'NO_RECOVERABLE_SOURCE'
  )),
  applied_plan_id uuid REFERENCES public.preliminary_survey_v2_plans(id) ON DELETE RESTRICT,
  applied_assignment_id uuid
    REFERENCES public.preliminary_survey_v2_measurement_assignments(id) ON DELETE RESTRICT,
  reconciliation_status text NOT NULL CHECK (reconciliation_status IN (
    'existing_v2_preserved', 'assignment_applied', 'snapshot_only', 'no_recoverable_source', 'rolled_back'
  )),
  exclusion_reason text,
  source_snapshot jsonb NOT NULL,
  plan_before jsonb,
  plan_after jsonb,
  assignment_before jsonb,
  assignment_after jsonb,
  reconciled_at timestamptz,
  rolled_back_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_preliminary_survey_v2_legacy_reconciliation_source
    UNIQUE (legacy_preliminary_survey_id)
);

CREATE INDEX IF NOT EXISTS idx_preliminary_survey_v2_legacy_reconciliation_target_date
  ON public.preliminary_survey_v2_legacy_reconciliation(measurement_target_business_id, measurement_date);

ALTER TABLE public.preliminary_survey_v2_legacy_reconciliation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS preliminary_survey_v2_legacy_reconciliation_read
  ON public.preliminary_survey_v2_legacy_reconciliation;
CREATE POLICY preliminary_survey_v2_legacy_reconciliation_read
  ON public.preliminary_survey_v2_legacy_reconciliation FOR SELECT TO authenticated
  USING (true);

REVOKE ALL ON TABLE public.preliminary_survey_v2_legacy_reconciliation FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.preliminary_survey_v2_legacy_reconciliation TO authenticated;
GRANT ALL ON TABLE public.preliminary_survey_v2_legacy_reconciliation TO service_role;

CREATE OR REPLACE FUNCTION public.preliminary_survey_v2_legacy_source_hash(p_legacy_id bigint)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT encode(extensions.digest(convert_to(jsonb_build_array(
    survey.id, survey.code, survey.year, survey.period, survey.measurement_date,
    survey.date_details, survey.preliminary_surveyor, survey.measurer, survey.survey_code,
    survey.actual_measurer, survey.report_writer, survey.address,
    survey.sequence_number, survey.created_at, survey.updated_at
  )::text, 'UTF8'), 'sha256'), 'hex')
  FROM public.preliminary_survey survey
  WHERE survey.id = p_legacy_id;
$$;

CREATE OR REPLACE FUNCTION public.preliminary_survey_v2_legacy_manifest_sha(p_manifest jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER
SET search_path = public AS $$
  SELECT encode(extensions.digest(convert_to(p_manifest::text, 'UTF8'), 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION public.reconcile_preliminary_survey_v2_legacy_history(
  p_batch_id uuid,
  p_manifest jsonb,
  p_manifest_sha text,
  p_expected_rows integer,
  p_expected_assignment_inserts integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  item jsonb;
  legacy_row public.preliminary_survey%ROWTYPE;
  target_row public.measurement_target_business%ROWTYPE;
  plan_row public.preliminary_survey_v2_plans%ROWTYPE;
  existing_audit public.preliminary_survey_v2_legacy_reconciliation%ROWTYPE;
  inserted_assignment public.preliminary_survey_v2_measurement_assignments%ROWTYPE;
  resolved_target_count integer;
  assignment_count integer;
  group_count integer;
  matching_user_count integer;
  matched_user public.users%ROWTYPE;
  actual_source_hash text;
  actual_classification text;
  manifest_assignment_count integer;
  inserted_count integer := 0;
  snapshot_count integer := 0;
  already_count integer := 0;
  protected_codes constant text[] := ARRAY[
    'H0399','H0524','H0288','H0528','H0348','H0126','H0281','H0260','H0063','H0077'
  ];
BEGIN
  IF p_batch_id IS NULL OR p_manifest IS NULL OR jsonb_typeof(p_manifest) <> 'array'
     OR p_expected_rows < 0 OR p_expected_assignment_inserts < 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_LEGACY_RECONCILIATION_INPUT';
  END IF;
  IF public.preliminary_survey_v2_legacy_manifest_sha(p_manifest) IS DISTINCT FROM lower(p_manifest_sha) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'LEGACY_MANIFEST_SHA_MISMATCH';
  END IF;
  IF jsonb_array_length(p_manifest) <> p_expected_rows THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'LEGACY_EXPECTED_COUNT_MISMATCH';
  END IF;
  IF (SELECT count(DISTINCT (value->>'legacySurveyId')::bigint) FROM jsonb_array_elements(p_manifest))
     <> p_expected_rows THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'LEGACY_MANIFEST_DUPLICATE_ID';
  END IF;
  IF (SELECT count(*) FROM public.preliminary_survey survey
      WHERE survey.year = 2026 AND survey.measurement_date >= DATE '2026-08-01'
        AND btrim(regexp_replace(survey.period, '[[:space:]]*[(]수시[)][[:space:]]*$', '')) = '하반기')
     <> p_expected_rows THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'LEGACY_SOURCE_SCOPE_CHANGED';
  END IF;
  SELECT count(*) INTO manifest_assignment_count
  FROM jsonb_array_elements(p_manifest) manifest(value)
  WHERE value->>'classification' = 'ASSIGNMENT_ONLY_EXACT_RECOVERY';
  IF manifest_assignment_count <> p_expected_assignment_inserts THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'LEGACY_ASSIGNMENT_EXPECTED_COUNT_MISMATCH';
  END IF;

  PERFORM set_config('app.preliminary_survey_admin_repair', 'on', true);

  FOR item IN SELECT value FROM jsonb_array_elements(p_manifest) manifest(value)
              ORDER BY (value->>'legacySurveyId')::bigint LOOP
    SELECT * INTO STRICT legacy_row FROM public.preliminary_survey
    WHERE id = (item->>'legacySurveyId')::bigint FOR UPDATE;
    IF legacy_row.year <> 2026 OR legacy_row.measurement_date < DATE '2026-08-01'
       OR btrim(regexp_replace(legacy_row.period, '[[:space:]]*[(]수시[)][[:space:]]*$', '')) <> '하반기' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'LEGACY_ROW_OUT_OF_SCOPE';
    END IF;
    actual_source_hash := public.preliminary_survey_v2_legacy_source_hash(legacy_row.id);
    IF actual_source_hash IS DISTINCT FROM item->>'sourceHash' THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'STALE_LEGACY_SOURCE';
    END IF;

    target_row := NULL;
    SELECT count(*) INTO resolved_target_count FROM public.measurement_target_business target
    WHERE target.code = legacy_row.code AND target.year = legacy_row.year
      AND (target.measurement_date = legacy_row.measurement_date::text OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(target.daily_staff) = 'array'
          THEN target.daily_staff ELSE '[]'::jsonb END) day
        WHERE day->>'date' = legacy_row.measurement_date::text
      ))
      AND btrim(target.period) = btrim(legacy_row.period);
    IF resolved_target_count = 1 THEN
      SELECT * INTO target_row FROM public.measurement_target_business target
      WHERE target.code = legacy_row.code AND target.year = legacy_row.year
        AND (target.measurement_date = legacy_row.measurement_date::text OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(target.daily_staff) = 'array'
            THEN target.daily_staff ELSE '[]'::jsonb END) day
          WHERE day->>'date' = legacy_row.measurement_date::text
        ))
        AND btrim(target.period) = btrim(legacy_row.period);
    ELSIF resolved_target_count = 0 THEN
      SELECT count(*) INTO resolved_target_count FROM public.measurement_target_business target
      WHERE target.code = legacy_row.code AND target.year = legacy_row.year
        AND (target.measurement_date = legacy_row.measurement_date::text OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(target.daily_staff) = 'array'
            THEN target.daily_staff ELSE '[]'::jsonb END) day
          WHERE day->>'date' = legacy_row.measurement_date::text
        ))
        AND btrim(regexp_replace(target.period, '[[:space:]]*[(]수시[)][[:space:]]*$', '')) =
          btrim(regexp_replace(legacy_row.period, '[[:space:]]*[(]수시[)][[:space:]]*$', ''));
      IF resolved_target_count = 1 THEN
        SELECT * INTO target_row FROM public.measurement_target_business target
        WHERE target.code = legacy_row.code AND target.year = legacy_row.year
          AND (target.measurement_date = legacy_row.measurement_date::text OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(target.daily_staff) = 'array'
              THEN target.daily_staff ELSE '[]'::jsonb END) day
            WHERE day->>'date' = legacy_row.measurement_date::text
          ))
          AND btrim(regexp_replace(target.period, '[[:space:]]*[(]수시[)][[:space:]]*$', '')) =
            btrim(regexp_replace(legacy_row.period, '[[:space:]]*[(]수시[)][[:space:]]*$', ''));
      END IF;
    END IF;
    IF COALESCE((item->>'targetId')::bigint, 0) IS DISTINCT FROM COALESCE(target_row.id, 0) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'LEGACY_TARGET_KEY_MISMATCH';
    END IF;

    plan_row := NULL;
    IF target_row.id IS NOT NULL THEN
      SELECT * INTO plan_row FROM public.preliminary_survey_v2_plans
      WHERE measurement_target_business_id = target_row.id FOR UPDATE;
    END IF;
    SELECT count(*) INTO assignment_count
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    WHERE plan_row.id IS NOT NULL AND assignment.plan_id = plan_row.id
      AND assignment.measurement_date = legacy_row.measurement_date;

    matched_user := NULL;
    SELECT count(*) INTO matching_user_count FROM public.users user_row
    WHERE btrim(user_row.name) = btrim(COALESCE(legacy_row.measurer, ''));
    IF matching_user_count = 1 THEN
      SELECT * INTO matched_user FROM public.users user_row
      WHERE btrim(user_row.name) = btrim(COALESCE(legacy_row.measurer, ''));
    END IF;
    IF COALESCE((item->>'matchedPublicSampleUserId')::integer, 0)
       IS DISTINCT FROM COALESCE(matched_user.id, 0) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'LEGACY_USER_MAPPING_CHANGED';
    END IF;

    IF COALESCE(item->'matchedResponsibleUserIds', '[]'::jsonb) IS DISTINCT FROM COALESCE((
      SELECT jsonb_agg(user_id ORDER BY user_id)
      FROM (
        SELECT min(user_row.id) AS user_id
        FROM regexp_split_to_table(COALESCE(legacy_row.preliminary_surveyor, ''), '[,|]') token
        JOIN public.users user_row ON btrim(user_row.name) = btrim(token)
        WHERE btrim(token) <> ''
        GROUP BY btrim(token)
        HAVING count(*) = 1
      ) resolved
    ), '[]'::jsonb) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'LEGACY_RESPONSIBLE_USER_MAPPING_CHANGED';
    END IF;

    SELECT * INTO existing_audit
    FROM public.preliminary_survey_v2_legacy_reconciliation
    WHERE legacy_preliminary_survey_id = legacy_row.id;
    IF existing_audit.id IS NOT NULL THEN
      IF existing_audit.source_hash IS DISTINCT FROM actual_source_hash
         OR existing_audit.classification IS DISTINCT FROM item->>'classification' THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'STALE_LEGACY_RECONCILIATION';
      END IF;
      IF existing_audit.applied_assignment_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.preliminary_survey_v2_measurement_assignments assignment
        WHERE assignment.id = existing_audit.applied_assignment_id
          AND assignment.assignment_origin = 'legacy_reconciled'
          AND assignment.legacy_preliminary_survey_id = legacy_row.id
          AND assignment.reconciliation_batch_id = existing_audit.batch_id
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'LEGACY_RECONCILIATION_ASSIGNMENT_CHANGED';
      END IF;
      already_count := already_count + 1;
      CONTINUE;
    END IF;

    IF assignment_count > 0 THEN
      actual_classification := 'V2_ALREADY_AUTHORITATIVE';
    ELSIF btrim(COALESCE(legacy_row.preliminary_surveyor, '')) = ''
       AND btrim(COALESCE(legacy_row.measurer, '')) = ''
       AND btrim(COALESCE(legacy_row.survey_code, '')) = '' THEN
      actual_classification := 'NO_RECOVERABLE_SOURCE';
    ELSIF target_row.id IS NOT NULL AND target_row.code = ANY(protected_codes) THEN
      actual_classification := 'SNAPSHOT_ONLY';
    ELSIF target_row.id IS NOT NULL AND plan_row.id IS NOT NULL
       AND plan_row.status = 'recommended' AND plan_row.recommended_date IS NOT NULL
       AND plan_row.survey_method IN ('phone', 'field')
       AND matching_user_count = 1 AND matched_user.is_active IS NOT FALSE
       AND upper(btrim(COALESCE(matched_user.survey_code, ''))) IN ('A','B','C','D','F','G') THEN
      SELECT count(*) INTO group_count
      FROM public.preliminary_survey_v2_measurement_assignments assignment
      WHERE assignment.measurement_date = legacy_row.measurement_date
        AND assignment.assignee_user_id = matched_user.id;
      actual_classification := CASE WHEN group_count < 2
        THEN 'ASSIGNMENT_ONLY_EXACT_RECOVERY' ELSE 'SNAPSHOT_ONLY' END;
    ELSIF btrim(COALESCE(legacy_row.preliminary_surveyor, '')) <> ''
       OR btrim(COALESCE(legacy_row.measurer, '')) <> ''
       OR btrim(COALESCE(legacy_row.survey_code, '')) <> '' THEN
      actual_classification := 'SNAPSHOT_ONLY';
    ELSE
      actual_classification := 'NO_RECOVERABLE_SOURCE';
    END IF;
    IF actual_classification IS DISTINCT FROM item->>'classification' THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'LEGACY_CLASSIFICATION_CHANGED';
    END IF;

    inserted_assignment := NULL;
    IF actual_classification = 'ASSIGNMENT_ONLY_EXACT_RECOVERY' THEN
      INSERT INTO public.preliminary_survey_v2_measurement_assignments (
        plan_id, measurement_date, assignee_user_id, survey_code, survey_code_source,
        assignment_reason, approval_required, assignment_origin,
        legacy_preliminary_survey_id, legacy_measurer_snapshot,
        legacy_survey_code_snapshot, reconciliation_batch_id
      ) VALUES (
        plan_row.id, legacy_row.measurement_date, matched_user.id,
        upper(btrim(matched_user.survey_code)), 'users.survey_code',
        'LEGACY_RECONCILED_2026_08_26', false, 'legacy_reconciled',
        legacy_row.id, legacy_row.measurer, legacy_row.survey_code, p_batch_id
      ) RETURNING * INTO inserted_assignment;
      inserted_count := inserted_count + 1;
    ELSE
      snapshot_count := snapshot_count + 1;
    END IF;

    INSERT INTO public.preliminary_survey_v2_legacy_reconciliation (
      batch_id, measurement_target_business_id, legacy_preliminary_survey_id,
      code, measurement_year, measurement_period, measurement_date,
      legacy_preliminary_date, legacy_preliminary_surveyor,
      legacy_public_sample_measurer, legacy_survey_code_raw,
      legacy_actual_measurer, legacy_report_writer,
      matched_responsible_user_ids, matched_public_sample_user_id,
      normalized_current_survey_code, source_hash, classification,
      applied_plan_id, applied_assignment_id, reconciliation_status,
      exclusion_reason, source_snapshot, plan_before, plan_after,
      assignment_before, assignment_after, reconciled_at
    ) VALUES (
      p_batch_id, target_row.id, legacy_row.id,
      legacy_row.code, legacy_row.year, legacy_row.period, legacy_row.measurement_date,
      NULL, legacy_row.preliminary_surveyor, legacy_row.measurer, legacy_row.survey_code,
      legacy_row.actual_measurer, legacy_row.report_writer,
      COALESCE(item->'matchedResponsibleUserIds', '[]'::jsonb), matched_user.id,
      CASE WHEN matched_user.id IS NULL THEN NULL ELSE upper(btrim(matched_user.survey_code)) END,
      actual_source_hash, actual_classification, plan_row.id, inserted_assignment.id,
      CASE actual_classification
        WHEN 'V2_ALREADY_AUTHORITATIVE' THEN 'existing_v2_preserved'
        WHEN 'ASSIGNMENT_ONLY_EXACT_RECOVERY' THEN 'assignment_applied'
        WHEN 'NO_RECOVERABLE_SOURCE' THEN 'no_recoverable_source'
        ELSE 'snapshot_only' END,
      item->>'exclusionReason', to_jsonb(legacy_row),
      CASE WHEN plan_row.id IS NULL THEN NULL ELSE to_jsonb(plan_row) END,
      CASE WHEN plan_row.id IS NULL THEN NULL ELSE to_jsonb(plan_row) END,
      CASE WHEN assignment_count = 0 THEN NULL ELSE (
        SELECT to_jsonb(assignment) FROM public.preliminary_survey_v2_measurement_assignments assignment
        WHERE assignment.plan_id = plan_row.id AND assignment.measurement_date = legacy_row.measurement_date
        LIMIT 1
      ) END,
      CASE WHEN inserted_assignment.id IS NULL THEN (
        SELECT to_jsonb(assignment) FROM public.preliminary_survey_v2_measurement_assignments assignment
        WHERE assignment.plan_id = plan_row.id AND assignment.measurement_date = legacy_row.measurement_date
        LIMIT 1
      ) ELSE to_jsonb(inserted_assignment) END,
      CASE WHEN actual_classification = 'ASSIGNMENT_ONLY_EXACT_RECOVERY'
        THEN CURRENT_TIMESTAMP ELSE NULL END
    );
  END LOOP;

  IF inserted_count NOT IN (0, p_expected_assignment_inserts) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'LEGACY_ACTUAL_ASSIGNMENT_COUNT_MISMATCH';
  END IF;
  RETURN jsonb_build_object(
    'batchId', p_batch_id, 'manifestRows', p_expected_rows,
    'assignmentInserted', inserted_count, 'snapshotRows', snapshot_count,
    'alreadyReconciled', already_count, 'additionalChanges', inserted_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rollback_preliminary_survey_v2_legacy_reconciliation(
  p_batch_id uuid,
  p_expected_assignment_deletes integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  actual_count integer;
BEGIN
  SELECT count(*) INTO actual_count
  FROM public.preliminary_survey_v2_measurement_assignments
  WHERE assignment_origin = 'legacy_reconciled' AND reconciliation_batch_id = p_batch_id;
  IF actual_count <> p_expected_assignment_deletes THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'LEGACY_ROLLBACK_EXPECTED_COUNT_MISMATCH';
  END IF;
  PERFORM set_config('app.preliminary_survey_admin_repair', 'on', true);
  UPDATE public.preliminary_survey_v2_legacy_reconciliation
  SET reconciliation_status = 'rolled_back', applied_assignment_id = NULL,
      rolled_back_at = CURRENT_TIMESTAMP
  WHERE batch_id = p_batch_id AND reconciliation_status = 'assignment_applied';
  DELETE FROM public.preliminary_survey_v2_measurement_assignments
  WHERE assignment_origin = 'legacy_reconciled' AND reconciliation_batch_id = p_batch_id;
  RETURN jsonb_build_object('batchId', p_batch_id, 'assignmentDeleted', actual_count);
END;
$$;

REVOKE ALL ON FUNCTION public.preliminary_survey_v2_legacy_source_hash(bigint)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preliminary_survey_v2_legacy_manifest_sha(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_preliminary_survey_v2_legacy_history(uuid,jsonb,text,integer,integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rollback_preliminary_survey_v2_legacy_reconciliation(uuid,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preliminary_survey_v2_legacy_source_hash(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.preliminary_survey_v2_legacy_manifest_sha(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_preliminary_survey_v2_legacy_history(uuid,jsonb,text,integer,integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.rollback_preliminary_survey_v2_legacy_reconciliation(uuid,integer)
  TO service_role;

NOTIFY pgrst, 'reload schema';
