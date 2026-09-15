-- 건강디딤돌 전용 대표자 override와 실행 snapshot. 기존 데이터 backfill은 하지 않는다.
ALTER TABLE public.business_info
  ADD COLUMN IF NOT EXISTS national_support_representative_name text NULL;

ALTER TABLE public.national_support_application
  ADD COLUMN IF NOT EXISTS representative_name text NULL;

-- 신청 결과가 실제 조회/업로드로 확정된 것인지, 관리자 수동 확인의
-- placeholder인지를 구분한다. NULL은 이 migration 이전의 legacy 행이다.
ALTER TABLE public.national_support_application
  ADD COLUMN IF NOT EXISTS status_source text NULL;

ALTER TABLE public.national_support_application
  DROP CONSTRAINT IF EXISTS national_support_application_status_source_check;

ALTER TABLE public.national_support_application
  ADD CONSTRAINT national_support_application_status_source_check
  CHECK (status_source IS NULL OR status_source IN ('manual_internal', 'confirmed_result'));

-- 수동 확정 RPC가 쓰는 상태를 기존 queue 상태 제약에도 허용한다.
DO $$
DECLARE
  constraint_record RECORD;
BEGIN
  FOR constraint_record IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.measurement_target_business'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%sync_status%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.measurement_target_business DROP CONSTRAINT %I',
      constraint_record.conname
    );
  END LOOP;
END $$;

ALTER TABLE public.measurement_target_business
  ADD CONSTRAINT measurement_target_business_sync_status_check
  CHECK (
    sync_status IS NULL OR sync_status IN (
      '정보부족', '조회대기', '조회중', '확인대기', '신청중',
      '신청완료대기', '비대상대기', '수동확인필요', '수동확정', '일지 등록 · 제외',
      '성공', '실패', '대기'
    )
  );

DROP TRIGGER IF EXISTS national_support_application_representative_snapshot ON public.national_support_application;
DROP FUNCTION IF EXISTS public.snapshot_national_support_representative();

-- 대표자 snapshot은 실제 NATIONAL_SUPPORT job의 terminal projection에서만
-- 확정한다. 수동 상태 placeholder는 execution이 아니므로 NULL을 유지한다.
CREATE OR REPLACE FUNCTION public.complete_national_support_automation_job(
  p_job_id UUID, p_worker_id TEXT, p_status TEXT, p_result_code TEXT,
  p_result_payload JSONB, p_error_code TEXT, p_error_message TEXT,
  p_target_id BIGINT, p_sync_status TEXT, p_sync_error_message TEXT,
  p_effect_confirmed BOOLEAN DEFAULT FALSE
) RETURNS public.automation_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE completed public.automation_jobs;
DECLARE final_support_status TEXT;
DECLARE final_application_status TEXT;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('COMPLETED','FAILED','CONFIRM_REQUIRED') OR
     p_sync_status IS NULL OR p_sync_status NOT IN ('성공','일지 등록 · 제외','조회대기','비대상대기','확인대기','신청완료대기','수동확인필요','실패') THEN
    RAISE EXCEPTION 'NATIONAL_SUPPORT_TERMINAL_ARGUMENT_INVALID';
  END IF;
  final_support_status := CASE p_result_code WHEN 'SUPPORT' THEN '대상'
    WHEN 'NON_SUPPORT' THEN '비대상' ELSE NULL END;
  final_application_status := CASE p_result_code WHEN 'SUPPORT' THEN '○'
    WHEN 'NON_SUPPORT' THEN '신청취소' ELSE NULL END;
  IF final_support_status IS NOT NULL AND (p_status <> 'COMPLETED' OR p_sync_status <> '성공') THEN
    RAISE EXCEPTION 'NATIONAL_SUPPORT_FINAL_STATUS_INVALID';
  END IF;
  UPDATE public.automation_jobs job SET status=p_status,
    result_code=p_result_code, result_payload=p_result_payload,
    error_code=p_error_code, error_message=p_error_message,
    progress_stage=CASE p_status WHEN 'FAILED' THEN '조회 실패'
      WHEN 'CONFIRM_REQUIRED' THEN '외부 효과 확인 필요' ELSE '결과 확인' END,
    progress_percent=100, finished_at=CURRENT_TIMESTAMP,
    effect_confirmed_at=CASE WHEN p_effect_confirmed THEN CURRENT_TIMESTAMP ELSE job.effect_confirmed_at END,
    updated_at=CURRENT_TIMESTAMP
  WHERE job.id=p_job_id AND job.job_type='NATIONAL_SUPPORT'
    AND job.worker_id=p_worker_id AND job.status='RUNNING'
    AND job.request_payload->>'target_id'=p_target_id::text
  RETURNING job.* INTO completed;
  IF NOT FOUND THEN RAISE EXCEPTION 'NATIONAL_SUPPORT_TERMINAL_NOT_OWNED'; END IF;
  UPDATE public.measurement_target_business target
  SET sync_status=p_sync_status, sync_error_message=p_sync_error_message,
    national_support_status=coalesce(final_support_status,target.national_support_status),
    updated_at=CURRENT_TIMESTAMP
  WHERE target.id=p_target_id AND (
    final_support_status IS NULL OR (
      target.code=completed.request_payload->>'code'
      AND target.year=(completed.request_payload->>'year')::INTEGER
      AND target.period=completed.request_payload->>'period'
    ));
  IF NOT FOUND THEN RAISE EXCEPTION 'NATIONAL_SUPPORT_TARGET_NOT_FOUND'; END IF;
  IF final_support_status IS NOT NULL THEN
    INSERT INTO public.national_support_application (
      code, year, period, application_status, result, national_support_status, representative_name, status_source
    ) VALUES (
      completed.request_payload->>'code', (completed.request_payload->>'year')::INTEGER,
      completed.request_payload->>'period', final_application_status,
      final_support_status, final_support_status,
      NULLIF(completed.request_payload->>'representative', ''), 'confirmed_result'
    ) ON CONFLICT (code, year, period) DO UPDATE SET
      application_status=EXCLUDED.application_status, result=EXCLUDED.result,
      national_support_status=EXCLUDED.national_support_status,
      representative_name=EXCLUDED.representative_name,
      status_source=EXCLUDED.status_source,
      updated_at=CURRENT_TIMESTAMP;
    UPDATE public.measurement_journal SET national_support_status=final_support_status
    WHERE code=completed.request_payload->>'code'
      AND measurement_year=(completed.request_payload->>'year')::INTEGER
      AND measurement_period=completed.request_payload->>'period';
  END IF;
  RETURN completed;
END $$;

CREATE OR REPLACE FUNCTION public.sync_manual_national_support_application()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.sync_status = '수동확정' AND NEW.national_support_status IN ('대상', '비대상') THEN
    INSERT INTO public.national_support_application (
      code, year, period, application_status, result, national_support_status, status_source
    ) VALUES (NEW.code, NEW.year, NEW.period, NULL, NULL, NEW.national_support_status, 'manual_internal')
    ON CONFLICT (code, year, period) DO UPDATE
      -- 수동 확정은 현재 내부 상태의 원천이다. 실제 결과의 상세와 대표자
      -- snapshot은 보존하되, 상태·원천·갱신시각은 항상 수동 확정으로 갱신한다.
      SET national_support_status = EXCLUDED.national_support_status,
          status_source = EXCLUDED.status_source,
          updated_at = CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS measurement_target_business_manual_national_support_sync ON public.measurement_target_business;
CREATE TRIGGER measurement_target_business_manual_national_support_sync
  AFTER INSERT OR UPDATE OF national_support_status, sync_status ON public.measurement_target_business
  FOR EACH ROW EXECUTE FUNCTION public.sync_manual_national_support_application();

-- 대상 사업장과 건강디딤돌 목록 원천을 같은 트랜잭션에서만 수동 확정한다.
CREATE OR REPLACE FUNCTION public.set_manual_national_support_status(
  p_target_id bigint,
  p_status text
)
RETURNS public.measurement_target_business
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  target public.measurement_target_business;
BEGIN
  IF p_status NOT IN ('대상', '비대상') THEN
    RAISE EXCEPTION 'NATIONAL_SUPPORT_MANUAL_STATUS_INVALID';
  END IF;
  UPDATE public.measurement_target_business
     SET national_support_status = p_status,
         sync_status = '수동확정',
         sync_error_message = NULL,
         updated_at = now()
   WHERE id = p_target_id
   RETURNING * INTO target;
  IF NOT FOUND THEN RAISE EXCEPTION 'NATIONAL_SUPPORT_TARGET_NOT_FOUND'; END IF;
  RETURN target;
END;
$$;

-- 서버의 service role만 이 내부 상태 변경 RPC를 실행할 수 있다. API의
-- 관리자 세션 검증을 우회한 PostgREST 직접 호출은 허용하지 않는다.
REVOKE ALL ON FUNCTION public.set_manual_national_support_status(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_manual_national_support_status(bigint, text) TO service_role;
