-- 신규 문서 작업의 최소 Realtime wake-up 신호
-- document_generation_jobs에는 개인정보가 포함된 payload가 있으므로 테이블 자체를
-- anon Postgres Changes publication에 노출하지 않고 최소 Broadcast 신호만 전송합니다.

CREATE OR REPLACE FUNCTION public.notify_document_generation_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, realtime
AS $$
DECLARE
  should_notify BOOLEAN := FALSE;
BEGIN
  IF NEW.status = 'PENDING'
     AND NEW.job_type = 'GENERATE_NEW_BUSINESS_DOCUMENTS' THEN
    IF TG_OP = 'INSERT' THEN
      should_notify := TRUE;
    ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
      should_notify := TRUE;
    END IF;
  END IF;

  IF should_notify THEN
    PERFORM realtime.send(
      jsonb_build_object(
        'status', NEW.status,
        'job_type', NEW.job_type
      ),
      'document_generation_pending',
      'document-worker-jobs',
      FALSE
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_document_generation_pending_wakeup
  ON public.document_generation_jobs;
CREATE TRIGGER trg_document_generation_pending_wakeup
AFTER INSERT OR UPDATE OF status ON public.document_generation_jobs
FOR EACH ROW
EXECUTE FUNCTION public.notify_document_generation_pending();

REVOKE ALL ON FUNCTION public.notify_document_generation_pending() FROM PUBLIC;
NOTIFY pgrst, 'reload schema';
