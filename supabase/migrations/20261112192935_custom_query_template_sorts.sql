ALTER TABLE public.custom_report_templates
  ADD COLUMN sorts JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.custom_report_templates
  ADD CONSTRAINT custom_report_templates_sorts_array
  CHECK (jsonb_typeof(sorts) = 'array');

COMMENT ON COLUMN public.custom_report_templates.sorts IS
  '우선순위 순서의 사용자 지정 결과 정렬 조건. 검색 환경설정과 독립.';
