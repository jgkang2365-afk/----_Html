import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkCollaboratorsSchema() {
    console.log("Checking measurement_target_business schema...");
    
    // 1. Column check
    const { data: columns, error: colError } = await supabase
        .rpc('get_table_columns', { table_name: 'measurement_target_business' });
    
    if (colError) {
        console.log("RPC get_table_columns failed or not available. Using a simple select.");
    }
    
    // 2. Fetch specific data (e.g. for the one in the user's image if possible)
    // The image shows "[강종구]일성건설(주)"
    const { data: targetData, error: targetError } = await supabase
        .from("measurement_target_business")
        .select("*")
        .ilike("business_name", "%일성건설%")
        .limit(5);

    if (targetError) {
        console.error("Error fetching data:", targetError);
    } else {
        console.log("Recent data for '일성건설':");
        targetData.forEach(item => {
            console.log(`- Code: ${item.code}, Name: ${item.business_name}, Collaborators: ${item.collaborators}, MeasurerID: ${item.measurer_id}`);
        });
    }

    // 3. Check preliminary_survey sync
    const { data: surveyData, error: surveyError } = await supabase
        .from("preliminary_survey")
        .select("*")
        .ilike("business_name", "%일성건설%")
        .limit(5);

    if (surveyError) {
        console.error("Error fetching survey data:", surveyError);
    } else {
        console.log("Survey data for '일성건설':");
        surveyData.forEach(item => {
            console.log(`- Code: ${item.code}, Actual Measurer: ${item.actual_measurer}`);
        });
    }
}

checkCollaboratorsSchema();
