import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { recommendationDates } from "../lib/preliminary-survey-v2/calendar";
import { recommendBatch } from "../lib/preliminary-survey-v2/engine";
import { targetChangeRecommendationPolicy } from "../lib/preliminary-survey-v2/policy";
import type { RouteMetric, SurveyTarget, SurveyUser } from "../lib/preliminary-survey-v2/types";

const experienced = (id: number, name = `경력${id}`): SurveyUser => ({ id, name, experienced: true, active: true });
const novice = (id: number, name = `비경력${id}`): SurveyUser => ({ id, name, experienced: false, active: true });
const target = (id: number, kind: "new" | "existing", responsible: SurveyUser, measurementDate = "2026-07-14"): SurveyTarget => ({
  id, code: `C${id}`, name: `사업장${id}`, kind, responsible, measurementDate,
  address: "충남 천안시", region: "충남 천안시", coordinate: { latitude: 36.8 + id / 1000, longitude: 127.1 },
  createdAt: `2026-01-${String(id).padStart(2, "0")}`,
});
const route = (durationMinutes: number | null = 30, source: RouteMetric["source"] = "vehicle") => ({
  between: async (): Promise<RouteMetric> => ({ source, durationMinutes, distanceKm: 10, sameRegion: true }),
});
const available = (blocked = new Set<string>()) => ({ isBlocked: (userId: number, date: string) => blocked.has(`${userId}:${date}`) });

test("A: 현재 날짜가 측정일 이후여도 측정일 기준 과거 후보를 생성한다", async () => {
  const user = experienced(1);
  const [result] = await recommendBatch({ targets: [target(1, "new", user)], experiencedUsers: [user], availability: available(), routes: route() });
  assert.equal(result.status, "recommended");
  assert.ok(result.date! < "2026-07-14");
});

test("B: -30~-20 기본구간에서 -30을 우선한다", () => {
  assert.equal(recommendationDates("2026-07-14")[0].workingDaysBefore, 30);
});

test("C: 기본구간이 모두 불가능하면 -19부터 탐색한다", async () => {
  const user = experienced(1);
  const dates = recommendationDates("2026-07-14");
  const blocked = new Set(dates.filter(item => item.workingDaysBefore >= 20).map(item => `${user.id}:${item.date}`));
  const [result] = await recommendBatch({ targets: [target(1, "new", user)], experiencedUsers: [user], availability: available(blocked), routes: route() });
  assert.equal(result.evidence.workingDaysBefore, 19);
});

test("D: -3까지 불가능하면 수동조정 상태다", async () => {
  const user = experienced(1);
  const blocked = new Set(recommendationDates("2026-07-14").map(item => `${user.id}:${item.date}`));
  const [result] = await recommendBatch({ targets: [target(1, "new", user)], experiencedUsers: [user], availability: available(blocked), routes: route() });
  assert.equal(result.status, "manual_required");
});

test("E/F: 경력 담당자는 단독, 비경력 담당자는 담당자+경력자", async () => {
  const senior = experienced(10);
  const results = await recommendBatch({ targets: [target(1, "new", senior), target(2, "new", novice(2))], experiencedUsers: [senior], availability: available(), routes: route() });
  assert.deepEqual(results[0].participants.map(item => item.id), [10]);
  assert.deepEqual(results[1].participants.map(item => item.id), [2, 10]);
});

test("G: 신규업체는 가능한 날짜에 하루 1건씩 먼저 분산한다", async () => {
  const user = experienced(1);
  const results = await recommendBatch({ targets: [target(1, "new", user), target(2, "new", user)], experiencedUsers: [user], availability: available(), routes: route(null, "distance") });
  assert.notEqual(results[0].date, results[1].date);
  assert.equal(results[1].evidence.capacityPass, 1);
});

test("H/I: 날짜 부족 시 신규 2건을 60분 이내만 허용한다", async () => {
  const user = experienced(1);
  const allowedDate = recommendationDates("2026-07-14")[0].date;
  const blocked = new Set(recommendationDates("2026-07-14").slice(1).map(item => `${user.id}:${item.date}`));
  const okay = await recommendBatch({ targets: [target(1, "new", user), target(2, "new", user)], experiencedUsers: [user], availability: available(blocked), routes: route(60) });
  assert.equal(okay[1].date, allowedDate);
  assert.equal(okay[1].evidence.capacityPass, 2);
  const denied = await recommendBatch({ targets: [target(1, "new", user), target(2, "new", user)], experiencedUsers: [user], availability: available(blocked), routes: route(61) });
  assert.equal(denied[1].status, "manual_required");
});

test("J: 기존업체는 동일 담당자 하루 최대 3건", async () => {
  const user = experienced(1);
  const results = await recommendBatch({ targets: [1, 2, 3, 4].map(id => target(id, "existing", user)), experiencedUsers: [user], availability: available(), routes: route() });
  assert.equal(results.slice(0, 3).filter(item => item.date === results[0].date).length, 3);
  assert.notEqual(results[3].date, results[0].date);
});

test("K/L: 기존 경력 검토는 무제한이며 신규 경력자 균등 카운트에서 제외", async () => {
  const reviewer1 = experienced(10);
  const reviewer2 = experienced(11);
  const existing = await recommendBatch({
    targets: [1, 2, 3, 4, 5, 6].map(id => target(id, "existing", novice(id))),
    experiencedUsers: [reviewer1, reviewer2], availability: available(), routes: route(),
  });
  assert.equal(existing.filter(item => item.date === existing[0].date && item.experiencedReviewer?.id === 10).length, 6);
  assert.ok(existing.every(item => item.evidence.experiencedNewAssignments === 0));
});

test("M/N: 보고서 담당자 변경은 자동/수동 계획 구분 없이 재추천", () => {
  for (const manual of [false, true]) {
    assert.equal(targetChangeRecommendationPolicy({ responsibleChanged: true, measurementDateChanged: false, existingRecommendedDate: manual ? "2026-06-01" : "2026-06-02", nextMeasurementDate: "2026-07-14" }), "recalculate");
  }
});

test("O/P: 측정일 단순 변경은 유지하고 -3 이내/이후만 재추천", () => {
  assert.equal(targetChangeRecommendationPolicy({ responsibleChanged: false, measurementDateChanged: true, existingRecommendedDate: "2026-06-01", nextMeasurementDate: "2026-07-20" }), "keep");
  assert.equal(targetChangeRecommendationPolicy({ responsibleChanged: false, measurementDateChanged: true, existingRecommendedDate: "2026-07-17", nextMeasurementDate: "2026-07-20" }), "recalculate");
  assert.equal(targetChangeRecommendationPolicy({ responsibleChanged: false, measurementDateChanged: true, existingRecommendedDate: "2026-07-21", nextMeasurementDate: "2026-07-20" }), "recalculate");
});

test("Q-V: 단일 추천 저장/UI/수동수정/Google 신호 배제/score 제거 구조", () => {
  const ui = readFileSync("components/features/MeasurementTargetBusinessManagement.tsx", "utf8");
  const recommendRoute = readFileSync("app/api/preliminary-survey-v2/recommend/route.ts", "utf8");
  const manualRoute = readFileSync("app/api/preliminary-survey-v2/[targetId]/route.ts", "utf8");
  const engine = readFileSync("lib/preliminary-survey-v2/engine.ts", "utf8");
  const migration = readFileSync("supabase/migrations/20260808_add_preliminary_survey_v2.sql", "utf8");
  assert.match(recommendRoute, /recommendAndPersistV2/);
  assert.match(ui, /예비조사자\(복수선택 가능\)/);
  assert.doesNotMatch(ui, /선택한 추천안 적용|추천일 숨김/);
  assert.match(manualRoute, /plan_origin[\s\S]*manual/);
  assert.doesNotMatch(engine, /Google|preferred|occupied/);
  assert.doesNotMatch(migration, /recommendation_score\s+(integer|bigint)/i);
});
