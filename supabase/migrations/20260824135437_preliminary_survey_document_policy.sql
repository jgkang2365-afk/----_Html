BEGIN;

-- 문서 code와 기존 template/mapping/job 이력은 유지하고 표시명과 신규 생성 규칙만 갱신한다.
UPDATE public.document_definitions
SET name = CASE code
      WHEN 'GENERAL_PRELIMINARY_SURVEY' THEN '예비조사표(일반)'
      WHEN 'INDUSTRIAL_SHOP_PRELIMINARY_SURVEY' THEN '예비조사표(공업사)'
    END,
    filename_pattern = '{business_name}(예비조사표-{short_year}{short_period})',
    updated_at = CURRENT_TIMESTAMP
WHERE code IN (
  'GENERAL_PRELIMINARY_SURVEY',
  'INDUSTRIAL_SHOP_PRELIMINARY_SURVEY'
);

-- 과거 자동분석에서 안내문구나 HWPX 제어문자열이 default로 저장된 경우만 제거한다.
-- 관리자가 입력한 다른 실제 기본값은 유지한다.
UPDATE public.document_field_mappings mapping
SET default_value = NULL,
    updated_at = CURRENT_TIMESTAMP
FROM public.document_definitions definition
WHERE definition.id = mapping.document_definition_id
  AND definition.code IN (
    'GENERAL_PRELIMINARY_SURVEY',
    'INDUSTRIAL_SHOP_PRELIMINARY_SURVEY'
  )
  AND mapping.default_value IS NOT NULL
  AND (
    mapping.default_value ~* '(Clickhere\s*:|Direction\s*:\s*wstring\s*:|HelpState\s*:)'
    OR EXISTS (
      SELECT 1
      FROM (VALUES
        ('measurement_year', '측정연도'),
        ('measurement_year', '측정년도'),
        ('measurement_year', '년도'),
        ('measurement_period', '측정주기'),
        ('measurement_period', '주기'),
        ('business_name', '사업장명'),
        ('representative_name', '대표자'),
        ('representative_name', '대표자명'),
        ('address', '주소'),
        ('business_category', '업종'),
        ('business_category', '업종분류'),
        ('phone', '전화번호'),
        ('main_product', '주요생산품'),
        ('main_product', '주요 생산품'),
        ('fax', '팩스'),
        ('total_employees', '총 근로자수'),
        ('total_employees', '총 근로자 수'),
        ('manager_name', '담당자'),
        ('manager_name', '담당자명'),
        ('manager_email', '이메일'),
        ('manager_email', '담당자 이메일'),
        ('manager_email', '담당자 메일'),
        ('manager_contact', '연락처'),
        ('manager_contact', '담당자 연락처'),
        ('preliminary_surveyor', '예비조사자'),
        ('business_number', '사업자등록번호'),
        ('industrial_accident_number', '산재관리번호')
      ) AS guide(source_field, guide_value)
      WHERE guide.source_field = mapping.source_field
        AND guide.guide_value = btrim(mapping.default_value)
    )
  );

-- catalog 조회 이후 직접 queue RPC를 호출해도 일반/공업사 예비조사표를 바꿔 요청할 수 없다.
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
  selected_code TEXT;
BEGIN
  SELECT *
  INTO target_row
  FROM public.measurement_target_business
  WHERE id = p_business_id
  FOR UPDATE;

  IF NOT FOUND
     OR NOT target_row.document_generation_enabled
     OR target_row.business_type IS NULL
     OR target_row.business_type NOT IN ('first_measurement', 'external_new') THEN
    RAISE EXCEPTION 'DOCUMENT_GENERATION_NOT_ELIGIBLE';
  END IF;

  IF p_selected_documents IS NULL
     OR jsonb_typeof(p_selected_documents) <> 'array'
     OR jsonb_array_length(p_selected_documents) = 0 THEN
    RAISE EXCEPTION 'DOCUMENT_DEFINITION_UNAVAILABLE';
  END IF;

  FOR selected_code IN
    SELECT value
    FROM jsonb_array_elements_text(p_selected_documents) AS selected(value)
    ORDER BY value
  LOOP
    PERFORM 1
    FROM public.document_definitions definition
    WHERE definition.code = selected_code
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'DOCUMENT_DEFINITION_UNAVAILABLE';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.document_definitions definition
      WHERE definition.code = selected_code
        AND definition.deleted_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'DOCUMENT_DEFINITION_DELETED';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.document_definitions definition
      WHERE definition.code = selected_code
        AND NOT definition.is_active
    ) THEN
      RAISE EXCEPTION 'DOCUMENT_DEFINITION_UNAVAILABLE';
    END IF;

    IF (
      selected_code = 'INDUSTRIAL_SHOP_PRELIMINARY_SURVEY'
      AND btrim(COALESCE(target_row.business_category, '')) <> '공업사'
    ) OR (
      selected_code = 'GENERAL_PRELIMINARY_SURVEY'
      AND btrim(COALESCE(target_row.business_category, '')) = '공업사'
    ) THEN
      RAISE EXCEPTION 'DOCUMENT_DEFINITION_NOT_ELIGIBLE';
    END IF;
  END LOOP;

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

COMMIT;
