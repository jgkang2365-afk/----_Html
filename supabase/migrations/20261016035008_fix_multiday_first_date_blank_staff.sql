-- Forward-only fix for legacy daily_staff entries with an empty date string.
-- Keep authoritative target.measurement_date and daily_staff unchanged.
DO $guard$
DECLARE old_definition text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO old_definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname='preliminary_survey_v2_first_measurement_date'
    AND pg_get_function_identity_arguments(p.oid)='p_measurement_date text, p_daily_staff jsonb';
  IF old_definition IS NULL OR position('min((day->>''date'')::date)' IN old_definition)=0 THEN
    RAISE EXCEPTION 'MULTIDAY_FIRST_DATE_HELPER_SHAPE_CHANGED';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.preliminary_survey_v2_first_measurement_date(
  p_measurement_date text,
  p_daily_staff jsonb
) RETURNS date
LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $function$
  SELECT COALESCE(
    (SELECT min(NULLIF(btrim(day->>'date'), '')::date)
     FROM jsonb_array_elements(
       CASE WHEN jsonb_typeof(p_daily_staff) = 'array' THEN p_daily_staff ELSE '[]'::jsonb END
     ) AS day),
    NULLIF(btrim(split_part(p_measurement_date, ',', 1)), '')::date
  );
$function$;

REVOKE ALL ON FUNCTION public.preliminary_survey_v2_first_measurement_date(text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';