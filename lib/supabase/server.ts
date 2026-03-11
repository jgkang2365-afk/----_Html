import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * 서버 사이드에서 사용할 Supabase 클라이언트 생성
 * 쿠키 간섭 방지를 위해 SSR 클라이언트 대신 직접 Supabase JS 클라이언트 사용
 * (자체 세션 관리를 사용하므로 Supabase 쿠키 통합이 불필요)
 */
export async function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      "Supabase 환경 변수가 설정되지 않았습니다. " +
      "NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY를 확인하세요. " +
      "환경 변수를 변경했다면 개발 서버를 재시작하세요."
    );
  }

  return createSupabaseClient(supabaseUrl, supabaseServiceKey);
}

