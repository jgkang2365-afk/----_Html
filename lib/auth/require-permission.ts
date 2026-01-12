import { redirect } from "next/navigation";
import { getSession } from "./session";
import { Permission, hasPermission } from "@/lib/permissions";

/**
 * 특정 권한이 필요한 페이지에서 사용
 */
export async function requirePermission(
  permission: Permission,
  redirectTo: string = "/dashboard"
) {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  if (!hasPermission(session.role, permission)) {
    redirect(redirectTo);
  }

  return session;
}

/**
 * 관리자 권한이 필요한 페이지에서 사용
 */
export async function requireAdmin() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  if (session.role !== "관리자") {
    redirect("/dashboard");
  }

  return session;
}
