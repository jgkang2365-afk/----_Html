import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { candidateDates } from "../lib/preliminary-survey-v2/reverse-planner/candidate-dates";
import { createRouteMetrics } from "../lib/preliminary-survey-v2/route-metrics";
import { resolveLazyRouteEvidence } from "../lib/preliminary-survey-v2/reverse-planner/lazy-route";
import { collectRequiredRoutePairs } from "../lib/preliminary-survey-v2/reverse-planner/route-requirements";
import { planPreliminarySurveyGivenFixedAssignments } from "../lib/preliminary-survey-v2/reverse-planner/solver";
import {
  PRELIMINARY_SURVEY_CANONICAL_SHA,
  REVERSE_PLANNER_VERSION,
  type PlannerTarget,
  type PlanningSnapshot,
} from "../lib/preliminary-survey-v2/reverse-planner/types";

const users = [
  { id: 1, name: "강종구", active: true, experienced: false, baseCode: "C" },
  { id: 2, name: "이태환", active: true, experienced: true, baseCode: "A" },
];

function target(overrides: Partial<PlannerTarget> = {}): PlannerTarget {
  return {
    id: 10, code: "H0010", name: "계획대상", address: "대전광역시 중구 1",
    coordinate: { latitude: 36.3201, longitude: 127.4201 }, businessType: "first_measurement",
    days: [{ date: "2026-09-16", collaboratorUserIds: [1], reportWriterUserId: 1 }],
    fixedAssignments: [{ targetId: 10, measurementDate: "2026-09-16", assigneeUserId: 1,
      confirmedAt: "x", updatedAt: "x" }], existingPlan: null, ...overrides,
  };
}

function fixture(overrides: Partial<PlanningSnapshot> = {}): PlanningSnapshot {
  const planningTarget = target();
  return {
    canonicalSha: PRELIMINARY_SURVEY_CANONICAL_SHA, plannerVersion: REVERSE_PLANNER_VERSION,
    targets: [planningTarget], users, scheduleBlocks: [], routeEvidence: [], writingCounters: {},
    existingSurveyOccupancy: [], existingPublicSampleAssignments: [],
    actualMeasurementOccupancy: [{ targetId: 10, businessCode: "H0010", address: planningTarget.address,
      coordinate: planningTarget.coordinate, date: "2026-09-16", participantUserIds: [1] }],
    ...overrides,
  };
}

test("shared-person index는 무관한 1,000개 사업장을 route pair로 만들지 않는다", () => {
  const unrelated = Array.from({ length: 1_000 }, (_, index) => ({
    targetId: 1000 + index, businessCode: `U${index}`, address: `주소 ${index}`,
    date: "2026-09-16", participantUserIds: [1000 + index],
  }));
  const snapshot = fixture({ actualMeasurementOccupancy: [
    ...fixture().actualMeasurementOccupancy,
    { targetId: 20, businessCode: "H0020", address: "대전광역시 중구 2",
      coordinate: { latitude: 36.3301, longitude: 127.4301 }, date: "2026-09-16", participantUserIds: [1] },
    ...unrelated,
  ] });
  const provisional = planPreliminarySurveyGivenFixedAssignments(snapshot, { allowMissingRouteEvidence: true });
  const requirements = collectRequiredRoutePairs(snapshot, provisional);
  assert.equal(requirements.length, 1);
  assert.deepEqual([requirements[0].leftTargetId, requirements[0].rightTargetId], [10, 20]);
  assert.deepEqual(requirements[0].sharedUserIds, [1]);
});

test("동일주소 shared-person pair는 외부 Route 호출 없이 해결한다", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.KAKAO_REST_API_KEY;
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; throw new Error("호출되면 안 됨"); }) as typeof fetch;
  process.env.KAKAO_REST_API_KEY = "test";
  try {
    const snapshot = fixture({ actualMeasurementOccupancy: [
      ...fixture().actualMeasurementOccupancy,
      { targetId: 20, businessCode: "H0020", address: " 대전광역시  중구 1 ",
        coordinate: { latitude: 36.3302, longitude: 127.4302 }, date: "2026-09-16", participantUserIds: [1] },
    ] });
    const result = await resolveLazyRouteEvidence(snapshot);
    assert.equal(calls, 0);
    assert.equal(result.stats.sameAddressResolved, 1);
    assert.equal(result.stats.externalCalls, 0);
    assert.equal(result.snapshot.routeEvidence[0].provider, "same_address");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey == null) delete process.env.KAKAO_REST_API_KEY;
    else process.env.KAKAO_REST_API_KEY = originalKey;
  }
});

test("공유 직원 + 다른 주소는 정확히 한 directional route를 조회한다", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.KAKAO_REST_API_KEY;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ routes: [{ summary: { duration: 900, distance: 5000 } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  process.env.KAKAO_REST_API_KEY = "test";
  try {
    const snapshot = fixture({
      targets: [target({ coordinate: { latitude: 36.3401, longitude: 127.4401 } })],
      actualMeasurementOccupancy: [
        { targetId: 10, businessCode: "H0010", address: "대전 A",
          coordinate: { latitude: 36.3401, longitude: 127.4401 }, date: "2026-09-16", participantUserIds: [1] },
        { targetId: 20, businessCode: "H0020", address: "대전 B",
          coordinate: { latitude: 36.3501, longitude: 127.4501 }, date: "2026-09-16", participantUserIds: [1] },
      ],
    });
    const result = await resolveLazyRouteEvidence(snapshot);
    assert.equal(calls, 1);
    assert.equal(result.stats.externalCalls, 1);
    assert.equal(result.snapshot.routeEvidence[0].durationMinutes, 15);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey == null) delete process.env.KAKAO_REST_API_KEY;
    else process.env.KAKAO_REST_API_KEY = originalKey;
  }
});

test("provider 실패는 짧은 negative cache로 반복 외부 호출을 막되 정상 근거로 사용하지 않는다", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; return new Response("error", { status: 503 }); }) as typeof fetch;
  const left = { coordinate: { latitude: 36.3601, longitude: 127.4601 }, region: "대전 중구" } as any;
  const right = { coordinate: { latitude: 36.3701, longitude: 127.4701 }, region: "대전 서구" } as any;
  try {
    const first = createRouteMetrics("test");
    assert.equal((await first.between(left, right)).durationMinutes, null);
    const repeated = createRouteMetrics("test");
    const result = await repeated.between(left, right);
    assert.equal(result.source, "unknown");
    assert.equal(calls, 1);
    assert.equal(repeated.stats?.negativeCacheHits, 1);
    assert.equal(repeated.stats?.externalCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Route 장애는 관련 target만 MANUAL_REQUIRED로 낮춘다", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.KAKAO_REST_API_KEY;
  globalThis.fetch = (async () => new Response("error", { status: 503 })) as typeof fetch;
  process.env.KAKAO_REST_API_KEY = "test";
  try {
    const independent = target({ id: 11, code: "H0011", address: "독립 주소",
      coordinate: { latitude: 36.3901, longitude: 127.4901 },
      days: [{ date: "2026-09-16", collaboratorUserIds: [2], reportWriterUserId: 2 }],
      fixedAssignments: [{ targetId: 11, measurementDate: "2026-09-16", assigneeUserId: 2,
        confirmedAt: "x", updatedAt: "x" }] });
    const snapshot = fixture({ targets: [target({ coordinate: { latitude: 36.3801, longitude: 127.4801 } }), independent],
      actualMeasurementOccupancy: [
        { targetId: 10, businessCode: "H0010", address: "A", coordinate: { latitude: 36.3801, longitude: 127.4801 },
          date: "2026-09-16", participantUserIds: [1] },
        { targetId: 20, businessCode: "H0020", address: "B", coordinate: { latitude: 36.3811, longitude: 127.4811 },
          date: "2026-09-16", participantUserIds: [1] },
        { targetId: 11, businessCode: "H0011", address: "독립 주소", coordinate: independent.coordinate,
          date: "2026-09-16", participantUserIds: [2] },
      ] });
    const resolved = await resolveLazyRouteEvidence(snapshot);
    const output = planPreliminarySurveyGivenFixedAssignments(resolved.snapshot);
    assert.equal(output.results.find((item) => item.targetId === 10)?.reason, "ROUTE_EVIDENCE_REQUIRED");
    assert.equal(output.results.find((item) => item.targetId === 11)?.decision, "AUTO_ASSIGNED");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey == null) delete process.env.KAKAO_REST_API_KEY;
    else process.env.KAKAO_REST_API_KEY = originalKey;
  }
});

test("입력 순서를 바꿔도 required pair 집합이 같다", () => {
  const occupancy = [
    { targetId: 10, businessCode: "H0010", address: "A", date: "2026-09-16", participantUserIds: [2, 1] },
    { targetId: 20, businessCode: "H0020", address: "B", date: "2026-09-16", participantUserIds: [1] },
    { targetId: 30, businessCode: "H0030", address: "C", date: "2026-09-16", participantUserIds: [2] },
  ];
  const collect = (items: typeof occupancy) => {
    const snapshot = fixture({ actualMeasurementOccupancy: items });
    const provisional = planPreliminarySurveyGivenFixedAssignments(snapshot, { allowMissingRouteEvidence: true });
    return collectRequiredRoutePairs(snapshot, provisional);
  };
  assert.deepEqual(collect(occupancy), collect([...occupancy].reverse().map((item) => ({
    ...item, participantUserIds: [...item.participantUserIds].reverse(),
  }))));
});

test("45 calendar-day magic range를 제거하고 실제 working-day -20/-25를 사용한다", () => {
  const source = readFileSync("app/api/preliminary-survey-v2/reverse-planner/route.ts", "utf8");
  assert.doesNotMatch(source, /subtractDays\([^\n]*45|45 calendar/i);
  assert.equal(candidateDates("2026-09-16", "first_measurement").primary.length, 18);
  assert.equal(candidateDates("2026-09-16", "existing").fallback.length, 5);
});

test("GET·confirm·Apply는 resolver를 호출하지 않고 Preview만 frozen evidence를 만든다", () => {
  const source = readFileSync("app/api/preliminary-survey-v2/reverse-planner/route.ts", "utf8");
  assert.equal((source.match(/resolveLazyRouteEvidence\(/g) ?? []).length, 1);
  assert.match(source, /body\.action === "preview"[\s\S]*resolveLazyRouteEvidence/);
  assert.match(source, /verifyPreviewToken[\s\S]*routeEvidence: preview\.routeEvidence/);
  assert.match(source, /body\.action === "confirm_fixed"[\s\S]*confirm_preliminary_survey_v2_fixed_assignment/);
});
