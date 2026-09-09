import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { K2BService, isK2BSubmissionRefreshComplete } from "../lib/automation/k2b-service";
import { K2B_BEGIN_SUBMISSION_REFRESH_SCRIPT, K2B_END_SUBMISSION_REFRESH_SCRIPT, K2B_READ_SUBMISSION_GRID_SCRIPT, K2B_SUBMISSION_REFRESH_STATE_SCRIPT } from "../lib/automation/k2b-grid-reader";
import { parseK2BSubmissionGrid, type K2BGridReadEvidence } from "../lib/automation/k2b-original-sync";
import { reconcileK2BSubmissionResults } from "../lib/k2b-verification";

const headers = ["청구 파일명", "사업장명", "처리상태", "접수일", "사업년도", "반기", "지원구분", "접수번호", "관리번호", "개시번호", "순번", "오류내용", "오류보기"];
const actualK2BHeaders = ["청구 파일명", "사업장명", "처리상태", "접수일", "사업년도", "반기", "지원구분", "접수번호", "내용보기", "오류보기", "도급사업장", "관리번호", "개시번호", "순번"];
const makeRows = (size = 30) => Array.from({ length: size }, (_, index) => [
  `fixture-${index}.xml`, index === 20 ? "한스오토스" : index === 29 ? "월드마스터" : `합성-${index}`,
  "정상처리", "2026-09-09", "2026", "하반기", "국고", `R-${index}`,
  index === 20 ? "31481904910" : index === 29 ? "46988023690" : String(10000000000 + index),
  "00000000000", String(index + 1), "", "오류보기",
]);

/** 10개 슬롯의 DOM 객체/id를 재사용하는 Nexacro 런타임 fixture. 외부 조회는 없다. */
function browserFixture(options: { dataset?: boolean; size?: number; expected?: number | null; frozen?: boolean } = {}) {
  const fixtureHeaders = [...headers];
  const rows = makeRows(options.size ?? 30);
  const pool = Array.from({ length: Math.min(10, rows.length) }, (_, slot) => headers.map((_, col) => ({
    id: `fixture_grid_fileList_body_gridrow_${slot}_cell_${slot}_${col}GridCellTextContainerElement`, textContent: "",
  }))).flat();
  let position = 0;
  let componentPosition: number | null = null;
  let scrollWrites = 0;
  const root = {
    id: "fixture_grid_fileList", clientHeight: 200, scrollHeight: rows.length * 20,
    get scrollTop() { return position; },
    set scrollTop(value: number) { position = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); scrollWrites++; },
    getClientRects: () => [{}],
    getAttribute: (name: string) => name === "data-rowcount" ? String(options.expected === undefined ? rows.length : options.expected ?? "") : null,
    dispatchEvent: () => true,
    querySelectorAll(selector: string) {
      if (selector === "*") return [];
      if (selector.includes("_head")) return fixtureHeaders.map((header, col) => ({ id: `fixture_grid_fileList_head_cell_0_${col}GridCellTextContainerElement`, textContent: header }));
      const start = options.frozen ? 0 : Math.floor((componentPosition ?? position) / 20);
      pool.forEach((node, i) => { node.textContent = rows[start + Math.floor(i / headers.length)]?.[i % headers.length] ?? ""; });
      return pool;
    },
  };
  const loadHandlers = new Set<(sender: unknown, event: { reason: number; errorcode: number }) => void>();
  const dataset = {
    addEventHandler: (_name: string, handler: (sender: unknown, event: { reason: number; errorcode: number }) => void) => { loadHandlers.add(handler); },
    removeEventHandler: (_name: string, handler: (sender: unknown, event: { reason: number; errorcode: number }) => void) => { loadHandlers.delete(handler); },
    getRowCount: () => rows.length,
    getColumnInfo: (id: string) => /^c\d+$/.test(id) && Number(id.slice(1)) < headers.length ? { id } : null,
    getColumn: (row: number, id: string) => rows[row][Number(id.slice(1))],
  };
  // body cell 순서를 head와 반대로 배치해 고정 index/동일 cell index 가정을 검출한다.
  const grid = {
    id: "grid_fileList",
    getElement: () => ({ handle: root }),
    getBindDataset: () => options.dataset === false ? null : dataset,
    getCellCount: () => headers.length,
    getCellProperty(band: string, cell: number, property: string): string | number {
      const col = band === "head" ? cell : headers.length - 1 - cell;
      if (property === "col") return col;
      if (property === "colspan") return 1;
      return band === "head" ? fixtureHeaders[col] : col === headers.length - 1 ? "오류보기" : `bind:c${col}`;
    },
    getCellText: (row: number, cell: number) => rows[row][headers.length - 1 - cell],
  };
  const clickHandlers = new Set<() => void>();
  const mutationObservers = new Set<(records: { type: string }[]) => void>();
  const searchButton = {
    addEventListener: (_name: string, handler: () => void) => { clickHandlers.add(handler); },
    removeEventListener: (_name: string, handler: () => void) => { clickHandlers.delete(handler); },
    click: () => { clickHandlers.forEach(handler => handler()); mutationObservers.forEach(handler => handler([{ type: "childList" }])); },
  };
  class FixtureMutationObserver {
    constructor(private readonly callback: (records: { type: string }[]) => void) {}
    observe() { mutationObservers.add(this.callback); }
    disconnect() { mutationObservers.delete(this.callback); }
  }
  const browser = {
    document: { querySelectorAll: () => [root], getElementById: () => searchButton },
    window: { nexacro: { getApplication: () => ({ mainframe: { form: { components: [grid] } } }) } },
    setTimeout: (callback: () => void) => { callback(); return 0; }, Event: class {}, MutationObserver: FixtureMutationObserver,
  };
  const service = new K2BService();
  const scripts: string[] = [];
  const driver = { async executeScript(script: string) {
    scripts.push(script);
    return runInNewContext(`(function () { ${script} })()`, browser);
  } };
  Object.assign(service, { driver });
  return { service, rows, dataset, grid, root, pool, scripts, driver, fixtureHeaders, searchButton, loadHandlers, clickHandlers,
    getScrollWrites: () => scrollWrites,
    emitLoad: (reason = 0, errorcode = 0) => { loadHandlers.forEach(handler => handler(dataset, { reason, errorcode })); },
    useOfficialScroll(withScrollbar = true) {
      componentPosition = 200;
      let calls = 0;
      const scrollbar = { max: Math.max(0, rows.length * 20 - 200), get pos() { return componentPosition; } };
      Object.assign(grid, {
        ...(withScrollbar ? { vscrollbar: scrollbar } : {}),
        getVScrollPos: () => componentPosition, getHScrollPos: () => 17,
        scrollTo(horizontal: number, vertical: number) { assert.equal(horizontal, 17); calls++; componentPosition = Math.max(0, Math.min(vertical, scrollbar.max)); },
      });
      return { getCalls: () => calls, getPosition: () => componentPosition };
    },
  };
}

test("viewport 10 / Dataset 30: 원본 30건을 읽고 head→bind→Dataset 매핑한다", async () => {
  const fixture = browserFixture();
  const result = await fixture.service.readCurrentSubmissionResults();
  assert.equal(fixture.pool.length, headers.length * 10);
  assert.equal(result.rows.length, 30);
  assert.equal(result.expectedRowCount, 30);
  assert.equal(result.collectedUniqueRowCount, 30);
  assert.equal(result.readMethod, "nexacro_dataset");
  assert.equal(result.completeness, "COMPLETE");
  assert.equal(fixture.getScrollWrites(), 0);
  assert.equal(fixture.scripts.length, 1);
  for (const [name, management] of [["한스오토스", "31481904910"], ["월드마스터", "46988023690"]]) {
    const [matched] = reconcileK2BSubmissionResults([{
      code: name, businessName: name, industrialAccidentNumber: management, commencementNumber: "00000000000",
      resultDate: "2026-09-09", internalK2BSendDate: "2026-09-09",
    }], result.rows.map(row => ({ ...row, submissionDate: row.actualSubmissionDate })), result);
    assert.equal(matched.verdict, "정상");
    assert.equal(matched.matchMethod, "exact_keys");
    assert.equal(matched.match?.commencementNumber, "00000000000");
  }
});

test("정적 오류보기 컨트롤은 정상, Dataset 실제 오류내용/신호는 오류이다", async () => {
  const fixture = browserFixture();
  fixture.rows[1][11] = "합성 오류내용";
  const result = await fixture.service.readCurrentSubmissionResults();
  assert.equal(result.rows[0].errorViewAvailable, false);
  assert.equal(result.rows[0].errorDetail, null);
  assert.equal(result.rows[1].errorViewAvailable, true);
  assert.equal(result.rows[1].errorDetail, "합성 오류내용");
  const property = fixture.grid.getCellProperty;
  fixture.grid.getCellProperty = (band, cell, name) => band === "body" && cell === 0 && name === "text" ? "bind:c12" : property(band, cell, name);
  fixture.rows.forEach(row => { row[12] = "0"; });
  fixture.rows[2][12] = "1";
  const bound = await fixture.service.readCurrentSubmissionResults();
  assert.equal(bound.rows[0].errorViewAvailable, false);
  assert.equal(bound.rows[2].errorViewAvailable, true);
});

test("Dataset binding/schema가 불명확하면 DOM으로 우회하여 성공시키지 않는다", async () => {
  const fixture = browserFixture();
  fixture.dataset.getColumnInfo = () => null;
  await assert.rejects(fixture.service.readCurrentSubmissionResults(), /missing_dataset_column/);
  assert.equal(fixture.getScrollWrites(), 0);
});

test("Dataset 0건은 검증된 빈 결과, 읽는 중 count 변경은 INCOMPLETE이다", async () => {
  const empty = await browserFixture({ size: 0 }).service.readCurrentSubmissionResults();
  assert.equal(empty.outcome, "SUCCESS_EMPTY");
  assert.equal(empty.completeness, "COMPLETE");
  assert.equal(empty.expectedRowCount, 0);
  const fixture = browserFixture();
  let reads = 0;
  fixture.dataset.getRowCount = () => ++reads === 1 ? 30 : 29;
  assert.equal((await fixture.service.readCurrentSubmissionResults()).completeness, "INCOMPLETE");
});

test("Dataset 접근 불가에서만 virtual scroll: DOM 재사용·겹치는 viewport를 안정 키로 dedupe", async () => {
  for (const inaccessible of [false, true]) {
    const fixture = browserFixture({ dataset: false });
    if (inaccessible) fixture.grid.getBindDataset = () => { throw new Error("runtime unavailable"); };
    const nodes = [...fixture.pool];
    fixture.root.scrollTop = 200; // 현재 위치와 무관하게 맨 위부터 순회하고 복원한다.
    const result = await fixture.service.readCurrentSubmissionResults();
    assert.equal(result.rows.length, 30);
    assert.equal(result.readMethod, "virtual_scroll");
    assert.equal(result.completeness, "COMPLETE");
    assert.equal(new Set(result.rows.map(row => row.submissionNumber)).size, 30);
    assert.ok(nodes.every((node, index) => node === fixture.pool[index]));
    assert.equal(fixture.root.scrollTop, 200);
  }
});

test("expected30/collected29와 끝까지 갱신되지 않는 DOM은 COMPLETE가 아니다", async () => {
  const missing = await browserFixture({ dataset: false, size: 29, expected: 30 }).service.readCurrentSubmissionResults();
  assert.equal(missing.expectedRowCount, 30);
  assert.equal(missing.collectedUniqueRowCount, 29);
  assert.equal(missing.completeness, "INCOMPLETE");
  const frozen = await browserFixture({ dataset: false, frozen: true }).service.readCurrentSubmissionResults();
  assert.equal(frozen.collectedUniqueRowCount, 10);
  assert.equal(frozen.completeness, "INCOMPLETE");
  const unknown = await browserFixture({ dataset: false, expected: null }).service.readCurrentSubmissionResults();
  assert.equal(unknown.completeness, "UNKNOWN");
});

test("parser는 COMPLETE 주장만 믿지 않고 expected/collected 수를 재확인한다", () => {
  const evidence: K2BGridReadEvidence = { expectedRowCount: 30, collectedUniqueRowCount: 29, readMethod: "virtual_scroll", completeness: "COMPLETE" };
  assert.equal(parseK2BSubmissionGrid(headers, makeRows(29), evidence).completeness, "INCOMPLETE");
  assert.equal(parseK2BSubmissionGrid(headers, makeRows(), { ...evidence, collectedUniqueRowCount: 30 }).completeness, "COMPLETE");
  assert.equal(parseK2BSubmissionGrid(headers, []).completeness, "UNKNOWN");
});

const target = { code: "fixture", businessName: "이름만 동일", industrialAccidentNumber: "314-81904910", commencementNumber: "00000000000", resultDate: "2026-09-09", internalK2BSendDate: "2026-09-09" };
const exact = { managementNumber: "31481904910", commencementNumber: "00000000000", status: "정상처리", submissionDate: "2026-09-09" };

test("COMPLETE exact0만 미접수, UNKNOWN/INCOMPLETE exact0는 확인 필요", () => {
  for (const completeness of ["COMPLETE", "INCOMPLETE", "UNKNOWN"] as const) {
    const [result] = reconcileK2BSubmissionResults([target], [], { completeness });
    assert.equal(result.verdict, completeness === "COMPLETE" ? "미접수" : "확인 필요");
    assert.equal(result.matchMethod, "NONE");
  }
  assert.equal(reconcileK2BSubmissionResults([target], [])[0].verdict, "확인 필요");
});

test("INCOMPLETE/UNKNOWN이어도 실제 exact 1건 정상/오류 verdict를 유지한다", () => {
  for (const completeness of ["INCOMPLETE", "UNKNOWN"] as const) {
    assert.equal(reconcileK2BSubmissionResults([target], [exact], { completeness })[0].verdict, "정상");
    for (const error of [{ errorDetail: "실제 오류" }, { errorViewAvailable: true }, { status: "파일오류" }]) {
      assert.equal(reconcileK2BSubmissionResults([target], [{ ...exact, ...error }], { completeness })[0].verdict, "오류");
    }
  }
});

test("이름만 일치하고 exact key가 다르면 자동매칭하지 않는다 (all-zero 개시번호 보존)", () => {
  const [result] = reconcileK2BSubmissionResults([target], [{ ...exact, companyName: target.businessName, commencementNumber: "00000000001" }], { completeness: "COMPLETE" });
  assert.equal(result.match, null);
  assert.equal(result.verdict, "미접수");
});

test("호출부는 completeness와 최소 진단만 전달하며 로그인/범위조회는 한 번이다", () => {
  const worker = readFileSync("lib/automation/worker-daemon.ts", "utf8");
  assert.match(worker, /remoteResults, rangeGrid\)/);
  assert.match(worker, /gridResults, grid\)/);
  for (const field of ["remoteExpectedRowCount", "gridReadMethod", "gridReadComplete"]) assert.ok(worker.includes(field));
  const service = readFileSync("lib/automation/k2b-verification-service.ts", "utf8");
  assert.equal((service.match(/await k2b\.login\(\)/g) ?? []).length, 1);
  const verify = worker.slice(worker.indexOf("private async processK2BVerifyJob"), worker.indexOf("private async processK2BJob"));
  assert.equal((verify.match(/await querySubmissionResultsForRange\(/g) ?? []).length, 1);
  assert.doesNotMatch(K2B_READ_SUBMISSION_GRID_SCRIPT, /outerHTML|console\.|\.click\(/);
});

test("DOM fallback 오류값 1/Y/true/오류내용은 COMPLETE에서도 실제 오류로 전달한다", async () => {
  for (const flagHeader of ["오류보기", "오류여부"]) {
    const fixture = browserFixture({ dataset: false });
    fixture.fixtureHeaders[12] = flagHeader;
    const property = fixture.grid.getCellProperty;
    fixture.grid.getCellProperty = (band, cell, name) => band === "body" && cell === 0 && name === "text" ? "bind:c12" : property(band, cell, name);
    const values = ["1", "Y", "true", "실제 오류내용", "0", "N", "false"];
    fixture.rows.forEach((row, index) => { row[12] = values[index % values.length]; });
    const result = await fixture.service.readCurrentSubmissionResults();
    assert.equal(result.completeness, "COMPLETE");
    for (let index = 0; index < values.length; index++) {
      const row = result.rows[index];
      const hasError = index < 4;
      assert.equal(row.errorViewAvailable, hasError);
      assert.equal(Boolean(row.errorDetail), hasError);
      const [verdict] = reconcileK2BSubmissionResults([{ ...target, industrialAccidentNumber: row.managementNumber }], [{ ...row, submissionDate: row.actualSubmissionDate }], result);
      assert.equal(verdict.verdict, hasError ? "오류" : "정상");
    }
  }
});

test("정적 오류보기 라벨만 있고 실제 오류 컬럼이 없어도 schema를 거부하거나 오류로 오판하지 않는다", async () => {
  for (const value of ["오류보기", ""]) {
    const fixture = browserFixture({ dataset: false });
    fixture.fixtureHeaders[11] = "참고";
    fixture.rows.forEach(row => { row[12] = value; });
    const result = await fixture.service.readCurrentSubmissionResults();
    assert.equal(result.completeness, "COMPLETE");
    assert.equal(result.rows[0].errorViewAvailable, false);
  }
});

test("실제 K2B 14-column header: 별도 오류내용 없이 static 오류보기는 정상 행을 오류로 만들지 않는다", () => {
  const rows = [["a.xml", "한스오토스", "정상처리", "20260901", "2026", "하반기", "국고", "R-1", "내용보기", "오류보기", "", "31481904910", "00000000000", "1"]];
  const read = parseK2BSubmissionGrid(actualK2BHeaders, rows, {
    expectedRowCount: 1, collectedUniqueRowCount: 1, readMethod: "virtual_scroll", completeness: "COMPLETE",
  });
  assert.equal(read.rows[0].errorViewAvailable, false);
  const [matched] = reconcileK2BSubmissionResults([{
    code: "한스오토스", businessName: "한스오토스", industrialAccidentNumber: "31481904910", commencementNumber: "00000000000",
    resultDate: "2026-09-01", internalK2BSendDate: "2026-09-01",
  }], read.rows.map(row => ({ ...row, submissionDate: row.actualSubmissionDate })), read);
  assert.equal(matched.verdict, "정상");
});

test("Dataset NF API는 존재해도 현재 검색 결과 수집에서 호출하지 않는다", async () => {
  const fixture = browserFixture();
  Object.assign(fixture.dataset, {
    getRowCountNF: () => { throw new Error("NF must not be called"); },
    getColumnNF: () => { throw new Error("NF must not be called"); },
  });
  const result = await fixture.service.readCurrentSubmissionResults();
  assert.equal(result.expectedRowCount, 30);
  assert.equal(result.readMethod, "nexacro_dataset");
});

test("공식 scrollTo/getVScrollPos가 native DOM보다 우선하고 30건/최하단/위치 복원을 증명한다", async () => {
  for (const withScrollbar of [true, false]) {
    const fixture = browserFixture({ dataset: false });
    const scroll = fixture.useOfficialScroll(withScrollbar);
    const result = await fixture.service.readCurrentSubmissionResults();
    assert.ok(scroll.getCalls() > 0);
    assert.equal(fixture.getScrollWrites(), 0);
    assert.equal(result.completeness, "COMPLETE");
    assert.equal(result.collectedUniqueRowCount, 30);
    assert.equal(result.rows.at(-1)?.companyName, "월드마스터");
    assert.equal(scroll.getPosition(), 200);
  }
});

test("독립 scrollbar를 이동할 API가 없으면 native 끝 위치로 COMPLETE를 위조하지 않는다", async () => {
  const fixture = browserFixture({ dataset: false });
  Object.assign(fixture.grid, { vscrollbar: { pos: 0, max: 400 } });
  const result = await fixture.service.readCurrentSubmissionResults();
  assert.equal(fixture.getScrollWrites(), 0);
  assert.equal(result.collectedUniqueRowCount, 10);
  assert.equal(result.completeness, "INCOMPLETE");
});

test("Dataset duplicate는 rows30을 보존하면서 unique29/INCOMPLETE로 기록하고 exact 후보를 숨기지 않는다", async () => {
  const fixture = browserFixture();
  fixture.rows[29] = [...fixture.rows[20]];
  const result = await fixture.service.readCurrentSubmissionResults();
  assert.equal(result.rows.length, 30);
  assert.equal(result.expectedRowCount, 30);
  assert.equal(result.collectedUniqueRowCount, 29);
  assert.equal(result.completeness, "INCOMPLETE");
  const [matched] = reconcileK2BSubmissionResults([target], result.rows.map(row => ({ ...row, submissionDate: row.actualSubmissionDate })), result);
  assert.equal(matched.matchMethod, "AMBIGUOUS");
  assert.equal(matched.verdict, "확인 필요");
});

test("Dataset 동일 내용 오류 행 2건도 identity 중복으로 자동 선택을 차단한다", async () => {
  for (const hasSubmissionNumber of [true, false]) {
    const fixture = browserFixture();
    fixture.rows[20][11] = "동일 오류내용";
    if (!hasSubmissionNumber) fixture.rows[20][7] = "";
    fixture.rows[29] = [...fixture.rows[20]];
    const result = await fixture.service.readCurrentSubmissionResults();
    assert.equal(result.rows.length, 30);
    assert.equal(result.expectedRowCount, 30);
    assert.equal(result.collectedUniqueRowCount, 29);
    assert.equal(result.completeness, "INCOMPLETE");
    const conflicts = result.rows.filter(row => row.identityConflict);
    assert.equal(conflicts.length, 2);
    assert.deepEqual(conflicts[0].raw, conflicts[1].raw);
    assert.ok(conflicts.every(row => row.errorViewAvailable && row.errorDetail === "동일 오류내용"));
    const [matched] = reconcileK2BSubmissionResults([target], result.rows.map(row => ({ ...row, submissionDate: row.actualSubmissionDate })), result);
    assert.equal(matched.verdict, "확인 필요");
    assert.equal(matched.matchMethod, "AMBIGUOUS");
    assert.equal(matched.match, null);
  }
});

test("Dataset 동일 접수키 정상/오류 conflict는 양쪽을 보존하고 정상 행을 임의 선택하지 않는다", async () => {
  const fixture = browserFixture();
  fixture.rows[29] = [...fixture.rows[20]];
  fixture.rows[29][11] = "충돌 오류값";
  const result = await fixture.service.readCurrentSubmissionResults();
  const conflicts = result.rows.filter(row => row.identityConflict);
  assert.equal(result.rows.length, 30);
  assert.equal(result.collectedUniqueRowCount, 29);
  assert.equal(conflicts.length, 2);
  assert.equal(conflicts.filter(row => row.errorViewAvailable).length, 1);
  const [matched] = reconcileK2BSubmissionResults([target], result.rows.map(row => ({ ...row, submissionDate: row.actualSubmissionDate })), result);
  assert.equal(matched.verdict, "확인 필요");
  assert.equal(matched.match, null);
  const worker = readFileSync("lib/automation/worker-daemon.ts", "utf8");
  assert.equal((worker.match(/identityConflict: row\.identityConflict/g) ?? []).length, 2);
});

test("virtual-scroll conflict도 관측 버전을 삭제하지 않고 unique count와 별도로 보존한다", async () => {
  const fixture = browserFixture({ dataset: false });
  fixture.rows[29] = [...fixture.rows[20]];
  fixture.rows[29][11] = "충돌 오류값";
  const result = await fixture.service.readCurrentSubmissionResults();
  assert.equal(result.rows.length, 30);
  assert.equal(result.collectedUniqueRowCount, 29);
  assert.equal(result.completeness, "INCOMPLETE");
  assert.equal(result.rows.filter(row => row.identityConflict).length, 2);
});

test("freshness: 무관 style mutation/검색 전 onload/부분 load는 stale 빈 Dataset을 승인하지 않는다", async () => {
  const fixture = browserFixture({ size: 0 });
  await fixture.driver.executeScript(K2B_BEGIN_SUBMISSION_REFRESH_SCRIPT);
  const before = { loading: false, gridElementId: "grid", rowSignature: "", explicitEmpty: true, mutationVersion: 0, datasetLoadVersion: 0 };
  fixture.emitLoad(); // 검색 버튼을 누르기 전 이벤트는 이번 검색과 관계없다.
  let state = await fixture.driver.executeScript(K2B_SUBMISSION_REFRESH_STATE_SCRIPT);
  assert.equal(state.datasetLoadVersion, 0);
  assert.equal(isK2BSubmissionRefreshComplete(before, { ...before, mutationVersion: 100 }, true), false);
  fixture.searchButton.click();
  Object.assign(fixture.root, { style: { display: "block" }, className: "changed" });
  state = await fixture.driver.executeScript(K2B_SUBMISSION_REFRESH_STATE_SCRIPT);
  assert.equal(state.datasetLoadVersion, 0);
  fixture.emitLoad(1);
  state = await fixture.driver.executeScript(K2B_SUBMISSION_REFRESH_STATE_SCRIPT);
  assert.equal(state.datasetLoadVersion, 0);
  assert.equal(state.datasetLoading, true);
  fixture.emitLoad(0);
  state = await fixture.driver.executeScript(K2B_SUBMISSION_REFRESH_STATE_SCRIPT);
  assert.equal(state.datasetLoadVersion, 1);
  assert.equal(state.datasetLoading, false);
  assert.equal(isK2BSubmissionRefreshComplete(before, { ...before, ...state }, false), true);
  fixture.emitLoad(0, -1);
  state = await fixture.driver.executeScript(K2B_SUBMISSION_REFRESH_STATE_SCRIPT);
  assert.equal(isK2BSubmissionRefreshComplete(before, { ...before, ...state }, false), false);
  await fixture.driver.executeScript(K2B_END_SUBMISSION_REFRESH_SCRIPT);
  assert.equal(fixture.loadHandlers.size, 0);
  assert.equal(fixture.clickHandlers.size, 0);
});

function rangeFixture(size: number, search: (fixture: ReturnType<typeof browserFixture>) => void) {
  const fixture = browserFixture({ size });
  let queryCount = 0;
  const input = () => {
    let value = "";
    return { click: async () => {}, sendKeys: async (...keys: string[]) => { value = keys.at(-1) ?? ""; }, getAttribute: async () => value };
  };
  const controls = [input(), input(), { click: async () => { queryCount++; fixture.searchButton.click(); search(fixture); } }];
  Object.assign(fixture.service, { readOnlyMode: true, driver: {
    ...fixture.driver, findElements: async () => [], sleep: async () => {},
    async wait(condition: unknown) {
      if (typeof condition !== "function") return controls.shift();
      if (!await condition()) throw new Error("K2B_GRID_REFRESH_UNVERIFIABLE:timeout");
    },
  } });
  return { ...fixture, getQueryCount: () => queryCount };
}

test("Dataset/event 접근 불가여도 range query는 DOM freshness 뒤 virtual-scroll fallback에 도달한다", async () => {
  const fixture = browserFixture({ dataset: false, size: 30 });
  let queryCount = 0;
  const input = () => ({ click: async () => {}, sendKeys: async () => {}, getAttribute: async () => "20260901" });
  const controls = [input(), input(), { click: async () => { queryCount++; fixture.searchButton.click(); } }];
  Object.assign(fixture.service, { readOnlyMode: true, driver: {
    ...fixture.driver, findElements: async () => [], sleep: async () => {},
    async wait(condition: unknown) { if (typeof condition !== "function") return controls.shift(); if (!await condition()) throw new Error("timeout"); },
  } });
  fixture.rows.forEach(row => { row[3] = "2026-09-01"; });
  const result = await fixture.service.querySubmissionResultsForRange("2026-09-01", "2026-09-01");
  assert.equal(queryCount, 1);
  assert.equal(result.readMethod, "virtual_scroll");
  assert.equal(result.completeness, "COMPLETE");
});

test("범위조회: stale 빈 결과는 읽지 않고 실패, 새 빈 Dataset load는 1회 검색으로 COMPLETE", async () => {
  const stale = rangeFixture(0, () => {});
  await assert.rejects(stale.service.querySubmissionResultsForRange("2026-09-03", "2026-09-09"), /REFRESH_UNVERIFIABLE/);
  assert.equal(stale.getQueryCount(), 1);
  assert.equal(stale.scripts.filter(script => script === K2B_READ_SUBMISSION_GRID_SCRIPT).length, 0);
  assert.equal(stale.loadHandlers.size, 0);
  const fresh = rangeFixture(0, fixture => fixture.emitLoad());
  const result = await fresh.service.querySubmissionResultsForRange("2026-09-03", "2026-09-09");
  assert.equal(result.completeness, "COMPLETE");
  assert.equal(result.outcome, "SUCCESS_EMPTY");
  assert.equal(fresh.getQueryCount(), 1);
  assert.equal(fresh.loadHandlers.size, 0);
});

test("범위 밖 실제 접수일이 1건이면 전체 조회가 실패하여 판정/반영에 쓰일 행을 반환하지 않는다", async () => {
  const fixture = rangeFixture(30, fixture => fixture.emitLoad());
  fixture.rows[29][3] = "2026-09-02";
  let rowsUsed = false;
  await assert.rejects(fixture.service.querySubmissionResultsForRange("2026-09-03", "2026-09-09").then(() => { rowsUsed = true; }), /K2B_GRID_RANGE_MISMATCH:submission_date_outside_range/);
  assert.equal(rowsUsed, false);
  assert.equal(fixture.getQueryCount(), 1);
  assert.equal(fixture.loadHandlers.size, 0);
});
