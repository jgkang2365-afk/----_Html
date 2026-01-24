-- Fix incorrect national_support_status where result contains '비대상' but status was '지원'
-- This fixes the logic error where '비대상' contains '대상' and was incorrectly marked as '지원'

-- Update national_support_application
UPDATE national_support_application
SET national_support_status = '비대상',
    updated_at = NOW()
WHERE result LIKE '%비대상%' 
  AND national_support_status = '지원';

-- Update measurement_journal (sync with application status)
UPDATE measurement_journal mj
SET national_support_status = '비대상',
    updated_at = NOW()
FROM national_support_application nsa
WHERE mj.code = nsa.code
  AND mj.measurement_year = nsa.year
  AND mj.measurement_period = nsa.period
  AND nsa.result LIKE '%비대상%'
  AND mj.national_support_status = '지원';
