import { createClient } from "@/lib/supabase/server";

/**
 * 현재 로그인한 사용자 정보 조회 (서버 사이드)
 */
export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  // users 테이블에서 추가 정보 조회
  const { data: userData, error: userError } = await supabase
    .from("users")
    .select("id, email, name, role")
    .eq("email", user.email)
    .single();

  if (userError || !userData) {
    return {
      id: user.id,
      email: user.email || "",
      name: user.email?.split("@")[0] || "사용자",
      role: "측정팀 직원" as const,
    };
  }

  return {
    id: userData.id.toString(),
    email: userData.email,
    name: userData.name,
    role: userData.role as "관리자" | "측정팀 직원",
  };
}

