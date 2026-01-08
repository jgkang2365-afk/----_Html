"use client";

import { useUser } from "./use-user";
import { hasPermission, type Permission } from "@/lib/permissions";

/**
 * 권한 체크를 위한 커스텀 훅
 */
export function usePermission(permission: Permission) {
  const { user } = useUser();

  if (!user) {
    return false;
  }

  return hasPermission(user.role, permission);
}

/**
 * 여러 권한 중 하나라도 있는지 확인
 */
export function useAnyPermission(permissions: Permission[]) {
  const { user } = useUser();

  if (!user) {
    return false;
  }

  return permissions.some((permission) =>
    hasPermission(user.role, permission)
  );
}

