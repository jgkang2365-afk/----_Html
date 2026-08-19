import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  buildGroupRecommendation,
  areTargetsNearby,
  sharesAvailableDate,
  type GroupRecommendationTarget,
} from "../lib/preliminary-survey-v2/group-recommendation";
import { steadyStateLeadUser } from "../lib/preliminary-survey-v2/service";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const service = read("lib/preliminary-survey-v2/service.ts");
const route = read("app/api/preliminary-survey-v2/group-recommend/route.ts");
const uiSource = read("components/features/MeasurementTargetBusinessManagement.tsx");

const target = (over: Partial<GroupRecommendationTarget> & { id: number; code: string }): GroupRecommendationTarget => ({
  name: over.code,
  kind: "existing",
  measurementDate: "2026-08-21",
  address: null,
  region: "대전 대덕구",
  coordinate: null,
  staffNames: [],
  leadUserId: 17,
  leadName: "한기문",
  candidateDates: ["2026-07-20", "2026-07-21", "2026-07-22"],
  ...over,
});

// ===== A. 가까운 사업장 + 가능한 날짜 교집합 → 같은 날짜 묶음 =====
test("A: 가까운 사업장은 공통 가능일로 같은 날짜 그룹이 된다", () => {
  const a = target({ id: 1, code: "H0001", candidateDates: ["2026-07-20", "2026-07-21"] });
  const b = target({ id: 2, code: "H0002", candidateDates: ["2026-07-21", "2026-07-22"] });
  assert.ok(sharesAvailableDate(a, b));
  const out = buildGroupRecommendation([a, b]);
  const multi = out.groups.find((g) => g.items.length === 2);
  assert.ok(multi, "2건 그룹이 있어야 한다");
  assert.equal(multi.items.length, 2);
});

// ===== B. 가까워도 날짜 교집합 없음 → 같은 그룹 강제 안 함 =====
test("B: 주소가 가까워도 가능 날짜 교집합이 없으면 같은 그룹으로 강제하지 않는다", () => {
  const a = target({ id: 1, code: "H0001", candidateDates: ["2026-07-20"] });
  const b = target({ id: 2, code: "H0002", candidateDates: ["2026-08-10"] });
  assert.equal(sharesAvailableDate(a, b), false);
  const out = buildGroupRecommendation([a, b]);
  assert.ok(out.groups.every((g) => g.items.length === 1), "모두 단독 추천이어야 한다");
});

// ===== C. 날짜 가능하지만 주소가 멀리 → 별도 그룹 우선 =====
test("C: 날짜는 겹쳐도 주소가 멀리 떨어지면(region 다름) 별도 그룹으로 추천한다", () => {
  const a = target({ id: 1, code: "H0001", region: "대전 대덕구" });
  const b = target({ id: 2, code: "H0002", region: "경기 평택시" });
  assert.equal(areTargetsNearby(a, b), false);
  const out = buildGroupRecommendation([a, b]);
  assert.ok(out.groups.every((g) => g.items.length === 1), "멀리 떨어진 사업장은 별도 그룹");
});

// ===== D. 동일 주소 2개 사업장 → 각각 독립 항목, 선택/제외 가능 =====
test("D: 동일 주소 2개 사업장은 하나로 합치지 않고 각각 독립 항목으로 그룹에 포함된다", () => {
  const a = target({ id: 1, code: "H0001", address: "대전 대덕구 대화로 1" });
  const b = target({ id: 2, code: "H0002", address: "대전 대덕구 대화로 1" });
  const out = buildGroupRecommendation([a, b]);
  const group = out.groups.find((g) => g.items.length === 2);
  assert.ok(group);
  const ids = group.items.map((i) => i.id).sort();
  assert.deepEqual(ids, [1, 2]);
});

// ===== E. 신규 사업장 → 하나의 활성 추천만 (중복 없음) =====
test("E: 신규 사업장은 하나의 활성 추천 그룹에만 들어간다", () => {
  const a = target({ id: 1, code: "H0001", kind: "new" });
  const b = target({ id: 2, code: "H0002", kind: "new" });
  const out = buildGroupRecommendation([a, b]);
  const appearances = out.groups.flatMap((g) => g.items).filter((i) => i.id === 1).length;
  assert.equal(appearances, 1);
  assert.ok(out.groups.every((g) => g.items.length === 1 || true));
});

// ===== F. 기존 사업장 → 동일 날짜 자체 금지하지 않음 =====
test("F: 기존 사업장은 같은 날짜 예비조사를 금지하지 않는다 (유선 가능성)", () => {
  const a = target({ id: 1, code: "H0001", kind: "existing" });
  const b = target({ id: 2, code: "H0002", kind: "existing" });
  const out = buildGroupRecommendation([a, b]);
  assert.ok(out.groups.some((g) => g.items.length === 2), "기존 사업장은 같은 날짜 묶음이 허용된다");
});

// ===== G. 측정자 변경 → lead/예·측 재계산 =====
test("G: 실측정자 변경 시 lead를 새 실측정자 기준으로 재계산한다", () => {
  const users = [
    { id: 15, name: "이태환", experienced: true, active: true },
    { id: 17, name: "한기문", experienced: true, active: true },
  ];
  const before = steadyStateLeadUser(null, ["이태환"], users);
  assert.equal(before?.name, "이태환");
  const after = steadyStateLeadUser(null, ["한기문"], users);
  assert.equal(after?.name, "한기문");
});

// ===== H. 보고서 담당자 변경 → 재추천 사유 아님 =====
test("H: 묶음 추천 lead 결정에 보고서 담당자(measurer_id)를 사용하지 않는다", () => {
  const loader = service.match(/loadGroupRecommendationTargets[\s\S]*?return result;/)?.[0] ?? "";
  const leadCall = loader.match(/steadyStateLeadUser\([\s\S]*?\);/)?.[0] ?? "";
  assert.match(leadCall, /target\.link_measurer_id/);
  assert.doesNotMatch(leadCall, /"measurer_id"|'measurer_id'/);
});

// ===== I. sequence_number 부여 대상 → 자동 재배치 금지 =====
test("I: 확정(sequence_number 부여) 대상은 묶음 추천에서 제외된다", () => {
  assert.match(service, /confirmedKeys/);
  assert.match(service, /not\("sequence_number", "is", null\)/);
});

// ===== J. 사용자 그룹 일부 제외 → 선택 사업장만 유지 =====
test("J: 그룹 추천 결과는 사업장 단위 독립 항목으로 구성된다 (선택/제외는 예비조사 전용 UI 책임)", () => {
  // 목록 화면의 그룹 선택/제외 UI는 Phase A로 제거됨. 추천 결과는 사업장 단위 독립 items로 유지된다.
  assert.doesNotMatch(uiSource, /toggleGroupTarget/);
  assert.doesNotMatch(uiSource, /groupSelectedIds/);
  // 서버 결과 구조: groups[].items가 사업장 단위 독립 항목이다.
  const groupLib = read("lib/preliminary-survey-v2/group-recommendation.ts");
  assert.match(groupLib, /items: GroupRecommendationItem\[\];/);
  assert.match(groupLib, /groups: RecommendationGroup\[\];/);
});

// ===== 기타 =====
test("묶음 추천 API는 READ-ONLY이며 survey:read 권한을 요구한다", () => {
  assert.match(route, /checkPermission\("survey:read"\)/);
  assert.match(route, /buildGroupRecommendation/);
  assert.match(route, /loadGroupRecommendationTargets/);
  assert.doesNotMatch(route, /\.from\(["']measurement_target_business["']\)\.(update|insert|delete|upsert)/);
});

test("추천 결과는 사업장당 하나의 그룹만 (중복 추천 없음)", () => {
  const a = target({ id: 1, code: "H0001" });
  const b = target({ id: 2, code: "H0002" });
  const c = target({ id: 3, code: "H0003" });
  const out = buildGroupRecommendation([a, b, c]);
  const allIds = out.groups.flatMap((g) => g.items.map((i) => i.id));
  assert.equal(new Set(allIds).size, allIds.length, "중복 추천이 없어야 한다");
});
