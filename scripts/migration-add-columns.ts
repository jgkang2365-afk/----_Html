
import { Client } from "pg";
import dotenv from "dotenv";
import path from "path";

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

async function runMigration() {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL;

    if (!connectionString) {
        console.error("Migration failed: Missing DATABASE_URL or POSTGRES_URL in .env.local");
        console.log("Available keys:", Object.keys(process.env).filter(k => !k.includes("KEY") && !k.includes("SECRET")));
        process.exit(1);
    }

    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false } // Supabase requires SSL
    });

    try {
        await client.connect();
        console.log("Connected to database.");

        // 1. Add 'job' column to users
        await client.query(`
      DO $$
      BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'job') THEN
              ALTER TABLE users ADD COLUMN job VARCHAR(20) DEFAULT '측정';
              RAISE NOTICE 'Added job column to users table';
          ELSE
              RAISE NOTICE 'job column already exists in users table';
          END IF;
      END
      $$;
    `);

        // 2. Add 'measurer_id' column to measurement_target_business
        await client.query(`
      DO $$
      BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'measurement_target_business' AND column_name = 'measurer_id') THEN
              ALTER TABLE measurement_target_business ADD COLUMN measurer_id BIGINT;
              -- Add FK if feasible, but optional for now to avoid constraint issues if user IDs don't match or clean up is needed
              -- ALTER TABLE measurement_target_business ADD CONSTRAINT fk_measurer FOREIGN KEY (measurer_id) REFERENCES users(id);
              RAISE NOTICE 'Added measurer_id column to measurement_target_business table';
          ELSE
              RAISE NOTICE 'measurer_id column already exists in measurement_target_business table';
          END IF;
      END
      $$;
    `);

        console.log("Migration completed successfully.");

    } catch (error) {
        console.error("Migration error:", error);
    } finally {
        await client.end();
    }
}

runMigration();
