import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    const fileType = "business-info";
    const { data: files, error: listError } = await supabase.storage
        .from("excel-files")
        .list(fileType, {
            limit: 10,
            offset: 0,
            sortBy: { column: "created_at", order: "desc" },
        });

    console.log("List error:", listError);
    console.log("Files:", files?.map(f => f.name));

    if (files && files.length > 0) {
        const latestFile = files[0];
        const fullPath = `${fileType}/${latestFile.name}`;
        console.log("Downloading fullPath:", fullPath);

        const { data: fileData, error: downloadError } = await supabase.storage
            .from("excel-files")
            .download(fullPath);

        console.log("Download Error:", downloadError);
        console.log("Download Data Length:", fileData ? (await fileData.arrayBuffer()).byteLength : null);
    }
}

main();
