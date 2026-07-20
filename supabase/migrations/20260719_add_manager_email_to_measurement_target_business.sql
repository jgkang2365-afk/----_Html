ALTER TABLE public.measurement_target_business
  ADD COLUMN IF NOT EXISTS manager_email TEXT;

COMMENT ON COLUMN public.measurement_target_business.manager_email
  IS '측정대상 사업장 담당자 이메일';

