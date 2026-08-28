-- Legacy schema bridge: this table previously existed only in the deployed database.
-- Keep the FK addition in 044_fix_users_cascade_delete.sql so replay order matches production.
CREATE TABLE IF NOT EXISTS quota_memos (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    is_shared BOOLEAN NOT NULL DEFAULT TRUE,
    user_id INTEGER NOT NULL,
    user_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The report-writer user-id column was also created manually before migration 044.
ALTER TABLE measurement_target_business
    ADD COLUMN IF NOT EXISTS measurer_id INTEGER,
    ADD COLUMN IF NOT EXISTS industrial_accident_number VARCHAR(50),
    ADD COLUMN IF NOT EXISTS commencement_number VARCHAR(50),
    ADD COLUMN IF NOT EXISTS representative_name VARCHAR(100);
