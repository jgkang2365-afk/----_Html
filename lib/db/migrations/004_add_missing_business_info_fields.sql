-- 사업장정보 테이블에 누락된 필드 추가
-- 사업장정보.xlsx 파일의 모든 컬럼을 반영하기 위한 마이그레이션

ALTER TABLE business_info
ADD COLUMN IF NOT EXISTS postal_code VARCHAR(10),
ADD COLUMN IF NOT EXISTS business_type VARCHAR(100), -- 업태
ADD COLUMN IF NOT EXISTS business_category_code VARCHAR(20), -- 업종코드
ADD COLUMN IF NOT EXISTS business_category VARCHAR(200), -- 업종
ADD COLUMN IF NOT EXISTS office_code VARCHAR(20), -- 관할청코드
ADD COLUMN IF NOT EXISTS office_jurisdiction VARCHAR(100), -- 관할청 (소재지 관할청)
ADD COLUMN IF NOT EXISTS main_product VARCHAR(500), -- 주생산품
ADD COLUMN IF NOT EXISTS male_employees INTEGER, -- 남근로수
ADD COLUMN IF NOT EXISTS female_employees INTEGER, -- 여근로수
ADD COLUMN IF NOT EXISTS management_number VARCHAR(50), -- 관리번호
ADD COLUMN IF NOT EXISTS invoice_email VARCHAR(200), -- 계산서 메일
ADD COLUMN IF NOT EXISTS invoice_manager VARCHAR(100), -- 계산서 담당
ADD COLUMN IF NOT EXISTS manager_position VARCHAR(50), -- 직위
ADD COLUMN IF NOT EXISTS manager_contact VARCHAR(50), -- 연락처
ADD COLUMN IF NOT EXISTS year INTEGER, -- 년도
ADD COLUMN IF NOT EXISTS registration_date DATE, -- 등록일
ADD COLUMN IF NOT EXISTS future_measurement_date DATE, -- 향후측정예상일
ADD COLUMN IF NOT EXISTS notes TEXT; -- 비고

-- 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_business_info_office_jurisdiction ON business_info(office_jurisdiction);
CREATE INDEX IF NOT EXISTS idx_business_info_business_category_code ON business_info(business_category_code);
CREATE INDEX IF NOT EXISTS idx_business_info_year ON business_info(year);
