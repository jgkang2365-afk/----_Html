import { redirect } from "next/navigation";
import { getUser } from "./get-user";

/**
 * 인증이 필요한 페이지에서 사용
 * 인증되지 않은 사용자는 로그인 페이지로 리다이렉트
 */
export async function requireAuth() {
  const user = await getUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}

