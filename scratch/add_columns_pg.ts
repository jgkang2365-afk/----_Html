import pg from 'pg';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const { Client } = pg;

async function run() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL || process.env.DATABASE_URL_ADMIN || process.env.NEXT_PUBLIC_DATABASE_URL,
    });

    try {
        await client.connect();
        console.log("Connected to DB.");

        const sql = `
            ALTER TABLE measurement_business ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(20) DEFAULT 'success';
            ALTER TABLE measurement_business ADD COLUMN IF NOT EXISTS delivery_error TEXT;

            COMMENT ON COLUMN measurement_business.delivery_status IS '이메일 수신 결과 상태 (success, bounced)';
            COMMENT ON COLUMN measurement_business.delivery_error IS '반송 사유 또는 상세 오류 내역';
        `;

        await client.query(sql);
        console.log("Columns added successfully.");
    } catch (err) {
        console.error("Error executing SQL:", err);
    } finally {
        await client.end();
    }
}

run();
