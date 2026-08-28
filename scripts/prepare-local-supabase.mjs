import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = process.cwd();
const workspaceRoot = path.resolve(repositoryRoot, ".supabase-local");
const workspaceSupabase = path.join(workspaceRoot, "supabase");
const workspaceMigrations = path.join(workspaceSupabase, "migrations");

if (
  path.dirname(workspaceRoot) !== repositoryRoot ||
  path.basename(workspaceRoot) !== ".supabase-local"
) {
  throw new Error("LOCAL_SUPABASE_WORKSPACE_PATH_INVALID");
}

await rm(workspaceRoot, { recursive: true, force: true });
await mkdir(workspaceMigrations, { recursive: true });

const legacyDirectory = path.join(repositoryRoot, "lib", "db", "migrations");
const legacyFiles = (await readdir(legacyDirectory))
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort((left, right) => left.localeCompare(right, "en"));

for (const [index, name] of legacyFiles.entries()) {
  const sequence = String(index + 1).padStart(2, "0");
  const targetName = `202501010000${sequence}_${name.replace(/\.sql$/, "")}.sql`;
  const source = await readFile(path.join(legacyDirectory, name), "utf8");
  await writeFile(
    path.join(workspaceMigrations, targetName),
    `-- Generated from lib/db/migrations/${name}. Do not edit this generated file.\n${source}`,
    "utf8"
  );
}

const forwardDirectory = path.join(repositoryRoot, "supabase", "migrations");
const migrationPriority = new Map([
  // This migration creates sync_status, which the same-day reset migration reads.
  ["20260718_sync_status_and_atomic_queue.sql", -1],
  // The realtime wake-up table references document_generation_jobs.
  ["20260719_add_new_business_document_generation.sql", -1],
  // The correction migration expects the coordinate columns to be moved first.
  ["20260723_move_coordinates_to_business_info.sql", -1],
]);
const productionDataOnlyMigrations = new Set([
  "20260814090100_backfill_2026_h2_business_type.sql",
  "20260814090200_initialize_2026_h2_process_changed.sql",
]);
const forwardFiles = (await readdir(forwardDirectory))
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort((left, right) => {
    const leftDate = left.match(/^\d{8}/)?.[0] ?? left;
    const rightDate = right.match(/^\d{8}/)?.[0] ?? right;
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate, "en");
    const priorityDifference =
      (migrationPriority.get(left) ?? 0) - (migrationPriority.get(right) ?? 0);
    return priorityDifference || left.localeCompare(right, "en");
  });

const usedVersions = new Set();
for (const name of forwardFiles) {
  const match = name.match(/^(\d+)_([^]+)$/);
  if (!match) throw new Error(`INVALID_MIGRATION_FILENAME:${name}`);

  let version = match[1].padEnd(14, "0");
  while (usedVersions.has(version)) {
    version = (BigInt(version) + 1n).toString().padStart(14, "0");
  }
  usedVersions.add(version);

  const targetPath = path.join(workspaceMigrations, `${version}_${match[2]}`);
  if (productionDataOnlyMigrations.has(name)) {
    await writeFile(
      targetPath,
      `-- Production-only data backfill intentionally omitted from synthetic environments.\n-- Source: supabase/migrations/${name}\nselect 1;\n`,
      "utf8"
    );
  } else {
    await copyFile(path.join(forwardDirectory, name), targetPath);
  }
}

await copyFile(
  path.join(repositoryRoot, "supabase", "config.toml"),
  path.join(workspaceSupabase, "config.toml")
);
await copyFile(
  path.join(repositoryRoot, "supabase", "seed.sql"),
  path.join(workspaceSupabase, "seed.sql")
);

console.log(
  `Prepared ${legacyFiles.length} legacy and ${forwardFiles.length} forward migrations in ${workspaceRoot}.`
);
