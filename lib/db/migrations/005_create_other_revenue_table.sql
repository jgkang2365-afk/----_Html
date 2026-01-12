-- ============================================
-- 기타 매출 테이블 생성
-- ============================================
CREATE TABLE IF NOT EXISTS other_revenue (
    id SERIAL PRIMARY KEY,
    item_name VARCHAR(200) NOT NULL,
    invoice_email VARCHAR(100),
    invoice_date DATE,
    supply_amount DECIMAL(15,2),
    vat_amount DECIMAL(15,2),
    total_amount DECIMAL(15,2) NOT NULL,
    deposit_date DATE,
    deposit_amount DECIMAL(15,2),
    notes TEXT,
    designated_office VARCHAR(100),
    revenue_year INTEGER,
    revenue_period VARCHAR(10) CHECK (revenue_period IN ('상반기', '하반기')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by VARCHAR(100),
    updated_by VARCHAR(100)
);

-- 컬럼 주석 추가
COMMENT ON TABLE other_revenue IS '기타 매출 테이블';
COMMENT ON COLUMN other_revenue.item_name IS '품명';
COMMENT ON COLUMN other_revenue.invoice_email IS '계산서 e-mail';
COMMENT ON COLUMN other_revenue.invoice_date IS '계산서 발행일';
COMMENT ON COLUMN other_revenue.supply_amount IS '공급가액';
COMMENT ON COLUMN other_revenue.vat_amount IS '부가세';
COMMENT ON COLUMN other_revenue.total_amount IS '합계금액';
COMMENT ON COLUMN other_revenue.deposit_date IS '입금일';
COMMENT ON COLUMN other_revenue.deposit_amount IS '입금액';
COMMENT ON COLUMN other_revenue.notes IS '비고';
COMMENT ON COLUMN other_revenue.designated_office IS '지정한계_관할지청';
COMMENT ON COLUMN other_revenue.revenue_year IS '매출년도';
COMMENT ON COLUMN other_revenue.revenue_period IS '매출주기 (상반기/하반기)';

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_other_revenue_year_period ON other_revenue(revenue_year, revenue_period);
CREATE INDEX IF NOT EXISTS idx_other_revenue_designated_office ON other_revenue(designated_office);
CREATE INDEX IF NOT EXISTS idx_other_revenue_invoice_date ON other_revenue(invoice_date);
CREATE INDEX IF NOT EXISTS idx_other_revenue_deposit_date ON other_revenue(deposit_date);
