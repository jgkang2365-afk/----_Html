-- background_jobs의 민감 payload를 Realtime publication에 직접 노출하지 않고,
-- pending 작업의 존재와 실행 가능 시각만 로컬 Worker에 전달합니다.
CREATE TABLE IF NOT EXISTS public.background_job_pending_signals (
  job_id UUID PRIMARY KEY REFERENCES public.background_jobs(id) ON DELETE CASCADE,
  job_type VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL CHECK (status = 'pending'),
  available_at TIMESTAMPTZ NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.background_job_pending_signals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.background_job_pending_signals FROM anon, authenticated;
GRANT SELECT ON public.background_job_pending_signals TO service_role;

CREATE OR REPLACE FUNCTION public.notify_background_job_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    INSERT INTO public.background_job_pending_signals (
      job_id,
      job_type,
      status,
      available_at,
      changed_at
    )
    VALUES (
      NEW.id,
      NEW.job_type,
      NEW.status,
      NEW.available_at,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (job_id) DO UPDATE SET
      job_type = EXCLUDED.job_type,
      status = EXCLUDED.status,
      available_at = EXCLUDED.available_at,
      changed_at = CURRENT_TIMESTAMP;
  ELSE
    DELETE FROM public.background_job_pending_signals
    WHERE job_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_background_job_pending_wakeup
  ON public.background_jobs;
CREATE TRIGGER trg_background_job_pending_wakeup
AFTER INSERT OR UPDATE OF status, available_at
ON public.background_jobs
FOR EACH ROW
EXECUTE FUNCTION public.notify_background_job_pending();

REVOKE ALL ON FUNCTION public.notify_background_job_pending() FROM PUBLIC;

INSERT INTO public.background_job_pending_signals (
  job_id,
  job_type,
  status,
  available_at
)
SELECT id, job_type, status, available_at
FROM public.background_jobs
WHERE status = 'pending'
ON CONFLICT (job_id) DO UPDATE SET
  job_type = EXCLUDED.job_type,
  status = EXCLUDED.status,
  available_at = EXCLUDED.available_at,
  changed_at = CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'background_job_pending_signals'
  ) THEN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.background_job_pending_signals;
  END IF;
END
$$;
