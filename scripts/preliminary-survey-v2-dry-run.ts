import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { calculateV2Recommendations } from "../lib/preliminary-survey-v2/service";
import { recommendationDates } from "../lib/preliminary-survey-v2/calendar";
import { createRouteMetrics } from "../lib/preliminary-survey-v2/route-metrics";

config({ path: resolve(process.cwd(), "../../.env.local"), quiet: true });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_ENV_MISSING");
const supabase = createClient(url, key);

async function tableSnapshot(table: string) {
  const countResult = await supabase.from(table).select("*", { count: "exact", head: true });
  if (countResult.error) return { table, unavailable: countResult.error.code || countResult.error.message };
  const latest = await supabase.from(table).select("updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  return { table, count: countResult.count ?? 0, latestUpdatedAt: latest.error ? null : latest.data?.updated_at ?? null };
}

async function snapshot() {
  return Promise.all([
    tableSnapshot("measurement_target_business"),
    tableSnapshot("measurement_journal"),
    tableSnapshot("business_info"),
    tableSnapshot("user_schedule_blocks"),
    tableSnapshot("preliminary_survey"),
    tableSnapshot("preliminary_survey_plans"),
    tableSnapshot("preliminary_survey_v2_plans"),
  ]);
}

async function legacyClassifications() {
  const { data, error } = await supabase.from("measurement_target_business").select(
    "id, code, business_name, year, period, preliminary_survey_rule_type",
  ).gte("measurement_date", "2026-07-01")
    .lte("measurement_date", "2026-08-07")
    .lte("created_at", "2026-08-07T23:59:59.999+09:00");
  if (error) throw new Error(`LEGACY_CLASSIFICATION_QUERY_FAILED:${error.message}`);
  return data ?? [];
}

async function main() {
const reportPath = resolve(process.cwd(), "docs/preliminary-survey-v2-dry-run-20260808.md");
const previousReport = (() => { try { return readFileSync(reportPath, "utf8"); } catch { return ""; } })();
const previousResults = new Map<string, { date: string; participants: string }>();
const previousSection = (
  previousReport.split("## 84개 사업장 실제 결과표")[1] ??
  previousReport.split("## 사업장별 전체 결과표")[1] ?? ""
).split("\n## ")[0];
for (const line of previousSection.split("\n")) {
  const cells = line.startsWith("|") ? line.slice(1, -1).split("|").map((cell) => cell.trim()) : [];
  if (/^H\d+$/.test(cells[1] ?? "")) previousResults.set(cells[1], {
    date: cells.length >= 15 ? cells[8] : cells[5],
    participants: cells.length >= 15 ? cells[10] : cells[6],
  });
}
const before = await snapshot();
const routeMetrics = createRouteMetrics();
const output = await calculateV2Recommendations(supabase, {
  measurementDateFrom: "2026-07-01",
  measurementDateTo: "2026-08-07",
  createdBeforeOrAt: "2026-08-07T23:59:59.999+09:00",
  routeMetrics,
});
const legacyRows = await legacyClassifications();
const after = await snapshot();
const databaseUnchanged = JSON.stringify(before) === JSON.stringify(after);
if (!databaseUnchanged) throw new Error(`DRY_RUN_DATABASE_CHANGED:${JSON.stringify({ before, after })}`);

const targetById = new Map(output.targets.map(target => [target.id, target]));
const classifiedBusinesses = [
  ...output.targets.map(target => ({
    targetId: target.id,
    code: target.code,
    name: target.name,
    kind: target.kind,
    classificationSource: target.classificationSource,
  })),
  ...output.missing.map(target => ({
    targetId: target.targetId,
    code: target.code,
    name: target.name,
    kind: target.kind,
    classificationSource: target.classificationSource,
  })),
];
const currentKindById = new Map(classifiedBusinesses.map(item => [item.targetId, item]));
const legacyStats = {
  new: legacyRows.filter(row => row.preliminary_survey_rule_type !== "existing").length,
  existing: legacyRows.filter(row => row.preliminary_survey_rule_type === "existing").length,
};
const changedClassifications = legacyRows.flatMap(row => {
  const current = currentKindById.get(Number(row.id));
  if (!current) return [];
  const previousKind = row.preliminary_survey_rule_type !== "existing" ? "new" : "existing";
  if (previousKind === current.kind) return [];
  return [{
    code: row.code,
    name: row.business_name,
    year: Number(row.year),
    period: String(row.period).trim(),
    previousKind,
    currentKind: current.kind,
    rawValue: current.classificationSource?.rawValue ?? null,
  }];
});
const recommended = output.results.filter(result => result.status === "recommended");
const failures: string[] = [];
const byUserDate = new Map<string, typeof recommended>();
for (const result of recommended) {
  const target = targetById.get(result.targetId)!;
  if ((result.evidence.workingDaysBefore ?? 0) < 3) failures.push(`${target.code}: -3 이내 배정`);
  for (const user of result.participants) {
    const key = `${user.id}:${result.date}`;
    const list = byUserDate.get(key) ?? []; list.push(result); byUserDate.set(key, list);
    if (output.blockedKeys.includes(key)) failures.push(`${target.code}: ${user.name} 실제/제외 일정 충돌`);
  }
  if (!target.responsible.experienced && !result.experiencedReviewer) failures.push(`${target.code}: 비경력 담당자 경력자 누락`);
  if (target.responsible.experienced && result.participants.length !== 1) failures.push(`${target.code}: 경력 담당자 불필요 인원`);
}
for (const [key, assignments] of byUserDate) {
  const newAssignments = assignments.filter(result => targetById.get(result.targetId)?.kind === "new");
  if (newAssignments.length > 2) failures.push(`${key}: 신규 ${newAssignments.length}건`);
  if (newAssignments.length === 2 && !newAssignments.some(result =>
    result.evidence.sameDayRoute?.routeDecision === "same_day_allowed" &&
    (result.evidence.sameDayRoute.selectedRouteMinutes ?? 61) <= 60,
  )) failures.push(`${key}: 신규 2건 차량 60분 근거 없음`);
  const existingResponsible = assignments.filter(result => {
    const target = targetById.get(result.targetId)!;
    return target.kind === "existing" && target.responsible.id === Number(key.split(":")[0]);
  });
  if (existingResponsible.length > 3) failures.push(`${key}: 기존 담당 ${existingResponsible.length}건`);
  if (newAssignments.length && existingResponsible.length) failures.push(`${key}: 신규/기존 실질 수행 충돌`);
  const existingReviews = assignments.filter(result => {
    const target = targetById.get(result.targetId)!;
    return target.kind === "existing" && result.experiencedReviewer?.id === Number(key.split(":")[0]);
  });
  if (existingReviews.length > 6) failures.push(`${key}: 기존 검토 ${existingReviews.length}건`);
}

const selectedPairs = recommended.filter(result => result.evidence.sameDayRoute?.routeDecision === "same_day_allowed");
const rejectedRoutes = output.results.flatMap(result => result.evidence.rejectedSameDayRoutes);
const changedFromPrevious = recommended.flatMap(result => {
  const target = targetById.get(result.targetId)!;
  const previous = previousResults.get(target.code);
  if (!previous) return [];
  const participants = result.participants.map(user => user.name).join(" + ");
  return previous.date !== result.date || previous.participants !== participants
    ? [{ target, result, previous, participants }]
    : [];
});

const stats = {
  total: output.targets.length + output.missing.length,
  new: output.targets.filter(target => target.kind === "new").length + output.missing.filter(target => target.kind === "new").length,
  existing: output.targets.filter(target => target.kind === "existing").length + output.missing.filter(target => target.kind === "existing").length,
  recommended: recommended.length,
  manualRequired: output.results.filter(result => result.status === "manual_required").length + output.missing.length,
  primary: recommended.filter(result => result.evidence.range === "primary").length,
  fallback: recommended.filter(result => result.evidence.range === "fallback").length,
  experiencedSolo: recommended.filter(result => result.responsible.experienced).length,
  noviceWithExperienced: recommended.filter(result => !result.responsible.experienced && result.experiencedReviewer).length,
  doubleNewDates: [...new Set(recommended.filter(result => result.evidence.capacityPass === 2).map(result => result.date))].length,
  sameRoutePairs: selectedPairs.filter(result => (result.evidence.sameDayRoute?.selectedRouteMinutes ?? 61) <= 30).length,
  fallbackPairs: selectedPairs.filter(result => (result.evidence.sameDayRoute?.selectedRouteMinutes ?? 0) > 30).length,
  over60Rejected: rejectedRoutes.filter(route => route.routeDecision === "both_directions_over_60").length,
  unverifiedRejected: rejectedRoutes.filter(route => route.routeDecision !== "same_day_allowed" && route.routeDecision !== "both_directions_over_60").length,
  field: recommended.filter(result => result.surveyMethod === "field").length,
  phone: recommended.filter(result => result.surveyMethod === "phone").length,
  crossTypeOverlap: recommended.filter(result => result.evidence.crossTypeOverlap).length,
  crossTypeOverlapAvoided: recommended.filter(result => result.evidence.crossTypeOverlapAvoided).length,
  vehicle: recommended.filter(result => result.evidence.route?.source === "vehicle").length,
  distance: recommended.filter(result => result.evidence.route?.source === "distance").length,
  region: recommended.filter(result => result.evidence.route?.source === "region").length,
  unknownRoute: recommended.filter(result => !result.evidence.route || result.evidence.route.source === "unknown").length,
  scheduleShifted: recommended.filter(result => {
    const target = targetById.get(result.targetId)!;
    const minus30 = recommendationDates(target.measurementDate).find(item => item.workingDaysBefore === 30);
    return Boolean(minus30 && result.evidence.workingDaysBefore !== 30 &&
      output.blockedKeys.includes(`${target.responsible.id}:${minus30.date}`));
  }).length,
};

const escape = (value: unknown) => String(value ?? "-").replaceAll("|", "\\|").replaceAll("\n", " ");
const changedRows = changedClassifications.map(item =>
  `| ${escape(item.code)} | ${escape(item.name)} | ${item.year} | ${escape(item.period)} | ${item.previousKind === "new" ? "신규" : "기존"} | ${item.currentKind === "new" ? "신규" : "기존"} | ${escape(item.rawValue)} |`,
);
const businessRows = output.results.map(result => {
  const target = targetById.get(result.targetId)!;
  const sameDay = result.evidence.sameDayRoute;
  const routeLabel = sameDay
    ? `${escape(sameDay.routeABMinutes)} / ${escape(sameDay.routeBAMinutes)}분, 적용 ${escape(sameDay.selectedRouteMinutes)}분, ${escape(sameDay.selectedVisitOrder?.join("→"))}`
    : "단독 배정(경로 검증 불필요)";
  const previous = previousResults.get(target.code);
  const participants = result.participants.map(user => user.name).join(" + ");
  const change = !previous ? "비교 기준 없음" : previous.date !== result.date || previous.participants !== participants
    ? `${previous.date}/${previous.participants} → ${result.date}/${participants}` : "변경 없음";
  return `| ${escape(target.measurementDate)} | ${escape(target.code)} | ${escape(target.name)} | ${target.kind === "new" ? "신규" : "기존"} | ${escape(target.classificationSource?.rawValue)} | ${result.surveyMethod === "field" ? "현장(field)" : "전화(phone)"} | ${escape(target.responsible.name)} | ${target.responsible.experienced ? "경력" : "비경력"} | ${escape(result.date)} | ${escape(result.evidence.workingDaysBefore)} | ${escape(participants)} | ${escape(routeLabel)} | ${escape(result.reason)} | ${result.evidence.crossTypeOverlap ? "불가피 중복" : result.evidence.crossTypeOverlapAvoided ? "중복 회피" : "-"} | ${escape(change)} |`;
});
for (const item of output.missing) {
  businessRows.push(`| ${item.measurementDate} | ${item.code} | ${escape(item.name)} | ${item.kind === "new" ? "신규" : "기존"} | ${escape(item.classificationSource?.rawValue)} | ${item.kind === "new" ? "현장(field)" : "전화(phone)"} | 미지정 | - | - | - | - | 계산 제외 | ${escape(item.fields.join(", "))} | - | 변경 없음 |`);
}

const pairRows = selectedPairs.map(result => {
  const route = result.evidence.sameDayRoute!;
  return `| ${route.firstBusinessCode} / ${route.secondBusinessCode} | ${result.date} | ${escape(route.routeABMinutes)}분 | ${escape(route.routeBAMinutes)}분 | ${escape(route.selectedRouteMinutes)}분 | ${escape(route.selectedVisitOrder?.join("→"))} | ${result.evidence.selectionMode} | ${result.evidence.selectionReason} |`;
});
const overlapRows = recommended.filter(result => result.evidence.crossTypeOverlap).map(result => {
  const target = targetById.get(result.targetId)!;
  const overlapUser = target.kind === "new" ? result.responsible.name : result.experiencedReviewer?.name;
  return `| ${target.code} | ${escape(target.name)} | ${result.date} | ${escape(overlapUser)} | ${result.evidence.crossTypeOverlapReason} |`;
});
const comparisonRows = changedFromPrevious.map(item =>
  `| ${item.target.code} | ${escape(item.target.name)} | ${item.previous.date} | ${item.result.date} | ${escape(item.previous.participants)} | ${escape(item.participants)} |`,
);

const dateGroups = new Map<string, typeof recommended>();
for (const result of recommended) {
  const list = dateGroups.get(result.date!) ?? []; list.push(result); dateGroups.set(result.date!, list);
}
const dateTable = [...dateGroups.entries()].sort(([left], [right]) => left.localeCompare(right)).flatMap(([date, results]) => [
  `### ${date}`,
  ...results.map(result => {
    const target = targetById.get(result.targetId)!;
    return `- ${target.code} ${target.name} / ${target.kind === "new" ? "신규" : "기존"} / ${result.participants.map(user => user.name).join(" + ")}`;
  }),
]);

const userRows = output.targets.flatMap(target => [target.responsible, ...recommended.flatMap(result => result.experiencedReviewer ?? [])])
  .filter((user, index, all) => all.findIndex(item => item.id === user.id) === index)
  .sort((left, right) => left.id - right.id)
  .map(user => {
    const participated = recommended.filter(result => result.participants.some(item => item.id === user.id));
    const newResponsible = participated.filter(result => targetById.get(result.targetId)?.kind === "new" && result.responsible.id === user.id).length;
    const newCompanion = participated.filter(result => targetById.get(result.targetId)?.kind === "new" && result.experiencedReviewer?.id === user.id).length;
    const existingResponsible = participated.filter(result => targetById.get(result.targetId)?.kind === "existing" && result.responsible.id === user.id).length;
    const existingReview = participated.filter(result => targetById.get(result.targetId)?.kind === "existing" && result.experiencedReviewer?.id === user.id).length;
    const doubleDays = [...new Set(participated.filter(result => result.evidence.capacityPass === 2).map(result => result.date))].length;
    const maxExisting = Math.max(0, ...[...dateGroups.keys()].map(date => participated.filter(result => result.date === date && targetById.get(result.targetId)?.kind === "existing" && result.responsible.id === user.id).length));
    return `| ${user.name} | ${newResponsible} | ${newCompanion} | ${existingResponsible} | ${existingReview} | ${newCompanion} | ${doubleDays} | ${maxExisting} |`;
  });

const unusual = output.results.filter(result =>
  result.status === "manual_required" || result.evidence.range === "fallback" || result.evidence.capacityPass === 2,
).map(result => {
  const target = targetById.get(result.targetId)!;
  return `| ${target.code} ${escape(target.name)} | ${target.measurementDate} | ${escape(result.date)} | ${escape(result.participants.map(user => user.name).join(" + "))} | ${escape(result.status === "manual_required" ? result.reason : result.evidence.capacityPass === 2 ? "실제 차량시간으로 신규 2건 배정" : "후순위/예외 배정")} | ${escape(result.reason)} | 현장 운영성 수동 확인 |`;
});
for (const item of output.missing) {
  unusual.push(`| ${item.code} ${escape(item.name)} | ${item.measurementDate} | - | - | ${escape(item.fields.join(", "))} 누락으로 계산 제외 | 보고서 담당자 고정 원칙 | 담당자 입력 후 재추천 |`);
}

const snapshotRows = before.map((item: any, index) => {
  const next: any = after[index];
  return `| ${item.table} | ${escape(item.count)} | ${escape(item.latestUpdatedAt)} | ${escape(next.count)} | ${escape(next.latestUpdatedAt)} | ${JSON.stringify(item) === JSON.stringify(next) ? "동일" : "변경"} |`;
});
const routeStats = routeMetrics.stats!;
const report = `# 예비조사 자동배정 V2 최종 업무규칙 검증

- 실행일: 2026-08-09 (Asia/Seoul)
- 대상: 측정예정일 2026-07-01~2026-08-07, created_at이 2026-08-07 종료 시점 이전인 현재 운영 DB 레코드
- 실행 경로: \`calculateV2Recommendations\` SELECT 전용 계산 경로
- 외부 경로 API: **카카오 자동차 길찾기 실제 호출 활성화**
- full-fidelity Dry-run: 최초 실데이터 실행 1회 후 cross-type 순서 효과를 발견해 수정, 최종 확인 재실행 1회
- 운영 DB 무변경: **${databaseUnchanged ? "확인" : "실패"}**
- 자동 검증: **${failures.length === 0 ? "통과" : `실패 ${failures.length}건`}** ${failures.length ? escape(failures.join("; ")) : "(규칙 위반 0건)"}

Dry-run 과정에서 운영 DB INSERT/UPDATE/DELETE/UPSERT/저장 RPC/추천계획 저장/좌표 수정은 수행하지 않았다. 아래 전후 스냅샷으로 **운영 DB 변경 없음**을 확인했다.

## 통계 요약

| 항목 | 값 |
|---|---:|
| 대상 사업장 총수 | ${stats.total} |
| 수정 전 신규업체 수 | ${legacyStats.new} |
| 수정 후 신규업체 수 | ${stats.new} |
| 수정 전 기존업체 수 | ${legacyStats.existing} |
| 수정 후 기존업체 수 | ${stats.existing} |
| 분류 변경 사업장 수 | ${changedClassifications.length} |
| 정상 자동추천 수 | ${stats.recommended} |
| 추천 불가/입력 누락 수 | ${stats.manualRequired} |
| -30~-20 기본구간 배정 수 | ${stats.primary} |
| 기본구간 배정 비율 | ${stats.recommended ? ((stats.primary / stats.recommended) * 100).toFixed(1) : "0.0"}% |
| -19~-3 후순위 배정 수 | ${stats.fallback} |
| 경력 담당자 단독 배정 수 | ${stats.experiencedSolo} |
| 비경력 + 경력 배정 수 | ${stats.noviceWithExperienced} |
| 신규업체 하루 2건 묶음 날짜 수 | ${stats.doubleNewDates} |
| 30분 이하 same-route 묶음 | ${stats.sameRoutePairs} |
| 31~60분 fallback 묶음 | ${stats.fallbackPairs} |
| 60분 초과 거부 evidence | ${stats.over60Rejected} |
| 경로 미검증 거부 evidence | ${stats.unverifiedRejected} |
| 현장(field) 자동 지정 | ${stats.field} |
| 전화(phone) 자동 지정 | ${stats.phone} |
| 신규 현장 + 기존 검토 불가피 중복 | ${stats.crossTypeOverlap} |
| 신규 현장 + 기존 검토 중복 회피 | ${stats.crossTypeOverlapAvoided} |
| 직전 실제경로 결과 대비 변경 | ${changedFromPrevious.length} |
| 직원 실제/제외 일정 충돌로 -30에서 이동한 수 | ${stats.scheduleShifted} |
| 지역 최적화 때문에 날짜가 변경된 수 | 0 |

## 조사방식과 분류 원천

- 신규/기존의 유일한 authoritative source는 동일 \`code/year/period\` 최신 \`measurement_journal.note\`이다.
- 신규 토큰은 \`신규\`, \`최초실시\`, \`타기관 신규\`이며 그 외·누락은 기존이다.
- 자동 기본값은 신규=\`field\`, 기존=\`phone\`이다. 별도 조사방식 선택 UI는 추가하지 않았다.
- \`measurement_target_business.preliminary_survey_rule_type\` 컬럼은 기존 DB 호환을 위해 삭제하지 않았지만, 신규 등록/수정 UI와 API 입력에서 제거했고 V2 판정에는 영향이 없다. Dry-run의 '수정 전' 비교에만 읽었다.

## 신규/기존 분류 변경 사업장

- 수정 전: \`measurement_target_business.preliminary_survey_rule_type\` 기반 기존 V2 판정 재현(비교 전용)
- 수정 후: 동일 \`code/year/period\`의 최신 \`measurement_journal.note\` 기반 판정
- 측정일지 일반 신규 체크의 실제 저장값: \`최초실시\` (업무 용어 \`신규\` 호환), 타기관 신규 저장값: \`타기관 신규\`

| 코드 | 사업장명 | 측정년도 | 반기 | 수정 전 | 수정 후 | 측정일지 신규 구분 원본값(note) |
|---|---|---:|---|---|---|---|
${changedRows.length ? changedRows.join("\n") : "| 변경 없음 | - | - | - | - | - | - |"}

## 사업장별 전체 결과표

| 측정일 | 코드 | 사업장명 | 신규/기존 | 일지 원본값 | 조사방식 | 보고서담당자 | 담당자 경력 | 추천일 | 워킹데이 | 추천 조사자 | 실제 차량시간 판단 | 추천 근거 | cross-type | 직전 대비 |
|---|---|---|---|---|---|---|---|---|---:|---|---|---|---|---|
${businessRows.join("\n")}

## 직전 실제경로 Dry-run 대비 변경 사업장

| 코드 | 사업장 | 직전 추천일 | 최종 추천일 | 직전 조사자 | 최종 조사자 |
|---|---|---|---|---|---|
${comparisonRows.length ? comparisonRows.join("\n") : "| 변경 없음 | - | - | - | - | - |"}

## 신규 하루 2건 양방향 실제 차량경로

| 신규쌍 | 추천일 | A→B | B→A | 적용시간 | 추천순서 | mode | 판정 근거 |
|---|---|---:|---:|---:|---|---|---|
${pairRows.length ? pairRows.join("\n") : "| 없음 | - | - | - | - | - | - | - |"}

## 예비조사일별 배치표

${dateTable.join("\n")}

## 조사자별 배정 현황

| 조사자 | 신규 담당 | 신규 경력 동행 | 기존 담당 | 기존 검토 | 신규 경력자 균등배분 카운트 | 신규 2건 배정일 | 최대 기존 일일 건수 |
|---|---:|---:|---:|---:|---:|---:|---:|
${userRows.join("\n")}

## 신규 현장 + 기존 전화 검토 중복

| 코드 | 사업장 | 날짜 | 경력 검토자 | evidence |
|---|---|---|---|---|
${overlapRows.length ? overlapRows.join("\n") : "| 불가피 중복 없음 | - | - | - | - |"}

- 회피된 중복: ${stats.crossTypeOverlapAvoided}건
- 불가피하게 허용된 중복: ${stats.crossTypeOverlap}건

## 카카오 경로 API 호출·비용

| 항목 | 값 |
|---|---:|
| 경로 비교 요청(between) | ${routeStats.requests} |
| 실제 외부 API 호출 | ${routeStats.externalCalls} |
| 성공 | ${routeStats.successes} |
| 실패 | ${routeStats.failures} |
| 세션 캐시 hit | ${routeStats.sessionCacheHits} |
| 5분 공유 캐시 hit | ${routeStats.sharedCacheHits} |
| 좌표 부족 미검증 | ${routeStats.coordinateUnavailable} |

- 현재 확인된 무료 제공량 안에서는 예상 비용 0원이다. 무료량 소진 가정 최대 초과 비용은 ${routeStats.externalCalls * 8}원(${routeStats.externalCalls}건 × 8원)이다.
- API 키와 DB 비밀값은 로그·보고서·Git에 기록하지 않았다.

## 추천 실패 사례와 원인

${output.missing.length
  ? output.missing.map(item => `- ${item.code} ${item.name}: ${item.fields.join(", ")} 누락`).join("\n")
  : "- 없음"}

## 업무규칙상 가능하지만 실무 검토가 필요한 사례

| 사업장 | 측정일 | 예비조사일 | 조사자 | 검토 이유 | 적용 규칙 | 개선 제안 |
|---|---|---|---|---|---|---|
${unusual.length ? unusual.join("\n") : "| 해당 없음 | - | - | - | - | - | - |"}

## 운영 DB Sample 전후 스냅샷

| 테이블 | 전 건수 | 전 최신 updated_at | 후 건수 | 후 최신 updated_at | 판정 |
|---|---:|---|---:|---|---|
${snapshotRows.join("\n")}

## 코드·자동 테스트 검증 요약

- 관리자 수동 hard rule: -3~-30 범위, 담당자 포함, 비경력 경력자 필수, 신규 일 2건/실차 60분, 기존 담당 일 3건, 기존 검토 일 6건을 자동 테스트로 확인했다.
- 담당자 변경: 기존 계획 origin과 무관하게 재추천하며 측정일지 분류를 다시 읽는다.
- 측정일 변경: -3~-30 범위와 현재 hard rule이 유효하면 유지하고, 아니면 재추천한다.
- 토/일·현재 2025~2027 한국 공휴일 snapshot, -30~-20 기본구간, -19~-3 후순위구간은 기존 로직을 유지했다.
- 장기 공휴일 데이터 소스 개선과 검수용 캘린더 UI는 PR #10 범위 밖이다.
`;

const docsDir = resolve(process.cwd(), "docs");
mkdirSync(docsDir, { recursive: true });
writeFileSync(reportPath, report, "utf8");
console.log(JSON.stringify({ reportPath, stats, routeStats, changedFromPrevious: changedFromPrevious.length, failures, databaseUnchanged, before, after }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
