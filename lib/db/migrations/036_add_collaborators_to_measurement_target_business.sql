-- 측정 대상 사업장 테이블에 협력자 컬럼 추가
-- 생성일: 2026-03-27
-- 목적: 보고서 담당자 외 협력자를 기록하고 구글 캘린더에 동기화하기 위함

ALTER TABLE measurement_target_business 
ADD COLUMN IF NOT EXISTS collaborators TEXT;

COMMENT ON COLUMN measurement_target_business.collaborators IS '협력자 이름 목록 (쉼표로 구분)';
