import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";
import {
  isQaAutoLoginEnabled,
  qaAutoLoginRedirectPath,
} from "../lib/auth/qa-auto-login";
import { updateSession } from "../lib/supabase/middleware";
import { GET as qaAutoLogin } from "../app/api/auth/qa-auto-login/route";

async function withProcessEnvironment(
  values: Record<string, string | undefined>,
  run: () => void | Promise<void>
) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]])
  );
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("Staging QA auto-login gate", () => {
  it("Preview + staging + explicit flag에서만 허용한다", () => {
    assert.equal(
      isQaAutoLoginEnabled({
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_APP_ENV: "staging",
        QA_AUTO_LOGIN: "true",
      }),
      true
    );
    assert.equal(
      isQaAutoLoginEnabled({
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_APP_ENV: "staging",
        QA_AUTO_LOGIN: "false",
      }),
      false
    );
    assert.equal(
      isQaAutoLoginEnabled({
        VERCEL_ENV: "production",
        NEXT_PUBLIC_APP_ENV: "production",
        QA_AUTO_LOGIN: "true",
      }),
      false
    );
    assert.equal(
      isQaAutoLoginEnabled({
        VERCEL_ENV: "development",
        NEXT_PUBLIC_APP_ENV: "local",
        QA_AUTO_LOGIN: "true",
      }),
      false
    );
  });

  it("외부 redirect를 거부하고 /survey 범위만 허용한다", () => {
    assert.equal(qaAutoLoginRedirectPath(null), "/survey");
    assert.equal(
      qaAutoLoginRedirectPath("/survey?year=2026&period=하반기"),
      "/survey?year=2026&period=%ED%95%98%EB%B0%98%EA%B8%B0"
    );
    assert.equal(qaAutoLoginRedirectPath("/dashboard"), "/survey");
    assert.equal(qaAutoLoginRedirectPath("//example.com/survey"), "/survey");
  });

  it("무세션 /survey만 QA endpoint로 보내고 Production은 기존 login을 유지한다", async () => {
    await withProcessEnvironment(
      {
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_APP_ENV: "staging",
        QA_AUTO_LOGIN: "true",
      },
      async () => {
        const response = await updateSession(
          new NextRequest("https://qa.example/survey?year=2026")
        );
        assert.equal(response.status, 307);
        assert.equal(
          new URL(response.headers.get("location")!).pathname,
          "/api/auth/qa-auto-login"
        );
      }
    );

    await withProcessEnvironment(
      {
        VERCEL_ENV: "production",
        NEXT_PUBLIC_APP_ENV: "production",
        QA_AUTO_LOGIN: "true",
        QA_LOGIN_EMAIL: "must-not-be-used",
        QA_LOGIN_PASSWORD: "must-not-be-used",
      },
      async () => {
        const request = new NextRequest("https://production.example/survey");
        const middlewareResponse = await updateSession(request);
        assert.equal(
          new URL(middlewareResponse.headers.get("location")!).pathname,
          "/login"
        );
        const endpointResponse = await qaAutoLogin(request);
        assert.equal(endpointResponse.status, 404);
      }
    );
  });

  it("비밀값은 서버 route에서 gate 통과 후에만 읽고 client로 전달하지 않는다", async () => {
    const [route, middleware, example] = await Promise.all([
      readFile(
        new URL("../app/api/auth/qa-auto-login/route.ts", import.meta.url),
        "utf8"
      ),
      readFile(new URL("../lib/supabase/middleware.ts", import.meta.url), "utf8"),
      readFile(new URL("../.env.example", import.meta.url), "utf8"),
    ]);
    const gateIndex = route.indexOf("isQaAutoLoginEnabled(process.env)");
    assert.ok(gateIndex >= 0);
    assert.ok(route.indexOf("process.env.QA_LOGIN_EMAIL") > gateIndex);
    assert.ok(route.indexOf("process.env.QA_LOGIN_PASSWORD") > gateIndex);
    assert.match(route, /createClient\(\)/);
    assert.match(route, /verifyPassword\(qaPassword, user\.password_hash\)/);
    assert.match(route, /is_preliminary_survey_manager === true/);
    assert.match(route, /setSessionCookie/);
    assert.doesNotMatch(route, /console\./);
    assert.doesNotMatch(middleware, /QA_LOGIN_EMAIL|QA_LOGIN_PASSWORD/);
    assert.match(example, /QA_AUTO_LOGIN=\s*$/m);
    assert.match(example, /QA_LOGIN_EMAIL=\s*$/m);
    assert.match(example, /QA_LOGIN_PASSWORD=\s*$/m);
  });
});
