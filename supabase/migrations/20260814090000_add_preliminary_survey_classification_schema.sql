BEGIN;

ALTER TABLE public.measurement_target_business
  ADD COLUMN IF NOT EXISTS business_type text,
  ADD COLUMN IF NOT EXISTS process_changed boolean;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.measurement_target_business'::regclass
      AND conname = 'measurement_target_business_business_type_check'
  ) THEN
    ALTER TABLE public.measurement_target_business
      ADD CONSTRAINT measurement_target_business_business_type_check
      CHECK (business_type IS NULL OR business_type IN ('existing', 'first_measurement', 'external_new'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.preliminary_survey_policy_settings (
  policy_key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  effective_start_year integer,
  effective_start_period text,
  effective_start_measurement_date date,
  updated_by integer REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT preliminary_survey_policy_key_check
    CHECK (policy_key IN ('process_changed_preliminary_survey')),
  CONSTRAINT preliminary_survey_policy_period_check
    CHECK (effective_start_period IS NULL OR effective_start_period IN ('상반기', '하반기')),
  CONSTRAINT preliminary_survey_policy_effective_fields_check
    CHECK (
      NOT enabled OR (
        effective_start_year IS NOT NULL
        AND effective_start_period IS NOT NULL
        AND effective_start_measurement_date IS NOT NULL
      )
    )
);

DROP TRIGGER IF EXISTS update_preliminary_survey_policy_settings_updated_at
  ON public.preliminary_survey_policy_settings;
CREATE TRIGGER update_preliminary_survey_policy_settings_updated_at
  BEFORE UPDATE ON public.preliminary_survey_policy_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.preliminary_survey_policy_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.preliminary_survey_policy_settings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.preliminary_survey_policy_settings TO service_role;

INSERT INTO public.preliminary_survey_policy_settings (
  policy_key,
  enabled,
  effective_start_year,
  effective_start_period,
  effective_start_measurement_date
)
VALUES ('process_changed_preliminary_survey', false, NULL, NULL, NULL)
ON CONFLICT (policy_key) DO NOTHING;

COMMIT;
