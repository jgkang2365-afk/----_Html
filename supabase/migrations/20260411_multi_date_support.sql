-- 1. 측정대상사업장 테이블 수정
ALTER TABLE public.measurement_target_business 
ALTER COLUMN measurement_date TYPE TEXT USING measurement_date::TEXT;

ALTER TABLE public.measurement_target_business 
ADD COLUMN IF NOT EXISTS measurement_end_date DATE,
ADD COLUMN IF NOT EXISTS daily_staff JSONB;

-- 2. 예비조사 테이블 수정
ALTER TABLE public.preliminary_survey 
ADD COLUMN IF NOT EXISTS date_details JSONB,
ADD COLUMN IF NOT EXISTS google_event_id TEXT;

-- 3. 주석 추가
COMMENT ON COLUMN public.measurement_target_business.measurement_date IS '측정 시작일 또는 다중 날짜(쉼표 구분)';
COMMENT ON COLUMN public.measurement_target_business.measurement_end_date IS '측정 종료일 (연체 집계용)';
COMMENT ON COLUMN public.measurement_target_business.daily_staff IS '일자별 배정 인력 상세 (JSONB)';
COMMENT ON COLUMN public.preliminary_survey.date_details IS '해당 예비조사 레코드의 상세 정보 (JSONB)';
