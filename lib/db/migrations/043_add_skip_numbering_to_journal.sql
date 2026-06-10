-- measurement_journal 테이블에 번호 부여 제외 및 매출 유형 필드 추가
-- 생성일: 2026-04-18

-- 1. 번호 부여 제외 플래그 추가
ALTER TABLE measurement_journal ADD COLUMN IF NOT EXISTS is_skip_numbering BOOLEAN DEFAULT FALSE;
COMMENT ON COLUMN measurement_journal.is_skip_numbering IS '일련번호(공문연번, 연번) 부여 제외 여부';

-- 2. 매출 유형 필드 추가
ALTER TABLE measurement_journal ADD COLUMN IF NOT EXISTS revenue_type VARCHAR(20) DEFAULT '측정매출';
COMMENT ON COLUMN measurement_journal.revenue_type IS '매출 유형 (측정매출, 기타매출)';

-- 3. 기존 데이터 업데이트 (선택 사항 - 여기서는 기본값 '측정매출'로 유지됨)
-- UPDATE measurement_journal SET revenue_type = '측정매출' WHERE revenue_type IS NULL;
