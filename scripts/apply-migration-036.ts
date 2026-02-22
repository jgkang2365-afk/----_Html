
import { Client } from "pg";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

async function runMigration() {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL;

    if (!connectionString) {
        console.error("Migration failed: Missing DATABASE_URL in .env.local");
        process.exit(1);
    }

    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        console.log("Connected to database.");

        const sqlPath = path.resolve(__dirname, "../lib/db/migrations/036_add_email_status_fields.sql");
        const sql = fs.readFileSync(sqlPath, "utf8");

        console.log("Running migration 036...");
        await client.query(sql);
        console.log("Migration 036 completed successfully.");

    } catch (error) {
        console.error("Migration error:", error);
    } finally {
        await client.end();
    }
}

runMigration();
