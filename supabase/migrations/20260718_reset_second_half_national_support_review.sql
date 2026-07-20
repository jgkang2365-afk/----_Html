-- 2026년 하반기 건강디딤돌 비대상 상태 전수 재검증 준비
-- Supabase SQL Editor의 문장별 실행에서도 유지되도록 TEMP TABLE을 사용하지 않습니다.

BEGIN;

CREATE TABLE IF NOT EXISTS public.national_support_recheck_backup_20260718 (
    source_table TEXT NOT NULL,
    source_key TEXT NOT NULL,
    row_data JSONB NOT NULL,
    backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_table, source_key)
);

ALTER TABLE public.national_support_recheck_backup_20260718 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.national_support_recheck_backup_20260718 FROM anon, authenticated;

COMMENT ON TABLE public.national_support_recheck_backup_20260718 IS
    '2026년 하반기 건강디딤돌 비대상 상태 재검증 전 원본 백업';

DO $$
DECLARE
    target_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO target_count
    FROM public.measurement_target_business
    WHERE year = 2026
      AND period = '하반기'
      AND national_support_status = '비대상'
      AND COALESCE(sync_status, '대기') = '대기';

    IF target_count > 68 THEN
        RAISE EXCEPTION
            '재검증 후보가 감사 수량 68건을 초과했습니다. 현재 %건이므로 중단합니다.',
            target_count;
    END IF;
END $$;

INSERT INTO public.national_support_recheck_backup_20260718 (
    source_table,
    source_key,
    row_data
)
SELECT
    'measurement_target_business',
    target.id::TEXT,
    TO_JSONB(target)
FROM public.measurement_target_business AS target
WHERE target.year = 2026
  AND target.period = '하반기'
  AND target.national_support_status = '비대상'
  AND COALESCE(target.sync_status, '대기') = '대기'
ON CONFLICT (source_table, source_key) DO NOTHING;

INSERT INTO public.national_support_recheck_backup_20260718 (
    source_table,
    source_key,
    row_data
)
SELECT
    'national_support_application',
    application.id::TEXT,
    TO_JSONB(application)
FROM public.national_support_application AS application
WHERE application.year = 2026
  AND application.period = '하반기'
  AND application.national_support_status = '비대상'
  AND EXISTS (
      SELECT 1
      FROM public.national_support_recheck_backup_20260718 AS backup
      WHERE backup.source_table = 'measurement_target_business'
        AND backup.row_data ->> 'code' = application.code
        AND backup.row_data ->> 'year' = '2026'
        AND backup.row_data ->> 'period' = '하반기'
  )
ON CONFLICT (source_table, source_key) DO NOTHING;

INSERT INTO public.national_support_recheck_backup_20260718 (
    source_table,
    source_key,
    row_data
)
SELECT
    'measurement_journal',
    journal.id::TEXT,
    TO_JSONB(journal)
FROM public.measurement_journal AS journal
WHERE journal.measurement_year = 2026
  AND journal.measurement_period = '하반기'
  AND journal.national_support_status = '비대상'
  AND EXISTS (
      SELECT 1
      FROM public.national_support_recheck_backup_20260718 AS backup
      WHERE backup.source_table = 'measurement_target_business'
        AND backup.row_data ->> 'code' = journal.code
        AND backup.row_data ->> 'year' = '2026'
        AND backup.row_data ->> 'period' = '하반기'
  )
ON CONFLICT (source_table, source_key) DO NOTHING;

-- 신청결과 DB의 잘못된 확정값이 새로고침 즉시 다시 반영되지 않도록 미확정으로 되돌립니다.
UPDATE public.national_support_application AS application
SET national_support_status = NULL,
    application_status = NULL,
    result = NULL,
    updated_at = NOW()
WHERE application.year = 2026
  AND application.period = '하반기'
  AND application.national_support_status = '비대상'
  AND EXISTS (
      SELECT 1
      FROM public.national_support_recheck_backup_20260718 AS backup
      WHERE backup.source_table = 'measurement_target_business'
        AND backup.row_data ->> 'code' = application.code
        AND backup.row_data ->> 'year' = '2026'
        AND backup.row_data ->> 'period' = '하반기'
  );

-- 목록 API가 측정일지의 이전 비대상 값을 보완값으로 다시 사용하지 않도록 정리합니다.
UPDATE public.measurement_journal AS journal
SET national_support_status = NULL,
    updated_at = NOW()
WHERE journal.measurement_year = 2026
  AND journal.measurement_period = '하반기'
  AND journal.national_support_status = '비대상'
  AND EXISTS (
      SELECT 1
      FROM public.national_support_recheck_backup_20260718 AS backup
      WHERE backup.source_table = 'measurement_target_business'
        AND backup.row_data ->> 'code' = journal.code
        AND backup.row_data ->> 'year' = '2026'
        AND backup.row_data ->> 'period' = '하반기'
  );

UPDATE public.measurement_target_business AS target
SET national_support_status = NULL,
    sync_status = CASE
        WHEN REGEXP_REPLACE(COALESCE(target.industrial_accident_number, ''), '[^0-9]', '', 'g') ~ '^[0-9]{11}$'
         AND REGEXP_REPLACE(COALESCE(target.commencement_number, ''), '[^0-9]', '', 'g') ~ '^[0-9]{11}$'
         AND NULLIF(BTRIM(COALESCE(target.representative_name, '')), '') IS NOT NULL
        THEN '조회대기'
        ELSE '정보부족'
    END,
    sync_error_message = CASE
        WHEN REGEXP_REPLACE(COALESCE(target.industrial_accident_number, ''), '[^0-9]', '', 'g') ~ '^[0-9]{11}$'
         AND REGEXP_REPLACE(COALESCE(target.commencement_number, ''), '[^0-9]', '', 'g') ~ '^[0-9]{11}$'
         AND NULLIF(BTRIM(COALESCE(target.representative_name, '')), '') IS NOT NULL
        THEN NULL
        ELSE '건강디딤돌 재조회에 필요한 산재·개시번호 또는 대표자명이 부족합니다.'
    END,
    updated_at = NOW()
WHERE target.year = 2026
  AND target.period = '하반기'
  AND target.national_support_status = '비대상'
  AND COALESCE(target.sync_status, '대기') = '대기'
  AND EXISTS (
      SELECT 1
      FROM public.national_support_recheck_backup_20260718 AS backup
      WHERE backup.source_table = 'measurement_target_business'
        AND backup.source_key = target.id::TEXT
  );

COMMIT;
