import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const inputPath = resolve(arg("input") ?? "");
const outputPath = resolve(arg("output") ?? "");
const mode = arg("mode");
if (!inputPath || !outputPath || (mode !== "mutated" && mode !== "empty")) {
  throw new Error("USAGE: --input=... --output=... --mode=mutated|empty");
}

let cancelled = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { cancelled = true; });
const assertActive = () => { if (cancelled) throw new Error("ADVERSARIAL_ARTIFACT_CANCELLED"); };

const dataset = JSON.parse(readFileSync(inputPath, "utf8"));
assertActive();
const alternateUser = dataset.cleanInput.users.at(-1);
dataset.diagnosticSource.persistenceSourceContexts = dataset.diagnosticSource.persistenceSourceContexts.map((row: any) => ({
  ...row,
  measurer_id: mode === "mutated" ? alternateUser.id : null,
  collaborators: mode === "mutated" ? alternateUser.name : null,
  daily_staff: Array.isArray(row.daily_staff)
    ? row.daily_staff.map((day: any) => mode === "mutated"
      ? { ...day, measurer_id: alternateUser.id, collaborators: [alternateUser.name] }
      : { date: day.date, measurer_id: null, collaborators: [] })
    : row.daily_staff,
}));
dataset.diagnosticSource.v1Plans = (dataset.diagnosticSource.v1Plans ?? []).map((row: any) => ({
  ...row, recommended_date: mode === "mutated" ? "2025-01-02" : null,
}));
dataset.diagnosticSource.v2Plans = mode === "mutated"
  ? (dataset.diagnosticSource.v2Plans ?? []).map((row: any) => ({
    ...row, responsible_user_id: 999999, experienced_reviewer_id: 999998,
    participant_user_ids: [999997], recommendation_reason: { measurementAssignee: { userId: 999999 } },
  }))
  : [];
assertActive();
writeFileSync(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, mode, cleanInputUnchanged: true }));
