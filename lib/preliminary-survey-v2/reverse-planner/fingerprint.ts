import { deterministicHash } from "./stable";
import type { PlanningSnapshot } from "./types";
export function sourceFingerprint(snapshot: PlanningSnapshot) {
  const routeEvidence = snapshot.routeEvidence.map(({ capturedAt: _capturedAt, ...evidence }) => evidence);
  return deterministicHash({ canonicalSha: snapshot.canonicalSha, plannerVersion: snapshot.plannerVersion,
    targets: snapshot.targets, users: snapshot.users, scheduleBlocks: snapshot.scheduleBlocks,
    routeEvidence, writingCounters: snapshot.writingCounters });
}
