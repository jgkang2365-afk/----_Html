import assert from "node:assert/strict";
import test from "node:test";
import {
  calculatePreliminarySurveyImpactScope,
  normalizePreliminarySurveyImpactAddress,
  type PreliminarySurveyImpactTarget,
} from "../lib/preliminary-survey-v2/impact-scope";

const target = (targetId: number, over: Partial<PreliminarySurveyImpactTarget> = {}): PreliminarySurveyImpactTarget => ({
  targetId,
  preliminaryDate: null,
  participantUserIds: [],
  surveyMethod: null,
  address: null,
  visitBundleKey: null,
  measurementDate: null,
  locked: false,
  ...over,
});

test("같은 예비조사일·겹치는 조사자에서 시작해 주소와 방문묶음 관계까지 closure를 확장한다", () => {
  const result = calculatePreliminarySurveyImpactScope({
    seedTargetIds: [1],
    targets: [
      target(1, { preliminaryDate: "2026-08-03", participantUserIds: [10], address: "충남 천안시 동남구 1", surveyMethod: "field" }),
      target(2, { preliminaryDate: "2026-08-03", participantUserIds: [10, 20], address: "충남 천안시 다른주소", surveyMethod: "field" }),
      target(3, { preliminaryDate: "2026-08-07", participantUserIds: [30], address: "충남 천안시  다른주소", visitBundleKey: "A-1" }),
      target(4, { preliminaryDate: "2026-08-09", participantUserIds: [40], address: "대전 중구 1", visitBundleKey: "a-1" }),
      target(99, { preliminaryDate: "2026-08-10", participantUserIds: [99], address: "무관" }),
    ],
  });

  assert.deepEqual(result.targetIds, [1, 2, 3, 4]);
  assert.ok(result.reasonsByTarget[1].includes("selected"));
  assert.ok(result.reasonsByTarget[2].includes("same_preliminary_date_participant"));
  assert.ok(result.reasonsByTarget[3].includes("same_normalized_address"));
  assert.ok(result.reasonsByTarget[4].includes("same_visit_bundle"));
});

test("같은 날짜 방문·유선 용량과 같은 측정일 측정자 균등배정 대상도 포함한다", () => {
  const result = calculatePreliminarySurveyImpactScope({
    seedTargetIds: [1, 3],
    targets: [
      target(1, { preliminaryDate: "2026-08-03", surveyMethod: "field", participantUserIds: [10], measurementDate: "2026-09-01" }),
      target(2, { preliminaryDate: "2026-08-03", surveyMethod: "field", participantUserIds: [10], measurementDate: "2026-09-02" }),
      target(3, { preliminaryDate: "2026-08-04", surveyMethod: "phone", participantUserIds: [20], measurementDate: "2026-09-03" }),
      target(4, { preliminaryDate: "2026-08-04", surveyMethod: "phone", participantUserIds: [20], measurementDate: "2026-09-04" }),
      target(5, { preliminaryDate: "2026-08-09", surveyMethod: "field", measurementDate: "2026-09-01" }),
    ],
  });

  assert.deepEqual(result.targetIds, [1, 2, 3, 4, 5]);
  assert.ok(result.reasonsByTarget[2].includes("same_date_field_capacity"));
  assert.ok(result.reasonsByTarget[4].includes("same_date_phone_capacity"));
  assert.ok(result.reasonsByTarget[5].includes("same_measurement_date_assignee_balance"));
});

test("용량 관계는 같은 예비조사일·방식만으로 확장하지 않고 겹치는 조사자를 요구한다", () => {
  const result = calculatePreliminarySurveyImpactScope({
    seedTargetIds: [1],
    targets: [
      target(1, { preliminaryDate: "2026-08-03", surveyMethod: "field", participantUserIds: [10] }),
      target(2, { preliminaryDate: "2026-08-03", surveyMethod: "field", participantUserIds: [20] }),
      target(3, { preliminaryDate: "2026-08-03", surveyMethod: "phone", participantUserIds: [20] }),
    ],
  });
  assert.deepEqual(result.targetIds, [1]);
});

test("주소 정규화는 공백 차이만 제거하고 빈 주소는 관계를 만들지 않는다", () => {
  assert.equal(normalizePreliminarySurveyImpactAddress(" 충남  천안시\n동남구 1 "), "충남천안시동남구1");
  const result = calculatePreliminarySurveyImpactScope({
    seedTargetIds: [1],
    targets: [
      target(1, { address: "충남 천안시 동남구 1" }),
      target(2, { address: "충남천안시\n동남구 1" }),
      target(3, { address: "   " }),
      target(4, { address: null }),
    ],
  });
  assert.deepEqual(result.targetIds, [1, 2]);
  assert.ok(result.reasonsByTarget[2].includes("same_normalized_address"));
});

test("찐확정 대상은 closure 조회·재검증에는 포함하되 별도 locked 목록으로 반환한다", () => {
  const result = calculatePreliminarySurveyImpactScope({
    seedTargetIds: [1],
    targets: [
      target(1, { preliminaryDate: "2026-08-03", participantUserIds: [10] }),
      target(2, { preliminaryDate: "2026-08-03", participantUserIds: [10], locked: true }),
      target(3, { preliminaryDate: "2026-08-03", participantUserIds: [10], locked: false }),
    ],
  });

  assert.deepEqual(result.targetIds, [1, 2, 3]);
  assert.deepEqual(result.lockedTargetIds, [2]);
  assert.ok(result.reasonsByTarget[2].includes("true_confirmed_locked"));
  assert.ok(result.reasonsByTarget[2].includes("same_preliminary_date_participant"));
  assert.ok(result.reasonsByTarget[3].includes("same_preliminary_date_participant"));
});

test("다일 측정은 시작일이 달라도 겹치는 실제 측정일의 공시료 균형 대상을 포함한다", () => {
  const result = calculatePreliminarySurveyImpactScope({
    seedTargetIds: [1],
    targets: [
      { targetId: 1, measurementDate: "2026-08-01", measurementDates: ["2026-08-01", "2026-08-03"] },
      { targetId: 2, measurementDate: "2026-08-03", measurementDates: ["2026-08-03"] },
      { targetId: 3, measurementDate: "2026-08-04" },
    ],
  });
  assert.deepEqual(result.targetIds, [1, 2]);
  assert.ok(result.reasonsByTarget[2].includes("same_measurement_date_assignee_balance"));
});
