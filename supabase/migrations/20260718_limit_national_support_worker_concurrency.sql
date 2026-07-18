-- 여러 로컬 Worker 프로세스가 실행되더라도 건강디딤돌 Chrome은 한 번에 하나만 실행합니다.
DO $$
DECLARE
  active_count integer;
BEGIN
  SELECT count(*)
    INTO active_count
    FROM public.background_jobs
   WHERE job_type = 'national_support'
     AND status = 'processing';

  IF active_count > 1 THEN
    RAISE EXCEPTION
      '건강디딤돌 processing 작업이 %건입니다. 실행 작업을 1건 이하로 정리한 뒤 migration을 다시 실행하세요.',
      active_count;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_background_jobs_one_processing_national_support
ON public.background_jobs ((1))
WHERE job_type = 'national_support'
  AND status = 'processing';

