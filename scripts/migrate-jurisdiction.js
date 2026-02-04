
const { createClient } = require("@supabase/supabase-js");
const path = require("path");
require("dotenv").config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Supabase URL or Key is missing!");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const DESIGNATED_OFFICE_FULL_NAME_TO_SHORT = {
    "대전지방고용노동청 천안지청": "천안",
    "대전지방고용노동청": "대전",
    "중부지방고용노동청 평택지청": "평택",
    "중부지방고용노동청 경기지청": "경기",
};

function toShortName(fullName) {
    if (!fullName) return "";

    // 1. Map lookup
    if (DESIGNATED_OFFICE_FULL_NAME_TO_SHORT[fullName]) {
        return DESIGNATED_OFFICE_FULL_NAME_TO_SHORT[fullName];
    }

    // 2. "XX지청"
    const jicheongMatch = fullName.match(/\s+(.+)지청$/);
    if (jicheongMatch && jicheongMatch[1]) {
        return jicheongMatch[1];
    }

    // 3. "XX지방고용노동청"
    const cheongMatch = fullName.match(/^(.+)지방고용노동청$/);
    if (cheongMatch && cheongMatch[1]) {
        return cheongMatch[1];
    }

    return fullName;
}

async function migrateJurisdiction() {
    console.log("--- MIGRATION START: office_jurisdiction ---");

    // 1. Fetch all rows
    const { data: rows, error } = await supabase
        .from("measurement_target_business")
        .select("id, code, business_name, office_jurisdiction");

    if (error) {
        console.error("Error fetching rows:", error);
        return;
    }

    console.log(`Total rows to check: ${rows.length}`);

    let updateCount = 0;
    let skipCount = 0;

    // 2. Iterate and update
    for (const row of rows) {
        const originalName = row.office_jurisdiction;
        const shortName = toShortName(originalName);

        if (originalName !== shortName && shortName) {
            // Need update
            console.log(`Updating ${row.business_name} (${row.code}): '${originalName}' -> '${shortName}'`);

            const { error: updateError } = await supabase
                .from("measurement_target_business")
                .update({ office_jurisdiction: shortName })
                .eq("id", row.id);

            if (updateError) {
                console.error(`Failed to update ID ${row.id}:`, updateError);
            } else {
                updateCount++;
            }
        } else {
            skipCount++;
        }
    }

    console.log(`\nMigration Summary:`);
    console.log(`- Updated: ${updateCount}`);
    console.log(`- Skipped (Already short or no match): ${skipCount}`);
    console.log("--- MIGRATION COMPLETE ---");
}

migrateJurisdiction();
