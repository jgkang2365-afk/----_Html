CREATE TABLE IF NOT EXISTS public.custom_report_templates (
    id BIGSERIAL PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    is_public BOOLEAN NOT NULL DEFAULT FALSE,
    filters JSONB NOT NULL DEFAULT '[]'::jsonb,
    columns JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT custom_report_templates_owner_name_key UNIQUE (owner_id, name),
    CONSTRAINT custom_report_templates_name_not_blank CHECK (length(btrim(name)) > 0),
    CONSTRAINT custom_report_templates_filters_array CHECK (jsonb_typeof(filters) = 'array'),
    CONSTRAINT custom_report_templates_columns_array CHECK (jsonb_typeof(columns) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_custom_report_templates_owner
    ON public.custom_report_templates(owner_id);
CREATE INDEX IF NOT EXISTS idx_custom_report_templates_public
    ON public.custom_report_templates(is_public) WHERE is_public = TRUE;

DROP TRIGGER IF EXISTS update_custom_report_templates_updated_at
    ON public.custom_report_templates;
CREATE TRIGGER update_custom_report_templates_updated_at
    BEFORE UPDATE ON public.custom_report_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE public.custom_report_templates IS '내맘대로 보고서 사용자별/공용 템플릿';
COMMENT ON COLUMN public.custom_report_templates.is_public IS 'TRUE면 모든 로그인 사용자가 조회 가능, 수정/삭제는 소유자만 가능';