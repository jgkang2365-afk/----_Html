-- measurement_journal 테이블에 측정일수 컬럼 추가
ALTER TABLE public.measurement_journal 
ADD COLUMN IF NOT EXISTS measurement_days INTEGER;

COMMENT ON COLUMN public.measurement_journal.measurement_days IS '측정일수';
