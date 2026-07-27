-- document_generation_jobs의 민감 payload를 publication에 노출하지 않고,
-- PENDING INSERT의 최소 wake-up 정보만 Postgres Changes로 전달합니다.
CREATE TABLE IF NOT EXISTS public.document_job_pending_signals (
  job_id UUID PRIMARY KEY REFERENCES public.document_generation_jobs(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status = 'PENDING'),
  job_type TEXT NOT NULL CHECK (job_type = 'GENERATE_NEW_BUSINESS_DOCUMENTS'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.document_job_pending_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_job_pending_signals_realtime_read
  ON public.document_job_pending_signals;
CREATE POLICY document_job_pending_signals_realtime_read
  ON public.document_job_pending_signals
  FOR SELECT
  TO anon, authenticated
  USING (TRUE);
GRANT SELECT ON public.document_job_pending_signals TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.notify_document_generation_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'PENDING'
     AND NEW.job_type = 'GENERATE_NEW_BUSINESS_DOCUMENTS' THEN
    INSERT INTO public.document_job_pending_signals (job_id, status, job_type)
    VALUES (NEW.id, NEW.status, NEW.job_type)
    ON CONFLICT (job_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_document_generation_pending_wakeup
  ON public.document_generation_jobs;
CREATE TRIGGER trg_document_generation_pending_wakeup
AFTER INSERT ON public.document_generation_jobs
FOR EACH ROW
EXECUTE FUNCTION public.notify_document_generation_pending();

REVOKE ALL ON FUNCTION public.notify_document_generation_pending() FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'document_job_pending_signals'
  ) THEN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.document_job_pending_signals;
  END IF;
END
$$;
