-- 적용 연도는 그대로 유지하면서, 같은 연도의 상·하반기에서 차순위로 사용할
-- 연간 공통 문서 양식 저장값 annual을 허용한다.
ALTER TABLE public.document_templates
  DROP CONSTRAINT IF EXISTS document_templates_measurement_period_check;

ALTER TABLE public.document_templates
  ADD CONSTRAINT document_templates_measurement_period_check
  CHECK (measurement_period IN ('상반기', '하반기', 'annual'));

-- uq_document_templates_one_active는 measurement_period를 포함하므로
-- annual도 상반기·하반기와 독립적인 활성 기본 양식 범위를 유지한다.
NOTIFY pgrst, 'reload schema';
