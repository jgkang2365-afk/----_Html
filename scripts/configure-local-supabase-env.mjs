import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const envPath = path.join(root, ".env.local");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const status = spawnSync(
  npx,
  ["supabase", "status", "--workdir", ".supabase-local", "-o", "env"],
  { cwd: root, encoding: "utf8", shell: process.platform === "win32" }
);

if (status.status !== 0) {
  throw new Error("LOCAL_SUPABASE_NOT_RUNNING: start Docker Local Supabase first");
}

const values = {};
for (const line of status.stdout.split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!match) continue;
  values[match[1]] = match[2].replace(/^"|"$/g, "");
}

for (const required of ["API_URL", "ANON_KEY", "SERVICE_ROLE_KEY", "DB_URL"]) {
  if (!values[required]) throw new Error(`LOCAL_SUPABASE_STATUS_MISSING:${required}`);
}
function setEnv(source, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(source)) return source.replace(pattern, line);
  return `${source.replace(/\s*$/, "")}\n${line}\n`;
}

let env = await readFile(envPath, "utf8");
const updates = {
  NEXT_PUBLIC_APP_ENV: "local",
  VERCEL_ENV: "development",
  NEXT_PUBLIC_VERCEL_ENV: "development",
  NEXT_PUBLIC_SUPABASE_URL: values.API_URL,
  SUPABASE_URL: values.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: values.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: values.SERVICE_ROLE_KEY,
  SUPABASE_REALTIME_KEY: values.ANON_KEY,
  LOCAL_SUPABASE_DB_URL: values.DB_URL,
};

for (const [key, value] of Object.entries(updates)) env = setEnv(env, key, value);
await writeFile(envPath, env, "utf8");

console.log(`.env.local configured for Local Supabase at ${values.API_URL}`);
console.log("Restart the Next.js development server so public env values are rebuilt.");
