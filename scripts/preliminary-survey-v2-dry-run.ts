import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { calculateV2Recommendations } from "../lib/preliminary-survey-v2/service";
import { recommendationDates } from "../lib/preliminary-survey-v2/calendar";

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
const before = await snapshot();
const output = await calculateV2Recommendations(supabase, {
  measurementDateFrom: "2026-07-01",
  measurementDateTo: "2026-08-07",
  createdBeforeOrAt: "2026-08-07T23:59:59.999+09:00",
  allowExternalRoutes: false,
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
    result.evidence.route?.source === "vehicle" && (result.evidence.route.durationMinutes ?? 61) <= 60,
  )) failures.push(`${key}: 신규 2건 차량 60분 근거 없음`);
  const existingResponsible = assignments.filter(result => {
    const target = targetById.get(result.targetId)!;
    return target.kind === "existing" && target.responsible.id === Number(key.split(":")[0]);
  });
  if (existingResponsible.length > 3) failures.push(`${key}: 기존 담당 ${existingResponsible.length}건`);
  if (newAssignments.length && existingResponsible.length) failures.push(`${key}: 신규/기존 실질 수행 충돌`);
}

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
  const route = result.evidence.route;
  const routeLabel = route?.source === "vehicle" ? `차량 ${route.durationMinutes}분 / ${route.distanceKm?.toFixed(1)}km`
    : route?.source === "distance" ? `직선거리 ${route.distanceKm?.toFixed(1)}km fallback`
    : route?.source === "region" ? `행정구역 ${route.sameRegion ? "일치" : "불일치"} fallback` : "차량시간 미확인";
  return `| ${escape(target.measurementDate)} | ${escape(target.code)} | ${escape(target.name)} | ${target.kind === "new" ? "신규" : "기존"} | ${escape(target.responsible.name)} | ${target.responsible.experienced ? "경력" : "비경력"} | ${escape(result.date)} | ${escape(result.evidence.workingDaysBefore)} | ${escape(result.participants.map(user => user.name).join(" + "))} | ${escape(result.reason)} | ${escape(routeLabel)} | ${escape(result.status === "manual_required" ? result.reason : result.evidence.warnings.join(", ") || "-")} |`;
});
for (const item of output.missing) {
  businessRows.push(`| ${item.measurementDate} | ${item.code} | ${escape(item.name)} | ${item.kind === "new" ? "신규" : "기존"} | 미지정 | - | - | - | - | 계산 제외 | - | ${escape(item.fields.join(", "))} |`);
}

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
  return `| ${target.code} ${escape(target.name)} | ${target.measurementDate} | ${escape(result.date)} | ${escape(result.participants.map(user => user.name).join(" + "))} | ${escape(result.status === "manual_required" ? result.reason : "차량시간 직접 확인 없이 fallback/단독 배정")} | ${escape(result.reason)} | 좌표·경로 가용성 및 현장 운영성 수동 확인 |`;
});
for (const item of output.missing) {
  unusual.push(`| ${item.code} ${escape(item.name)} | ${item.measurementDate} | - | - | ${escape(item.fields.join(", "))} 누락으로 계산 제외 | 보고서 담당자 고정 원칙 | 담당자 입력 후 재추천 |`);
}

const report = `# 2026년 하반기 실제 데이터 Sample Dry-run 결과

- 실행일: 2026-08-08 (Asia/Seoul)
- 대상: 측정예정일 2026-07-01~2026-08-07, created_at이 2026-08-07 종료 시점 이전인 현재 운영 DB 레코드
- 실행 경로: \`calculateV2Recommendations\` SELECT 전용 계산 경로
- 외부 경로 API: 비활성화(실제 좌표 외부 전송 없음), 직선거리 → 행정구역 fallback만 사용
- 운영 DB 무변경: **${databaseUnchanged ? "확인" : "실패"}**
- 자동 검증: **${failures.length === 0 ? "통과" : `실패 ${failures.length}건`}** ${failures.length ? escape(failures.join("; ")) : "(규칙 위반 0건)"}

2026년 하반기 실제 데이터 Sample Dry-run 과정에서 운영 DB INSERT/UPDATE/DELETE 없음. 추천 결과는 DB에 반영하지 않았으며 Sample 전후 운영 데이터 무변경을 확인함.

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
| 차량시간 직접 확인 수 | ${stats.vehicle} |
| 거리 fallback 수 | ${stats.distance} |
| 행정구역 fallback 수 | ${stats.region} |
| 차량시간 미확인/단독 수 | ${stats.unknownRoute} |
| 직원 실제/제외 일정 충돌로 -30에서 이동한 수 | ${stats.scheduleShifted} |
| 지역 최적화 때문에 날짜가 변경된 수 | 0 |

## 신규/기존 분류 변경 사업장

- 수정 전: \`measurement_target_business.preliminary_survey_rule_type\` 기반 기존 V2 판정 재현(비교 전용)
- 수정 후: 동일 \`code/year/period\`의 최신 \`measurement_journal.note\` 기반 판정
- 측정일지 일반 신규 체크의 실제 저장값: \`최초실시\` (업무 용어 \`신규\` 호환), 타기관 신규 저장값: \`타기관 신규\`

| 코드 | 사업장명 | 측정년도 | 반기 | 수정 전 | 수정 후 | 측정일지 신규 구분 원본값(note) |
|---|---|---:|---|---|---|---|
${changedRows.length ? changedRows.join("\n") : "| 변경 없음 | - | - | - | - | - | - |"}

## 사업장별 전체 결과표

| 측정일 | 코드 | 사업장명 | 신규/기존 | 보고서담당자 | 담당자 경력 | 추천 예비조사일 | 측정일까지 워킹데이 | 추천 예비조사자 | 추천 근거 | 지역/이동 판단 | 특이사항 |
|---|---|---|---|---|---|---|---:|---|---|---|---|
${businessRows.join("\n")}

## 예비조사일별 배치표

${dateTable.join("\n")}

## 조사자별 배정 현황

| 조사자 | 신규 담당 | 신규 경력 동행 | 기존 담당 | 기존 검토 | 신규 경력자 균등배분 카운트 | 신규 2건 배정일 | 최대 기존 일일 건수 |
|---|---:|---:|---:|---:|---:|---:|---:|
${userRows.join("\n")}

## 차량 이동시간 및 fallback 실제 배정 사례

- 차량 이동시간을 이용한 실제 배정: 0건. 개인정보·사업장 좌표의 외부 경로 서비스 전송 승인이 없어 Sample에서는 외부 API를 비활성화했습니다.
- 거리/행정구역 fallback으로 신규 2건을 묶은 사례: ${stats.doubleNewDates}건. 이번 Sample의 신규 ${stats.new}건은 하루 1건 우선 분산 규칙을 먼저 적용했습니다.

## 추천 실패 사례와 원인

${output.missing.length
  ? output.missing.map(item => `- ${item.code} ${item.name}: ${item.fields.join(", ")} 누락`).join("\n")
  : "- 없음"}

## 업무규칙상 가능하지만 실무 검토가 필요한 사례

| 사업장 | 측정일 | 예비조사일 | 조사자 | 검토 이유 | 적용 규칙 | 개선 제안 |
|---|---|---|---|---|---|---|
${unusual.length ? unusual.join("\n") : "| 해당 없음 | - | - | - | - | - | - |"}

## 운영 DB Sample 전후 스냅샷

\`before\`: ${escape(JSON.stringify(before))}

\`after\`: ${escape(JSON.stringify(after))}
`;

const docsDir = resolve(process.cwd(), "docs");
mkdirSync(docsDir, { recursive: true });
const reportPath = resolve(docsDir, "preliminary-survey-v2-dry-run-20260808.md");
writeFileSync(reportPath, report, "utf8");
console.log(JSON.stringify({ reportPath, stats, failures, databaseUnchanged, before, after }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
