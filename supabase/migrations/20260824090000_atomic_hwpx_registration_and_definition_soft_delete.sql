ALTER TABLE public.document_definitions
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_document_definitions_generation_available
  ON public.document_definitions(sort_order, created_at)
  WHERE deleted_at IS NULL AND is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_document_definitions_deleted_by
  ON public.document_definitions(deleted_by)
  WHERE deleted_by IS NOT NULL;

CREATE OR REPLACE FUNCTION public.finalize_hwpx_document_template(
  p_document_definition_id UUID,
  p_measurement_year INTEGER,
  p_measurement_period TEXT,
  p_original_filename TEXT,
  p_storage_path TEXT,
  p_uploaded_by BIGINT,
  p_size_bytes BIGINT,
  p_extension TEXT,
  p_sha256 TEXT,
  p_mappings JSONB
)
RETURNS SETOF public.document_templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  selected_definition public.document_definitions;
  created_template public.document_templates;
  next_version INTEGER;
BEGIN
  SELECT *
  INTO selected_definition
  FROM public.document_definitions
  WHERE id = p_document_definition_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DOCUMENT_DEFINITION_NOT_FOUND';
  END IF;
  IF selected_definition.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'DOCUMENT_DEFINITION_DELETED';
  END IF;
  IF NOT selected_definition.is_active THEN
    RAISE EXCEPTION 'DOCUMENT_DEFINITION_INACTIVE';
  END IF;
  IF selected_definition.file_format <> 'HWPX' OR lower(p_extension) <> '.hwpx' THEN
    RAISE EXCEPTION 'DOCUMENT_TEMPLATE_FORMAT_MISMATCH';
  END IF;
  IF p_mappings IS NULL OR jsonb_typeof(p_mappings) <> 'array'
     OR jsonb_array_length(p_mappings) = 0 THEN
    RAISE EXCEPTION 'DOCUMENT_MAPPING_REQUIRED';
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1
  INTO next_version
  FROM public.document_templates
  WHERE document_definition_id = p_document_definition_id
    AND measurement_year = p_measurement_year
    AND measurement_period = p_measurement_period;

  INSERT INTO public.document_templates (
    document_definition_id, document_type, measurement_year, measurement_period,
    version, original_filename, storage_path, is_active, uploaded_by,
    size_bytes, extension, sha256
  ) VALUES (
    selected_definition.id, selected_definition.code, p_measurement_year,
    p_measurement_period, next_version, p_original_filename, p_storage_path,
    FALSE, p_uploaded_by, p_size_bytes, lower(p_extension), p_sha256
  )
  RETURNING * INTO created_template;

  DELETE FROM public.document_field_mappings
  WHERE document_definition_id = p_document_definition_id;

  INSERT INTO public.document_field_mappings (
    document_definition_id, source_field, target_type, target_sheet,
    target_address, required, default_value, sort_order
  )
  SELECT
    p_document_definition_id, mapping.source_field, mapping.target_type,
    mapping.target_sheet, mapping.target_address, COALESCE(mapping.required, FALSE),
    mapping.default_value, COALESCE(mapping.sort_order, 0)
  FROM jsonb_to_recordset(p_mappings) AS mapping(
    source_field TEXT, target_type TEXT, target_sheet TEXT, target_address TEXT,
    required BOOLEAN, default_value TEXT, sort_order INTEGER
  );

  UPDATE public.document_templates
  SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
  WHERE document_definition_id = p_document_definition_id
    AND measurement_year = p_measurement_year
    AND measurement_period = p_measurement_period
    AND id <> created_template.id
    AND is_active;

  RETURN QUERY
  UPDATE public.document_templates
  SET is_active = TRUE, updated_at = CURRENT_TIMESTAMP
  WHERE id = created_template.id
  RETURNING *;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_document_generation_catalog(
  p_measurement_year INTEGER,
  p_measurement_period TEXT
)
RETURNS TABLE(document_definition JSONB, template JSONB, mappings JSONB)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    to_jsonb(definition),
    CASE WHEN selected_template.id IS NULL THEN NULL ELSE to_jsonb(selected_template) END,
    COALESCE((
      SELECT jsonb_agg(to_jsonb(mapping) ORDER BY mapping.sort_order, mapping.created_at)
      FROM public.document_field_mappings mapping
      WHERE mapping.document_definition_id = definition.id
    ), '[]'::jsonb)
  FROM public.document_definitions definition
  LEFT JOIN LATERAL (
    SELECT candidate.*
    FROM public.document_templates candidate
    WHERE candidate.document_definition_id = definition.id
      AND candidate.measurement_year = p_measurement_year
      AND candidate.measurement_period IN (p_measurement_period, 'annual')
      AND candidate.is_active = TRUE
    ORDER BY (candidate.measurement_period = p_measurement_period) DESC, candidate.version DESC
    LIMIT 1
  ) selected_template ON TRUE
  WHERE definition.deleted_at IS NULL
    AND definition.is_active = TRUE
  ORDER BY definition.sort_order, definition.created_at;
$$;

CREATE OR REPLACE FUNCTION public.activate_document_template(p_template_id UUID)
RETURNS SETOF public.document_templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  selected_template public.document_templates;
  selected_definition public.document_definitions;
  selected_definition_id UUID;
BEGIN
  SELECT document_definition_id INTO selected_definition_id
  FROM public.document_templates
  WHERE id = p_template_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'DOCUMENT_TEMPLATE_NOT_FOUND'; END IF;

  SELECT * INTO selected_definition
  FROM public.document_definitions
  WHERE id = selected_definition_id
  FOR UPDATE;
  IF selected_definition.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'DOCUMENT_DEFINITION_DELETED';
  END IF;
  IF NOT selected_definition.is_active THEN
    RAISE EXCEPTION 'DOCUMENT_DEFINITION_INACTIVE';
  END IF;

  SELECT * INTO selected_template
  FROM public.document_templates
  WHERE id = p_template_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DOCUMENT_TEMPLATE_NOT_FOUND'; END IF;
  IF selected_definition.file_format = 'HWPX' AND NOT EXISTS (
    SELECT 1 FROM public.document_field_mappings mapping
    WHERE mapping.document_definition_id = selected_definition.id
      AND mapping.target_type = 'HWPX_FIELD'
  ) THEN
    RAISE EXCEPTION 'DOCUMENT_MAPPING_REQUIRED';
  END IF;

  UPDATE public.document_templates
  SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
  WHERE document_definition_id = selected_template.document_definition_id
    AND measurement_year = selected_template.measurement_year
    AND measurement_period = selected_template.measurement_period
    AND id <> selected_template.id AND is_active;

  RETURN QUERY UPDATE public.document_templates
  SET is_active = TRUE, updated_at = CURRENT_TIMESTAMP
  WHERE id = selected_template.id RETURNING *;
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
DECLARE
  selected_definition public.document_definitions;
BEGIN
  SELECT * INTO selected_definition
  FROM public.document_definitions
  WHERE id = p_document_definition_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DOCUMENT_DEFINITION_NOT_FOUND'; END IF;
  IF selected_definition.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'DOCUMENT_DEFINITION_DELETED';
  END IF;
  IF p_mappings IS NULL OR jsonb_typeof(p_mappings) <> 'array' THEN
    RAISE EXCEPTION 'DOCUMENT_MAPPINGS_MUST_BE_ARRAY';
  END IF;

  DELETE FROM public.document_field_mappings
  WHERE document_definition_id = p_document_definition_id;

  INSERT INTO public.document_field_mappings (
    document_definition_id, source_field, target_type, target_sheet,
    target_address, required, default_value, sort_order
  )
  SELECT
    p_document_definition_id, mapping.source_field, mapping.target_type,
    mapping.target_sheet, mapping.target_address, COALESCE(mapping.required, FALSE),
    mapping.default_value, COALESCE(mapping.sort_order, 0)
  FROM jsonb_to_recordset(p_mappings) AS mapping(
    source_field TEXT, target_type TEXT, target_sheet TEXT, target_address TEXT,
    required BOOLEAN, default_value TEXT, sort_order INTEGER
  );

  RETURN QUERY
  SELECT * FROM public.document_field_mappings
  WHERE document_definition_id = p_document_definition_id
  ORDER BY sort_order, created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_hwpx_document_template(UUID, INTEGER, TEXT, TEXT, TEXT, BIGINT, BIGINT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_document_generation_catalog(INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_document_field_mappings(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_hwpx_document_template(UUID, INTEGER, TEXT, TEXT, TEXT, BIGINT, BIGINT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_document_generation_catalog(INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.replace_document_field_mappings(UUID, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';
