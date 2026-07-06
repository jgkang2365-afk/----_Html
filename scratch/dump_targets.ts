import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const supabase = createClient(supabaseUrl, supabaseKey);

async function dumpData() {
  const { data, error } = await supabase
    .from("measurement_target_business")
    .select("*");

  if (error) {
    console.error("error:", error);
  } else if (data) {
    fs.writeFileSync(
      path.resolve(__dirname, "targets.json"),
      JSON.stringify(data, null, 2),
      "utf-8"
    );
    console.log(`Dumps ${data.length} rows to targets.json`);
  }
}

dumpData();
