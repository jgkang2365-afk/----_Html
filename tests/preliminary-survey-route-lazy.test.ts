import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { candidateDates, earliestMeasurementDate } from "../lib/preliminary-survey-v2/reverse-planner/candidate-dates";
import { createRouteMetrics } from "../lib/preliminary-survey-v2/route-metrics";
import { resolveLazyRouteEvidence } from "../lib/preliminary-survey-v2/reverse-planner/lazy-route";
import {
  createSignedPreviewToken,
  PREVIEW_TOKEN_TTL_MS,
  verifySignedPreviewToken,
} from "../lib/preliminary-survey-v2/reverse-planner/preview-token-codec";
import { collectRequiredRoutePairs } from "../lib/preliminary-survey-v2/reverse-planner/route-requirements";
import { planPreliminarySurveyGivenFixedAssignments } from "../lib/preliminary-survey-v2/reverse-planner/solver";
import {
  PRELIMINARY_SURVEY_CANONICAL_SHA,
  REVERSE_PLANNER_VERSION,
  type PlannerTarget,
  type PlanningSnapshot,
} from "../lib/preliminary-survey-v2/reverse-planner/types";
import type { RouteMetric, RouteMetrics } from "../lib/preliminary-survey-v2/types";

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

function fakeRoutes(resolver: RouteMetrics["between"]): RouteMetrics {
  const stats = {
    requests: 0, externalCalls: 0, successes: 0, failures: 0,
    sessionCacheHits: 0, sharedCacheHits: 0, negativeCacheHits: 0, coordinateUnavailable: 0,
  };
  return {
    stats,
    async between(left, right, options) {
      stats.requests += 1;
      stats.externalCalls += 1;
      const result = await resolver(left, right, options);
      if (result.source === "vehicle") stats.successes += 1;
      else stats.failures += 1;
      return result;
    },
  };
}

const vehicle = (minutes: number): RouteMetric => ({
  source: "vehicle", durationMinutes: minutes, distanceKm: 1, sameRegion: false,
});
const unknownRoute: RouteMetric = {
  source: "unknown", durationMinutes: null, distanceKm: null, sameRegion: false,
};

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

test("공유 직원 + 다른 주소는 양방향을 조회하고 보수적인 최댓값을 사용한다", async () => {
  const durations = [27, 39];
  const routes = fakeRoutes(async () => vehicle(durations.shift()!));
  const snapshot = fixture({
    targets: [target({ coordinate: { latitude: 36.3401, longitude: 127.4401 } })],
    actualMeasurementOccupancy: [
      { targetId: 10, businessCode: "H0010", address: "대전 A",
        coordinate: { latitude: 36.3401, longitude: 127.4401 }, date: "2026-09-16", participantUserIds: [1] },
      { targetId: 20, businessCode: "H0020", address: "대전 B",
        coordinate: { latitude: 36.3501, longitude: 127.4501 }, date: "2026-09-16", participantUserIds: [1] },
    ],
  });
  const result = await resolveLazyRouteEvidence(snapshot, { routes });
  assert.equal(result.stats.directionalRequests, 2);
  assert.equal(result.stats.externalCalls, 2);
  assert.equal(result.snapshot.routeEvidence[0].forwardDurationMinutes, 27);
  assert.equal(result.snapshot.routeEvidence[0].reverseDurationMinutes, 39);
  assert.equal(result.snapshot.routeEvidence[0].durationMinutes, 39);
  assert.equal(result.snapshot.routeEvidence[0].provider, "vehicle_bidirectional");
});

test("한 방향만 성공하면 정상 Route 근거로 사용하지 않는다", async () => {
  let direction = 0;
  const routes = fakeRoutes(async () => {
    direction += 1;
    if (direction === 1) return vehicle(28);
    throw new Error("reverse timeout");
  });
  const snapshot = fixture({ actualMeasurementOccupancy: [
    ...fixture().actualMeasurementOccupancy,
    { targetId: 20, businessCode: "H0020", address: "다른 주소", coordinate: { latitude: 36.351, longitude: 127.451 },
      date: "2026-09-16", participantUserIds: [1] },
  ] });
  const result = await resolveLazyRouteEvidence(snapshot, { routes });
  assert.equal(result.snapshot.routeEvidence[0].durationMinutes, null);
  assert.equal(result.snapshot.routeEvidence[0].provider, "incomplete_direction");
  assert.equal(planPreliminarySurveyGivenFixedAssignments(result.snapshot).results[0].reason,
    "ROUTE_EVIDENCE_REQUIRED");
});

test("후보 Route가 연속 탈락해도 target 수와 무관하게 세 번째 정상 후보까지 탐색한다", async () => {
  const candidateDays = [...candidateDates("2026-09-16", "first_measurement").primary];
  const allowed = candidateDays.slice(0, 3);
  const blocked = candidateDays.slice(3).flatMap((date) => users.map((user) => ({
    userId: user.id, startDate: date, endDate: date,
  })));
  const routeMinutes = [70, 70, 70, 70, 20, 20];
  const routes = fakeRoutes(async () => vehicle(routeMinutes.shift()!));
  const external = allowed.map((date, index) => ({
    targetId: 20 + index,
    businessCode: `H002${index}`,
    address: `방문 주소 ${index}`,
    coordinate: { latitude: 36.35 + index / 1_000, longitude: 127.45 + index / 1_000 },
    preliminaryDate: date,
    surveyMethod: "field" as const,
    participantUserIds: [1],
    responsibleUserId: 1,
    reviewerUserId: 2,
    writerUserId: 1,
    protected: false,
  }));
  const result = await resolveLazyRouteEvidence(fixture({
    scheduleBlocks: blocked,
    existingSurveyOccupancy: external,
  }), { routes });
  const output = planPreliminarySurveyGivenFixedAssignments(result.snapshot);
  assert.equal(result.stats.requiredPairs, 3);
  assert.equal(result.stats.directionalRequests, 6);
  assert.equal(output.results[0].candidate?.preliminaryDate, allowed[2]);
  assert.equal(output.results[0].decision, "AUTO_ASSIGNED");
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

test("Route guard 초과 시 ID 앞쪽 일부만 처리하지 않고 현재 pair 전체를 보수적으로 낮춘다", async () => {
  let calls = 0;
  const routes = fakeRoutes(async () => { calls += 1; return vehicle(10); });
  const peers = Array.from({ length: 21 }, (_, index) => ({
    targetId: 100 + index, businessCode: `H${100 + index}`, address: `다른 주소 ${index}`,
    coordinate: { latitude: 36.4 + index / 10_000, longitude: 127.4 + index / 10_000 },
    date: "2026-09-16", participantUserIds: [1],
  }));
  const result = await resolveLazyRouteEvidence(fixture({ actualMeasurementOccupancy: [
    ...fixture().actualMeasurementOccupancy, ...peers,
  ] }), { routes, maxPairs: 20 });
  assert.equal(calls, 0);
  assert.equal(result.stats.guardedPairs, 21);
  assert.equal(result.snapshot.routeEvidence.every((item) => item.provider === "route_guard"), true);
});

test("전체 deadline은 진행 중 Route를 중단하고 관련 pair만 미확인으로 남긴다", async () => {
  const routes = fakeRoutes((_left, _right, options) => new Promise<RouteMetric>((resolve) => {
    const finish = () => resolve(unknownRoute);
    if (options?.signal?.aborted) finish();
    else options?.signal?.addEventListener("abort", finish, { once: true });
  }));
  const startedAt = Date.now();
  const result = await resolveLazyRouteEvidence(fixture({ actualMeasurementOccupancy: [
    ...fixture().actualMeasurementOccupancy,
    { targetId: 20, businessCode: "H0020", address: "다른 주소", coordinate: { latitude: 36.352, longitude: 127.452 },
      date: "2026-09-16", participantUserIds: [1] },
  ] }), { routes, deadlineMs: 20 });
  assert.ok(Date.now() - startedAt < 1_000);
  assert.equal(result.stats.deadlinePairs, 1);
  assert.equal(result.snapshot.routeEvidence[0].provider, "route_deadline");
});

test("provider가 AbortSignal을 무시해도 resolver hard deadline은 Preview를 반환한다", async () => {
  const routes = fakeRoutes(() => new Promise<RouteMetric>(() => undefined));
  const startedAt = Date.now();
  const result = await resolveLazyRouteEvidence(fixture({ actualMeasurementOccupancy: [
    ...fixture().actualMeasurementOccupancy,
    { targetId: 20, businessCode: "H0020", address: "다른 주소", coordinate: { latitude: 36.352, longitude: 127.452 },
      date: "2026-09-16", participantUserIds: [1] },
  ] }), { routes, deadlineMs: 20 });
  assert.ok(Date.now() - startedAt < 1_000);
  assert.equal(result.stats.deadlinePairs, 1);
  assert.equal(result.snapshot.routeEvidence[0].provider, "route_deadline");
});

test("4개 pair는 pair concurrency 4에서 최대 8개 양방향 요청으로 제한된다", async () => {
  let active = 0;
  let maxActive = 0;
  const routes = fakeRoutes(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return vehicle(15);
  });
  const peers = Array.from({ length: 4 }, (_, index) => ({
    targetId: 20 + index, businessCode: `H002${index}`, address: `주소 ${index}`,
    coordinate: { latitude: 36.36 + index / 1_000, longitude: 127.46 + index / 1_000 },
    date: "2026-09-16", participantUserIds: [1],
  }));
  const result = await resolveLazyRouteEvidence(fixture({ actualMeasurementOccupancy: [
    ...fixture().actualMeasurementOccupancy, ...peers,
  ] }), { routes, concurrency: 4 });
  assert.equal(result.stats.requiredPairs, 4);
  assert.equal(result.stats.directionalRequests, 8);
  assert.ok(maxActive <= 8);
});

test("좌표는 required pair의 사업장 code만 지연 조회한다", async () => {
  const loadedCodes: string[][] = [];
  const unrelated = Array.from({ length: 1_000 }, (_, index) => ({
    targetId: 1000 + index, businessCode: `U${index}`, address: `무관 ${index}`,
    date: "2026-09-16", participantUserIds: [1000 + index],
  }));
  const snapshot = fixture({
    targets: [target({ coordinate: null })],
    actualMeasurementOccupancy: [
      { targetId: 10, businessCode: "H0010", address: "A", date: "2026-09-16", participantUserIds: [1] },
      { targetId: 20, businessCode: "H0020", address: "B", date: "2026-09-16", participantUserIds: [1] },
      ...unrelated,
    ],
  });
  await resolveLazyRouteEvidence(snapshot, {
    routes: fakeRoutes(async () => vehicle(10)),
    loadCoordinates: async (codes) => {
      loadedCodes.push(codes);
      return new Map([
        ["H0010", { latitude: 36.31, longitude: 127.41 }],
        ["H0020", { latitude: 36.32, longitude: 127.42 }],
      ]);
    },
  });
  assert.deepEqual(loadedCodes, [["H0010", "H0020"]]);
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

test("daily_staff 저장순서와 무관하게 가장 이른 실제 측정일을 사용한다", () => {
  assert.equal(earliestMeasurementDate(["2026-09-16", "2026-09-14", "2026-09-15"], "x"), "2026-09-14");
  assert.equal(earliestMeasurementDate(["2026-09-15", "2026-09-16", "2026-09-14"], "x"), "2026-09-14");
});

test("synthetic 장기휴일로 -25 working day가 calendar -45보다 과거여도 후보에서 유지한다", () => {
  const rows = Array.from({ length: 25 }, (_, index) => ({
    workingDaysBefore: index + 1,
    date: `2026-08-${String(30 - index).padStart(2, "0")}`,
  }));
  const range = candidateDates("2026-09-30", "existing", rows);
  assert.equal([...range.primary, ...range.fallback].sort()[0], "2026-08-06");
  assert.ok((new Date("2026-09-30").getTime() - new Date("2026-08-06").getTime()) / 86_400_000 > 45);
});

test("Preview token은 Route·target·date·actor·expiry·signature 변조를 거부한다", () => {
  const now = Date.UTC(2026, 8, 2);
  const secret = "test-preview-secret";
  const input = {
    actorUserId: 2,
    measurementDate: "2026-09-16",
    sourceFingerprint: "fingerprint",
    routeEvidence: [{ date: "2026-09-16", leftTargetId: 10, rightTargetId: 20,
      sameAddress: false, durationMinutes: 39, provider: "vehicle_bidirectional", capturedAt: "x" }],
  };
  const token = createSignedPreviewToken(input, secret, now);
  const tamper = (mutate: (payload: any) => void) => {
    const [encoded, signature] = token.split(".");
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    mutate(payload);
    return `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`;
  };
  assert.throws(() => verifySignedPreviewToken(tamper((p) => { p.routeEvidence[0].durationMinutes = 10; }),
    2, input.measurementDate, secret, now), /INVALID_PREVIEW_TOKEN/);
  assert.throws(() => verifySignedPreviewToken(tamper((p) => { p.routeEvidence[0].leftTargetId = 99; }),
    2, input.measurementDate, secret, now), /INVALID_PREVIEW_TOKEN/);
  assert.throws(() => verifySignedPreviewToken(token, 2, "2026-09-17", secret, now), /INVALID_PREVIEW_TOKEN/);
  assert.throws(() => verifySignedPreviewToken(token, 3, input.measurementDate, secret, now), /INVALID_PREVIEW_TOKEN/);
  assert.throws(() => verifySignedPreviewToken(token, 2, input.measurementDate, secret,
    now + PREVIEW_TOKEN_TTL_MS + 1), /INVALID_PREVIEW_TOKEN/);
  assert.throws(() => verifySignedPreviewToken(`${token.slice(0, -1)}x`, 2, input.measurementDate, secret, now),
    /INVALID_PREVIEW_TOKEN/);
});

test("GET·confirm·Apply는 resolver를 호출하지 않고 Preview만 frozen evidence를 만든다", () => {
  const source = readFileSync("app/api/preliminary-survey-v2/reverse-planner/route.ts", "utf8");
  assert.equal((source.match(/resolveLazyRouteEvidence\(/g) ?? []).length, 1);
  assert.match(source, /body\.action === "preview"[\s\S]*resolveLazyRouteEvidence/);
  assert.match(source, /verifyPreviewToken[\s\S]*routeEvidence: preview\.routeEvidence/);
  assert.match(source, /body\.action === "confirm_fixed"[\s\S]*confirm_preliminary_survey_v2_fixed_assignment/);
});
