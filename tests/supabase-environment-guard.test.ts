import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  assertPublicSupabaseEnvironment,
  assertConfiguredSupabaseUrls,
  assertServerSupabaseEnvironment,
  assertSupabaseEnvironment,
  DatabaseEnvironmentError,
  parseSupabaseDatabaseIdentity,
  SUPABASE_PROJECT_REFS,
} from "../lib/supabase/environment-guard";
import { createAdminClient } from "../lib/supabase/admin";
import { createClient as createBrowserSupabaseClient } from "../lib/supabase/client";
import { createClient as createServerSupabaseClient } from "../lib/supabase/server";

const productionRef = SUPABASE_PROJECT_REFS.production;
const stagingRef = SUPABASE_PROJECT_REFS.staging;

function expectCode(code: string, run: () => unknown) {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof DatabaseEnvironmentError);
    assert.equal(error.code, code);
    return true;
  });
}

function input(
  appEnvironment: "local" | "staging" | "production",
  databaseUrl: string,
  vercelEnvironment?: "development" | "preview" | "production"
) {
  return {
    appEnvironment,
    databaseUrl,
    productionProjectRef: productionRef,
    stagingProjectRef: stagingRef,
    vercelEnvironment,
  };
}

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

describe("Supabase project identity parser", () => {
  it("cloud project ref를 추출한다", () => {
    assert.deepEqual(
      parseSupabaseDatabaseIdentity(`https://${stagingRef}.supabase.co`),
      { kind: "cloud", projectRef: stagingRef }
    );
  });

  it("localhost와 127.0.0.1을 local로 인식한다", () => {
    assert.deepEqual(parseSupabaseDatabaseIdentity("http://localhost:54321"), {
      kind: "local",
      host: "localhost",
    });
    assert.deepEqual(parseSupabaseDatabaseIdentity("http://127.0.0.1:54321"), {
      kind: "local",
      host: "127.0.0.1",
    });
  });

  it("malformed URL과 허용하지 않는 remote host를 거부한다", () => {
    expectCode("INVALID_SUPABASE_URL", () => parseSupabaseDatabaseIdentity("not-a-url"));
    expectCode("INVALID_SUPABASE_URL", () =>
      parseSupabaseDatabaseIdentity("https://database.example.com")
    );
  });
});

describe("Supabase environment fail-fast guard", () => {
  it("Preview + Production ref를 차단한다", () => {
    expectCode("PREVIEW_PRODUCTION_DATABASE_BLOCKED", () =>
      assertSupabaseEnvironment(
        input("staging", `https://${productionRef}.supabase.co`, "preview")
      )
    );
  });

  it("Preview + Staging ref를 허용한다", () => {
    assert.equal(
      assertSupabaseEnvironment(
        input("staging", `https://${stagingRef}.supabase.co`, "preview")
      ).kind,
      "cloud"
    );
  });

  it("Production + Staging ref를 차단한다", () => {
    expectCode("PRODUCTION_STAGING_DATABASE_BLOCKED", () =>
      assertSupabaseEnvironment(
        input("production", `https://${stagingRef}.supabase.co`, "production")
      )
    );
  });

  it("Production + Production ref를 허용한다", () => {
    assert.equal(
      assertSupabaseEnvironment(
        input("production", `https://${productionRef}.supabase.co`, "production")
      ).kind,
      "cloud"
    );
  });

  it("Local + localhost만 허용하고 remote DB를 차단한다", () => {
    assert.equal(
      assertSupabaseEnvironment(input("local", "http://127.0.0.1:54321", "development"))
        .kind,
      "local"
    );
    expectCode("LOCAL_REMOTE_DATABASE_BLOCKED", () =>
      assertSupabaseEnvironment(
        input("local", `https://${productionRef}.supabase.co`, "development")
      )
    );
  });

  it("missing app env, URL, expected ref를 fail-fast한다", () => {
    expectCode("DATABASE_ENVIRONMENT_CONFIGURATION_MISSING", () =>
      assertSupabaseEnvironment({
        appEnvironment: undefined,
        databaseUrl: `https://${stagingRef}.supabase.co`,
        productionProjectRef: productionRef,
        stagingProjectRef: stagingRef,
      })
    );
    expectCode("DATABASE_ENVIRONMENT_CONFIGURATION_MISSING", () =>
      assertSupabaseEnvironment({
        appEnvironment: "staging",
        databaseUrl: undefined,
        productionProjectRef: productionRef,
        stagingProjectRef: stagingRef,
      })
    );
    expectCode("DATABASE_ENVIRONMENT_CONFIGURATION_MISSING", () =>
      assertSupabaseEnvironment({
        appEnvironment: "staging",
        databaseUrl: `https://${stagingRef}.supabase.co`,
        productionProjectRef: productionRef,
        stagingProjectRef: undefined,
      })
    );
  });

  it("VERCEL_ENV와 APP_ENV가 맞지 않으면 차단한다", () => {
    expectCode("APPLICATION_ENVIRONMENT_MISMATCH", () =>
      assertSupabaseEnvironment(
        input("production", `https://${productionRef}.supabase.co`, "preview")
      )
    );
  });
});

describe("browser/server/admin client guard wiring", () => {
  it("browser public 환경도 같은 identity guard를 사용한다", () => {
    assert.equal(
      assertPublicSupabaseEnvironment({
        NEXT_PUBLIC_APP_ENV: "staging",
        NEXT_PUBLIC_SUPABASE_URL: `https://${stagingRef}.supabase.co`,
        NEXT_PUBLIC_VERCEL_ENV: "preview",
      }).kind,
      "cloud"
    );
  });

  it("server runtime은 VERCEL_ENV까지 검증한다", () => {
    const environment = {
      NEXT_PUBLIC_APP_ENV: "production",
      VERCEL_ENV: "production",
    };
    assert.equal(
      assertServerSupabaseEnvironment(
        `https://${productionRef}.supabase.co`,
        environment
      ).kind,
      "cloud"
    );
  });

  it("VERCEL_ENV가 없는 local server에서 cloud APP_ENV 주장으로 우회할 수 없다", () => {
    expectCode("APPLICATION_ENVIRONMENT_MISMATCH", () =>
      assertServerSupabaseEnvironment(`https://${productionRef}.supabase.co`, {
        NEXT_PUBLIC_APP_ENV: "production",
      })
    );
    expectCode("APPLICATION_ENVIRONMENT_MISMATCH", () =>
      assertConfiguredSupabaseUrls({
        NEXT_PUBLIC_APP_ENV: "staging",
        NEXT_PUBLIC_SUPABASE_URL: `https://${stagingRef}.supabase.co`,
        SUPABASE_URL: `https://${stagingRef}.supabase.co`,
      })
    );
  });

  it("server URL과 public URL의 database identity가 다르면 차단한다", () => {
    expectCode("PRODUCTION_STAGING_DATABASE_BLOCKED", () =>
      assertConfiguredSupabaseUrls({
        NEXT_PUBLIC_APP_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: `https://${productionRef}.supabase.co`,
        SUPABASE_URL: `https://${stagingRef}.supabase.co`,
        VERCEL_ENV: "production",
      })
    );
  });

  it("server/admin/browser client 생성점에 guard가 연결돼 있다", async () => {
    const files = await Promise.all([
      readFile(new URL("../lib/supabase/server.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/supabase/admin.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/supabase/client.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/db/supabase.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/auth/get-user.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/debug-data/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../scripts/init-users.ts", import.meta.url), "utf8"),
      readFile(new URL("../scripts/reset-admin-password.ts", import.meta.url), "utf8"),
    ]);
    for (const source of files) {
      assert.match(
        source,
        /assert(?:SupabaseEnvironment|PublicSupabaseEnvironment|ConfiguredSupabaseUrls)|@\/lib\/supabase\/server/
      );
    }
    for (const source of files.slice(2, 4)) {
      assert.match(source, /NEXT_PUBLIC_APP_ENV:\s*process\.env\.NEXT_PUBLIC_APP_ENV/);
      assert.match(source, /NEXT_PUBLIC_SUPABASE_URL:\s*process\.env\.NEXT_PUBLIC_SUPABASE_URL/);
      assert.match(source, /NEXT_PUBLIC_VERCEL_ENV:\s*process\.env\.NEXT_PUBLIC_VERCEL_ENV/);
    }
  });

  it("browser client는 Preview에 Production URL이 들어오면 생성 전에 차단한다", async () => {
    await withProcessEnvironment(
      {
        NEXT_PUBLIC_APP_ENV: "staging",
        NEXT_PUBLIC_VERCEL_ENV: "preview",
        NEXT_PUBLIC_SUPABASE_URL: `https://${productionRef}.supabase.co`,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
      },
      () => {
        expectCode("PREVIEW_PRODUCTION_DATABASE_BLOCKED", () =>
          createBrowserSupabaseClient()
        );
      }
    );
  });

  it("server와 admin client는 Production에 Staging URL이 들어오면 생성 전에 차단한다", async () => {
    await withProcessEnvironment(
      {
        NEXT_PUBLIC_APP_ENV: "production",
        VERCEL_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: `https://${stagingRef}.supabase.co`,
        SUPABASE_URL: `https://${stagingRef}.supabase.co`,
        SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      },
      async () => {
        await assert.rejects(
          createServerSupabaseClient(),
          (error: unknown) =>
            error instanceof DatabaseEnvironmentError &&
            error.code === "PRODUCTION_STAGING_DATABASE_BLOCKED"
        );
        expectCode("PRODUCTION_STAGING_DATABASE_BLOCKED", () => createAdminClient());
      }
    );
  });

  it("Staging badge는 staging에서만 표시되고 전역 layout에 연결된다", async () => {
    const [badge, layout] = await Promise.all([
      readFile(new URL("../components/layout/EnvironmentBadge.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    ]);
    assert.match(badge, /NEXT_PUBLIC_APP_ENV !== "staging"/);
    assert.match(badge, /테스트 환경 · 운영 데이터 아님/);
    assert.match(layout, /<EnvironmentBadge \/>/);
  });

  it("synthetic reset과 계정 provisioning은 Staging ref 및 비밀 분리를 강제한다", async () => {
    const [reset, provision, seed] = await Promise.all([
      readFile(new URL("../scripts/reset-staging-supabase.mjs", import.meta.url), "utf8"),
      readFile(new URL("../scripts/provision-staging-test-users.ts", import.meta.url), "utf8"),
      readFile(new URL("../supabase/seed.sql", import.meta.url), "utf8"),
    ]);
    assert.match(reset, /CONFIRM_STAGING_RESET/);
    assert.match(reset, new RegExp(SUPABASE_PROJECT_REFS.staging));
    assert.match(provision, /STAGING_TEST_ADMIN_PASSWORD/);
    assert.match(provision, /appEnvironment !== "staging"[\s\S]*STAGING_PROVISION_REQUIRES_STAGING_APP_ENV/);
    assert.doesNotMatch(provision, /console\.(?:log|error)\([^)]*(?:credential\.password|passwordHash)/i);
    assert.match(seed, /password_hash[\s\S]*NULL/);
    assert.match(seed, /REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated/);
  });

  it("service_role Data API 보완 후에도 V2 원자 쓰기와 audit 권한을 재잠근다", async () => {
    const migration = await readFile(
      new URL("../supabase/migrations/20260828101000_restore_restricted_service_role_boundaries.sql", import.meta.url),
      "utf8"
    );
    assert.match(migration, /REVOKE ALL ON TABLE public\.preliminary_survey_v2_plans FROM service_role;[\s\S]*GRANT SELECT ON TABLE public\.preliminary_survey_v2_plans TO service_role;/);
    assert.match(migration, /REVOKE ALL ON TABLE public\.preliminary_survey_v2_measurement_assignments FROM service_role;[\s\S]*GRANT SELECT ON TABLE public\.preliminary_survey_v2_measurement_assignments TO service_role;/);
    assert.match(migration, /REVOKE ALL ON TABLE public\.preliminary_survey_v2_document_repair_audit FROM service_role;[\s\S]*GRANT SELECT, INSERT ON TABLE public\.preliminary_survey_v2_document_repair_audit TO service_role;/);
    assert.match(migration, /persist_preliminary_survey_v2_plan_and_measurement_assignments\([\s\S]*FROM service_role;/);
  });
});
