import { getUser } from "./get-user";
import { hasPermission, hasAnyPermission, type Permission, type UserRole } from "@/lib/permissions";

/**
 * 서버 사이드에서 권한 체크
 * API Route나 Server Component에서 사용
 * 권한이 없으면 에러를 throw합니다 (리다이렉트하지 않음)
 */
export async function checkPermission(
  requiredPermissions: Permission | Permission[]
): Promise<void> {
  const user = await getUser();

  if (!user) {
    throw new Error("Unauthorized: No user session found.");
  }

  const userRole: UserRole = user.role;
  const permissionsArray = Array.isArray(requiredPermissions)
    ? requiredPermissions
    : [requiredPermissions];

  const authorized = hasAnyPermission(userRole, permissionsArray);

  if (!authorized) {
    throw new Error("Forbidden: You do not have the necessary permissions.");
  }
}

