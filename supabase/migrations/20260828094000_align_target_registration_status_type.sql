-- The current UI/API stores the canonical status labels 미실시/실시/거래종료.
-- Older fresh schemas created this column as boolean. Convert only that legacy
-- shape; existing text-based environments remain unchanged.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'measurement_target_business'
      AND column_name = 'is_registered'
      AND data_type = 'boolean'
  ) THEN
    ALTER TABLE public.measurement_target_business
      ALTER COLUMN is_registered DROP DEFAULT;
    ALTER TABLE public.measurement_target_business
      ALTER COLUMN is_registered TYPE text
      USING CASE WHEN is_registered THEN '실시' ELSE '미실시' END;
  END IF;
END $$;

ALTER TABLE public.measurement_target_business
  ALTER COLUMN is_registered SET DEFAULT '미실시';
