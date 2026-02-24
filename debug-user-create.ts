import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import * as bcrypt from "bcryptjs";
dotenv.config({ path: ".env.local" });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testCreateUser() {
    const testUser = {
        name: "test_debug_" + Date.now(),
        role: "사용자",
        password: "password123",
        survey_code: "Z",
        job: "측정"
    };

    console.log("Starting debug user creation for:", testUser.name);

    try {
        // 1. Password hash
        console.log("Hashing password...");
        const passwordHash = await bcrypt.hash(testUser.password, 10);
        console.log("Hash success.");

        // 2. Insert
        console.log("Attempting insert into users table...");
        const { data, error } = await supabase
            .from("users")
            .insert({
                name: testUser.name,
                role: testUser.role,
                password_hash: passwordHash,
                survey_code: testUser.survey_code || null,
                job: testUser.job || "측정",
            })
            .select("*")
            .single();

        if (error) {
            console.error("INSERT FAILED!");
            console.error("Error Code:", error.code);
            console.error("Error Message:", error.message);
            console.error("Error Details:", error.details);
            console.error("Error Hint:", error.hint);
        } else {
            console.log("INSERT SUCCESS!");
            console.log("New User ID:", data.id);

            // Clean up
            console.log("Cleaning up test user...");
            await supabase.from("users").delete().eq("id", data.id);
        }
    } catch (e) {
        console.error("CRITICAL ERROR during script execution:", e);
    }
}

testCreateUser();
