-- [종합 해결 쿼리]
-- 이 쿼리를 실행하면 283건 -> 294건으로 정상화되고, 비어있는 '금회예정일', '업종분류' 등이 채워집니다.

-- 1. business_info 테이블 오류 수정 (컬럼이 없어서 발생하는 오류 해결)
ALTER TABLE business_info ADD COLUMN IF NOT EXISTS manager_name VARCHAR(100);

-- 2. measurement_target_business 기존 데이터 업데이트 (금회예정일, 측정일 등 동기화)
UPDATE measurement_target_business t
SET 
    future_measurement_date = s.future_measurement_date,
    measurement_date = s.measurement_date,
    future_measurement_period = s.future_measurement_period,
    business_category = s.business_category,
    measurer = s.measurer,
    business_name = s.business_name -- 혹시 이름이 변경되었을 경우를 대비
FROM measurement_business s
WHERE t.code = s.code 
  AND t.year = s.year 
  AND t.period = s.period
  AND t.year = 2026;

-- 3. measurement_target_business에 누락된 데이터 삽입 (283건 -> 294건으로 증가)
INSERT INTO measurement_target_business (
    code, year, period, business_name, business_number, address, 
    measurement_start_date, measurement_end_date, completion_status, measurer,
    future_measurement_date, measurement_date, future_measurement_period, business_category, is_registered
)
SELECT 
    s.code, s.year, s.period, s.business_name, s.business_number, s.address,
    s.measurement_start_date, s.measurement_end_date, s.completion_status, s.measurer,
    s.future_measurement_date, s.measurement_date, s.future_measurement_period, s.business_category, false
FROM measurement_business s
WHERE s.year = 2026
AND NOT EXISTS (
    SELECT 1 FROM measurement_target_business t 
    WHERE t.code = s.code AND t.year = s.year AND t.period = s.period
);

-- 4. 스키마 캐시 갱신 (반드시 필요)
NOTIFY pgrst, 'reload schema';
