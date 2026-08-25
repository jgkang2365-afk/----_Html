import assert from "node:assert/strict";
import test from "node:test";
import {
  allOrNothingAssignments,
  assertLocalDockerRehearsalEnvironment,
  assignmentGroupFingerprint,
} from "../lib/preliminary-survey-v2/stage2-rehearsal";

test("Docker rehearsal은 명시적 Local mode와 고정 loopback endpoint만 허용한다", () => {
  assert.doesNotThrow(() => assertLocalDockerRehearsalEnvironment({
    mode: "LOCAL_DOCKER_REHEARSAL",
    databaseUrl: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    apiUrl: "http://127.0.0.1:54321",
  }));
  assert.throws(() => assertLocalDockerRehearsalEnvironment({
    mode: "LOCAL_DOCKER_REHEARSAL",
    databaseUrl: "postgresql://postgres:secret@db.xjxqbwvcgffunqnkmoqw.supabase.co:5432/postgres",
    apiUrl: "https://xjxqbwvcgffunqnkmoqw.supabase.co",
  }), /PRODUCTION_WRITE_FORBIDDEN_IN_REHEARSAL/);
  assert.throws(() => assertLocalDockerRehearsalEnvironment({
    mode: undefined,
    databaseUrl: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    apiUrl: "http://127.0.0.1:54321",
  }), /LOCAL_DOCKER_REHEARSAL_MODE_REQUIRED/);
});

test("다일 target이 한 날짜라도 hard-block이면 모든 날짜 assignment를 제거한다", () => {
  const assignments = [
    { targetId: 1, measurementDate: "2026-08-24" },
    { targetId: 1, measurementDate: "2026-08-25" },
    { targetId: 2, measurementDate: "2026-08-24" },
  ];
  assert.deepEqual(allOrNothingAssignments(assignments, new Set([1])), [assignments[2]]);
});

test("approval group fingerprint는 target ID 정렬과 DB 형식에 고정된다", () => {
  assert.equal(
    assignmentGroupFingerprint({ measurementDate: "2026-08-24", assigneeUserId: 2, targetIds: [30, 10, 20] }),
    assignmentGroupFingerprint({ measurementDate: "2026-08-24", assigneeUserId: 2, targetIds: [10, 20, 30] }),
  );
  assert.match(
    assignmentGroupFingerprint({ measurementDate: "2026-08-24", assigneeUserId: 2, targetIds: [10, 20, 30] }),
    /^[0-9a-f]{32}$/,
  );
});
