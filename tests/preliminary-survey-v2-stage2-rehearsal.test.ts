import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPreliminarySurveyV2CleanInput,
  buildPreliminarySurveyV2CleanInput,
  replaySourceFingerprint,
} from "../lib/preliminary-survey-v2/historical-replay";
import {
  allOrNothingAssignments,
  assertLocalDockerRehearsalEnvironment,
  assertStage2ProductionEnvironment,
  assignmentGroupFingerprint,
} from "../lib/preliminary-survey-v2/stage2-rehearsal";

function legacyVariant(mode: "actual" | "mutated" | "empty") {
  const role = mode === "actual" ? { id: 2, name: "기존담당" } : mode === "mutated" ? { id: 999, name: "변조담당" } : null;
  return {
    targets: [{
      id: 1, code: "H0001", year: 2026, period: "하반기", business_name: "테스트", address: "충남",
      measurement_date: "2026-08-27", measurement_end_date: "2026-08-28", created_at: "2026-01-01T00:00:00Z",
      business_type: "existing", preliminary_survey_rule_type: "existing", process_changed: false,
      requires_field_preliminary_survey: false,
      measurer_id: role?.id ?? null, link_measurer_id: role?.id ?? null,
      collaborators: role ? role.name : null,
      daily_staff: [
        { date: "2026-08-27", measurer_id: role?.id ?? null, collaborators: role ? [role.name] : [] },
        { date: "2026-08-28", measurer_id: role?.id ?? null, collaborators: role ? [role.name] : [] },
      ],
    }],
    users: [{ id: 1, name: "신규후보", role: "관리자", job: "측정", survey_code: "A", is_active: true,
      is_preliminary_survey_experienced: true, is_preliminary_survey_support_assignable: true,
      is_preliminary_survey_manager: false }],
    journals: [], businessInfo: [{ code: "H0001", latitude: 36.8, longitude: 127.1 }], blocks: [], policyRows: [],
    v1Plans: [{ recommended_date: mode === "actual" ? "2026-08-01" : mode === "mutated" ? "2025-01-01" : null }],
    v2Plans: role ? [{ responsible_user_id: role.id, recommendation_reason: { measurementAssignee: role } }] : [],
  };
}

test("CLEAN_INPUT은 legacy 역할값 A/B/NULL 및 기존 V1/V2 값의 영향을 받지 않는다", () => {
  const digests = (["actual", "mutated", "empty"] as const).map((mode) =>
    replaySourceFingerprint(buildPreliminarySurveyV2CleanInput(legacyVariant(mode))),
  );
  assert.equal(new Set(digests).size, 1);
  const clean = buildPreliminarySurveyV2CleanInput(legacyVariant("actual"));
  assert.deepEqual(clean.targets[0].measurementDates, ["2026-08-27", "2026-08-28"]);
  assert.equal(JSON.stringify(clean).includes("기존담당"), false);
});

test("운영 one-shot은 명시 mode와 고정 production project만 허용한다", () => {
  assert.doesNotThrow(() => assertStage2ProductionEnvironment({
    mode: "PRODUCTION_ONE_SHOT", apiUrl: "https://xjxqbwvcgffunqnkmoqw.supabase.co",
  }));
  assert.throws(() => assertStage2ProductionEnvironment({
    mode: "PRODUCTION_ONE_SHOT", apiUrl: "http://127.0.0.1:54321",
  }), /PRODUCTION_PROJECT_MISMATCH/);
  assert.throws(() => assertStage2ProductionEnvironment({
    mode: undefined, apiUrl: "https://xjxqbwvcgffunqnkmoqw.supabase.co",
  }), /PRODUCTION_ONE_SHOT_MODE_REQUIRED/);
});

test("CLEAN_INPUT 객체에 금지 legacy field가 재유입되면 즉시 실패한다", () => {
  const clean: any = buildPreliminarySurveyV2CleanInput(legacyVariant("empty"));
  clean.targets[0].measurer_id = 1;
  assert.throws(() => assertPreliminarySurveyV2CleanInput(clean), /FORBIDDEN_LEGACY_ASSIGNMENT_FIELD_DETECTED/);
  delete clean.targets[0].measurer_id;
  clean.targets[0].daily_staff = [{ date: "2026-08-27", reportWriterUserId: 1 }];
  assert.throws(() => assertPreliminarySurveyV2CleanInput(clean), /FORBIDDEN_LEGACY_ASSIGNMENT_FIELD_DETECTED/);
});

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
