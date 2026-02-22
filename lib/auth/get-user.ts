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
    let supabase;
    try {
      supabase = await createClient();
    } catch (supabaseError: any) {
      console.error("[getUser] Supabase 클라이언트 생성 오류:", supabaseError);
      throw new Error(`Supabase 클라이언트 생성 실패: ${supabaseError?.message || String(supabaseError)}`);
    }

    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("id, name, role, job, survey_code, k2b_id")
      .eq("id", session.userId)
      .eq("id", session.userId)
      .limit(1)
      .maybeSingle();

    if (userError) {
      console.error("[getUser] 사용자 조회 오류:", userError);
      console.error("[getUser] 오류 코드:", userError.code);
      console.error("[getUser] 오류 메시지:", userError.message);
      console.error("[getUser] 세션 userId:", session.userId);
      // 데이터베이스 오류는 throw하여 상위에서 처리하도록 함
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
    };
  } catch (error) {
    console.error("[getUser] 함수 오류:", error);
    // 에러 상세 정보 로깅
    if (error instanceof Error) {
      console.error("[getUser] 에러 메시지:", error.message);
      console.error("[getUser] 에러 스택:", error.stack);
      // 에러를 다시 throw하여 상위에서 처리하도록 함
      throw error;
    }
    // 알 수 없는 오류
    throw new Error(`getUser 함수 오류: ${String(error)}`);
  }
}
