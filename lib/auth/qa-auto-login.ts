export type QaAutoLoginEnvironment = Readonly<
  Record<string, string | undefined>
>;

export function isQaAutoLoginEnabled(
  environment: QaAutoLoginEnvironment = process.env
) {
  return (
    environment.VERCEL_ENV === "preview" &&
    environment.NEXT_PUBLIC_APP_ENV === "staging" &&
    environment.QA_AUTO_LOGIN === "true"
  );
}

export function qaAutoLoginRedirectPath(value: string | null) {
  if (!value) return "/survey";

  try {
    const baseUrl = new URL("https://qa.invalid");
    const destination = new URL(value, baseUrl);
    if (
      destination.origin !== baseUrl.origin ||
      !destination.pathname.startsWith("/survey")
    ) {
      return "/survey";
    }
    return `${destination.pathname}${destination.search}`;
  } catch {
    return "/survey";
  }
}
