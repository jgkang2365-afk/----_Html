-- public.measurement_target_business 테이블에 geocode_provider 컬럼 추가
ALTER TABLE public.measurement_target_business
  ADD COLUMN IF NOT EXISTS geocode_provider text;

COMMENT ON COLUMN public.measurement_target_business.geocode_provider IS '좌표 변환 API 공급자 (kakao, juso 등)';
