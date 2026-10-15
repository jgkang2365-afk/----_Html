-- Run only against Docker Local. The whole synthetic exercise is rolled back.
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
DO $$
DECLARE
  first_row jsonb := jsonb_build_object(
    'unmatchableError', true,
    'sourceKey', 'k2b:unmatchable:' || repeat('a', 64) || ':1:1',
    'contentFingerprint', repeat('a', 64),
    'identicalRowCount', 1,
    'occurrenceOrdinal', 1,
    'sourceRowIndex', 0,
    'actualSubmissionDate', '2026-10-15',
    'fileName', '__synthetic_k2b_error_test__.xml',
    'status', '파일오류',
    'errorDetail', 'synthetic',
    'raw', jsonb_build_object('file', '__synthetic_k2b_error_test__.xml', 'error', 'synthetic')
  );
  changed_row jsonb;
  first_result jsonb;
  second_result jsonb;
  changed_result jsonb;
  approval jsonb;
  manager_id integer;
  manager_count integer;
  notification_count integer;
  history_count integer;
  submitter_id integer;
  other_user_id integer;
  upload_job_id uuid;
  proven_row jsonb;
  proven_result jsonb;
  denied boolean := false;
BEGIN
  SELECT id INTO manager_id FROM public.users WHERE role = '관리자' ORDER BY id LIMIT 1;
  IF manager_id IS NULL THEN RAISE EXCEPTION 'LOCAL_MANAGER_FIXTURE_MISSING'; END IF;
  SELECT count(*) INTO manager_count FROM public.users WHERE role = '관리자';
  first_result := public.upsert_k2b_unmatchable_error(first_row, NULL, NULL);
  second_result := public.upsert_k2b_unmatchable_error(first_row, NULL, NULL);
  IF first_result->>'id' IS DISTINCT FROM second_result->>'id' THEN
    RAISE EXCEPTION 'REREAD_CREATED_DUPLICATE_ERROR';
  END IF;
  SELECT count(*) INTO notification_count FROM public.k2b_unmatchable_error_notifications
    WHERE error_id = (first_result->>'id')::uuid;
  IF notification_count <> manager_count THEN RAISE EXCEPTION 'DUPLICATE_OR_MISSING_MANAGER_NOTIFICATION'; END IF;
  UPDATE public.notifications SET is_read = true
    WHERE id IN (SELECT notification_id FROM public.k2b_unmatchable_error_notifications
                 WHERE error_id = (first_result->>'id')::uuid);
  IF (SELECT review_state FROM public.k2b_unmatchable_errors WHERE id = (first_result->>'id')::uuid) <> 'WAITING' THEN
    RAISE EXCEPTION 'READ_NOTIFICATION_CHANGED_APPROVAL_STATE';
  END IF;
  approval := public.approve_k2b_unmatchable_error((first_result->>'id')::uuid, manager_id, 'synthetic local verification');
  IF approval->>'disposition' <> 'passed' THEN RAISE EXCEPTION 'FIRST_APPROVAL_FAILED'; END IF;
  approval := public.approve_k2b_unmatchable_error((first_result->>'id')::uuid, manager_id, 'second request');
  IF approval->>'disposition' <> 'already_passed' THEN RAISE EXCEPTION 'SECOND_APPROVAL_NOT_IDEMPOTENT'; END IF;
  SELECT count(*) INTO history_count FROM public.k2b_unmatchable_error_approvals
    WHERE error_id = (first_result->>'id')::uuid;
  IF history_count <> 1 THEN RAISE EXCEPTION 'DUPLICATE_APPROVAL_HISTORY'; END IF;
  changed_row := first_row || jsonb_build_object(
    'sourceKey', 'k2b:unmatchable:' || repeat('b', 64) || ':1:1',
    'contentFingerprint', repeat('b', 64),
    'errorDetail', 'changed synthetic',
    'raw', jsonb_build_object('file', '__synthetic_k2b_error_test__.xml', 'error', 'changed synthetic')
  );
  changed_result := public.upsert_k2b_unmatchable_error(changed_row, NULL, NULL);
  IF changed_result->>'reviewState' <> 'REVIEW_REQUIRED'
     OR changed_result->>'id' = first_result->>'id' THEN
    RAISE EXCEPTION 'CHANGED_ERROR_INHERITED_OLD_PASS';
  END IF;
  SELECT id INTO submitter_id FROM public.users WHERE role = '사용자' ORDER BY id LIMIT 1;
  SELECT id INTO other_user_id FROM public.users WHERE role = '사용자' AND id <> submitter_id ORDER BY id LIMIT 1;
  IF submitter_id IS NULL OR other_user_id IS NULL THEN RAISE EXCEPTION 'LOCAL_USER_FIXTURE_MISSING'; END IF;
  INSERT INTO public.background_jobs(job_type, status, payload)
  VALUES ('k2b', 'success', jsonb_build_object('requestUser', jsonb_build_object('id', submitter_id)))
  RETURNING id INTO upload_job_id;
  proven_row := first_row || jsonb_build_object(
    'sourceKey', 'k2b:unmatchable:' || repeat('c', 64) || ':1:1',
    'contentFingerprint', repeat('c', 64),
    'fileName', '__synthetic_proven_upload__.xml',
    'raw', jsonb_build_object('file', '__synthetic_proven_upload__.xml', 'error', 'synthetic')
  );
  proven_result := public.upsert_k2b_unmatchable_error(proven_row, upload_job_id, upload_job_id);
  IF (SELECT submitter_user_id FROM public.k2b_unmatchable_errors WHERE id = (proven_result->>'id')::uuid) <> submitter_id THEN
    RAISE EXCEPTION 'PROVEN_SUBMITTER_NOT_LINKED';
  END IF;
  SELECT count(*) INTO notification_count FROM public.k2b_unmatchable_error_notifications
    WHERE error_id = (proven_result->>'id')::uuid;
  IF notification_count <> manager_count + 1 THEN RAISE EXCEPTION 'SUBMITTER_OR_MANAGER_NOTIFICATION_MISSING'; END IF;
  BEGIN
    PERFORM public.approve_k2b_unmatchable_error((proven_result->>'id')::uuid, other_user_id, 'unauthorized');
  EXCEPTION WHEN SQLSTATE '42501' THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'OTHER_USER_APPROVAL_ALLOWED'; END IF;
  approval := public.approve_k2b_unmatchable_error((proven_result->>'id')::uuid, submitter_id, 'actual submitter approval');
  IF approval->>'disposition' <> 'passed' THEN RAISE EXCEPTION 'SUBMITTER_APPROVAL_FAILED'; END IF;
  RAISE NOTICE 'K2B_LOCAL_RPC_E2E_OK';
END;
$$;
ROLLBACK;
