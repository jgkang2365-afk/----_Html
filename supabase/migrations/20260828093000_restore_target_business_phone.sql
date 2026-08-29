-- Current target create/read flows persist the business phone snapshot. Its
-- original DDL was not present in the checked-in migration chain.

ALTER TABLE public.measurement_target_business
  ADD COLUMN IF NOT EXISTS phone text;
