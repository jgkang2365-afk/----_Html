
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://xjxqbwvcgffunqnkmoqw.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqeHFid3ZjZ2ZmdW5xbmttb3F3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzUyMzE5OSwiZXhwIjoyMDgzMDk5MTk5fQ.JjQ6jjPlCV1GE93_rM3F6pGr1ZaN3phuwo4iRiprML8";

async function findAnomalies() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  const standard = ['공업사', '건설', '제조', '정비', '병원', '실험실', '인쇄', '서비스', '교육', '환경'];
  
  const { data } = await supabase.from("measurement_target_business").select("id, business_category");
  
  const anomalies = data?.filter(d => d.business_category && !standard.includes(d.business_category));
  console.log("Anomalies in measurement_target_business:", anomalies);
}

findAnomalies();
