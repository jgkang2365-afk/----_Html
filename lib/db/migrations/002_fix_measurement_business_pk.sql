-- measurement_business 테이블 PRIMARY KEY 수정
-- code만 PK인 것을 (code, year, period) 복합키로 변경
-- 생성일: 2025-01-06

-- 1. 외래키 제약조건 일시적으로 제거
ALTER TABLE measurement_journal DROP CONSTRAINT IF EXISTS fk_measurement_journal_code;
ALTER TABLE preliminary_survey DROP CONSTRAINT IF EXISTS fk_preliminary_survey_code;

-- 2. 기존 PRIMARY KEY 제약조건 제거
ALTER TABLE measurement_business DROP CONSTRAINT IF EXISTS measurement_business_pkey CASCADE;

-- 3. 새로운 복합 PRIMARY KEY 생성
ALTER TABLE measurement_business ADD PRIMARY KEY (code, year, period);

-- 4. 외래키 재생성
-- measurement_journal은 (code, measurement_year, measurement_period)로 복합키 전체 참조
ALTER TABLE measurement_journal 
  ADD CONSTRAINT fk_measurement_journal_code 
  FOREIGN KEY (code, measurement_year, measurement_period) 
  REFERENCES measurement_business(code, year, period);

-- preliminary_survey는 code만 참조하므로 외래키 제거 (또는 나중에 복합키로 변경)
-- 현재는 외래키 없이 사용 (애플리케이션 레벨에서 참조 무결성 관리)

