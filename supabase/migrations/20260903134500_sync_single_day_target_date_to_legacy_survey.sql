-- measurement_target_business가 현재 측정일의 authoritative source다.
-- 단일일 일정의 날짜가 변경될 때 legacy preliminary_survey mirror를 같은 transaction에서
-- in-place로 이동해 row id, google_event_id, 수동 예비조사 정보와 등록 순서를 보존한다.
-- 다일 일정은 기존 애플리케이션 동기화 경로가 날짜별 row를 관리한다.

CREATE OR REPLACE FUNCTION public.sync_single_day_target_measurement_date_to_legacy_survey()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_date date;
  new_date date;
  legacy_count integer;
  duplicate_count integer;
BEGIN
  IF NEW.measurement_date IS NOT DISTINCT FROM OLD.measurement_date
     AND NEW.daily_staff IS NOT DISTINCT FROM OLD.daily_staff THEN
    RETURN NEW;
  END IF;

  -- 다일 일정은 날짜별 row 생성/삭제가 필요하므로 기존 API 동기화 경로에 맡긴다.
  IF jsonb_typeof(NEW.daily_staff) = 'array'
     AND jsonb_array_length(NEW.daily_staff) > 0 THEN
    RETURN NEW;
  END IF;

  IF NULLIF(btrim(COALESCE(NEW.measurement_date::text, '')), '') IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    new_date := NEW.measurement_date::date;
  EXCEPTION WHEN others THEN
    RETURN NEW;
  END;

  BEGIN
    old_date := NULLIF(btrim(COALESCE(OLD.measurement_date::text, '')), '')::date;
  EXCEPTION WHEN others THEN
    old_date := NULL;
  END;

  SELECT count(*)
    INTO legacy_count
  FROM public.preliminary_survey survey
  WHERE survey.code = NEW.code
    AND survey.year = NEW.year
    AND btrim(COALESCE(survey.period, '')) = btrim(COALESCE(NEW.period, ''));

  -- 행이 하나일 때만 기존 행을 현재 단일일 mirror로 안전하게 식별할 수 있다.
  IF legacy_count <> 1 THEN
    RETURN NEW;
  END IF;

  SELECT count(*)
    INTO duplicate_count
  FROM public.preliminary_survey survey
  WHERE survey.code = NEW.code
    AND survey.year = NEW.year
    AND btrim(COALESCE(survey.period, '')) = btrim(COALESCE(NEW.period, ''))
    AND survey.measurement_date = new_date;

  IF duplicate_count > 0 THEN
    RETURN NEW;
  END IF;

  UPDATE public.preliminary_survey survey
  SET measurement_date = new_date,
      end_date = CASE
        WHEN survey.end_date IS NULL OR survey.end_date = old_date THEN new_date
        ELSE survey.end_date
      END
  WHERE survey.code = NEW.code
    AND survey.year = NEW.year
    AND btrim(COALESCE(survey.period, '')) = btrim(COALESCE(NEW.period, ''));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_single_day_target_measurement_date
  ON public.measurement_target_business;

CREATE TRIGGER trg_sync_single_day_target_measurement_date
AFTER UPDATE OF measurement_date, daily_staff
ON public.measurement_target_business
FOR EACH ROW
EXECUTE FUNCTION public.sync_single_day_target_measurement_date_to_legacy_survey();
