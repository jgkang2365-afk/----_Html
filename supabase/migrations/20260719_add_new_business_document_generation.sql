CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('document-templates', 'document-templates', FALSE, 104857600)
ON CONFLICT (id) DO UPDATE SET public = FALSE, file_size_limit = EXCLUDED.file_size_limit;

CREATE TABLE IF NOT EXISTS public.document_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type TEXT NOT NULL CHECK (document_type IN ('GENERAL_PRELIMINARY_SURVEY', 'FIELD_PRELIMINARY_SURVEY', 'MEASUREMENT_PLAN_XLSM')),
  measurement_year INTEGER NOT NULL CHECK (measurement_year BETWEEN 2000 AND 2100),
  measurement_period TEXT NOT NULL CHECK (measurement_period IN ('상반기', '하반기')),
  version INTEGER NOT NULL CHECK (version > 0),
  original_filename TEXT NOT NULL,
  storage_path TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  uploaded_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  extension TEXT NOT NULL CHECK (extension IN ('.hwpx', '.xlsm')),
  sha256 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (document_type, measurement_year, measurement_period, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_document_templates_one_active
  ON public.document_templates(document_type, measurement_year, measurement_period) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_document_templates_lookup
  ON public.document_templates(measurement_year, measurement_period, document_type, is_active);

CREATE TABLE IF NOT EXISTS public.document_generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id BIGINT NOT NULL REFERENCES public.measurement_target_business(id) ON DELETE CASCADE,
  business_code TEXT NOT NULL,
  measurement_year INTEGER NOT NULL,
  measurement_period TEXT NOT NULL,
  new_business_code_created BOOLEAN NOT NULL DEFAULT FALSE,
  job_type TEXT NOT NULL DEFAULT 'GENERATE_NEW_BUSINESS_DOCUMENTS' CHECK (job_type = 'GENERATE_NEW_BUSINESS_DOCUMENTS'),
  status TEXT NOT NULL DEFAULT 'NOT_REQUESTED' CHECK (status IN ('NOT_REQUESTED', 'PENDING', 'PROCESSING', 'COMPLETED', 'PARTIAL_SUCCESS', 'FAILED')),
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  selected_documents JSONB NOT NULL DEFAULT '[]'::JSONB,
  requested_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  requested_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  result_files JSONB NOT NULL DEFAULT '[]'::JSONB,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  worker_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_id)
);

CREATE INDEX IF NOT EXISTS idx_document_generation_jobs_claim
  ON public.document_generation_jobs(status, requested_at, created_at);
ALTER TABLE public.document_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_generation_jobs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.activate_document_template(p_template_id UUID)
RETURNS SETOF public.document_templates LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE selected_template public.document_templates;
BEGIN
  SELECT * INTO selected_template FROM public.document_templates WHERE id = p_template_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DOCUMENT_TEMPLATE_NOT_FOUND'; END IF;
  UPDATE public.document_templates SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
  WHERE document_type = selected_template.document_type AND measurement_year = selected_template.measurement_year
    AND measurement_period = selected_template.measurement_period AND id <> selected_template.id AND is_active;
  RETURN QUERY UPDATE public.document_templates SET is_active = TRUE, updated_at = CURRENT_TIMESTAMP
  WHERE id = selected_template.id RETURNING *;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_new_business_document_eligibility(p_business_id BIGINT, p_requested_by BIGINT DEFAULT NULL)
RETURNS TABLE(new_business_code_created BOOLEAN, job_id UUID) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target_row public.measurement_target_business; created_job_id UUID;
BEGIN
  SELECT * INTO target_row FROM public.measurement_target_business WHERE id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DOCUMENT_TARGET_NOT_FOUND'; END IF;
  IF EXISTS (SELECT 1 FROM public.business_info WHERE code = target_row.code)
     OR EXISTS (SELECT 1 FROM public.measurement_target_business WHERE code = target_row.code AND id <> target_row.id)
     OR EXISTS (SELECT 1 FROM public.measurement_business WHERE code = target_row.code)
     OR EXISTS (SELECT 1 FROM public.measurement_journal WHERE code = target_row.code AND id <> COALESCE(target_row.journal_id, -1)) THEN
    RETURN QUERY SELECT FALSE, NULL::UUID; RETURN;
  END IF;
  INSERT INTO public.business_info (code, business_name, business_number, address1, phone, fax, representative_name, business_category, invoice_email, created_at, updated_at)
  VALUES (target_row.code, target_row.business_name, target_row.business_number, target_row.address, target_row.phone, target_row.fax, target_row.representative_name, target_row.business_category, target_row.invoice_email, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  ON CONFLICT (code) DO NOTHING;
  IF NOT FOUND THEN RETURN QUERY SELECT FALSE, NULL::UUID; RETURN; END IF;
  INSERT INTO public.document_generation_jobs (business_id, business_code, measurement_year, measurement_period, new_business_code_created, status, requested_by)
  VALUES (target_row.id, target_row.code, target_row.year, target_row.period, TRUE, 'NOT_REQUESTED', p_requested_by)
  ON CONFLICT (business_id) DO UPDATE SET new_business_code_created = TRUE, updated_at = CURRENT_TIMESTAMP
  RETURNING id INTO created_job_id;
  RETURN QUERY SELECT TRUE, created_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_document_generation_job(p_business_id BIGINT, p_payload JSONB, p_selected_documents JSONB, p_requested_by BIGINT DEFAULT NULL)
RETURNS SETOF public.document_generation_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE queued public.document_generation_jobs;
BEGIN
  SELECT * INTO queued FROM public.document_generation_jobs WHERE business_id = p_business_id FOR UPDATE;
  IF NOT FOUND OR NOT queued.new_business_code_created THEN RAISE EXCEPTION 'DOCUMENT_GENERATION_NOT_ELIGIBLE'; END IF;
  IF queued.status IN ('PENDING', 'PROCESSING') THEN RAISE EXCEPTION 'DOCUMENT_GENERATION_ALREADY_RUNNING'; END IF;
  IF queued.status = 'COMPLETED' THEN RAISE EXCEPTION 'DOCUMENT_GENERATION_ALREADY_COMPLETED'; END IF;
  RETURN QUERY UPDATE public.document_generation_jobs SET status = 'PENDING', payload = p_payload,
    selected_documents = p_selected_documents, requested_by = p_requested_by, requested_at = CURRENT_TIMESTAMP,
    started_at = NULL, completed_at = NULL, error_message = NULL, result_files = '[]'::JSONB,
    worker_id = NULL, attempt_count = attempt_count + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = queued.id RETURNING *;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_next_document_generation_job(p_worker_id TEXT)
RETURNS SETOF public.document_generation_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE selected_id UUID;
BEGIN
  SELECT id INTO selected_id FROM public.document_generation_jobs WHERE status = 'PENDING'
  ORDER BY requested_at NULLS LAST, created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF selected_id IS NULL THEN RETURN; END IF;
  RETURN QUERY UPDATE public.document_generation_jobs SET status = 'PROCESSING', started_at = CURRENT_TIMESTAMP,
    worker_id = p_worker_id, updated_at = CURRENT_TIMESTAMP
  WHERE id = selected_id AND status = 'PENDING' RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_document_template(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_new_business_document_eligibility(BIGINT, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.queue_document_generation_job(BIGINT, JSONB, JSONB, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_next_document_generation_job(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_document_template(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_new_business_document_eligibility(BIGINT, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.queue_document_generation_job(BIGINT, JSONB, JSONB, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_next_document_generation_job(TEXT) TO service_role;
NOTIFY pgrst, 'reload schema';
