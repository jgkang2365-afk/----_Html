-- ============================================
-- preliminary_survey 테이블에 sequence_number 필드 추가
-- 예비조사 등록 순서를 나타내는 순번 필드
-- 생성일: 2025-01-XX
-- ============================================

-- sequence_number 필드 추가 (INTEGER, NULL 허용)
ALTER TABLE preliminary_survey
    ADD COLUMN IF NOT EXISTS sequence_number INTEGER;

-- 기존 데이터에 순번 부여 (created_at 순서대로)
DO $$
DECLARE
    survey_record RECORD;
    seq_num INTEGER := 1;
BEGIN
    FOR survey_record IN 
        SELECT id 
        FROM preliminary_survey 
        ORDER BY created_at ASC
    LOOP
        UPDATE preliminary_survey
        SET sequence_number = seq_num
        WHERE id = survey_record.id;
        seq_num := seq_num + 1;
    END LOOP;
END $$;

-- 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_preliminary_survey_sequence_number ON preliminary_survey(sequence_number);

-- 주석 추가
COMMENT ON COLUMN preliminary_survey.sequence_number IS '예비조사 등록 순서 (1부터 시작)';

DO $$
BEGIN
    RAISE NOTICE 'preliminary_survey 테이블에 sequence_number 필드 추가 완료';
END $$;
