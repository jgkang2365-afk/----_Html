-- 건강디딤돌 전용 대표자 override와 실행 snapshot. 기존 데이터 backfill은 하지 않는다.
ALTER TABLE public.business_info
  ADD COLUMN IF NOT EXISTS national_support_representative_name text NULL;

ALTER TABLE public.national_support_application
  ADD COLUMN IF NOT EXISTS representative_name text NULL;

CREATE OR REPLACE FUNCTION public.snapshot_national_support_representative()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- 자동화 job payload가 존재하면 master의 현재값이 아닌 실제 실행 입력을 snapshot한다.
  SELECT NULLIF(aj.request_payload->>'representative', '')
    INTO NEW.representative_name
    FROM public.automation_jobs aj
   WHERE aj.job_type = 'NATIONAL_SUPPORT'
     AND aj.status = 'COMPLETED'
     AND aj.request_payload->>'code' = NEW.code
     AND aj.request_payload->>'year' = NEW.year::text
     AND aj.request_payload->>'period' = NEW.period
   ORDER BY aj.updated_at DESC
   LIMIT 1;
  IF NEW.representative_name IS NULL THEN
    SELECT COALESCE(bi.national_support_representative_name, mtb.representative_name)
      INTO NEW.representative_name
      FROM public.measurement_target_business mtb
      LEFT JOIN public.business_info bi ON bi.code = mtb.code
     WHERE mtb.code = NEW.code AND mtb.year = NEW.year AND mtb.period = NEW.period
     LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS national_support_application_representative_snapshot ON public.national_support_application;
CREATE TRIGGER national_support_application_representative_snapshot
  BEFORE INSERT ON public.national_support_application
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_national_support_representative();

CREATE OR REPLACE FUNCTION public.sync_manual_national_support_application()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.sync_status = '수동확정' AND NEW.national_support_status IN ('대상', '비대상') THEN
    INSERT INTO public.national_support_application (
      code, year, period, application_status, result, national_support_status
    ) VALUES (NEW.code, NEW.year, NEW.period, NULL, NULL, NEW.national_support_status)
    ON CONFLICT (code, year, period) DO UPDATE
      SET national_support_status = EXCLUDED.national_support_status;
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
