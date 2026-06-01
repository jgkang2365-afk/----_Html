const SUPABASE_URL = "https://xjxqbwvcgffunqnkmoqw.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqeHFid3ZjZ2ZmdW5xbmttb3F3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzUyMzE5OSwiZXhwIjoyMDgzMDk5MTk5fQ.JjQ6jjPlCV1GE93_rM3F6pGr1ZaN3phuwo4iRiprML8"; // 서비스 롤 키

async function checkColumns() {
  try {
    console.log("측정일지 테이블의 1개 데이터 조회 중...");
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/measurement_journal?select=*&limit=1`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`
        }
      }
    );
    const data = await res.json();
    console.log("조회된 데이터 구조:", JSON.stringify(data[0] || {}, null, 2));
  } catch (err) {
    console.error("에러 발생:", err);
  }
}

checkColumns();
