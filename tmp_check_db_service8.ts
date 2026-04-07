import { createClient } from "@supabase/supabase-js";
import fs from "fs";

let supabaseUrl = "";
let supabaseKey = "";
const env = fs.readFileSync(".env.local", "utf-8");
for (const line of env.split("\n")) {
  if (line.trim().startsWith("NEXT_PUBLIC_SUPABASE_URL=")) supabaseUrl = line.split("=")[1].trim().replace(/['"]/g, '');
  if (line.trim().startsWith("SUPABASE_SERVICE_ROLE_KEY=")) supabaseKey = line.split("=")[1].trim().replace(/['"]/g, '');
}
const supabase = createClient(supabaseUrl, supabaseKey);

async function findGaps() {
  const { data } = await supabase.from("measurement_journal").select("id, created_at").order("id", { ascending: true });
  if (!data) return;
  
  let prevId = null;
  let gaps = [];
  for (const item of data) {
    if (prevId !== null && item.id > prevId + 1) {
       for (let i = prevId + 1; i < item.id; i++) {
          gaps.push(i);
       }
    }
    prevId = item.id;
  }
  console.log(`There are ${gaps.length} gaps (deleted IDs) in the entire DB sequence. Last few:`, gaps.slice(-10));
}
findGaps();
