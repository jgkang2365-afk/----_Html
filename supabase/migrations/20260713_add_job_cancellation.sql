-- MES 및 로컬 백그라운드 작업 중단 기능
ALTER TABLE public.mes_sync_queue
  ADD COLUMN IF NOT EXISTS requested_by BIGINT REFERENCES public.users(id);

ALTER TABLE public.mes_sync_queue
  DROP CONSTRAINT IF EXISTS mes_sync_queue_status_check;

ALTER TABLE public.mes_sync_queue
  ADD CONSTRAINT mes_sync_queue_status_check
  CHECK (status IN ('idle', 'pending', 'running', 'cancel_requested', 'success', 'error', 'cancelled'));

ALTER TABLE public.background_jobs
  DROP CONSTRAINT IF EXISTS background_jobs_status_check;

ALTER TABLE public.background_jobs
  ADD CONSTRAINT background_jobs_status_check
  CHECK (status IN ('pending', 'processing', 'cancel_requested', 'success', 'failed', 'cancelled'));

COMMENT ON COLUMN public.background_jobs.status IS 'pending, processing, cancel_requested, success, failed, cancelled';

COMMENT ON COLUMN public.mes_sync_queue.requested_by IS 'MES 수동 동기화를 요청한 로그인 사용자 ID';

