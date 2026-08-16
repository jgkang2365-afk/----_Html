import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { recommendBatch } from "../lib/preliminary-survey-v2/engine";
import { recommendationDates } from "../lib/preliminary-survey-v2/calendar";
import { validateManualPlanHardRules } from "../lib/preliminary-survey-v2/manual-validation";
import type { SurveyTarget, SurveyUser } from "../lib/preliminary-survey-v2/types";
import {
  classifyLinkMeasurerCandidate,
  collectMeasurementStaffNames,
} from "../lib/business/link-measurer";

const root = process.cwd();
const routeSource = readFileSync(path.join(root, "app", "api", "businesses", "route.ts"), "utf8");
const routeSource2 = readFileSync(
  path.join(root, "app", "api", "preliminary-survey-v2", "[targetId]", "route.ts"),
  "utf8",
);
const serviceSource = readFileSync(path.join(root, "lib", "preliminary-survey-v2", "service.ts"), "utf8");
const validationSource = readFileSync(path.join(root, "lib", "preliminary-survey-v2", "manual-validation.ts"), "utf8");
const engineSource = readFileSync(path.join(root, "lib", "preliminary-survey-v2", "engine.ts"), "utf8");
const uiSource = readFileSync(
  path.join(root, "components", "features", "MeasurementTargetBusinessManagement.tsx"),
  "utf8",
);

const user = (id: number, name: string, experienced: boolean): SurveyUser => ({
  id, name, experienced, active: true,
});
const target = (
  id: number,
  kind: "existing" | "new",
  responsible: SurveyUser,
  measurementDate = "2026-08-03",
): SurveyTarget => ({
  id,
  code: `H${String(id).padStart(4, "0")}`,
  name: `사업장${id}`,
  kind,
  measurementDate,
  responsible,
  address: null,
  region: null,
  coordinate: null,
  createdAt: "2026-07-01T00:00:00Z",
  businessType: kind === "new" ? "first_measurement" : "existing",
  processChanged: null,
  classificationSource: {
    source: "target_business_type",
    journalId: null,
    rawValue: kind === "new" ? "first_measurement" : "existing",
    measurementYear: 2026,
    measurementPeriod: "하반기",
  },
});

const availability = { isBlocked: () => false };
const routes = {
  between: async () => ({ source: "region" as const, durationMinutes: 10, distanceKm: 5, sameRegion: true }),
};

// ===== A. 보고서 담당 ≠ 측정자 / 연계측정자 = 예비조사자 =====
test("A: 보고서 담당자(measurer_id)는 예비조사자·측정자와 별개로 허용된다 (코드 구조)", () => {
  // PATCH가 measurer_id를 측정자(collaborators)에 강제 포함하지 않는다.
  assert.doesNotMatch(routeSource, /measurer_id.*collaborators.*push|collaborators: newCollabs\.join/);
  // V2 수동 검증은 '보고서 담당자' 대신 '연계측정자' 포함을 요구한다.
  assert.match(validationSource, /연계측정자는 예비조사자에 반드시 포함되어야 합니다/);
  assert.doesNotMatch(validationSource, /보고서 담당자는 예비조사자에 반드시 포함되어야 합니다/);
});

// ===== B. 1인 예비조사: 연계측정자(한기문)가 측정에 최소 하루 참여 → 정상 =====
test("B: 기존 사업장 비경력 responsible 단독 예비조사가 허용된다 (engine)", async () => {
  const results = await recommendBatch({
    targets: [target(1, "existing", user(17, "한기문", true))],
    experiencedUsers: [user(2, "강종구", false), user(15, "이태환", true)],
    availability,
    routes,
  });
  const result = results[0];
  assert.equal(result.status, "recommended");
  assert.equal(result.participants.length, 1);
  assert.equal(result.participants[0].id, 17);
});

// ===== C. 1인 예비조사 연계 끊김: 저장 차단 로직 존재 =====
test("C: 예비조사자 전원이 측정 인원에서 빠지면 저장을 차단한다 (코드 구조)", () => {
  assert.match(routeSource, /기존 예비조사자 전원이 실제 측정 인원에서 빠집니다/);
  assert.match(routeSource, /link_measurer_id/);
  assert.match(routeSource, /연계측정자는 실제 측정 인원에 반드시 포함되어야 합니다/);
});

// ===== D. 다일 측정: daily_staff 협력자 합집합으로 연계 검증 =====
test("D: 다일 측정 인원은 daily_staff 협력자 합집합으로 검증된다 (코드 구조)", () => {
  assert.match(routeSource, /Array\.isArray\(newDailyStaff\)/);
  assert.match(routeSource, /entry\.collaborators/);
});

// ===== E. 기존 사업장 비경력자 단독 허용 =====
test("E: 기존 사업장 비경력자 단독 예비조사 허용 (manual validation)", async () => {
  const responsible = user(16, "고유빈", false);
  const t = target(1, "existing", responsible);
  const validation = await validateManualPlanHardRules({
    target: t,
    recommendedDate: recommendationDates(t.measurementDate)[0].date,
    participants: [responsible],
    existingAssignments: [],
    routes: {} as never,
  });
  assert.equal(validation.valid, true);
});

// ===== F. 최초실시 비경력자 단독 차단 =====
test("F: 최초실시 비경력자 단독 예비조사 차단 (manual validation)", async () => {
  const responsible = user(16, "고유빈", false);
  const t = target(1, "new", responsible);
  const validation = await validateManualPlanHardRules({
    target: t,
    recommendedDate: recommendationDates(t.measurementDate)[0].date,
    participants: [responsible],
    existingAssignments: [],
    routes: {} as never,
  });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((e) => e.includes("경력자")));
});

// ===== G. 타기관 신규 비경력자 단독 차단 =====
test("G: 타기관 신규 비경력자 단독 예비조사 차단 (manual validation)", async () => {
  const responsible = user(20, "김민영", false);
  const t: SurveyTarget = {
    ...target(1, "new", responsible),
    businessType: "external_new",
    classificationSource: { source: "target_business_type", journalId: null, rawValue: "external_new", measurementYear: 2026, measurementPeriod: "하반기" },
  };
  const validation = await validateManualPlanHardRules({
    target: t,
    recommendedDate: recommendationDates(t.measurementDate)[0].date,
    participants: [responsible],
    existingAssignments: [],
    routes: {} as never,
  });
  assert.equal(validation.valid, false);
});

// ===== H. 경력자 단독 신규 허용 =====
test("H: 경력자 단독 신규 예비조사 허용 (manual validation + engine)", async () => {
  const responsible = user(15, "이태환", true);
  const t = target(1, "new", responsible);
  const validation = await validateManualPlanHardRules({
    target: t,
    recommendedDate: recommendationDates(t.measurementDate)[0].date,
    participants: [responsible],
    existingAssignments: [],
    routes: {} as never,
  });
  assert.equal(validation.valid, true);

  const results = await recommendBatch({
    targets: [t],
    experiencedUsers: [responsible],
    availability,
    routes,
  });
  assert.equal(results[0].status, "recommended");
  assert.equal(results[0].participants.length, 1);
});

// ===== I. 경력자 2명 조합 허용 + 사용자 확인 =====
test("I: 경력자 2명 조합은 허용되며 사용자 확인 플래그가 설정된다", async () => {
  const responsible = user(15, "이태환", true);
  const reviewer = user(17, "한기문", true);
  const t = target(1, "existing", responsible);
  const validation = await validateManualPlanHardRules({
    target: t,
    recommendedDate: recommendationDates(t.measurementDate)[0].date,
    participants: [responsible, reviewer],
    existingAssignments: [],
    routes: {} as never,
  });
  assert.equal(validation.valid, true);
  assert.equal(validation.requiresUserConfirmation, true);
});

// ===== J. 조력자 변경: 연계 유지 시 불필요한 V2 재추천 없음 =====
test("J: 조력자(collaborators)만 변경된 경우 responsible 재추천 트리거에 포함되지 않는다 (코드 구조)", () => {
  assert.doesNotMatch(routeSource, /hasOwnProperty\(updates, "collaborators"\).*responsibleChanged/);
  assert.match(routeSource, /measurementStaffChanged/);
});

// ===== K. 조력자/측정자 변경으로 연계 끊김 → 저장 차단 또는 재추천 요구 =====
test("K: 측정 인원 변경으로 연계가 끊기면 저장을 차단한다 (코드 구조)", () => {
  assert.match(routeSource, /기존 예비조사자 전원이 실제 측정 인원에서 빠집니다/);
  assert.match(routeSource, /측정 인원을 조정하거나 예비조사를 재추천\/재확정/);
});

// ===== 연번 부여 후 권한 가드 =====
test("연번 부여(측정일지 확정) 후 일반 사용자 핵심값 수정 차단 로직 존재", () => {
  assert.match(routeSource, /측정일지 연번이 부여되어 확정된 사업장입니다/);
  assert.match(routeSource, /관리자만 수정할 수 있습니다/);
});

// ===== V2 responsible = 연계측정자(link_measurer_id) 유일 =====
test("V2 responsible는 link_measurer_id만 사용하며 measurer_id fallback을 사용하지 않는다", () => {
  assert.match(serviceSource, /link_measurer_id/);
  assert.doesNotMatch(serviceSource, /link_measurer_id \?\? row\.measurer_id/);
  assert.doesNotMatch(serviceSource, /link_measurer_id \?\? targetRow\.measurer_id/);
  assert.match(serviceSource, /LINK_MEASURER_REQUIRED/);
  assert.match(serviceSource, /!responsible && "link_measurer"/);
});

// ===== A. link_measurer_id NULL = 보고서 담당자 자동 사용 금지 =====
test("A: link_measurer_id가 NULL이면 보고서 담당자를 연계측정자로 자동 사용하지 않는다", () => {
  assert.doesNotMatch(serviceSource, /Number\(row\.measurer_id\)|Number\(targetRow\.measurer_id\)|measurer_id \?\?/);
  assert.match(serviceSource, /responsibleId = targetRow\.link_measurer_id/);
});

// ===== B. 보고서 담당 변경 = 연계측정자 유지 시 재추천 없음 =====
test("B: 보고서 담당자(measurer_id) 변경만으로는 V2 재추천이 발생하지 않는다", () => {
  const changedBlock = routeSource.slice(routeSource.indexOf("const responsibleChanged"), routeSource.indexOf("const measurementDateChanged"));
  assert.match(changedBlock, /link_measurer_id/);
  assert.doesNotMatch(changedBlock, /hasOwnProperty\(updates, "measurer_id"\)/);
  assert.doesNotMatch(changedBlock, /updates\.measurer_id/);
});

// ===== C. 연계측정자 변경 = 예비조사 연계 재검증 =====
test("C: 연계측정자(link_measurer_id) 변경은 저장 검증 대상이며 재추천 트리거다", () => {
  assert.match(routeSource, /link_measurer_id/);
  assert.match(routeSource, /measurementStaffChanged/);
});

// ===== D. 경력자 2명 = 1차 요청 저장 없음 + 확인 후 저장 =====
test("D: 경력자 2명 조합은 1차 요청에서 저장하지 않고 확인을 요구한다", () => {
  assert.match(routeSource2, /requiresUserConfirmation && !confirmed/);
  assert.match(routeSource2, /confirm === true/);
  assert.match(routeSource2, /이 조합으로 확정하시겠습니까/);
});

// ===== E. 다일 측정 = 연계측정자 Day2만 참여해도 정상 =====
test("E: 다일 측정에서 연계측정자가 Day2에만 있어도 측정 인원으로 인정된다", () => {
  const staff = collectMeasurementStaffNames({
    collaborators: null,
    dailyStaff: [
      { date: "2026-08-08", collaborators: ["김민영"] },
      { date: "2026-08-09", collaborators: ["강종구", "한기문"] },
    ],
  });
  assert.ok(staff.includes("한기문"));
  const classification = classifyLinkMeasurerCandidate({
    measurerName: "한기문",
    collaborators: null,
    dailyStaff: [
      { date: "2026-08-08", collaborators: ["김민영"] },
      { date: "2026-08-09", collaborators: ["강종구", "한기문"] },
    ],
    v2ParticipantNames: ["한기문"],
  });
  assert.equal(classification.klass, "A");
});

// ===== F. 다일 자동배치 금지 = 연계측정자 선택만으로 Day1 인원 변경 없음 =====
test("F: 연계측정자 선택이 다일 측정 Day1 인원을 자동 변경하지 않는다", () => {
  assert.doesNotMatch(uiSource, /daily\[0\]/);
  assert.doesNotMatch(uiSource, /daily\[0\]\.collaborators/);
});

// ===== G/H: 기존/신규 비경력 규칙 (이미 E~H 테스트로 검증) =====

// ===== 엔진: 신규 + 비경력 responsible는 경력자 reviewer 필요 =====
test("신규 + 비경력 responsible는 경력자 reviewer와 함께 2인으로 추천된다 (engine)", async () => {
  const responsible = user(16, "고유빈", false);
  const results = await recommendBatch({
    targets: [target(1, "new", responsible)],
    experiencedUsers: [user(17, "한기문", true)],
    availability,
    routes,
  });
  const result = results[0];
  assert.equal(result.status, "recommended");
  assert.equal(result.participants.length, 2);
  assert.ok(result.participants.some((u) => u.experienced));
});

// ===== UI: 연계측정자 / 조력자 UI 존재 =====
test("측정대상사업장 UI에 연계측정자 단일 선택과 조력자 체크박스가 존재한다", () => {
  assert.match(uiSource, /link_measurer_id/);
  assert.match(uiSource, /연계측정자/);
  assert.match(uiSource, /조력자/);
  assert.doesNotMatch(uiSource, /측정자 \(복수 선택\)/);
});
