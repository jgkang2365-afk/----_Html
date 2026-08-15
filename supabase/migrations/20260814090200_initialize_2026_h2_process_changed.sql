BEGIN;

DO $$
DECLARE
  v_industrial_count integer;
  v_construction_count integer;
  v_explicit_journal_outside_exact integer;
BEGIN
  SELECT count(*) FILTER (WHERE btrim(business_category) = '공업사'),
         count(*) FILTER (WHERE btrim(business_category) = '건설')
    INTO v_industrial_count, v_construction_count
  FROM public.measurement_target_business
  WHERE year = 2026 AND period = '하반기';

  IF v_industrial_count <> 155 OR v_construction_count <> 65 THEN
    RAISE EXCEPTION 'category scope drift: 공업사 %, 건설 %', v_industrial_count, v_construction_count;
  END IF;

  SELECT count(*) INTO v_explicit_journal_outside_exact
  FROM public.measurement_target_business t
  WHERE t.year = 2026
    AND t.period = '하반기'
    AND btrim(coalesce(t.business_category, '')) NOT IN ('공업사', '건설')
    AND EXISTS (
      SELECT 1
      FROM public.measurement_journal j
      WHERE j.code = t.code
        AND j.measurement_year = t.year
        AND j.measurement_period = t.period
        AND '공정 변경' = ANY(regexp_split_to_array(coalesce(j.note, ''), '\s*,\s*'))
    );

  IF v_explicit_journal_outside_exact <> 1 THEN
    RAISE EXCEPTION 'explicit journal process-change scope drift: %', v_explicit_journal_outside_exact;
  END IF;
END $$;

UPDATE public.measurement_target_business
SET process_changed = true
WHERE year = 2026
  AND period = '하반기'
  AND process_changed IS NULL
  AND btrim(business_category) IN ('공업사', '건설');

UPDATE public.measurement_target_business t
SET process_changed = true
WHERE t.year = 2026
  AND t.period = '하반기'
  AND t.process_changed IS NULL
  AND btrim(coalesce(t.business_category, '')) NOT IN ('공업사', '건설')
  AND EXISTS (
    SELECT 1
    FROM public.measurement_journal j
    WHERE j.code = t.code
      AND j.measurement_year = t.year
      AND j.measurement_period = t.period
      AND '공정 변경' = ANY(regexp_split_to_array(coalesce(j.note, ''), '\s*,\s*'))
  );

DO $$
DECLARE
  v_true_count integer;
  v_false_outside_exact integer;
  v_null_outside_exact integer;
BEGIN
  SELECT count(*) FILTER (WHERE process_changed IS TRUE),
         count(*) FILTER (
           WHERE process_changed IS FALSE
             AND btrim(coalesce(business_category, '')) NOT IN ('공업사', '건설')
         ),
         count(*) FILTER (
           WHERE process_changed IS NULL
             AND btrim(coalesce(business_category, '')) NOT IN ('공업사', '건설')
         )
    INTO v_true_count, v_false_outside_exact, v_null_outside_exact
  FROM public.measurement_target_business
  WHERE year = 2026 AND period = '하반기';

  IF v_true_count <> 221 OR v_false_outside_exact <> 0 OR v_null_outside_exact <> 109 THEN
    RAISE EXCEPTION 'process_changed distribution mismatch: true %, outside false %, outside null %',
      v_true_count, v_false_outside_exact, v_null_outside_exact;
  END IF;
END $$;

COMMIT;
