-- 노동관서 참조값은 문서 생성 시 payload snapshot으로만 고정한다.
-- 기존 매핑의 allowlist 값은 그대로 유지하고, 새 snapshot 필드만 추가한다.
ALTER TABLE public.document_field_mappings
  DROP CONSTRAINT IF EXISTS document_field_mappings_source_field_check;

ALTER TABLE public.document_field_mappings
  ADD CONSTRAINT document_field_mappings_source_field_check
  CHECK (
    source_field IN (
      'measurement_year', 'measurement_period', 'business_id', 'business_code',
      'business_name', 'representative_name', 'address', 'business_category',
      'phone', 'main_product', 'fax', 'total_employees', 'manager_name',
      'manager_email', 'manager_mobile', 'manager_phone', 'manager_contact',
      'invoice_email', 'business_number', 'industrial_accident_number',
      'preliminary_surveyor', 'business_year_period_label',
      'labor_office_name', 'labor_office_phone', 'labor_office_fax'
    )
  );

-- 개발 환경에 이미 등록된 선정 신고서가 있으면 새 snapshot 필드를
-- 같은 이름의 HWPX 누름틀에 연결한다. 정의가 없는 환경에서는 아무 작업도 하지 않는다.
INSERT INTO public.document_field_mappings (
  document_definition_id,
  source_field,
  target_type,
  target_sheet,
  target_address,
  required,
  sort_order
)
SELECT
  definition.id,
  seed.source_field,
  'HWPX_FIELD',
  NULL,
  seed.target_address,
  FALSE,
  seed.sort_order
FROM public.document_definitions definition
JOIN (
  VALUES
    ('labor_office_name', 'labor_office_name', 70),
    ('labor_office_phone', 'labor_office_phone', 80),
    ('labor_office_fax', 'labor_office_fax', 90)
) AS seed(source_field, target_address, sort_order)
  ON definition.name = '작업환경측정기관 선정 신고서'
 AND definition.file_format = 'HWPX'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.document_field_mappings existing
  WHERE existing.document_definition_id = definition.id
    AND existing.target_type = 'HWPX_FIELD'
    AND existing.target_address = seed.target_address
);

NOTIFY pgrst, 'reload schema';
