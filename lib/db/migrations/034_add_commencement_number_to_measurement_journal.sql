-- measurement_journal 테이블에 개시번호(commencement_number) 컬럼 추가
ALTER TABLE measurement_journal ADD COLUMN IF NOT EXISTS commencement_number VARCHAR(50);
