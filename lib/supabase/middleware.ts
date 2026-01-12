import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/session";

/**
 * 미들웨어에서 세션 확인 및 보호된 라우트 처리
 */
export async function updateSession(request: NextRequest) {
  const session = getSessionFromRequest(request);

  // 보호된 라우트 정의 (로그인 페이지와 API는 제외)
  const protectedPaths = ["/dashboard", "/journal", "/survey", "/summary", "/sales"];
  const isProtectedPath = protectedPaths.some((path) =>
    request.nextUrl.pathname.startsWith(path)
  );
  const isLoginPath = request.nextUrl.pathname.startsWith("/login");
  const isApiPath = request.nextUrl.pathname.startsWith("/api");

  // 보호된 경로에 인증되지 않은 사용자가 접근하려고 하면 로그인 페이지로 리다이렉트
  if (isProtectedPath && !session && !isApiPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // 이미 로그인한 사용자가 로그인 페이지에 접근하면 대시보드로 리다이렉트
  if (isLoginPath && session && !isApiPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return NextResponse.next({
    request,
  });
}
