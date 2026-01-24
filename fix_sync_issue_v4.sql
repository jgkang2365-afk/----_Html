-- [최종_성공_쿼리_v4]
-- 필수 컬럼 plan_based_year, plan_based_period 모두 추가

-- 1. 컬럼 추가
ALTER TABLE measurement_target_business ADD COLUMN IF NOT EXISTS business_category VARCHAR(100);
ALTER TABLE measurement_target_business ADD COLUMN IF NOT EXISTS future_measurement_date DATE;
ALTER TABLE measurement_target_business ADD COLUMN IF NOT EXISTS measurement_date DATE;
ALTER TABLE measurement_target_business ADD COLUMN IF NOT EXISTS future_measurement_period INT;
ALTER TABLE business_info ADD COLUMN IF NOT EXISTS manager_name VARCHAR(100);

-- 2. 기존 데이터 업데이트
UPDATE measurement_target_business t
SET 
    future_measurement_date = s.future_measurement_date,
    measurement_date = s.measurement_date,
    future_measurement_period = s.future_measurement_period,
    business_category = s.business_category,
    measurer = s.measurer,
    business_name = s.business_name
FROM measurement_business s
WHERE t.code = s.code 
  AND t.year = s.year 
  AND t.period = s.period
  AND t.year = 2026;

-- 3. 누락된 데이터 삽입 (plan_based_year, plan_based_period 추가)
INSERT INTO measurement_target_business (
    code, year, period, business_name, business_number, address, 
    measurement_start_date, measurement_end_date, completion_status, measurer,
    future_measurement_date, measurement_date, future_measurement_period, business_category, is_registered,
    plan_based_year, plan_based_period
)
SELECT 
    s.code, s.year, s.period, s.business_name, s.business_number, s.address,
    s.measurement_start_date, s.measurement_end_date, s.completion_status, s.measurer,
    s.future_measurement_date, s.measurement_date, s.future_measurement_period, s.business_category, false,
    s.year, s.period
FROM measurement_business s
WHERE s.year = 2026
AND NOT EXISTS (
    SELECT 1 FROM measurement_target_business t 
    WHERE t.code = s.code AND t.year = s.year AND t.period = s.period
);

-- 4. 캐시 갱신
NOTIFY pgrst, 'reload schema';
