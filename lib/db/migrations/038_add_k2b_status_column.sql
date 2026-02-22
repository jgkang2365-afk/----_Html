-- measurement_journal 및 measurement_summary 테이블에 K2B 전송 상태 필드 추가
ALTER TABLE measurement_journal ADD COLUMN IF NOT EXISTS k2b_status VARCHAR(100);
ALTER TABLE measurement_summary ADD COLUMN IF NOT EXISTS k2b_status VARCHAR(100);

-- 설명 주석 추가
COMMENT ON COLUMN measurement_journal.k2b_status IS 'K2B 업로드 결과 상태 (성공, 실패, 업로드 완료, 정상처리 등)';
COMMENT ON COLUMN measurement_summary.k2b_status IS 'K2B 업로드 결과 상태 (성공, 실패, 업로드 완료, 정상처리 등)';
