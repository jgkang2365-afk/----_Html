const SUPABASE_URL = "https://xjxqbwvcgffunqnkmoqw.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqeHFid3ZjZ2ZmdW5xbmttb3F3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzUyMzE5OSwiZXhwIjoyMDgzMDk5MTk5fQ.JjQ6jjPlCV1GE93_rM3F6pGr1ZaN3phuwo4iRiprML8"; // service role key

async function query() {
  try {
    console.log("Searching preliminary_survey...");
    const surveyRes = await fetch(
      `${SUPABASE_URL}/rest/v1/preliminary_survey?business_name=ilike.*범일건설*&select=*`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`
        }
      }
    );
    const surveys = await surveyRes.json();
    console.log("Surveys:", JSON.stringify(surveys, null, 2));

    if (surveys.length > 0) {
      const code = "H0406";
      console.log(`Searching measurement_journal for code: ${code}...`);
      const journalRes = await fetch(
        `${SUPABASE_URL}/rest/v1/measurement_journal?code=eq.${code}&select=*`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`
          }
        }
      );
      const journals = await journalRes.json();
      console.log("Journals:", JSON.stringify(journals, null, 2));
    }
  } catch (err) {
    console.error(err);
  }
}

query();
