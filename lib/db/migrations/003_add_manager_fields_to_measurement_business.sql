-- measurement_business 테이블에 담당자 정보 필드 추가
-- 생성일: 2025-01-27
-- Supabase SQL Editor에서 실행하세요.

ALTER TABLE measurement_business
ADD COLUMN IF NOT EXISTS manager_name VARCHAR(100);

ALTER TABLE measurement_business
ADD COLUMN IF NOT EXISTS manager_position VARCHAR(50);

ALTER TABLE measurement_business
ADD COLUMN IF NOT EXISTS manager_mobile VARCHAR(20);

ALTER TABLE measurement_business
ADD COLUMN IF NOT EXISTS manager_email VARCHAR(100);

ALTER TABLE measurement_business
ADD COLUMN IF NOT EXISTS invoice_email VARCHAR(100);

ALTER TABLE measurement_business
ADD COLUMN IF NOT EXISTS industrial_accident_number VARCHAR(50);

ALTER TABLE measurement_business
ADD COLUMN IF NOT EXISTS representative_name VARCHAR(100);
