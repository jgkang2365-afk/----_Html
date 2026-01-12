"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useUser } from "@/hooks/use-user";

interface NavItem {
  href: string;
  label: string;
  icon?: string;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { href: "/dashboard", label: "대시보드", icon: "📊" },
  { href: "/survey", label: "예비조사", icon: "🔍" },
  { href: "/journal", label: "측정일지", icon: "📋" },
  { href: "/businesses", label: "측정 대상 사업장 관리", icon: "🏢" },
  { href: "/businesses/national-support", label: "건강디딤돌 신청결과", icon: "🏥" },
  { href: "/summary", label: "측정정보 요약", icon: "📄" },
  { href: "/sales", label: "매출관리", icon: "💰" },
];

const adminNavItems: NavItem[] = [
  { href: "/users", label: "사용자 관리", icon: "👥", adminOnly: true },
];

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen = true, onClose }) => {
  const pathname = usePathname();
  const { user } = useUser();
  const isAdmin = user?.role === "관리자";

  return (
    <>
      {/* 모바일 오버레이 */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* 사이드바 */}
      <aside
        className={cn(
          "fixed top-0 left-0 h-full w-64 bg-white border-r border-surface-100 z-50 transition-transform",
          "lg:translate-x-0 lg:static lg:z-auto",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex flex-col h-full">
          {/* 일반 네비게이션 */}
          <nav className="flex-1 overflow-y-auto py-6">
            <ul className="space-y-1 px-3">
              {navItems.map((item) => {
                const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => onClose?.()}
                      className={cn(
                        "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-150",
                        "focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2",
                        isActive
                          ? "bg-primary-50 text-primary-600 shadow-sm"
                          : "text-text-700 hover:bg-surface-50 hover:text-text-900"
                      )}
                      aria-current={isActive ? "page" : undefined}
                    >
                      {item.icon && (
                        <span className="text-base flex-shrink-0">{item.icon}</span>
                      )}
                      <span>{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          
          {/* 관리자 전용 메뉴 (하단 고정) */}
          {isAdmin && (
            <nav className="mt-auto border-t border-surface-200 pt-4 pb-6">
              <ul className="space-y-1 px-3">
                {adminNavItems.map((item) => {
                  const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => onClose?.()}
                        className={cn(
                          "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-150",
                          "focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2",
                          isActive
                            ? "bg-primary-50 text-primary-600 shadow-sm"
                            : "text-text-700 hover:bg-surface-50 hover:text-text-900"
                        )}
                        aria-current={isActive ? "page" : undefined}
                      >
                        {item.icon && (
                          <span className="text-base flex-shrink-0">{item.icon}</span>
                        )}
                        <span>{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          )}
        </div>
      </aside>
    </>
  );
};
