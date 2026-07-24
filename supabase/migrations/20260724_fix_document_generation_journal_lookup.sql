-- 운영 measurement_target_business에는 journal_id가 없으므로
-- 동일 측정 건은 정확한 code + year + period로 판정한다.
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

  IF EXISTS (
    SELECT 1
    FROM public.measurement_journal journal
    WHERE journal.code = target_row.code
      AND journal.measurement_year = target_row.year
      AND journal.measurement_period = target_row.period
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

REVOKE ALL ON FUNCTION public.queue_document_generation_job(BIGINT, JSONB, JSONB, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.queue_document_generation_job(BIGINT, JSONB, JSONB, BIGINT) TO service_role;

NOTIFY pgrst, 'reload schema';
