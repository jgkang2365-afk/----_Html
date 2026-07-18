ALTER TABLE public.background_jobs
  ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_background_jobs_pending_available
  ON public.background_jobs(status, available_at, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_background_jobs_active_national_support_mode
  ON public.background_jobs (
    (payload->>'target_id'),
    (COALESCE(payload->>'mode', 'lookup_only'))
  )
  WHERE job_type = 'national_support'
    AND status IN ('pending', 'processing', 'cancel_requested');

COMMENT ON COLUMN public.background_jobs.available_at IS '작업 실행 가능 시각';
COMMENT ON COLUMN public.background_jobs.attempt_count IS '후속 조회 재시도 횟수';
