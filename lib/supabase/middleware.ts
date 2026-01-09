import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * 미들웨어에서 사용할 Supabase 클라이언트 생성 및 보호된 라우트 처리
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // 세션 새로고침 (필요시)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 보호된 라우트 정의 (로그인 페이지와 API는 제외)
  const protectedPaths = ["/dashboard", "/journal", "/survey", "/summary", "/sales"];
  const isProtectedPath = protectedPaths.some((path) =>
    request.nextUrl.pathname.startsWith(path)
  );
  const isLoginPath = request.nextUrl.pathname.startsWith("/login");
  const isApiPath = request.nextUrl.pathname.startsWith("/api");

  // 보호된 경로에 인증되지 않은 사용자가 접근하려고 하면 로그인 페이지로 리다이렉트
  if (isProtectedPath && !user && !isApiPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // 이미 로그인한 사용자가 로그인 페이지에 접근하면 대시보드로 리다이렉트
  if (isLoginPath && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
