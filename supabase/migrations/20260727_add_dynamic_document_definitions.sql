-- 문서 종류·입력 매핑을 코드에서 분리하고 기존 3종 템플릿을 같은 트랜잭션에서 연결한다.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.document_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  file_format TEXT NOT NULL CHECK (file_format IN ('HWPX', 'XLSX', 'XLSM')),
  filename_pattern TEXT NOT NULL
    CHECK (
      btrim(filename_pattern) <> ''
      AND filename_pattern !~* '\.(hwpx|xlsx|xlsm)$'
    ),
  default_selected BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.document_field_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_definition_id UUID NOT NULL
    REFERENCES public.document_definitions(id) ON DELETE RESTRICT,
  source_field TEXT NOT NULL CHECK (
    source_field IN (
      'measurement_year', 'measurement_period', 'business_id', 'business_code',
      'business_name', 'representative_name', 'address', 'business_category',
      'phone', 'main_product', 'fax', 'total_employees', 'manager_name',
      'manager_email', 'manager_mobile', 'manager_phone', 'manager_contact',
      'invoice_email', 'business_number', 'industrial_accident_number',
      'preliminary_surveyor', 'business_year_period_label'
    )
  ),
  target_type TEXT NOT NULL CHECK (target_type IN ('HWPX_FIELD', 'EXCEL_CELL')),
  target_sheet TEXT,
  target_address TEXT NOT NULL CHECK (btrim(target_address) <> ''),
  required BOOLEAN NOT NULL DEFAULT FALSE,
  default_value TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT document_field_mappings_target_shape CHECK (
    (
      target_type = 'HWPX_FIELD'
      AND target_sheet IS NULL
    )
    OR (
      target_type = 'EXCEL_CELL'
      AND target_sheet IS NOT NULL
      AND btrim(target_sheet) <> ''
      AND target_address ~ '^[A-Z]{1,3}[1-9][0-9]*$'
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_document_field_mappings_hwpx_target
  ON public.document_field_mappings(document_definition_id, target_address)
  WHERE target_type = 'HWPX_FIELD';

CREATE UNIQUE INDEX IF NOT EXISTS uq_document_field_mappings_excel_target
  ON public.document_field_mappings(document_definition_id, target_sheet, target_address)
  WHERE target_type = 'EXCEL_CELL';

CREATE INDEX IF NOT EXISTS idx_document_field_mappings_definition_sort
  ON public.document_field_mappings(document_definition_id, sort_order, created_at);

INSERT INTO public.document_definitions (
  code, name, file_format, filename_pattern, default_selected, sort_order, is_active
)
VALUES
  (
    'GENERAL_PRELIMINARY_SURVEY',
    '일반 예비조사표',
    'HWPX',
    '{business_name}(예비조사표-{short_year}{short_period})',
    TRUE,
    10,
    TRUE
  ),
  (
    'FIELD_PRELIMINARY_SURVEY',
    '현장 예비조사표',
    'HWPX',
    '{business_name}(현장 예비조사표-{short_year}{short_period})',
    TRUE,
    20,
    TRUE
  ),
  (
    'MEASUREMENT_PLAN_XLSM',
    '화학물질입력 및 측정계획',
    'XLSM',
    '★ {business_name}({short_year}{short_period})_화학물질입력 및 측정계획(V2.0)',
    TRUE,
    30,
    TRUE
  )
ON CONFLICT (code) DO NOTHING;

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
    ('GENERAL_PRELIMINARY_SURVEY', 'measurement_year', 'measurement_year', 10),
    ('GENERAL_PRELIMINARY_SURVEY', 'measurement_period', 'measurement_period', 20),
    ('GENERAL_PRELIMINARY_SURVEY', 'business_name', 'business_name', 30),
    ('GENERAL_PRELIMINARY_SURVEY', 'representative_name', 'representative_name', 40),
    ('GENERAL_PRELIMINARY_SURVEY', 'address', 'address', 50),
    ('GENERAL_PRELIMINARY_SURVEY', 'business_category', 'business_category', 60),
    ('GENERAL_PRELIMINARY_SURVEY', 'phone', 'phone', 70),
    ('GENERAL_PRELIMINARY_SURVEY', 'main_product', 'main_product', 80),
    ('GENERAL_PRELIMINARY_SURVEY', 'fax', 'fax', 90),
    ('GENERAL_PRELIMINARY_SURVEY', 'total_employees', 'total_employees', 100),
    ('GENERAL_PRELIMINARY_SURVEY', 'manager_name', 'manager_name', 110),
    ('GENERAL_PRELIMINARY_SURVEY', 'manager_email', 'manager_email', 120),
    ('GENERAL_PRELIMINARY_SURVEY', 'manager_contact', 'manager_contact', 130),
    ('GENERAL_PRELIMINARY_SURVEY', 'preliminary_surveyor', 'preliminary_surveyor', 140),
    ('GENERAL_PRELIMINARY_SURVEY', 'business_number', 'business_number', 150),
    ('GENERAL_PRELIMINARY_SURVEY', 'industrial_accident_number', 'industrial_accident_number', 160),
    ('FIELD_PRELIMINARY_SURVEY', 'measurement_year', 'measurement_year', 10),
    ('FIELD_PRELIMINARY_SURVEY', 'measurement_period', 'measurement_period', 20),
    ('FIELD_PRELIMINARY_SURVEY', 'business_name', 'business_name', 30),
    ('FIELD_PRELIMINARY_SURVEY', 'representative_name', 'representative_name', 40),
    ('FIELD_PRELIMINARY_SURVEY', 'address', 'address', 50),
    ('FIELD_PRELIMINARY_SURVEY', 'business_category', 'business_category', 60),
    ('FIELD_PRELIMINARY_SURVEY', 'phone', 'phone', 70),
    ('FIELD_PRELIMINARY_SURVEY', 'main_product', 'main_product', 80),
    ('FIELD_PRELIMINARY_SURVEY', 'fax', 'fax', 90),
    ('FIELD_PRELIMINARY_SURVEY', 'total_employees', 'total_employees', 100),
    ('FIELD_PRELIMINARY_SURVEY', 'manager_name', 'manager_name', 110),
    ('FIELD_PRELIMINARY_SURVEY', 'manager_email', 'manager_email', 120),
    ('FIELD_PRELIMINARY_SURVEY', 'manager_contact', 'manager_contact', 130)
) AS seed(code, source_field, target_address, sort_order)
  ON seed.code = definition.code
WHERE NOT EXISTS (
  SELECT 1
  FROM public.document_field_mappings existing
  WHERE existing.document_definition_id = definition.id
)
ON CONFLICT DO NOTHING;

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
  'EXCEL_CELL',
  '측정계획(양식)',
  seed.target_address,
  FALSE,
  seed.sort_order
FROM public.document_definitions definition
JOIN (
  VALUES
    ('business_year_period_label', 'B1', 10),
    ('manager_name', 'G1', 20),
    ('manager_email', 'C2', 30),
    ('manager_contact', 'F2', 40),
    ('invoice_email', 'I2', 50)
) AS seed(source_field, target_address, sort_order)
  ON definition.code = 'MEASUREMENT_PLAN_XLSM'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.document_field_mappings existing
  WHERE existing.document_definition_id = definition.id
)
ON CONFLICT DO NOTHING;

ALTER TABLE public.document_templates
  ADD COLUMN IF NOT EXISTS document_definition_id UUID
    REFERENCES public.document_definitions(id) ON DELETE RESTRICT;

UPDATE public.document_templates template
SET document_definition_id = definition.id
FROM public.document_definitions definition
WHERE template.document_definition_id IS NULL
  AND definition.code = template.document_type;

ALTER TABLE public.document_templates
  ALTER COLUMN document_definition_id SET NOT NULL;

ALTER TABLE public.document_templates
  DROP CONSTRAINT IF EXISTS document_templates_document_type_check;

ALTER TABLE public.document_templates
  DROP CONSTRAINT IF EXISTS document_templates_extension_check;

ALTER TABLE public.document_templates
  ADD CONSTRAINT document_templates_extension_check
  CHECK (extension IN ('.hwpx', '.xlsx', '.xlsm'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_document_templates_definition_version
  ON public.document_templates(
    document_definition_id,
    measurement_year,
    measurement_period,
    version
  );

DROP INDEX IF EXISTS public.uq_document_templates_one_active;
CREATE UNIQUE INDEX uq_document_templates_one_active
  ON public.document_templates(document_definition_id, measurement_year, measurement_period)
  WHERE is_active;

DROP INDEX IF EXISTS public.idx_document_templates_lookup;
CREATE INDEX idx_document_templates_lookup
  ON public.document_templates(
    measurement_year,
    measurement_period,
    document_definition_id,
    is_active
  );

CREATE OR REPLACE FUNCTION public.activate_document_template(p_template_id UUID)
RETURNS SETOF public.document_templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  selected_template public.document_templates;
  selected_definition public.document_definitions;
BEGIN
  SELECT *
  INTO selected_template
  FROM public.document_templates
  WHERE id = p_template_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DOCUMENT_TEMPLATE_NOT_FOUND';
  END IF;

  SELECT *
  INTO selected_definition
  FROM public.document_definitions
  WHERE id = selected_template.document_definition_id;

  IF NOT selected_definition.is_active THEN
    RAISE EXCEPTION 'DOCUMENT_DEFINITION_INACTIVE';
  END IF;

  IF selected_definition.file_format = 'HWPX'
     AND NOT EXISTS (
       SELECT 1
       FROM public.document_field_mappings mapping
       WHERE mapping.document_definition_id = selected_definition.id
         AND mapping.target_type = 'HWPX_FIELD'
     ) THEN
    RAISE EXCEPTION 'DOCUMENT_MAPPING_REQUIRED';
  END IF;

  UPDATE public.document_templates
  SET is_active = FALSE,
      updated_at = CURRENT_TIMESTAMP
  WHERE document_definition_id = selected_template.document_definition_id
    AND measurement_year = selected_template.measurement_year
    AND measurement_period = selected_template.measurement_period
    AND id <> selected_template.id
    AND is_active;

  RETURN QUERY
  UPDATE public.document_templates
  SET is_active = TRUE,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = selected_template.id
  RETURNING *;
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_document_field_mappings(
  p_document_definition_id UUID,
  p_mappings JSONB
)
RETURNS SETOF public.document_field_mappings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.document_definitions
    WHERE id = p_document_definition_id
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'DOCUMENT_DEFINITION_NOT_FOUND';
  END IF;

  IF p_mappings IS NULL OR jsonb_typeof(p_mappings) <> 'array' THEN
    RAISE EXCEPTION 'DOCUMENT_MAPPINGS_MUST_BE_ARRAY';
  END IF;

  DELETE FROM public.document_field_mappings
  WHERE document_definition_id = p_document_definition_id;

  INSERT INTO public.document_field_mappings (
    document_definition_id,
    source_field,
    target_type,
    target_sheet,
    target_address,
    required,
    default_value,
    sort_order
  )
  SELECT
    p_document_definition_id,
    mapping.source_field,
    mapping.target_type,
    mapping.target_sheet,
    mapping.target_address,
    COALESCE(mapping.required, FALSE),
    mapping.default_value,
    COALESCE(mapping.sort_order, 0)
  FROM jsonb_to_recordset(p_mappings) AS mapping(
    source_field TEXT,
    target_type TEXT,
    target_sheet TEXT,
    target_address TEXT,
    required BOOLEAN,
    default_value TEXT,
    sort_order INTEGER
  );

  RETURN QUERY
  SELECT *
  FROM public.document_field_mappings
  WHERE document_definition_id = p_document_definition_id
  ORDER BY sort_order, created_at;
END;
$$;

ALTER TABLE public.document_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_field_mappings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION public.activate_document_template(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_document_field_mappings(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_document_template(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.replace_document_field_mappings(UUID, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';
