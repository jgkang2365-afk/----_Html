ALTER TABLE public.measurement_target_business
  ADD COLUMN IF NOT EXISTS business_number TEXT,
  ADD COLUMN IF NOT EXISTS invoice_email TEXT;

COMMENT ON COLUMN public.measurement_target_business.business_number
  IS '신규 등록 시 business_info에서 선택하거나 사용자가 입력한 사업자등록번호 스냅샷';

COMMENT ON COLUMN public.measurement_target_business.invoice_email
  IS '신규 등록 시 business_info에서 선택하거나 사용자가 입력한 계산서 이메일 스냅샷';

-- measurement_business는 이미 (code, year, period) 복합 기본키를 사용한다.
-- 신규 대상 등록도 동일 조합의 동시 중복 저장을 DB에서 최종 차단한다.
CREATE UNIQUE INDEX IF NOT EXISTS uq_measurement_target_business_code_year_period
  ON public.measurement_target_business (code, year, period);
