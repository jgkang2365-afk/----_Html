-- ============================================
-- 업종분류 테이블 생성
-- 측정일지의 업종분류를 관리하는 마스터 테이블
-- ============================================

CREATE TABLE IF NOT EXISTS business_category (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    display_order INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 업종분류 데이터 삽입 (오름차순 정렬)
INSERT INTO business_category (name, display_order) VALUES
    ('건설', 1),
    ('교육', 2),
    ('공업사', 3),
    ('도정', 4),
    ('병원', 5),
    ('서비스', 6),
    ('수리', 7),
    ('실험실', 8),
    ('인쇄', 9),
    ('정비', 10),
    ('제조', 11),
    ('환경', 12)
ON CONFLICT (name) DO NOTHING;

-- 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_business_category_display_order ON business_category(display_order);
