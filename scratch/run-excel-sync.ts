import { createClient } from "@supabase/supabase-js";
import { syncAllFiles } from "../lib/sync/excel-sync";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function runExcelSync() {
  console.log("[Excel Sync] Starting syncAllFiles...");
  try {
    const results = await syncAllFiles(supabase);
    console.log("[Excel Sync] Results:", JSON.stringify(results, null, 2));
  } catch (error) {
    console.error("[Excel Sync] Error:", error);
  }
}

runExcelSync();
