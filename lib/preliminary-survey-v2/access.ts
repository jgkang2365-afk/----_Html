import type { SessionData } from "@/lib/auth/session";

export async function canManagePreliminarySurvey(supabase: any, session: SessionData | null) {
  if (!session) return false;
  if (session.role === "관리자") return true;
  const { data, error } = await supabase.from("users")
    .select("is_preliminary_survey_manager")
    .eq("id", session.userId)
    .maybeSingle();
  // migration 적용 전에는 기존 안전 정책(관리자만 쓰기)을 유지한다.
  return !error && data?.is_preliminary_survey_manager === true;
}
