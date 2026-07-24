-- 문서 생성 자격은 사업장 코드의 신규 여부가 아니라, 기능 적용 이후 사용자가
-- 신규 등록한 measurement_target_business 행 자체에 부여한다.
ALTER TABLE public.measurement_target_business
  ADD COLUMN IF NOT EXISTS document_generation_enabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.measurement_target_business.document_generation_enabled IS
  '신규 등록 화면에서 생성된 측정대상 건의 문서 생성 자격. 기존 행은 false를 유지한다.';

-- 작업 이력을 보존하기 위해 사업장당 한 작업만 허용하던 제약을 제거한다.
ALTER TABLE public.document_generation_jobs
  DROP CONSTRAINT IF EXISTS document_generation_jobs_business_id_key;

CREATE INDEX IF NOT EXISTS idx_document_generation_jobs_business_history
  ON public.document_generation_jobs(business_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_document_generation_jobs_active_business
  ON public.document_generation_jobs(business_id)
  WHERE status IN ('PENDING', 'PROCESSING');

-- 구버전 API와의 호환을 위해 함수는 유지하되 코드의 과거 존재 여부를 검사하지 않는다.
DROP FUNCTION IF EXISTS public.register_new_business_document_eligibility(BIGINT, BIGINT);
CREATE FUNCTION public.register_new_business_document_eligibility(
  p_business_id BIGINT,
  p_requested_by BIGINT DEFAULT NULL
)
RETURNS TABLE(document_generation_enabled BOOLEAN, job_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.measurement_target_business
  SET document_generation_enabled = TRUE,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = p_business_id
  RETURNING TRUE, NULL::UUID;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DOCUMENT_TARGET_NOT_FOUND';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_document_generation_job(
  p_business_id BIGINT,
  p_payload JSONB,
  p_selected_documents JSONB,
  p_requested_by BIGINT DEFAULT NULL
)
RETURNS SETOF public.document_generation_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_row public.measurement_target_business;
BEGIN
  SELECT *
  INTO target_row
  FROM public.measurement_target_business
  WHERE id = p_business_id
  FOR UPDATE;

  IF NOT FOUND OR NOT target_row.document_generation_enabled THEN
    RAISE EXCEPTION 'DOCUMENT_GENERATION_NOT_ELIGIBLE';
  END IF;

  -- journal_id가 고아 값이면 일치 레코드가 없으므로 생성을 막지 않는다.
  -- 과거의 다른 연도·주기는 정확한 code/year/period 비교에서 제외된다.
  IF EXISTS (
    SELECT 1
    FROM public.measurement_journal journal
    WHERE journal.id = target_row.journal_id
       OR (
         journal.code = target_row.code
         AND journal.measurement_year = target_row.year
         AND journal.measurement_period = target_row.period
       )
  ) THEN
    RAISE EXCEPTION 'DOCUMENT_GENERATION_JOURNAL_EXISTS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.document_generation_jobs
    WHERE business_id = p_business_id
      AND status IN ('PENDING', 'PROCESSING')
  ) THEN
    RAISE EXCEPTION 'DOCUMENT_GENERATION_ALREADY_RUNNING';
  END IF;

  RETURN QUERY
  INSERT INTO public.document_generation_jobs (
    business_id,
    business_code,
    measurement_year,
    measurement_period,
    new_business_code_created,
    status,
    payload,
    selected_documents,
    requested_by,
    requested_at,
    attempt_count
  )
  VALUES (
    target_row.id,
    target_row.code,
    target_row.year,
    target_row.period,
    FALSE,
    'PENDING',
    p_payload,
    p_selected_documents,
    p_requested_by,
    CURRENT_TIMESTAMP,
    1
  )
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.register_new_business_document_eligibility(BIGINT, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.queue_document_generation_job(BIGINT, JSONB, JSONB, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_new_business_document_eligibility(BIGINT, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.queue_document_generation_job(BIGINT, JSONB, JSONB, BIGINT) TO service_role;

NOTIFY pgrst, 'reload schema';
