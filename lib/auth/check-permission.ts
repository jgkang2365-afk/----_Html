import { getSession } from "./session";
import { Permission, hasPermission, hasAnyPermission } from "@/lib/permissions";

/**
 * API 엔드포인트에서 권한 체크
 * 권한이 없으면 예외를 던집니다
 */
export async function checkPermission(
  requiredPermissions: Permission | Permission[]
): Promise<void> {
  try {
    const session = await getSession();

    if (!session) {
      throw new Error("Unauthorized");
    }

    const permissions = Array.isArray(requiredPermissions)
      ? requiredPermissions
      : [requiredPermissions];

    const hasAccess = hasAnyPermission(session.role, permissions);

    if (!hasAccess) {
      throw new Error("Forbidden");
    }
  } catch (error) {
    // 이미 Error 객체인 경우 그대로 전달
    if (error instanceof Error) {
      throw error;
    }
    // 그 외의 경우 새로운 Error로 래핑
    throw new Error("권한 체크 중 오류가 발생했습니다.");
  }
}
