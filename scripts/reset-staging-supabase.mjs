import { spawnSync } from "node:child_process";

const stagingProjectRef = "ujwlvmkqjdlqblnbzmsw";
if (process.env.NEXT_PUBLIC_APP_ENV !== "staging") {
  throw new Error("STAGING_RESET_REQUIRES_STAGING_APP_ENV");
}
if (process.env.CONFIRM_STAGING_RESET !== stagingProjectRef) {
  throw new Error("STAGING_RESET_EXPLICIT_CONFIRMATION_REQUIRED");
}
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== `https://${stagingProjectRef}.supabase.co`) {
  throw new Error("STAGING_RESET_PROJECT_REF_MISMATCH");
}
if (!process.env.SUPABASE_ACCESS_TOKEN || !process.env.SUPABASE_DB_PASSWORD) {
  throw new Error("STAGING_RESET_CLI_CREDENTIALS_MISSING");
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) throw new Error(`STAGING_RESET_COMMAND_FAILED:${args.join(" ")}`);
}

run("npm", ["run", "db:local:prepare"]);
run("npx", ["supabase", "link", "--project-ref", stagingProjectRef, "--workdir", ".supabase-local"]);
run("npx", ["supabase", "db", "reset", "--linked", "--yes", "--workdir", ".supabase-local"]);

console.log("Staging schema and synthetic fixture reset completed for the pinned project ref.");
