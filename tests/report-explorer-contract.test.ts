import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

const pagePath = "app/(dashboard)/report-processing/page.tsx";
const clientPath = "lib/report-explorer/client.ts";
const helperPath = "tools/report-explorer-helper/report_explorer_helper.py";

function source(path: string) {
  assert.equal(existsSync(path), true, `${path} must exist`);
  return readFileSync(path, "utf8");
}

function reactHookBodies(page: string, hookName: string): string[] {
  const file = ts.createSourceFile(pagePath, page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bodies: string[] = [];

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === hookName
      && node.arguments[0]
    ) {
      bodies.push(node.arguments[0].getText(file));
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  return bodies;
}

function namedInitializer(page: string, names: readonly string[]): string {
  const file = ts.createSourceFile(pagePath, page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const initializers: string[] = [];

  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && names.includes(node.name.text)
      && node.initializer
    ) {
      initializers.push(node.initializer.getText(file));
    }
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) {
      initializers.push(node.getText(file));
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  assert.notEqual(initializers.length, 0, `${names.join("/")} handler must exist`);
  return initializers.join("\n");
}

test("보고서 탐색기는 기존 목록·선택·필터 상태를 재사용한다", () => {
  const page = source(pagePath);

  for (const state of ["filters", "records", "selectedKeys"]) {
    assert.match(page, new RegExp(`\\b${state}\\b`), `${state} state must remain available`);
  }
  assert.match(page, /collectReportExplorerBusinessNames/);
  assert.match(page, /useCurrentResults:\s*true/);
  assert.doesNotMatch(page, /use-report-processing-results|현재 보고서 처리 결과 사용/);
});

test("v0.6 화면은 보고서 처리 결과 다음에 탐색기를 배치하고 두 표를 10건씩 표시한다", () => {
  const page = source(pagePath);
  const processingTable = page.indexOf('aria-label="보고서 처리 결과"');
  const explorer = page.indexOf(">보고서 탐색기</h2>");

  assert.ok(processingTable > 0);
  assert.ok(explorer > processingTable);
  assert.match(page, /const PAGE_SIZE = 10/);
  assert.match(page, /visibleRecords = records\.slice/);
  assert.match(page, /visibleExplorerRows = explorerRows\.slice/);
  assert.match(page, /records\.length > PAGE_SIZE/);
  assert.match(page, /explorerRows\.length > PAGE_SIZE/);
});

test("탐색기는 상단 기준값을 공유하고 한 줄 추가 입력과 경로 tooltip을 제공한다", () => {
  const page = source(pagePath);

  assert.match(page, /effectiveExplorerYear = filters\.year === 'all'/);
  assert.match(page, /effectiveExplorerPeriod = filters\.period === 'all'/);
  assert.doesNotMatch(page, /<textarea/);
  assert.match(page, /label="추가 사업장명"/);
  assert.match(page, /title=\{match\?\.path\}/);
  assert.match(page, /if \(event\.key === 'Enter'\)/);
});

test("탐색 결과 표는 검색 전과 검색 후 0건 상태에서도 헤더와 안내 행을 유지한다", () => {
  const page = source(pagePath);

  assert.match(page, /const \[explorerHasSearched, setExplorerHasSearched\] = useState\(false\)/);
  assert.match(page, /setExplorerHasSearched\(true\)/);
  assert.match(page, />검색 사업장<\/TableHead>/);
  assert.match(page, />일치 사업장 폴더<\/TableHead>/);
  assert.match(page, />경로<\/TableHead>/);
  assert.match(page, />상태<\/TableHead>/);
  assert.match(page, />동작<\/TableHead>/);
  assert.match(page, /<TableCell colSpan=\{5\}/);
  assert.match(page, /text-left text-muted-foreground sm:text-center/);
  assert.match(page, /보고서 폴더를 검색해주세요\./);
  assert.match(page, /일치하는 보고서 폴더가 없습니다\./);
  assert.doesNotMatch(page, /\{explorerRows\.length > 0 && \(/);
});

test("사업장명 입력은 쉼표·개행을 trim하고 대소문자 무시 중복 제거한다", async () => {
  const client = await import("../lib/report-explorer/client");

  assert.deepEqual(
    client.parseReportExplorerBusinessNames(" 한결환경,\n미래기술\n한결환경,  미래기술  "),
    ["한결환경", "미래기술"],
  );
  assert.deepEqual(
    client.collectReportExplorerBusinessNames({
      useCurrentResults: true,
      records: [
        { code: "A", year: 2026, period: "상반기", business_name: "한결환경" },
        { code: "B", year: 2026, period: "상반기", business_name: "미래기술" },
      ],
      selectedKeys: ["A-2026-상반기"],
      manualInput: "한결환경\n추가입력",
    }),
    ["한결환경", "추가입력"],
  );
});

test("health가 Z: 저장소 미연결을 독립 루트 오류로 표시한다", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    status: "ok",
    version: "1",
    storage: { available: false, root: "Z:\\data\\측정팀\\측정보고서", reason: "STORAGE_ROOT_UNAVAILABLE" },
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  try {
    const client = await import("../lib/report-explorer/client");
    const health = await client.getReportExplorerHealth();
    assert.deepEqual(health.issues.map((issue) => issue.kind), ["root"]);
    assert.match(health.message ?? "", /Z: 드라이브/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("탐색기 연결 상태는 확인 전·권한 거부·Z: 저장소 오류를 구분한다", async () => {
  const client = await import("../lib/report-explorer/client");

  assert.equal(client.deriveReportExplorerConnectionStatus([], false), "disconnected");
  assert.equal(
    client.deriveReportExplorerConnectionStatus([{ kind: "permission", message: "권한 거부" }], false),
    "disconnected",
  );
  assert.equal(
    client.deriveReportExplorerConnectionStatus([{ kind: "root", message: "Z: 접근 실패" }], false),
    "storage-error",
  );
  assert.equal(client.deriveReportExplorerConnectionStatus([], true), "connected");
});

test("페이지 마운트와 useEffect는 localhost health를 자동 호출하지 않는다", () => {
  const page = source(pagePath);
  const effects = reactHookBodies(page, "useEffect");

  assert.notEqual(effects.length, 0, "page mount effects must be inspectable");
  for (const effect of effects) {
    assert.doesNotMatch(effect, /\b(?:getReportExplorerHealth|updateExplorerHealth|checkReportExplorerHealth)\s*\(/);
  }
  assert.match(page, /useState<ReportExplorerConnectionStatus>\(["']unchecked["']\)/);
  assert.match(page, /status === ["']unchecked["'][\s\S]*?["']연결 확인 전["']/);
  assert.match(page, /연결 확인/);
});

test("localhost 호출은 연결 확인·검색·열기 같은 명시적 작업에서만 시작한다", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    if (String(input).endsWith("/health")) {
      return new Response(JSON.stringify({
        status: "ok",
        version: "1",
        storage: { available: true, root: "Z:\\data\\측정팀\\측정보고서" },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(input).endsWith("/report-explorer/search")) {
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const client = await import("../lib/report-explorer/client");
    assert.equal(requests.length, 0, "import/mount contract must not contact localhost");

    await client.getReportExplorerHealth();
    await client.searchReportExplorer({
      year: 2026,
      period: "상반기",
      businessNames: ["한결환경"],
    });
    await client.openReportExplorerResult("opaque-result-id");

    assert.deepEqual(
      requests.map(({ url, init }) => [url, init?.method ?? "GET"]),
      [
        ["http://127.0.0.1:17653/health", "GET"],
        ["http://127.0.0.1:17653/report-explorer/search", "POST"],
        ["http://127.0.0.1:17653/report-explorer/open", "POST"],
      ],
    );
    assert.deepEqual(JSON.parse(String(requests[1].init?.body)), {
      year: 2026,
      period: "상반기",
      businessNames: ["한결환경"],
    });
    assert.deepEqual(JSON.parse(String(requests[2].init?.body)), { resultId: "opaque-result-id" });
    assert.equal(requests.some(({ url }) => /supabase|\/rest\/v1|\/api\//i.test(url)), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("명시적 Explorer 작업 핸들러는 Supabase나 Next API를 우회 경로로 호출하지 않는다", () => {
  const page = source(pagePath);
  const handlers = namedInitializer(page, [
    "updateExplorerHealth",
    "checkReportExplorerHealth",
    "handleExplorerSearch",
    "handleExplorerOpen",
  ]);

  assert.doesNotMatch(handlers, /\bsupabase\b|\.from\s*\(|\bfetch\s*\(|\/api\//i);
  assert.match(handlers, /getReportExplorerHealth/);
  assert.match(handlers, /searchReportExplorer/);
  assert.match(handlers, /openReportExplorerResult/);
});

test("권한 오류와 path containment 거부를 HTTP 403만으로 혼동하지 않는다", async () => {
  const originalFetch = globalThis.fetch;
  const client = await import("../lib/report-explorer/client");

  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      error: { code: "PATH_NOT_ALLOWED", message: "허용된 저장소 범위를 벗어난 경로입니다." },
    }), { status: 403, headers: { "Content-Type": "application/json" } });
    await assert.rejects(
      client.searchReportExplorer({ year: 2026, period: "상반기", businessNames: ["한결"] }),
      (error: unknown) => error instanceof client.ReportExplorerClientError
        && error.code === "PATH_NOT_ALLOWED"
        && !error.issues.some((issue) => issue.kind === "permission"),
    );

    globalThis.fetch = async () => new Response(JSON.stringify({
      error: { code: "STORAGE_PERMISSION_DENIED", message: "보고서 저장소에 접근할 권한이 없습니다." },
    }), { status: 403, headers: { "Content-Type": "application/json" } });
    await assert.rejects(
      client.searchReportExplorer({ year: 2026, period: "상반기", businessNames: ["한결"] }),
      (error: unknown) => error instanceof client.ReportExplorerClientError
        && error.code === "STORAGE_PERMISSION_DENIED"
        && error.issues.some((issue) => issue.kind === "permission"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("클라이언트는 고정 loopback helper만 사용하고 URL override를 허용하지 않는다", () => {
  const page = source(pagePath);
  const client = source(clientPath);

  assert.match(client, /REPORT_EXPLORER_BASE_URL\s*=\s*["']http:\/\/127\.0\.0\.1:17653["']/);
  assert.match(client, /\/health/);
  assert.match(client, /\/report-explorer\/search/);
  assert.match(client, /\/report-explorer\/open/);
  assert.doesNotMatch(client, /process\.env|NEXT_PUBLIC_[A-Z0-9_]*REPORT_EXPLORER/);
  assert.doesNotMatch(client, /https?:\/\/(?!127\.0\.0\.1:17653)/);
  assert.doesNotMatch(page, /\/api\/report-processing\/report-explorer/);
});

test("헬퍼는 고정 loopback·exact Origin·opaque resultId·containment 경계를 유지한다", () => {
  const helper = source(helperPath);

  assert.match(helper, /LOOPBACK_HOST\s*=\s*["']127\.0\.0\.1["']/);
  assert.match(helper, /if host != LOOPBACK_HOST:/);
  assert.match(helper, /PRODUCTION_ORIGIN\s*=\s*["']https:\/\/html-tan-six\.vercel\.app["']/);
  assert.match(helper, /origin is not None and origin in configured_origins\(\)/);
  assert.doesNotMatch(helper, /Access-Control-Allow-Origin["']\s*,\s*["']\*/);
  assert.match(helper, /set\(payload\) != \{["']resultId["']\}/);
  assert.match(helper, /secrets\.token_urlsafe\(/);
  assert.match(helper, /_records\.pop\(result_id, None\)/);
  assert.match(helper, /not _is_within\(target, root\)/);
  assert.match(helper, /not _is_within\(target, period_root\)/);
});

test("탐색기 경계에는 Supabase·background_jobs·migration 연동이 없다", () => {
  const client = source(clientPath);
  const helper = source(helperPath);
  const boundary = `${client}\n${helper}`;

  assert.doesNotMatch(boundary, /supabase/i);
  assert.doesNotMatch(boundary, /background_jobs/i);
  assert.doesNotMatch(boundary, /migration/i);
  assert.doesNotMatch(boundary, /report-processing\/queue|report-processing\/job-status/);
});

test("헬퍼는 웹 앱과 분리된 tools 경계에만 존재한다", () => {
  assert.equal(existsSync(helperPath), true);
  assert.equal(
    existsSync(join("app", "api", "report-explorer")),
    false,
    "report explorer must not become a Next.js API route",
  );
});
