-- 1. 개시번호 컬럼 추가 (없을 경우)
ALTER TABLE measurement_business ADD COLUMN IF NOT EXISTS commencement_number VARCHAR(50);
ALTER TABLE measurement_journal ADD COLUMN IF NOT EXISTS commencement_number VARCHAR(50);

-- 2. 기존 데이터 정제 (숫자 이외의 문자 제거 - 하이픈 등)
-- NULL이거나 빈 문자열이 아닌 경우에만 숫자만 남기도록 업데이트합니다.
UPDATE business_info SET business_number = regexp_replace(business_number, '[^0-9]', '', 'g') WHERE business_number IS NOT NULL AND business_number != '';
UPDATE measurement_business SET business_number = regexp_replace(business_number, '[^0-9]', '', 'g') WHERE business_number IS NOT NULL AND business_number != '';
UPDATE measurement_business SET industrial_accident_number = regexp_replace(industrial_accident_number, '[^0-9]', '', 'g') WHERE industrial_accident_number IS NOT NULL AND industrial_accident_number != '';
UPDATE measurement_business SET commencement_number = regexp_replace(commencement_number, '[^0-9]', '', 'g') WHERE commencement_number IS NOT NULL AND commencement_number != '';

UPDATE measurement_journal SET business_number = regexp_replace(business_number, '[^0-9]', '', 'g') WHERE business_number IS NOT NULL AND business_number != '';
UPDATE measurement_journal SET industrial_accident_number = regexp_replace(industrial_accident_number, '[^0-9]', '', 'g') WHERE industrial_accident_number IS NOT NULL AND industrial_accident_number != '';
UPDATE measurement_journal SET commencement_number = regexp_replace(commencement_number, '[^0-9]', '', 'g') WHERE commencement_number IS NOT NULL AND commencement_number != '';

-- 3. 자릿수 및 숫자 형식 제약 조건 추가 (NULL 또는 빈 값 허용)
-- 사업자등록번호: 정확히 10자리 숫자
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_business_info_number_format') THEN
        ALTER TABLE business_info ADD CONSTRAINT check_business_info_number_format CHECK (business_number IS NULL OR business_number = '' OR business_number ~ '^\d{10}$');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_measurement_business_number_format') THEN
        ALTER TABLE measurement_business ADD CONSTRAINT check_measurement_business_number_format CHECK (business_number IS NULL OR business_number = '' OR business_number ~ '^\d{10}$');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_measurement_journal_number_format') THEN
        ALTER TABLE measurement_journal ADD CONSTRAINT check_measurement_journal_number_format CHECK (business_number IS NULL OR business_number = '' OR business_number ~ '^\d{10}$');
    END IF;
END $$;

-- 산재관리번호: 정확히 11자리 숫자
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_measurement_business_sanjae_format') THEN
        ALTER TABLE measurement_business ADD CONSTRAINT check_measurement_business_sanjae_format CHECK (industrial_accident_number IS NULL OR industrial_accident_number = '' OR industrial_accident_number ~ '^\d{11}$');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_measurement_journal_sanjae_format') THEN
        ALTER TABLE measurement_journal ADD CONSTRAINT check_measurement_journal_sanjae_format CHECK (industrial_accident_number IS NULL OR industrial_accident_number = '' OR industrial_accident_number ~ '^\d{11}$');
    END IF;
END $$;

-- 개시번호: 정확히 11자리 숫자
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_measurement_business_commencement_format') THEN
        ALTER TABLE measurement_business ADD CONSTRAINT check_measurement_business_commencement_format CHECK (commencement_number IS NULL OR commencement_number = '' OR commencement_number ~ '^\d{11}$');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_measurement_journal_commencement_format') THEN
        ALTER TABLE measurement_journal ADD CONSTRAINT check_measurement_journal_commencement_format CHECK (commencement_number IS NULL OR commencement_number = '' OR commencement_number ~ '^\d{11}$');
    END IF;
END $$;
