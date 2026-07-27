-- H0508은 기능 도입 전 신규 등록 화면으로 생성된 건으로 확인되어,
-- 환경별 ID 대신 사업장 식별값 전체를 사용해 문서 생성 자격만 보정한다.
BEGIN;

UPDATE public.measurement_target_business
SET document_generation_enabled = TRUE
WHERE code = 'H0508'
  AND year = 2026
  AND period = '하반기'
  AND business_name = '남영물류산업 (주) YAN5 Manless Mezzanine 공사'
  AND document_generation_enabled IS DISTINCT FROM TRUE;

COMMIT;
