import { getSession } from "./session";
import { createClient } from "@/lib/supabase/server";

/**
 * 현재 로그인한 사용자 정보 조회 (서버 사이드)
 */
export async function getUser() {
  try {
    const session = await getSession();

    if (!session) {
      return null;
    }

    // 세션 데이터에서 사용자 정보 조회
    const supabase = await createClient();
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("id, name, role")
      .eq("id", session.userId)
      .single();

    if (userError || !userData) {
      console.error("사용자 조회 오류:", userError);
      return null;
    }

    return {
      id: userData.id.toString(),
      email: "", // 더 이상 사용하지 않음
      name: userData.name,
      role: userData.role as "관리자" | "사용자",
    };
  } catch (error) {
    console.error("getUser 함수 오류:", error);
    return null;
  }
}
