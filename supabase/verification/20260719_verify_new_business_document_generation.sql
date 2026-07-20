SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('document_templates', 'document_generation_jobs') ORDER BY table_name;

SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ('document_templates', 'document_generation_jobs')
ORDER BY table_name, ordinal_position;

SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'
AND indexname IN ('uq_document_templates_one_active', 'idx_document_generation_jobs_claim');

SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace
AND proname IN ('activate_document_template', 'register_new_business_document_eligibility', 'queue_document_generation_job', 'claim_next_document_generation_job')
ORDER BY proname;

SELECT id, name, public, file_size_limit FROM storage.buckets WHERE id = 'document-templates';
SELECT document_type, measurement_year, measurement_period, version, original_filename, is_active, size_bytes, created_at
FROM public.document_templates ORDER BY measurement_year DESC, measurement_period, document_type, version DESC;
