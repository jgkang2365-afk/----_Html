-- 문서 매핑 source allowlist에 예비조사 날짜 세 필드만 추가한다.
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
      'preliminary_survey_year', 'preliminary_survey_month', 'preliminary_survey_day',
      'preliminary_surveyor', 'business_year_period_label',
      'labor_office_name', 'labor_office_phone', 'labor_office_fax'
    )
  );
