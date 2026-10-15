-- Identity-free K2B file errors are isolated from normal receipts and journals.
CREATE TABLE public.k2b_unmatchable_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL UNIQUE,
  content_fingerprint text NOT NULL CHECK (content_fingerprint ~ '^[a-f0-9]{64}$'),
  identical_row_count integer NOT NULL CHECK (identical_row_count > 0),
  occurrence_ordinal integer NOT NULL CHECK (occurrence_ordinal > 0 AND occurrence_ordinal <= identical_row_count),
  source_row_index integer NOT NULL CHECK (source_row_index >= 0),
  actual_submission_date date NOT NULL,
  file_name text NOT NULL,
  k2b_status text NOT NULL,
  error_detail text,
  raw_row jsonb NOT NULL CHECK (jsonb_typeof(raw_row) = 'object'),
  first_seen_at timestamptz NOT NULL DEFAULT current_timestamp,
  last_seen_at timestamptz NOT NULL DEFAULT current_timestamp,
  last_sync_job_id uuid REFERENCES public.background_jobs(id) ON DELETE SET NULL,
  submission_job_id uuid REFERENCES public.background_jobs(id) ON DELETE SET NULL,
  submitter_user_id integer REFERENCES public.users(id) ON DELETE RESTRICT,
  review_state text NOT NULL DEFAULT 'WAITING' CHECK (review_state IN ('WAITING', 'REVIEW_REQUIRED', 'PASSED')),
  approved_by_user_id integer REFERENCES public.users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  approval_reason text,
  CHECK ((review_state = 'PASSED') = (approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL AND nullif(btrim(approval_reason), '') IS NOT NULL))
);
CREATE INDEX k2b_unmatchable_errors_date_idx ON public.k2b_unmatchable_errors(actual_submission_date DESC);

CREATE TABLE public.k2b_unmatchable_error_approvals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  error_id uuid NOT NULL REFERENCES public.k2b_unmatchable_errors(id) ON DELETE RESTRICT,
  actor_user_id integer NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  approved_at timestamptz NOT NULL DEFAULT current_timestamp,
  UNIQUE (error_id)
);
CREATE TABLE public.k2b_unmatchable_error_notifications (
  error_id uuid NOT NULL REFERENCES public.k2b_unmatchable_errors(id) ON DELETE RESTRICT,
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  notification_id integer NOT NULL REFERENCES public.notifications(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT current_timestamp,
  PRIMARY KEY (error_id, user_id)
);

CREATE FUNCTION public.prevent_k2b_error_approval_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'K2B_APPROVAL_HISTORY_APPEND_ONLY';
END;
$$;
CREATE TRIGGER k2b_error_approvals_append_only BEFORE UPDATE OR DELETE ON public.k2b_unmatchable_error_approvals
FOR EACH ROW EXECUTE FUNCTION public.prevent_k2b_error_approval_mutation();

ALTER TABLE public.k2b_unmatchable_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.k2b_unmatchable_error_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.k2b_unmatchable_error_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.k2b_unmatchable_errors, public.k2b_unmatchable_error_approvals,
  public.k2b_unmatchable_error_notifications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_k2b_error_approval_mutation() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.upsert_k2b_unmatchable_error(p_row jsonb, p_job_id uuid, p_submission_job_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_state text;
  v_submitter integer;
  v_recipient integer;
  v_notification_id integer;
  v_review_state text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'K2B_SERVICE_ROLE_ONLY';
  END IF;
  IF jsonb_typeof(p_row) IS DISTINCT FROM 'object'
     OR COALESCE(p_row->>'unmatchableError', '') <> 'true'
     OR COALESCE(p_row->>'sourceKey', '') NOT LIKE 'k2b:unmatchable:%'
     OR COALESCE(p_row->>'contentFingerprint', '') !~ '^[a-f0-9]{64}$'
     OR COALESCE(p_row->>'actualSubmissionDate', '') !~ '^\d{4}-\d{2}-\d{2}$'
     OR COALESCE(p_row->>'fileName', '') = '' OR COALESCE(p_row->>'status', '') = ''
     OR jsonb_typeof(p_row->'raw') IS DISTINCT FROM 'object'
     OR COALESCE(p_row->>'identicalRowCount', '') !~ '^[1-9][0-9]*$'
     OR COALESCE(p_row->>'occurrenceOrdinal', '') !~ '^[1-9][0-9]*$'
     OR COALESCE(p_row->>'sourceRowIndex', '') !~ '^(0|[1-9][0-9]*)$'
     OR (p_row->>'occurrenceOrdinal')::integer > (p_row->>'identicalRowCount')::integer THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_K2B_UNMATCHABLE_ROW';
  END IF;

  -- A worker may supply provenance only after proving this exact row belongs to that upload.
  IF p_submission_job_id IS NOT NULL THEN
    SELECT (payload->'requestUser'->>'id')::integer INTO v_submitter
    FROM public.background_jobs
    WHERE id = p_submission_job_id AND job_type = 'k2b'
      AND payload->'requestUser'->>'id' ~ '^[0-9]+$';
    IF v_submitter IS NULL OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_submitter) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'K2B_SUBMITTER_PROVENANCE_INVALID';
    END IF;
  END IF;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.k2b_unmatchable_errors old
    WHERE old.actual_submission_date = (p_row->>'actualSubmissionDate')::date
      AND old.file_name = p_row->>'fileName'
      AND (old.content_fingerprint <> p_row->>'contentFingerprint'
        OR old.identical_row_count <> (p_row->>'identicalRowCount')::integer)
  ) THEN 'REVIEW_REQUIRED' ELSE 'WAITING' END INTO v_review_state;

  INSERT INTO public.k2b_unmatchable_errors (
    source_key, content_fingerprint, identical_row_count, occurrence_ordinal, source_row_index,
    actual_submission_date, file_name, k2b_status, error_detail, raw_row, last_sync_job_id,
    submission_job_id, submitter_user_id, review_state
  ) VALUES (
    p_row->>'sourceKey', p_row->>'contentFingerprint', (p_row->>'identicalRowCount')::integer,
    (p_row->>'occurrenceOrdinal')::integer, (p_row->>'sourceRowIndex')::integer,
    (p_row->>'actualSubmissionDate')::date, p_row->>'fileName', p_row->>'status',
    nullif(p_row->>'errorDetail', ''), p_row->'raw', p_job_id,
    p_submission_job_id, v_submitter, v_review_state
  ) ON CONFLICT (source_key) DO UPDATE SET
    last_seen_at = current_timestamp,
    last_sync_job_id = EXCLUDED.last_sync_job_id,
    submission_job_id = COALESCE(public.k2b_unmatchable_errors.submission_job_id, EXCLUDED.submission_job_id),
    submitter_user_id = COALESCE(public.k2b_unmatchable_errors.submitter_user_id, EXCLUDED.submitter_user_id)
  WHERE public.k2b_unmatchable_errors.raw_row = EXCLUDED.raw_row
    AND public.k2b_unmatchable_errors.content_fingerprint = EXCLUDED.content_fingerprint
    AND (public.k2b_unmatchable_errors.submission_job_id IS NULL
      OR EXCLUDED.submission_job_id IS NULL
      OR public.k2b_unmatchable_errors.submission_job_id = EXCLUDED.submission_job_id)
  RETURNING id, review_state, submitter_user_id INTO v_id, v_state, v_submitter;
  IF v_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'K2B_ERROR_IDENTITY_CONFLICT';
  END IF;

  IF v_state <> 'PASSED' THEN
    FOR v_recipient IN
      SELECT id FROM public.users WHERE role = '관리자'
      UNION SELECT v_submitter WHERE v_submitter IS NOT NULL
    LOOP
      -- The row lock and unique ledger make repeat reads and concurrent jobs idempotent.
      IF NOT EXISTS (SELECT 1 FROM public.k2b_unmatchable_error_notifications
                     WHERE error_id = v_id AND user_id = v_recipient) THEN
        INSERT INTO public.notifications(user_id, type, message, is_read)
        VALUES (v_recipient, 'warning',
          '[K2B 오류 확인 필요] 접수일 ' || (p_row->>'actualSubmissionDate') ||
          ', 파일 ' || (p_row->>'fileName') || ', 상태 ' || (p_row->>'status') ||
          ', 오류 ID ' || v_id::text, false) RETURNING id INTO v_notification_id;
        INSERT INTO public.k2b_unmatchable_error_notifications(error_id, user_id, notification_id)
        VALUES (v_id, v_recipient, v_notification_id);
      END IF;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('id', v_id, 'reviewState', v_state, 'sourceKey', p_row->>'sourceKey');
END;
$$;

CREATE FUNCTION public.approve_k2b_unmatchable_error(p_error_id uuid, p_actor_user_id integer, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_error public.k2b_unmatchable_errors%ROWTYPE;
DECLARE v_role text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'K2B_SERVICE_ROLE_ONLY';
  END IF;
  IF nullif(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'K2B_PASS_REASON_REQUIRED';
  END IF;
  SELECT * INTO v_error FROM public.k2b_unmatchable_errors WHERE id = p_error_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'K2B_ERROR_NOT_FOUND'; END IF;
  SELECT role INTO v_role FROM public.users WHERE id = p_actor_user_id;
  IF v_role IS NULL OR (v_role <> '관리자' AND p_actor_user_id IS DISTINCT FROM v_error.submitter_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'K2B_PASS_FORBIDDEN';
  END IF;
  IF v_error.review_state = 'PASSED' THEN
    RETURN jsonb_build_object('id', p_error_id, 'disposition', 'already_passed');
  END IF;
  UPDATE public.k2b_unmatchable_errors SET review_state = 'PASSED', approved_by_user_id = p_actor_user_id,
    approved_at = current_timestamp, approval_reason = btrim(p_reason) WHERE id = p_error_id;
  INSERT INTO public.k2b_unmatchable_error_approvals(error_id, actor_user_id, reason)
  VALUES (p_error_id, p_actor_user_id, btrim(p_reason));
  RETURN jsonb_build_object('id', p_error_id, 'disposition', 'passed');
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_k2b_unmatchable_error(jsonb, uuid, uuid),
  public.approve_k2b_unmatchable_error(uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_k2b_unmatchable_error(jsonb, uuid, uuid),
  public.approve_k2b_unmatchable_error(uuid, integer, text) TO service_role;
NOTIFY pgrst, 'reload schema';
