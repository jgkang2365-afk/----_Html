import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { resolve } from "path";
import { verifyPassword } from "../lib/utils/password";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Supabase environment variables are missing!");
  process.exit(1);
}

const supabase = createClient(url, key);

async function main() {
  const { data: user, error } = await supabase
    .from("users")
    .select("name, password_hash")
    .eq("name", "강종구")
    .single();

  if (error || !user) {
    console.error("Error fetching user '강종구':", error?.message);
    return;
  }

  const defaultPassword = "frn2314@";
  const isValid = await verifyPassword(defaultPassword, user.password_hash);
  console.log(`User '강종구' password verification with '${defaultPassword}': ${isValid ? "SUCCESS" : "FAILED"}`);
}

main();
