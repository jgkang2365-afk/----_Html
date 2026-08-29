import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";
import {
  assertSupabaseEnvironment,
  SUPABASE_PROJECT_REFS,
} from "../lib/supabase/environment-guard";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const appEnvironment = process.env.NEXT_PUBLIC_APP_ENV;

  if (!url || !serviceRoleKey) throw new Error("STAGING_PROVISION_ENV_MISSING");
  if (appEnvironment !== "staging") {
    throw new Error("STAGING_PROVISION_REQUIRES_STAGING_APP_ENV");
  }
  assertSupabaseEnvironment({
    appEnvironment,
    databaseUrl: url,
    productionProjectRef: SUPABASE_PROJECT_REFS.production,
    stagingProjectRef: SUPABASE_PROJECT_REFS.staging,
  });

  const credentials = [
    { id: 9001, password: process.env.STAGING_TEST_ADMIN_PASSWORD },
    { id: 9002, password: process.env.STAGING_TEST_PRELIMINARY_MANAGER_PASSWORD },
  ];
  if (credentials.some(({ password }) => !password || password.length < 12)) {
    throw new Error("STAGING_TEST_PASSWORDS_MUST_BE_AT_LEAST_12_CHARACTERS");
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (const credential of credentials) {
    const passwordHash = await bcrypt.hash(credential.password!, 12);
    const { error } = await supabase
      .from("users")
      .update({ password_hash: passwordHash })
      .eq("id", credential.id);
    if (error) throw error;
  }

  console.log("Staging test user passwords provisioned without logging credentials.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "STAGING_USER_PROVISION_FAILED");
  process.exitCode = 1;
});
