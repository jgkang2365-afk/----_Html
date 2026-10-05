BEGIN;

-- Local and Production use different exact names for the two active CUSTOM definitions.
-- Keep deleted/history rows and every other document definition unchanged.
DO $$
DECLARE
  general_count integer;
  industrial_count integer;
BEGIN
  SELECT
    count(*) FILTER (WHERE name IN ('일반사업장_예비조사표', '일반사업장(예비조사표)')),
    count(*) FILTER (WHERE name IN ('공업사_예비조사표', '공업사(예비조사표)'))
  INTO general_count, industrial_count
  FROM public.document_definitions
  WHERE is_active = true
    AND deleted_at IS NULL
    AND file_format = 'HWPX'
    AND code ~ '^CUSTOM_[A-F0-9]{32}$'
    AND name IN (
      '일반사업장_예비조사표', '일반사업장(예비조사표)',
      '공업사_예비조사표', '공업사(예비조사표)'
    );

  IF general_count > 1 OR industrial_count > 1 THEN
    RAISE EXCEPTION 'Multiple active CUSTOM preliminary survey definitions found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.document_definitions
    WHERE is_active = true
      AND deleted_at IS NULL
      AND file_format = 'HWPX'
      AND code ~ '^CUSTOM_[A-F0-9]{32}$'
      AND name IN (
        '일반사업장_예비조사표', '일반사업장(예비조사표)',
        '공업사_예비조사표', '공업사(예비조사표)'
      )
      AND filename_pattern NOT IN (
        '{business_name}({document_name}-{short_year}{short_period})',
        '{business_name}(예비조사표-{short_year}{short_period})'
      )
  ) THEN
    RAISE EXCEPTION 'Unexpected active CUSTOM preliminary survey filename pattern';
  END IF;

  UPDATE public.document_definitions
  SET filename_pattern = '{business_name}(예비조사표-{short_year}{short_period})',
      updated_at = CURRENT_TIMESTAMP
  WHERE is_active = true
    AND deleted_at IS NULL
    AND file_format = 'HWPX'
    AND code ~ '^CUSTOM_[A-F0-9]{32}$'
    AND name IN (
      '일반사업장_예비조사표', '일반사업장(예비조사표)',
      '공업사_예비조사표', '공업사(예비조사표)'
    )
    AND filename_pattern = '{business_name}({document_name}-{short_year}{short_period})';
END $$;

COMMIT;
