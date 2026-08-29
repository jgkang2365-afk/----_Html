-- measurement_target_business.measurement_month is read by the current
-- preliminary-survey workbench and exists in Production, but it was not part
-- of the checked-in replay chain. Restore the same nullable text contract for
-- fresh Local and Staging databases.

ALTER TABLE public.measurement_target_business
  ADD COLUMN IF NOT EXISTS measurement_month text;
