-- measurement_business 테이블에 national_support_status 컬럼 추가 (v2)
-- Supabase 스키마 캐시 문제 해결을 위한 버전

-- 기존 컬럼 삭제 (있는 경우)
ALTER TABLE measurement_business 
DROP COLUMN IF EXISTS national_support_status;

-- 컬럼 추가
ALTER TABLE measurement_business
ADD COLUMN national_support_status VARCHAR(20) CHECK (national_support_status IN ('지원', '비대상'));

-- 기존 인덱스 삭제 (있는 경우)
DROP INDEX IF EXISTS idx_measurement_business_national_support;

-- 인덱스 추가 (검색 최적화)
CREATE INDEX idx_measurement_business_national_support 
ON measurement_business(national_support_status);
