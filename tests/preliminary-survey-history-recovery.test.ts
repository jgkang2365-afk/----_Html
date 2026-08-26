import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildHistoricalPlanRecoveryManifest,
  HISTORICAL_PLAN_RECOVERY_PROTECTED_CODES,
  type HistoricalPlanRecoveryTarget,
} from "../lib/preliminary-survey-v2/historical-plan-recovery";
import { recommendationDatesForBusinessType } from "../lib/preliminary-survey-v2/calendar";

const target = (overrides: Partial<HistoricalPlanRecoveryTarget> = {}): HistoricalPlanRecoveryTarget => ({
  id: 1,
  code: "H0001",
  year: 2026,
  period: "하반기",
  measurement_date: "2026-08-26",
  ...overrides,
});

const users = [
  { id: 10, name: "비경력", is_active: true, is_preliminary_survey_experienced: false, is_preliminary_survey_support_assignable: true },
  { id: 20, name: "경력", is_active: true, is_preliminary_survey_experienced: true, is_preliminary_survey_support_assignable: true },
];

function build(overrides: Partial<Parameters<typeof buildHistoricalPlanRecoveryManifest>[0]> = {}) {
  return buildHistoricalPlanRecoveryManifest({
    targets: [target()],
    legacySources: [{ id: 101, code: "H0001", year: 2026, period: "하반기", measurement_date: "2026-08-26", preliminary_surveyor: "경력, 비경력" }],
    users,
    existingPlans: [],
    scheduleBlockedKeys: new Set(),
    measurementBlockedKeys: new Set(),
    sourceHashes: new Map([[101, "a".repeat(64)]]),
    targetHashes: new Map([[1, "b".repeat(64)]]),
    contextHash: "c".repeat(64),
    ...overrides,
  });
}

describe("historical plan recovery", () => {
  it("legacy participant order를 보존하고 manual 규칙으로 책임자/reviewer를 정한다", () => {
    const [row] = build();
    assert.equal(row.classification, "HISTORICAL_EXACT_RECOVERY");
    assert.deepEqual(row.participantNames, ["경력", "비경력"]);
    assert.deepEqual(row.participantUserIds, [20, 10]);
    assert.equal(row.derivedResponsibleUserId, 10);
    assert.equal(row.derivedReviewerUserId, 20);
    assert.equal(row.workingDaysBefore, 20);
  });

  it("현재 날짜 cutoff 없이 기존업체 역사 후보 순서 -20부터 탐색한다", () => {
    const [row] = build();
    assert.equal(row.derivedPreliminaryDate, "2026-07-28");
  });

  it("일정과 실제 측정 충돌을 모두 반영하고 조사자는 교체하지 않는다", () => {
    const baseline = build()[0];
    const blocked = new Set(users.flatMap((user) => [`${user.id}:${baseline.derivedPreliminaryDate}`]));
    const [row] = build({ scheduleBlockedKeys: blocked });
    assert.equal(row.classification, "HISTORICAL_EXACT_RECOVERY");
    assert.notEqual(row.derivedPreliminaryDate, baseline.derivedPreliminaryDate);
    assert.deepEqual(row.participantUserIds, [20, 10]);

    const allDates = recommendationDatesForBusinessType("2026-08-26", "existing");
    const allBlocked = new Set(allDates.flatMap((candidate) => users.map((user) => `${user.id}:${candidate.date}`)));
    const [unresolved] = build({ measurementBlockedKeys: allBlocked });
    assert.equal(unresolved.classification, "NO_VALID_HISTORICAL_DATE");
    assert.deepEqual(unresolved.participantUserIds, [20, 10]);
  });

  it("기존 plan과 보호 대상은 write 후보에서 제외한다", () => {
    const [existing] = build({
      existingPlans: [{ id: "plan-1", measurement_target_business_id: 1, recommended_date: "2026-08-03", responsible_user_id: 10, survey_method: "phone", status: "recommended" }],
    });
    assert.equal(existing.classification, "EXISTING_V2_PRESERVED");

    const [protectedRow] = build({ targets: [target({ code: "H0524" })], legacySources: [{ id: 102, code: "H0524", year: 2026, period: "하반기", measurement_date: "2026-08-26", preliminary_surveyor: "경력" }], sourceHashes: new Map([[102, "d".repeat(64)]]) });
    assert.equal(protectedRow.classification, "PROTECTED_PRESERVED");
  });

  it("H0399는 영구 코드 차단 없이 역사 복원 대상이고 기존 보호 9건은 유지한다", () => {
    const [row] = build({
      targets: [target({ code: "H0399", measurement_date: "2026-08-25" })],
      legacySources: [{ id: 102, code: "H0399", year: 2026, period: "하반기", measurement_date: "2026-08-25", preliminary_surveyor: "경력" }],
      sourceHashes: new Map([[102, "d".repeat(64)]]),
    });
    assert.equal(row.classification, "HISTORICAL_EXACT_RECOVERY");
    assert.deepEqual(row.participantNames, ["경력"]);
    assert.equal(HISTORICAL_PLAN_RECOVERY_PROTECTED_CODES.has("H0399"), false);
    assert.equal(HISTORICAL_PLAN_RECOVERY_PROTECTED_CODES.size, 9);
    assert.equal(HISTORICAL_PLAN_RECOVERY_PROTECTED_CODES.has("H0524"), true);
  });

  it("legacy source 또는 user가 모호하면 plan을 만들지 않는다", () => {
    const duplicateSources = [
      { id: 101, code: "H0001", year: 2026, period: "하반기", measurement_date: "2026-08-26", preliminary_surveyor: "경력" },
      { id: 102, code: "H0001", year: 2026, period: "하반기", measurement_date: "2026-08-26", preliminary_surveyor: "경력" },
    ];
    assert.equal(build({ legacySources: duplicateSources })[0].classification, "AMBIGUOUS_LEGACY_SOURCE");
    assert.equal(build({ users: [...users, { ...users[1], id: 21 }] })[0].classification, "USER_MAPPING_CONFLICT");
  });
});
