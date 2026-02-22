
import { Client } from "pg";
import dotenv from "dotenv";
import path from "path";

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

async function runMigration() {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL;

    if (!connectionString) {
        console.error("Migration failed: Missing DATABASE_URL or POSTGRES_URL in .env.local");
        process.exit(1);
    }

    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        console.log("Connected to database.");

        console.log("Adding k2b_status to measurement_journal...");
        await client.query(`
            ALTER TABLE measurement_journal ADD COLUMN IF NOT EXISTS k2b_status VARCHAR(100);
        `);

        console.log("Adding k2b_status to measurement_summary...");
        await client.query(`
            ALTER TABLE measurement_summary ADD COLUMN IF NOT EXISTS k2b_status VARCHAR(100);
        `);

        console.log("Adding comments...");
        await client.query(`
            COMMENT ON COLUMN measurement_journal.k2b_status IS 'K2B 업로드 결과 상태 (성공, 실패, 업로드 완료, 정상처리 등)';
            COMMENT ON COLUMN measurement_summary.k2b_status IS 'K2B 업로드 결과 상태 (성공, 실패, 업로드 완료, 정상처리 등)';
        `);

        console.log("Migration completed successfully.");

    } catch (error) {
        console.error("Migration error:", error);
    } finally {
        await client.end();
    }
}

runMigration();
