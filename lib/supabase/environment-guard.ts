export type AppEnvironment = "local" | "staging" | "production";

// Supabase project refs are public identifiers. Keeping this contract in source
// prevents a matching pair of incorrectly scoped Vercel variables from bypassing the guard.
export const SUPABASE_PROJECT_REFS = {
  production: "xjxqbwvcgffunqnkmoqw",
  staging: "ujwlvmkqjdlqblnbzmsw",
} as const;

export type SupabaseEnvironmentGuardInput = {
  appEnvironment: string | undefined;
  databaseUrl: string | undefined;
  productionProjectRef: string | undefined;
  stagingProjectRef: string | undefined;
  vercelEnvironment?: string | undefined;
};

export type SupabaseDatabaseIdentity =
  | { kind: "local"; host: "localhost" | "127.0.0.1" }
  | { kind: "cloud"; projectRef: string };

export class DatabaseEnvironmentError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "DatabaseEnvironmentError";
  }
}

function requireAppEnvironment(value: string | undefined): AppEnvironment {
  if (value === "local" || value === "staging" || value === "production") {
    return value;
  }

  throw new DatabaseEnvironmentError(
    "DATABASE_ENVIRONMENT_CONFIGURATION_MISSING",
    "NEXT_PUBLIC_APP_ENV must be local, staging, or production."
  );
}

function requireProjectRef(value: string | undefined, variableName: string): string {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || !/^[a-z0-9]+$/.test(normalized)) {
    throw new DatabaseEnvironmentError(
      "DATABASE_ENVIRONMENT_CONFIGURATION_MISSING",
      `${variableName} must contain a valid Supabase project ref.`
    );
  }
  return normalized;
}

export function parseSupabaseDatabaseIdentity(urlValue: string): SupabaseDatabaseIdentity {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new DatabaseEnvironmentError(
      "INVALID_SUPABASE_URL",
      "Supabase URL is malformed."
    );
  }

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new DatabaseEnvironmentError(
        "INVALID_SUPABASE_URL",
        "Local Supabase URL must use HTTP or HTTPS."
      );
    }
    return { kind: "local", host };
  }

  const cloudMatch = host.match(/^([a-z0-9]+)\.supabase\.co$/);
  if (!cloudMatch || url.protocol !== "https:") {
    throw new DatabaseEnvironmentError(
      "INVALID_SUPABASE_URL",
      "Cloud Supabase URL must use https://<project-ref>.supabase.co."
    );
  }

  return { kind: "cloud", projectRef: cloudMatch[1] };
}

function assertVercelEnvironmentMatches(
  appEnvironment: AppEnvironment,
  vercelEnvironment: string | undefined
) {
  if (!vercelEnvironment) return;

  const expectedAppEnvironment =
    vercelEnvironment === "production"
      ? "production"
      : vercelEnvironment === "preview"
        ? "staging"
        : vercelEnvironment === "development"
          ? "local"
          : undefined;

  if (!expectedAppEnvironment || expectedAppEnvironment !== appEnvironment) {
    throw new DatabaseEnvironmentError(
      "APPLICATION_ENVIRONMENT_MISMATCH",
      `VERCEL_ENV=${vercelEnvironment} is incompatible with NEXT_PUBLIC_APP_ENV=${appEnvironment}.`
    );
  }
}

export function assertSupabaseEnvironment(
  input: SupabaseEnvironmentGuardInput
): SupabaseDatabaseIdentity {
  const appEnvironment = requireAppEnvironment(input.appEnvironment);
  if (!input.databaseUrl) {
    throw new DatabaseEnvironmentError(
      "DATABASE_ENVIRONMENT_CONFIGURATION_MISSING",
      "Supabase URL is missing."
    );
  }

  assertVercelEnvironmentMatches(appEnvironment, input.vercelEnvironment);
  const identity = parseSupabaseDatabaseIdentity(input.databaseUrl);

  if (appEnvironment === "local") {
    if (identity.kind !== "local") {
      throw new DatabaseEnvironmentError(
        "LOCAL_REMOTE_DATABASE_BLOCKED",
        "Local application runtime may only connect to localhost Supabase."
      );
    }
    return identity;
  }

  const productionProjectRef = requireProjectRef(
    input.productionProjectRef,
    "NEXT_PUBLIC_PRODUCTION_SUPABASE_PROJECT_REF"
  );
  const stagingProjectRef = requireProjectRef(
    input.stagingProjectRef,
    "NEXT_PUBLIC_STAGING_SUPABASE_PROJECT_REF"
  );

  if (productionProjectRef === stagingProjectRef) {
    throw new DatabaseEnvironmentError(
      "DATABASE_ENVIRONMENT_CONFIGURATION_MISSING",
      "Production and staging Supabase project refs must be different."
    );
  }

  if (identity.kind !== "cloud") {
    throw new DatabaseEnvironmentError(
      "DATABASE_ENVIRONMENT_MISMATCH",
      `${appEnvironment} runtime requires a cloud Supabase project.`
    );
  }

  if (appEnvironment === "staging") {
    if (identity.projectRef === productionProjectRef) {
      throw new DatabaseEnvironmentError(
        "PREVIEW_PRODUCTION_DATABASE_BLOCKED",
        "Preview runtime cannot connect to the production Supabase project."
      );
    }
    if (identity.projectRef !== stagingProjectRef) {
      throw new DatabaseEnvironmentError(
        "DATABASE_ENVIRONMENT_MISMATCH",
        "Preview runtime is not connected to the configured staging Supabase project."
      );
    }
    return identity;
  }

  if (identity.projectRef === stagingProjectRef) {
    throw new DatabaseEnvironmentError(
      "PRODUCTION_STAGING_DATABASE_BLOCKED",
      "Production runtime cannot connect to the staging Supabase project."
    );
  }
  if (identity.projectRef !== productionProjectRef) {
    throw new DatabaseEnvironmentError(
      "DATABASE_ENVIRONMENT_MISMATCH",
      "Production runtime is not connected to the configured production Supabase project."
    );
  }

  return identity;
}

type EnvironmentValues = Readonly<Record<string, string | undefined>>;

type PublicEnvironment = EnvironmentValues & {
  NEXT_PUBLIC_APP_ENV?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_VERCEL_ENV?: string;
};

export function assertPublicSupabaseEnvironment(
  environment: PublicEnvironment
) {
  return assertSupabaseEnvironment({
    appEnvironment: environment.NEXT_PUBLIC_APP_ENV,
    databaseUrl: environment.NEXT_PUBLIC_SUPABASE_URL,
    productionProjectRef: SUPABASE_PROJECT_REFS.production,
    stagingProjectRef: SUPABASE_PROJECT_REFS.staging,
    vercelEnvironment: environment.NEXT_PUBLIC_VERCEL_ENV,
  });
}

export function assertServerSupabaseEnvironment(
  databaseUrl: string | undefined,
  environment: EnvironmentValues = process.env
) {
  return assertSupabaseEnvironment({
    appEnvironment: environment.NEXT_PUBLIC_APP_ENV,
    databaseUrl,
    productionProjectRef: SUPABASE_PROJECT_REFS.production,
    stagingProjectRef: SUPABASE_PROJECT_REFS.staging,
    // A server runtime without VERCEL_ENV is a local development process.
    // Treating it as development prevents .env.local from opting into a cloud
    // service-role connection by merely claiming APP_ENV=production/staging.
    vercelEnvironment: environment.VERCEL_ENV ?? "development",
  });
}

export function assertConfiguredSupabaseUrls(
  environment: EnvironmentValues = process.env
) {
  const publicUrl = environment.NEXT_PUBLIC_SUPABASE_URL;
  const serverUrl = environment.SUPABASE_URL;
  const publicIdentity = publicUrl
    ? assertServerSupabaseEnvironment(publicUrl, environment)
    : undefined;
  const serverIdentity = serverUrl
    ? assertServerSupabaseEnvironment(serverUrl, environment)
    : undefined;

  if (publicIdentity && serverIdentity) {
    const publicKey =
      publicIdentity.kind === "local" ? `local:${publicIdentity.host}` : publicIdentity.projectRef;
    const serverKey =
      serverIdentity.kind === "local" ? `local:${serverIdentity.host}` : serverIdentity.projectRef;
    if (publicKey !== serverKey) {
      throw new DatabaseEnvironmentError(
        "SUPABASE_SERVER_PUBLIC_URL_MISMATCH",
        "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_URL must identify the same database environment."
      );
    }
  }
}
