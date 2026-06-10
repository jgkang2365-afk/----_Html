-- National Support Status 값 명칭 통일 (지원 -> 대상)
-- 1. 기존 CHECK 제약 조건 삭제 및 수정

-- national_support_application 테이블
ALTER TABLE national_support_application DROP CONSTRAINT IF EXISTS national_support_application_national_support_status_check;
UPDATE national_support_application SET national_support_status = '대상' WHERE national_support_status = '지원';
ALTER TABLE national_support_application ADD CONSTRAINT national_support_application_national_support_status_check CHECK (national_support_status IN ('대상', '비대상'));

-- measurement_business 테이블
ALTER TABLE measurement_business DROP CONSTRAINT IF EXISTS measurement_business_national_support_status_check;
UPDATE measurement_business SET national_support_status = '대상' WHERE national_support_status = '지원';
ALTER TABLE measurement_business ADD CONSTRAINT measurement_business_national_support_status_check CHECK (national_support_status IN ('대상', '비대상'));

-- measurement_journal 테이블
ALTER TABLE measurement_journal DROP CONSTRAINT IF EXISTS measurement_journal_national_support_status_check;
UPDATE measurement_journal SET national_support_status = '대상' WHERE national_support_status = '지원';
ALTER TABLE measurement_journal ADD CONSTRAINT measurement_journal_national_support_status_check CHECK (national_support_status IN ('대상', '비대상'));

-- measurement_summary 테이블 (제약 조건은 없으나 값 일관성을 위해 업데이트)
UPDATE measurement_summary SET national_support_status = '대상' WHERE national_support_status = '지원';

-- 2. 관련 라이브러리 및 API에서 처리될 예정이므로 DB 업데이트는 여기까지 진행합니다.
