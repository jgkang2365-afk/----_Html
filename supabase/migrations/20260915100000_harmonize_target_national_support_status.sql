-- Fresh-replay compatibility: historical target status used '지원' while the
-- canonical operating value is '대상'. Existing canonical databases are no-op.
DO $$
DECLARE
  unexpected_values text;
  status_constraint_definition text;
  status_constraint_values text[];
BEGIN
  IF to_regclass('public.measurement_target_business') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'measurement_target_business'
         AND column_name = 'national_support_status'
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '42P01', MESSAGE = 'TARGET_NATIONAL_SUPPORT_STATUS_NOT_FOUND';
  END IF;

  SELECT string_agg(quote_literal(national_support_status), ', ' ORDER BY national_support_status)
    INTO unexpected_values
  FROM (
    SELECT DISTINCT national_support_status
    FROM public.measurement_target_business
    WHERE national_support_status IS NOT NULL
      AND national_support_status NOT IN ('지원', '대상', '비대상')
  ) values_found;

  IF unexpected_values IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'TARGET_NATIONAL_SUPPORT_STATUS_UNEXPECTED_VALUE',
      DETAIL = unexpected_values;
  END IF;

  SELECT pg_get_constraintdef(constraint_row.oid)
    INTO status_constraint_definition
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.measurement_target_business'::regclass
    AND constraint_row.conname = 'measurement_target_business_national_support_status_check'
    AND constraint_row.contype = 'c';

  SELECT array_agg(token[1] ORDER BY token[1])
    INTO status_constraint_values
  FROM regexp_matches(status_constraint_definition, '''([^'']*)''', 'g') token;

  IF status_constraint_definition IS NOT NULL
     AND status_constraint_values <@ ARRAY['대상', '비대상']
     AND '대상' = ANY(status_constraint_values)
     AND '비대상' = ANY(status_constraint_values) THEN
    -- Production's canonical constraint is already present: intentionally no-op.
    RETURN;
  END IF;

  IF status_constraint_definition IS NOT NULL THEN
    IF NOT (
      status_constraint_values <@ ARRAY['지원', '비대상']
      AND '지원' = ANY(status_constraint_values)
      AND '비대상' = ANY(status_constraint_values)
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'TARGET_NATIONAL_SUPPORT_STATUS_CONSTRAINT_UNRECOGNIZED',
        DETAIL = status_constraint_definition;
    END IF;

    -- Only the known historical target constraint is removed, inside this transaction.
    ALTER TABLE public.measurement_target_business
      DROP CONSTRAINT measurement_target_business_national_support_status_check;
  END IF;

  UPDATE public.measurement_target_business
  SET national_support_status = '대상'
  WHERE national_support_status = '지원';

  ALTER TABLE public.measurement_target_business
    ADD CONSTRAINT measurement_target_business_national_support_status_check
    CHECK (
      national_support_status IS NULL
      OR national_support_status IN ('대상', '비대상')
    );
END;
$$;
