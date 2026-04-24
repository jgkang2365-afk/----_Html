
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const SUPABASE_URL = "https://xjxqbwvcgffunqnkmoqw.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqeHFid3ZjZ2ZmdW5xbmttb3F3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzUyMzE5OSwiZXhwIjoyMDgzMDk5MTk5fQ.JjQ6jjPlCV1GE93_rM3F6pGr1ZaN3phuwo4iRiprML8";

async function exportList30() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  const { data: journals } = await supabase
    .from("measurement_journal")
    .select("code, business_name, measurement_year, measurement_period")
    .eq("business_category", "30");
    
  const { data: masters } = await supabase
    .from("measurement_business")
    .select("code, business_name")
    .eq("business_category", "30");

  let mdContent = "# 업종 코드 '30' 사업장 전체 리스트\n\n";
  
  mdContent += "## 1. 측정일지 기록 (Journals)\n";
  mdContent += "| 년도-주기 | 사업장명 | 코드 |\n";
  mdContent += "| :--- | :--- | :--- |\n";
  journals?.forEach(j => {
    mdContent += `| ${j.measurement_year}-${j.measurement_period} | ${j.business_name} | ${j.code} |\n`;
  });
  
  mdContent += "\n## 2. 사업장 마스터 (Master)\n";
  mdContent += "| 사업장명 | 코드 |\n";
  mdContent += "| :--- | :--- |\n";
  
  const uniqueMasters = Array.from(new Set(masters?.map(m => `${m.business_name} (${m.code})`))).sort();
  uniqueMasters.forEach(m => {
    const parts = m.split(" (");
    const name = parts[0];
    const code = parts[1] ? parts[1].replace(")", "") : "";
    mdContent += `| ${name} | ${code} |\n`;
  });

  fs.writeFileSync(path.join(process.cwd(), "scratch", "list_30.md"), mdContent, "utf8");
  console.log("File scratch/list_30.md generated successfully.");
}

exportList30();
