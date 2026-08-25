import { createHash } from "node:crypto";

export const STAGE2_REHEARSAL_MODE = "LOCAL_DOCKER_REHEARSAL" as const;
export const PRODUCTION_PROJECT_REF = "xjxqbwvcgffunqnkmoqw";
export const STAGE2_PRODUCTION_MODE = "PRODUCTION_ONE_SHOT" as const;

export function assertLocalDockerRehearsalEnvironment(input: {
  mode: string | undefined;
  databaseUrl: string;
  apiUrl: string;
  environmentValues?: Array<string | undefined>;
}) {
  const allValues = [input.databaseUrl, input.apiUrl, ...(input.environmentValues ?? [])]
    .filter((value): value is string => Boolean(value));
  if (allValues.some((value) => value.includes(PRODUCTION_PROJECT_REF))) {
    throw new Error("PRODUCTION_WRITE_FORBIDDEN_IN_REHEARSAL");
  }
  if (input.mode !== STAGE2_REHEARSAL_MODE) throw new Error("LOCAL_DOCKER_REHEARSAL_MODE_REQUIRED");
  if (!/^postgresql:\/\/[^@]+@127\.0\.0\.1:54322\//.test(input.databaseUrl) ||
      !/^http:\/\/127\.0\.0\.1:54321$/.test(input.apiUrl)) {
    throw new Error("ISOLATED_LOCAL_SUPABASE_REQUIRED");
  }
}

export function assertStage2ProductionEnvironment(input: { mode: string | undefined; apiUrl: string }) {
  if (input.mode !== STAGE2_PRODUCTION_MODE) throw new Error("PRODUCTION_ONE_SHOT_MODE_REQUIRED");
  const url = new URL(input.apiUrl);
  if (url.protocol !== "https:" || url.hostname !== `${PRODUCTION_PROJECT_REF}.supabase.co`) {
    throw new Error("PRODUCTION_PROJECT_MISMATCH");
  }
}

export function allOrNothingAssignments<T extends { targetId: number }>(
  assignments: T[],
  hardBlockedTargetIds: ReadonlySet<number>,
) {
  return assignments.filter((assignment) => !hardBlockedTargetIds.has(assignment.targetId));
}

export function assignmentGroupFingerprint(input: {
  measurementDate: string;
  assigneeUserId: number;
  targetIds: number[];
}) {
  const targetIds = [...input.targetIds].sort((left, right) => left - right);
  return createHash("md5").update(
    `${input.measurementDate}|${input.assigneeUserId}|${targetIds.join(",")}`,
  ).digest("hex");
}

export function stableJsonDigest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
