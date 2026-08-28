-- These columns are part of the application's long-lived runtime contract but
-- were historically added outside the checked-in migration chain. Define them
-- explicitly so a fresh Local/Staging database supports the current main app.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS job text;

ALTER TABLE public.measurement_target_business
  ADD COLUMN IF NOT EXISTS plan_manager text,
  ADD COLUMN IF NOT EXISTS requires_field_preliminary_survey boolean NOT NULL DEFAULT false;
