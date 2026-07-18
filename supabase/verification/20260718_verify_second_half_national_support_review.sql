-- 20260718_reset_second_half_national_support_review.sql 적용 확인

SELECT source_table, COUNT(*) AS backup_count
FROM public.national_support_recheck_backup_20260718
GROUP BY source_table
ORDER BY source_table;

SELECT sync_status, COUNT(*) AS target_count
FROM public.measurement_target_business
WHERE year = 2026
  AND period = '하반기'
  AND national_support_status IS NULL
  AND code IN (
      SELECT DISTINCT row_data ->> 'code'
      FROM public.national_support_recheck_backup_20260718
      WHERE source_table = 'measurement_target_business'
  )
GROUP BY sync_status
ORDER BY sync_status;

SELECT COUNT(*) AS remaining_target_non_support
FROM public.measurement_target_business
WHERE year = 2026
  AND period = '하반기'
  AND national_support_status = '비대상'
  AND COALESCE(sync_status, '대기') = '대기';

SELECT COUNT(*) AS remaining_application_non_support
FROM public.national_support_application
WHERE year = 2026
  AND period = '하반기'
  AND national_support_status = '비대상'
  AND code IN (
      SELECT DISTINCT row_data ->> 'code'
      FROM public.national_support_recheck_backup_20260718
      WHERE source_table = 'measurement_target_business'
  );

SELECT COUNT(*) AS remaining_journal_non_support
FROM public.measurement_journal
WHERE measurement_year = 2026
  AND measurement_period = '하반기'
  AND national_support_status = '비대상'
  AND code IN (
      SELECT DISTINCT row_data ->> 'code'
      FROM public.national_support_recheck_backup_20260718
      WHERE source_table = 'measurement_target_business'
  );
