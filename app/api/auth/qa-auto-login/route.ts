import { NextRequest, NextResponse } from "next/server";
import { setSessionCookie } from "@/lib/auth/session";
import {
  isQaAutoLoginEnabled,
  qaAutoLoginRedirectPath,
} from "@/lib/auth/qa-auto-login";
import { createClient } from "@/lib/supabase/server";
import { verifyPassword } from "@/lib/utils/password";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function loginFailure(request: NextRequest) {
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("error", "QA_AUTO_LOGIN_FAILED");
  return NextResponse.redirect(loginUrl);
}

export async function GET(request: NextRequest) {
  // Production/local runtimes must exit before QA credentials are referenced.
  if (!isQaAutoLoginEnabled(process.env)) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const qaEmail = process.env.QA_LOGIN_EMAIL?.trim();
  const qaPassword = process.env.QA_LOGIN_PASSWORD;
  if (!qaEmail || !qaPassword) return loginFailure(request);

  try {
    // createClient enforces the existing Preview -> Staging database guard.
    const supabase = await createClient();
    const { data: user, error } = await supabase
      .from("users")
      .select(
        "id, email, name, role, password_hash, is_active, is_preliminary_survey_manager"
      )
      .eq("email", qaEmail)
      .maybeSingle();

    const isReservedStagingTester =
      user &&
      user.id >= 9000 &&
      user.id <= 9999 &&
      user.role === "사용자" &&
      user.is_active === true &&
      user.is_preliminary_survey_manager === true;

    if (
      error ||
      !isReservedStagingTester ||
      !user.password_hash ||
      !(await verifyPassword(qaPassword, user.password_hash))
    ) {
      return loginFailure(request);
    }

    const destination = new URL(
      qaAutoLoginRedirectPath(request.nextUrl.searchParams.get("redirect")),
      request.url
    );
    const response = NextResponse.redirect(destination);
    setSessionCookie(response, {
      userId: user.id,
      name: user.name,
      role: "사용자",
    });
    return response;
  } catch {
    return loginFailure(request);
  }
}
