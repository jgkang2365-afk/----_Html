-- 건강디딤돌 진행 상태 제약 정리 및 상태 변경 + 큐 등록 원자화
-- 건강디딤돌 진행 상태 컬럼을 저장소 migration에 명시
ALTER TABLE public.measurement_target_business
  ADD COLUMN IF NOT EXISTS sync_status VARCHAR(20) DEFAULT '대기',
  ADD COLUMN IF NOT EXISTS sync_error_message TEXT;

DO $$
DECLARE
  unknown_statuses TEXT;
  constraint_record RECORD;
BEGIN
  SELECT string_agg(status_value, ', ' ORDER BY status_value)
    INTO unknown_statuses
  FROM (
    SELECT DISTINCT sync_status::TEXT AS status_value
    FROM public.measurement_target_business
    WHERE sync_status IS NOT NULL
      AND sync_status::TEXT NOT IN (
        '정보부족', '조회대기', '조회중', '확인대기', '신청중',
        '신청완료대기', '비대상대기', '수동확인필요',
        '성공', '실패', '대기'
      )
  ) AS unknown_values;

  IF unknown_statuses IS NOT NULL THEN
    RAISE EXCEPTION
      'Unknown measurement_target_business.sync_status values: %',
      unknown_statuses;
  END IF;

  FOR constraint_record IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.measurement_target_business'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%sync_status%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.measurement_target_business DROP CONSTRAINT %I',
      constraint_record.conname
    );
  END LOOP;
END $$;

ALTER TABLE public.measurement_target_business
  ALTER COLUMN sync_status DROP DEFAULT;

ALTER TABLE public.measurement_target_business
  ALTER COLUMN sync_status TYPE VARCHAR(20) USING sync_status::TEXT;

ALTER TABLE public.measurement_target_business
  ALTER COLUMN sync_status SET DEFAULT '대기';

ALTER TABLE public.measurement_target_business
  ADD CONSTRAINT measurement_target_business_sync_status_check
  CHECK (
    sync_status IS NULL OR sync_status IN (
      '정보부족', '조회대기', '조회중', '확인대기', '신청중',
      '신청완료대기', '비대상대기', '수동확인필요',
      '성공', '실패', '대기'
    )
  );

CREATE OR REPLACE FUNCTION public.enqueue_national_support_job(
  p_target_id BIGINT,
  p_job_payload JSONB,
  p_available_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
)
RETURNS TABLE(job_id UUID, previous_sync_status VARCHAR)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_sync_status VARCHAR;
  created_job_id UUID;
  requested_mode TEXT := COALESCE(p_job_payload->>'mode', 'lookup_only');
BEGIN
  SELECT sync_status
    INTO current_sync_status
  FROM public.measurement_target_business
  WHERE id = p_target_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'NATIONAL_SUPPORT_TARGET_NOT_FOUND';
  END IF;

  IF current_sync_status IN ('신청중', '조회중') THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'NATIONAL_SUPPORT_ALREADY_RUNNING';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.background_jobs
    WHERE job_type = 'national_support'
      AND status IN ('pending', 'processing', 'cancel_requested')
      AND payload->>'target_id' = p_target_id::TEXT
      AND COALESCE(payload->>'mode', 'lookup_only') = requested_mode
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'NATIONAL_SUPPORT_JOB_DUPLICATE';
  END IF;

  UPDATE public.measurement_target_business
  SET
    sync_status = '조회중',
    sync_error_message = NULL,
    industrial_accident_number = COALESCE(
      NULLIF(p_job_payload->>'sanjae', ''),
      industrial_accident_number
    ),
    commencement_number = COALESCE(
      NULLIF(p_job_payload->>'commencement', ''),
      commencement_number
    ),
    representative_name = COALESCE(
      NULLIF(p_job_payload->>'representative', ''),
      representative_name
    ),
    updated_at = CURRENT_TIMESTAMP
  WHERE id = p_target_id;

  INSERT INTO public.background_jobs (
    job_type,
    status,
    payload,
    available_at,
    attempt_count
  )
  VALUES (
    'national_support',
    'pending',
    p_job_payload,
    COALESCE(p_available_at, CURRENT_TIMESTAMP),
    COALESCE((p_job_payload->>'attempt_count')::INTEGER, 0)
  )
  RETURNING id INTO created_job_id;

  RETURN QUERY SELECT created_job_id, current_sync_status;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'NATIONAL_SUPPORT_JOB_DUPLICATE';
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_national_support_job(BIGINT, JSONB, TIMESTAMPTZ)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_national_support_job(BIGINT, JSONB, TIMESTAMPTZ)
  TO service_role;

COMMENT ON FUNCTION public.enqueue_national_support_job(BIGINT, JSONB, TIMESTAMPTZ)
  IS '건강디딤돌 대상 행 잠금과 background_jobs 등록을 하나의 트랜잭션으로 처리';

NOTIFY pgrst, 'reload schema';
