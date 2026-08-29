-- Fresh schema replay must include the second business deposit field used by
-- journal, sales, survey and business lookup APIs.
ALTER TABLE public.measurement_journal
  ADD COLUMN IF NOT EXISTS deposit_amount_business_2 numeric(15, 2);

NOTIFY pgrst, 'reload schema';
