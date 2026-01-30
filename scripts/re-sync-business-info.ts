
import { syncBusinessInfo } from "../lib/sync/excel-sync";
import dotenv from "dotenv";
import path from "path";

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function run() {
    console.log("Re-running sync for the specific file...");
    // Use the exact filename from the user's screenshot/debug investigation
    const specificFile = "business-info/business-info-2026-01-30T04-39-06.xlsx";
    const result = await syncBusinessInfo(undefined, specificFile);
    console.log("Sync Result:", result);
}

run();
