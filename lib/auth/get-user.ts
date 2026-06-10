import { getSession } from "./session";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key);
}

/**
 * 현재 로그인한 사용자 정보 조회 (서버 사이드)
 * 쿠키 간섭 방지를 위해 SSR 클라이언트 대신 직접 Supabase JS 클라이언트 사용
 */
export async function getUser() {
  try {
    const session = await getSession();

    if (!session) {
      return null;
    }

    const supabase = getSupabase();

    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("id, name, role, job, survey_code, k2b_id, is_journal_manager")
      .eq("id", session.userId)
      .limit(1)
      .maybeSingle();

    if (userError) {
      console.error("[getUser] 사용자 조회 오류:", userError);
      console.error("[getUser] 세션 userId:", session.userId);
      throw new Error(`사용자 조회 실패: ${userError.message || "알 수 없는 오류"}`);
    }

    if (!userData) {
      console.error("[getUser] 사용자 데이터가 없습니다. userId:", session.userId);
      return null;
    }

    return {
      id: userData.id.toString(),
      name: userData.name,
      role: userData.role as "관리자" | "사용자",
      job: userData.job,
      survey_code: userData.survey_code,
      k2b_id: userData.k2b_id,
      is_journal_manager: !!userData.is_journal_manager,
    };
  } catch (error) {
    console.error("[getUser] 함수 오류:", error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`getUser 함수 오류: ${String(error)}`);
  }
}
