import { createBrowserClient } from "@supabase/ssr";

/**
 * 클라이언트 사이드에서 사용할 Supabase 클라이언트 생성
 * Client Components에서 사용
 */
export function createClient() {
  // Next.js에서 NEXT_PUBLIC_ 접두사가 있는 환경 변수는 브라우저에 노출됩니다
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Supabase 환경 변수가 설정되지 않았습니다. " +
      "NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_ANON_KEY를 확인하세요. " +
      "환경 변수를 변경했다면 개발 서버를 재시작하세요."
    );
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}

