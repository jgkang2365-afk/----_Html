import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const page = read("app/survey/page.tsx");
const surveyApi = read("app/api/survey/route.ts");
const summaryApi = read("app/api/summary/route.ts");
const previousDataApi = read("app/api/journal/previous-data/route.ts");
const journalForm = read("components/features/JournalEditForm.tsx");
const summaryTable = read("components/features/SummaryTable.tsx");
const surveyForm = read("components/features/SurveyForm.tsx");
const lookup = read("lib/preliminary-survey-v2/plans-lookup.ts");

// A. V2 plan 존재 시 예비조사일 표시
test("A: 예비조사 목록은 V2 plan의 예비조사일(preliminary_survey_date)을 표시한다", () => {
  assert.match(surveyApi, /preliminary_survey_date: v2Plan\.recommended_date/);
  assert.match(page, /preliminary_survey_date/);
  assert.match(page, /예비조사일/);
});

// B. V2 plan 존재 시 예비조사자 1명 표시
test("B: V2 plan의 예비조사자(participant_names)를 표시한다", () => {
  assert.match(surveyApi, /preliminary_surveyors: v2Plan\.participant_names/);
  assert.match(page, /preliminary_surveyors/);
});

// C. 복수 예비조사자 표시 (join)
test("C: 복수 예비조사자를 콤마로 join해 표시한다", () => {
  assert.match(page, /preliminary_surveyors\.join\(", "\)/);
  assert.match(page, /preliminary_surveyors\?\.length/);
});

// D. V2 plan 없음 null/undefined 노출 없음
test("D: 값이 없으면 null/undefined 대신 '-'를 표시한다", () => {
  assert.match(page, /\|\| "-"/);
  assert.match(summaryTable, /\|\| "-"/);
  // V2 없음 branch: has_v2_plan false 시 legacy 값 또는 "-"
  assert.match(page, /has_v2_plan/);
});

// E. 사업장명 긴 경우 ellipsis (truncate + 고정폭)
test("E: 사업장명 셀에 truncate(CSS ellipsis)와 고정폭이 적용된다", () => {
  assert.match(page, /w-\[200px\] max-w-\[240px\] truncate px-2 py-2 font-medium/);
});

// F. 사업장명 full text tooltip/title
test("F: 사업장명 셀에 title(전체명 hover)이 존재한다", () => {
  assert.match(page, /title=\{survey\.business_name \|\| ""\}/);
});

// G. 예비조사자 긴 경우 ellipsis + full text hover
test("G: 예비조사자 셀에 ellipsis와 전체 목록 title이 적용된다", () => {
  assert.match(page, /w-\[180px\] max-w-\[200px\] truncate px-2 py-2 text-center font-medium/);
  assert.match(page, /preliminary_surveyors\.join\(", "\)/);
});

// H. 측정일지 "측정대상사업장 기준 분류" 안내 제거
test("H: 측정일지 수정 모달의 분류 안내 문구가 제거된다", () => {
  assert.doesNotMatch(journalForm, /측정대상사업장 기준 분류/);
  assert.doesNotMatch(journalForm, /측정일지 비고는 호환용/);
});

// I. 측정일지 참고용 정보 순서
test("I: 측정일지 참고용 정보가 예비조사일→예비조사자→공시료코드→실측정자→보고서 담당 순서다", () => {
  const section = journalForm.slice(journalForm.indexOf("예비조사 정보 (참고용)"));
  const labels = ["예비조사일", "예비조사자", "공시료 코드", "실측정자", "보고서 담당"];
  const indexes = labels.map((label) => section.indexOf(label));
  assert.ok(indexes.every((i) => i !== -1), "모든 라벨이 존재해야 함");
  for (let i = 1; i < indexes.length; i += 1) {
    assert.ok(indexes[i] > indexes[i - 1], `${labels[i - 1]} 다음에 ${labels[i]}가 와야 함`);
  }
  // V2 연동
  assert.match(journalForm, /v2PlanInfo/);
});

// J. 측정정보 요약 수정 모달 1열/2열 구성
test("J: 측정정보 요약 수정 모달에 1열(공문연번/연번/5인+/측정자)과 2열(예비조사일/예비조사자/보고서 담당)이 존재한다", () => {
  const modalSection = summaryTable.slice(summaryTable.indexOf("수정 불가 필드"), summaryTable.indexOf("수정 가능 필드"));
  for (const label of ["공문연번", "연번", "5인 이상 연번", "측정자", "예비조사일", "예비조사자", "보고서 담당"]) {
    assert.ok(modalSection.includes(label), `모달에 ${label} 라벨 필요`);
  }
  assert.match(modalSection, /md:grid-cols-2 print:grid-cols-2/);
});

// K. 선택인쇄에 예비조사일/예비조사자/보고서 담당 표시
test("K: 선택인쇄(기본 정보) 블록에 예비조사일/예비조사자/보고서 담당이 표시된다", () => {
  const printSection = summaryTable.slice(summaryTable.indexOf("기본 정보"));
  for (const label of ["예비조사일", "예비조사자", "보고서 담당"]) {
    assert.ok(printSection.includes(label), `인쇄 블록에 ${label} 라벨 필요`);
  }
  assert.match(printSection, /v2_preliminary_survey_date/);
  assert.match(printSection, /v2_participant_names/);
});

// L. legacy fallback이 V2를 덮어쓰지 않음 (V2 우선)
test("L: V2 plan이 있으면 V2를 우선 표시하고 legacy로 덮지 않는다", () => {
  assert.match(surveyApi, /has_v2_plan: true/);
  assert.match(page, /survey\.has_v2_plan/);
  // 예비조사자 셀: V2 우선, 없으면 legacy fallback
  assert.match(page, /has_v2_plan\r?\n\s*\? survey\.preliminary_surveyors/);
  assert.match(summaryTable, /v2_participant_names\?\.length/);
  assert.match(summaryTable, /if \(v2Names\)/);
});

// M. 목록 API N+1 없음 (batch 조회)
test("M: 목록 API는 row별 개별 조회 없이 일괄(V2 plan batch) 조회한다", () => {
  assert.match(surveyApi, /loadV2PlansByTargetKeys/);
  assert.match(summaryApi, /loadV2PlansByTargetKeys/);
  assert.match(previousDataApi, /loadV2PlansByTargetKeys/);
  assert.match(lookup, /\.in\("measurement_target_business_id", targetIds\)/);
  // page.tsx는 row별 fetch를 하지 않는다 (N+1 없음)
  assert.doesNotMatch(page, /preliminary-survey-v2\/plans/);
});

// N. 동일 측정자+동일 측정일 2건 공시료코드(C/CC) 유지
test("N: 공시료코드는 저장된 값(survey_code)을 그대로 읽어 표시하며 생성 규칙을 수정하지 않는다", () => {
  // 목록 API는 preliminary_survey의 survey_code를 그대로 전달(재산출 없음)
  assert.match(surveyApi, /from\("preliminary_survey"\)/);
  // UI는 저장된 survey_code를 그대로 표시
  assert.match(page, /survey\.survey_code \|\| "-"/);
  // V2 plan 연동은 예비조사일/예비조사자만 다루며 공시료코드는 건드리지 않음
  assert.doesNotMatch(lookup, /survey_code/);
});

// 보조: 예비조사 수정 모달 V2 연동 표시 (예비조사일/예비조사자 읽기 전용)
test("예비조사 수정 모달에 V2 예비조사일/예비조사자 읽기 전용 표시가 추가된다", () => {
  assert.match(surveyForm, /예비조사일 \(V2 자동\)/);
  assert.match(surveyForm, /예비조사자 \(V2 자동\)/);
  assert.match(surveyForm, /preliminary_surveyors\?\.join\(", "\)/);
});

// 보조: 이전-data API가 v2Plan을 반환
test("이전-data API는 v2Plan(recommended_date/participant_names)을 반환한다", () => {
  assert.match(previousDataApi, /v2Plan/);
  assert.match(previousDataApi, /recommended_date: v2Plan\.recommended_date/);
});
