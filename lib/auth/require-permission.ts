import { redirect } from "next/navigation";
import { getUser } from "./get-user";
import { hasPermission, type Permission, type UserRole } from "@/lib/permissions";

/**
 * 특정 권한이 필요한 페이지에서 사용
 * 인증되지 않았거나 권한이 없으면 리다이렉트
 */
export async function requirePermission(
  permission: Permission,
  redirectTo: string = "/dashboard"
) {
  const user = await getUser();

  if (!user) {
    redirect("/login");
  }

  if (!hasPermission(user.role, permission)) {
    redirect(redirectTo);
  }

  return user;
}

/**
 * 관리자 권한이 필요한 페이지에서 사용
 */
export async function requireAdmin() {
  return requirePermission("system:settings", "/dashboard");
}

