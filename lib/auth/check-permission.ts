import { getSession } from "./session";
import { Permission, hasPermission, hasAnyPermission } from "@/lib/permissions";

/**
 * API 엔드포인트에서 권한 체크
 * 권한이 없으면 예외를 던집니다
 */
export async function checkPermission(
  requiredPermissions: Permission | Permission[]
): Promise<void> {
  const session = await getSession();

  if (!session) {
    throw new Error("로그인이 필요합니다.");
  }

  const permissions = Array.isArray(requiredPermissions)
    ? requiredPermissions
    : [requiredPermissions];

  const hasAccess = hasAnyPermission(session.role, permissions);

  if (!hasAccess) {
    throw new Error("권한이 없습니다.");
  }
}
