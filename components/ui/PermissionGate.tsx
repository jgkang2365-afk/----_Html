"use client";

import { ReactNode } from "react";
import { usePermission } from "@/hooks/use-permission";
import { type Permission } from "@/lib/permissions";

interface PermissionGateProps {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * 권한이 있는 경우에만 children을 렌더링하는 컴포넌트
 */
export function PermissionGate({
  permission,
  children,
  fallback = null,
}: PermissionGateProps) {
  const hasPermission = usePermission(permission);

  if (!hasPermission) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

