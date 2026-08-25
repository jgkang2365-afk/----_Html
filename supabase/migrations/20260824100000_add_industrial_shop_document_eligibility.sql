-- 공업사 예비조사표는 기존 동적 문서 정의/Worker 파이프라인을 그대로 사용한다.
-- 운영에 같은 이름으로 시험 등록한 비활성 정의가 있고 템플릿/매핑이 전혀 없으면
-- 공식 code로 다시 등록할 수 있도록 해당 빈 정의만 제거한다.
DELETE FROM public.document_definitions definition
WHERE definition.name = '공업사(예비조사표)'
  AND definition.code <> 'INDUSTRIAL_SHOP_PRELIMINARY_SURVEY'
  AND definition.is_active = FALSE
  AND NOT EXISTS (
    SELECT 1
    FROM public.document_templates template
    WHERE template.document_definition_id = definition.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.document_field_mappings mapping
    WHERE mapping.document_definition_id = definition.id
  );

INSERT INTO public.document_definitions (
  code, name, file_format, filename_pattern, default_selected, sort_order, is_active
)
SELECT
  'INDUSTRIAL_SHOP_PRELIMINARY_SURVEY',
  '공업사(예비조사표)',
  'HWPX',
  '{business_name}(공업사 예비조사표-{short_year}{short_period})',
  TRUE,
  40,
  TRUE
WHERE NOT EXISTS (
  SELECT 1
  FROM public.document_definitions
  WHERE code = 'INDUSTRIAL_SHOP_PRELIMINARY_SURVEY'
     OR name = '공업사(예비조사표)'
)
ON CONFLICT (code) DO NOTHING;

-- catalog 조회 후 definition 삭제/비활성화와 queue INSERT가 경합해도
-- 선택한 definition row를 잠근 뒤 최종 상태와 공업사 조건을 다시 검증한다.
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
    -- FOR UPDATE는 논리삭제 UPDATE와 직렬화한다. 대기 후 최신 상태를 판정한다.
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

    IF EXISTS (
      SELECT 1
      FROM public.document_definitions definition
      WHERE definition.code = selected_code
        AND (
          definition.code = 'INDUSTRIAL_SHOP_PRELIMINARY_SURVEY'
          OR definition.name = '공업사(예비조사표)'
        )
        AND btrim(COALESCE(target_row.business_category, '')) <> '공업사'
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
