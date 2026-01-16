import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * 서버 사이드에서 사용할 Supabase 클라이언트 생성 (쿠키 기반 세션 관리)
 * Server Components, Server Actions, Route Handlers에서 사용
 */
export async function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Supabase 환경 변수가 설정되지 않았습니다. " +
      "NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_ANON_KEY를 확인하세요. " +
      "환경 변수를 변경했다면 개발 서버를 재시작하세요."
    );
  }

  const cookieStore = await cookies();

  return createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // 쿠키 설정은 Server Actions에서만 가능합니다
            // Route Handlers에서는 Response 헤더로 설정해야 합니다
          }
        },
      },
    }
  );
}

