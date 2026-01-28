/**
 * 권한 관리 유틸리티
 * 역할 기반 접근 제어(RBAC)를 구현합니다.
 */

export type UserRole = "관리자" | "사용자";

export type Permission =
  | "journal:read"
  | "journal:write"
  | "journal:delete"
  | "survey:read"
  | "survey:write"
  | "dashboard:read"
  | "sales:read"
  | "sales:write"
  | "system:settings"
  | "users:manage";

/**
 * 역할별 권한 정의
 */
const rolePermissions: Record<UserRole, Permission[]> = {
  관리자: [
    "journal:read",
    "journal:write",
    "journal:delete",
    "survey:read",
    "survey:write",
    "dashboard:read",
    "sales:read",
    "sales:write",
    "system:settings",
    "users:manage",
  ],
  "사용자": [
    "journal:read",
    "journal:write",
    "journal:delete",
    "survey:read",
    "survey:write",
    "dashboard:read",
    "sales:read",
    "sales:write",
  ],
};

/**
 * 사용자 역할이 특정 권한을 가지고 있는지 확인
 */
export function hasPermission(role: UserRole, permission: Permission): boolean {
  return rolePermissions[role]?.includes(permission) ?? false;
}

/**
 * 사용자 역할이 여러 권한 중 하나라도 가지고 있는지 확인
 */
export function hasAnyPermission(
  role: UserRole,
  permissions: Permission[]
): boolean {
  return permissions.some((permission) => hasPermission(role, permission));
}

/**
 * 사용자 역할이 모든 권한을 가지고 있는지 확인
 */
export function hasAllPermissions(
  role: UserRole,
  permissions: Permission[]
): boolean {
  return permissions.every((permission) => hasPermission(role, permission));
}

/**
 * 측정일지 수정 가능 여부 확인
 * 완료된 측정일지는 수정할 수 없습니다.
 */
export function canEditJournal(
  role: UserRole,
  isCompleted: boolean
): { allowed: boolean; reason?: string } {
  // 관리자는 완료 여부와 관계없이 수정 가능
  if (role === "관리자") {
    return { allowed: true };
  }

  if (isCompleted) {
    return {
      allowed: false,
      reason: "완료된 측정일지는 수정할 수 없습니다.",
    };
  }

  if (!hasPermission(role, "journal:write")) {
    return {
      allowed: false,
      reason: "측정일지 수정 권한이 없습니다.",
    };
  }

  return { allowed: true };
}

/**
 * 측정일지 삭제 가능 여부 확인
 */
export function canDeleteJournal(role: UserRole): boolean {
  return hasPermission(role, "journal:delete");
}

/**
 * 시스템 설정 접근 가능 여부 확인
 */
export function canAccessSystemSettings(role: UserRole): boolean {
  return hasPermission(role, "system:settings");
}

/**
 * 사용자 관리 접근 가능 여부 확인
 */
export function canManageUsers(role: UserRole): boolean {
  return hasPermission(role, "users:manage");
}

