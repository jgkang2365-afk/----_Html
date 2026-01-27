-- 측정사업장 테이블에 개시번호 컬럼 추가
ALTER TABLE measurement_business ADD COLUMN IF NOT EXISTS commencement_number VARCHAR(50);
