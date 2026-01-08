import { createClient } from "@supabase/supabase-js";

// 클라이언트 사이드용 Supabase 클라이언트 (공개 키 사용)
export function createBrowserClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing Supabase environment variables. Please check your .env.local file."
    );
  }

  return createClient(supabaseUrl, supabaseAnonKey);
}

// 서버 사이드용 Supabase 클라이언트 (서비스 롤 키 사용)
export function createServerClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      "Missing Supabase server environment variables. Please check your .env.local file."
    );
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// 기본 클라이언트는 필요할 때만 생성하도록 변경
// 클라이언트 사이드에서 사용할 때는 createBrowserClient()를 직접 호출하세요

