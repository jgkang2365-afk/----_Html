-- ============================================
-- 공문연번 UNIQUE 제약조건 수정
-- 전체 테이블 레벨의 UNIQUE 제약조건을 제거하고,
-- 지정지청 + 측정년도 + 측정주기 + 공문연번 조합의 복합 UNIQUE 제약조건으로 변경
-- ============================================

-- 현재 제약조건 상태 확인 (참고용)
SELECT 
    conname AS constraint_name,
    contype AS constraint_type,
    pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'measurement_journal'::regclass
  AND contype = 'u'
  AND (
    -- 단일 컬럼 제약조건 (document_number만)
    (array_length(conkey, 1) = 1 
     AND (SELECT attname FROM pg_attribute WHERE attrelid = conrelid AND attnum = conkey[1]) = 'document_number')
    OR
    -- 복합 제약조건 (measurement_journal_document_number_unique)
    conname = 'measurement_journal_document_number_unique'
  );

-- 기존 UNIQUE 제약조건 확인 및 제거
-- PostgreSQL에서 자동 생성된 제약조건 이름은 보통 {table}_{column}_key 형식
DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    -- document_number에 대한 UNIQUE 제약조건 찾기
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'measurement_journal'::regclass
      AND contype = 'u'
      AND array_length(conkey, 1) = 1
      AND (SELECT attname FROM pg_attribute WHERE attrelid = conrelid AND attnum = conkey[1]) = 'document_number';
    
    -- 제약조건이 있으면 제거
    IF constraint_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE measurement_journal DROP CONSTRAINT ' || quote_ident(constraint_name);
        RAISE NOTICE '제약조건 제거됨: %', constraint_name;
    ELSE
        RAISE NOTICE '제거할 UNIQUE 제약조건을 찾을 수 없습니다.';
    END IF;
END $$;

-- 복합 UNIQUE 제약조건 추가 (이미 존재하면 제거 후 재생성)
DO $$
BEGIN
    -- 기존 복합 제약조건이 있으면 제거
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conrelid = 'measurement_journal'::regclass 
        AND conname = 'measurement_journal_document_number_unique'
    ) THEN
        ALTER TABLE measurement_journal 
        DROP CONSTRAINT measurement_journal_document_number_unique;
        RAISE NOTICE '기존 복합 제약조건 제거됨: measurement_journal_document_number_unique';
    END IF;
    
    -- 새로운 복합 UNIQUE 제약조건 추가
    -- 같은 지정지청 + 측정년도 + 측정주기 조합에서만 공문연번이 유일해야 함
    -- NULL 값은 제외됨 (PostgreSQL의 UNIQUE 제약조건은 NULL을 허용)
    ALTER TABLE measurement_journal 
    ADD CONSTRAINT measurement_journal_document_number_unique 
    UNIQUE (designated_office, measurement_year, measurement_period, document_number);
    
    RAISE NOTICE '복합 제약조건 생성 완료: measurement_journal_document_number_unique';
END $$;

-- 인덱스는 복합 unique 제약조건이 자동으로 생성하므로 추가 작업 불필요
