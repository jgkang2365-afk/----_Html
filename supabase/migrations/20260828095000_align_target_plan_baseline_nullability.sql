-- Integrated target registration no longer requires a previous plan baseline.
-- Older fresh schemas retained NOT NULL from the first table definition.

ALTER TABLE public.measurement_target_business
  ALTER COLUMN plan_based_year DROP NOT NULL,
  ALTER COLUMN plan_based_period DROP NOT NULL;
