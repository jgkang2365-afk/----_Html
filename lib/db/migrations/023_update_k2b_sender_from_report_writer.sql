-- ============================================
-- 측정일지의 K2B 전송자를 보고서 담당자(report_writer)로 업데이트
-- 기존 K2B 전송자가 비어있거나 null인 경우에만 업데이트
-- 생성일: 2025-01-XX
-- ============================================

-- 업데이트 전 상태 확인
DO $$
DECLARE
    before_count INTEGER;
    total_count INTEGER;
BEGIN
    -- 예비조사 정보가 있는 측정일지 수
    SELECT COUNT(*) INTO total_count
    FROM measurement_journal mj
    WHERE EXISTS (
        SELECT 1
        FROM preliminary_survey ps
        WHERE ps.code = mj.code
          AND ps.report_writer IS NOT NULL
          AND ps.report_writer != ''
    );
    
    -- K2B 전송자가 비어있는 측정일지 수
    SELECT COUNT(*) INTO before_count
    FROM measurement_journal mj
    WHERE EXISTS (
        SELECT 1
        FROM preliminary_survey ps
        WHERE ps.code = mj.code
          AND ps.report_writer IS NOT NULL
          AND ps.report_writer != ''
    )
    AND (mj.k2b_sender IS NULL OR mj.k2b_sender = '');
    
    RAISE NOTICE '업데이트 전: 예비조사 정보가 있는 측정일지 총 % 개', total_count;
    RAISE NOTICE '업데이트 전: K2B 전송자가 비어있는 측정일지 % 개', before_count;
    RAISE NOTICE '업데이트 전: K2B 전송자가 있는 측정일지 % 개 (모두 업데이트 예정)', total_count - before_count;
END $$;

-- 모든 측정일지에 대해 (기존 값이 있어도)
-- 같은 code의 가장 최근 예비조사 정보에서 report_writer를 가져와서 업데이트
-- report_writer는 콤마 구분 문자열일 수 있으므로 첫 번째 값만 사용
WITH latest_survey AS (
    SELECT DISTINCT ON (code)
        code,
        -- report_writer가 콤마로 구분된 경우 첫 번째 값만 추출
        CASE 
            WHEN report_writer LIKE '%,%' THEN TRIM(SPLIT_PART(report_writer, ',', 1))
            ELSE TRIM(report_writer)
        END AS report_writer
    FROM preliminary_survey
    WHERE report_writer IS NOT NULL
      AND report_writer != ''
    ORDER BY code,
             measurement_date DESC NULLS LAST,
             created_at DESC
)
UPDATE measurement_journal mj
SET k2b_sender = ls.report_writer,
    updated_at = NOW()
FROM latest_survey ls
WHERE mj.code = ls.code
  AND ls.report_writer IS NOT NULL
  AND ls.report_writer != '';

-- 업데이트 후 상태 확인
DO $$
DECLARE
    after_count INTEGER;
    updated_count INTEGER;
    total_count INTEGER;
BEGIN
    -- 예비조사 정보가 있는 측정일지 수
    SELECT COUNT(*) INTO total_count
    FROM measurement_journal mj
    WHERE EXISTS (
        SELECT 1
        FROM preliminary_survey ps
        WHERE ps.code = mj.code
          AND ps.report_writer IS NOT NULL
          AND ps.report_writer != ''
    );
    
    -- 업데이트 후에도 여전히 비어있는 레코드 수 (예비조사 정보가 없는 경우)
    SELECT COUNT(*) INTO after_count
    FROM measurement_journal mj
    WHERE EXISTS (
        SELECT 1
        FROM preliminary_survey ps
        WHERE ps.code = mj.code
          AND ps.report_writer IS NOT NULL
          AND ps.report_writer != ''
    )
    AND (mj.k2b_sender IS NULL OR mj.k2b_sender = '');
    
    -- 실제 업데이트된 레코드 수 (예비조사 정보가 있고 K2B 전송자가 설정된 레코드)
    SELECT COUNT(*) INTO updated_count
    FROM measurement_journal mj
    WHERE EXISTS (
        SELECT 1
        FROM preliminary_survey ps
        WHERE ps.code = mj.code
          AND ps.report_writer IS NOT NULL
          AND ps.report_writer != ''
    )
    AND mj.k2b_sender IS NOT NULL
    AND mj.k2b_sender != '';
    
    RAISE NOTICE '업데이트 후: 예비조사 정보가 있는 측정일지 총 % 개', total_count;
    RAISE NOTICE '업데이트 후: K2B 전송자가 설정된 측정일지 % 개', updated_count;
    RAISE NOTICE '업데이트 후: 여전히 비어있는 측정일지 % 개', after_count;
END $$;
