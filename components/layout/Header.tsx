"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useUser } from "@/hooks/use-user";
import { cn } from "@/lib/utils";
import React from "react";

interface HeaderProps {
  onMenuToggle?: () => void;
}

interface NavItem {
  href: string;
  label: string;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { href: "/dashboard", label: "대시보드" },
  { href: "/businesses", label: "측정 대상 사업장 관리" },
  { href: "/survey", label: "예비조사" },
  { href: "/journal", label: "측정일지" },
  { href: "/summary", label: "측정정보 요약" },
  { href: "/businesses/national-support", label: "건강디딤돌 신청결과" },
  { href: "/sales", label: "매출관리" },
];

const adminNavItems: NavItem[] = [
  { href: "/users", label: "사용자 관리", adminOnly: true },
  { href: "/business-categories", label: "업종분류 관리", adminOnly: true },
];

export const Header: React.FC<HeaderProps> = ({ onMenuToggle }) => {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading, logout } = useUser();
  const isAdmin = user?.role === "관리자" || user?.role === "DB관리";

  // 디버깅: 사용자 정보 확인
  React.useEffect(() => {
    if (!loading) {
      console.log("[Header] 사용자 정보:", user);
      console.log("[Header] 관리자 여부:", isAdmin);
    }
  }, [user, loading, isAdmin]);

  const handleLoginClick = () => {
    router.push("/login");
  };

  return (
    <header className="bg-white border-b border-surface-100 sticky top-0 z-30">
      <div className="h-16 flex items-center justify-between px-4 lg:px-6">
        <div className="flex items-center gap-4">
          {/* 모바일 메뉴 버튼 */}
          <button
            onClick={onMenuToggle}
            className="lg:hidden p-2 rounded-md hover:bg-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
            aria-label="메뉴 열기"
          >
            <svg
              className="w-6 h-6 text-text-700"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path d="M4 6h16M4 12h16M4 18h16"></path>
            </svg>
          </button>

          {/* 로고/제목 */}
          <h1 className="text-xl font-bold text-primary-600">측정일지 관리 시스템</h1>
        </div>

        {/* 사용자 메뉴 */}
        <div className="relative">
          {user ? (
            <div className="flex items-center gap-4">
              <div className="hidden sm:block text-right">
                <div className="text-sm font-medium text-text-900">{user.name}</div>
                <div className="text-xs text-text-500">{user.email}</div>
              </div>
              <Button variant="secondary" size="sm" onClick={logout}>
                로그아웃
              </Button>
            </div>
          ) : (
            <Button variant="primary" size="sm" onClick={handleLoginClick}>
              로그인
            </Button>
          )}
        </div>
      </div>

      {/* 상단 네비게이션바 (데스크톱 전용) */}
      <nav className="hidden lg:block border-t border-surface-100 bg-white/95 backdrop-blur-sm">
        <div className="px-4 lg:px-6">
          <div className="flex items-center justify-between py-2">
            {/* 일반 메뉴 */}
            <ul className="flex items-center gap-1 overflow-x-auto no-scrollbar">
              {navItems.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (pathname?.startsWith(item.href + "/") &&
                    !navItems.some(
                      (other) =>
                        other.href !== item.href &&
                        other.href.startsWith(item.href) &&
                        (pathname === other.href || pathname.startsWith(other.href + "/"))
                    ));

                return (
                  <li key={item.href} className="shrink-0">
                    <Link
                      href={item.href}
                      className={cn(
                        "px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap block",
                        isActive
                          ? "bg-primary-50 text-primary-600"
                          : "text-text-700 hover:bg-surface-50 hover:text-text-900"
                      )}
                      aria-current={isActive ? "page" : undefined}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>

            {/* 관리자 메뉴 (맨 오른쪽) */}
            {!loading && isAdmin && (
              <ul className="flex items-center gap-1 shrink-0 ml-4">
                {adminNavItems.map((item) => {
                  const isActive =
                    pathname === item.href || pathname?.startsWith(item.href + "/");

                  return (
                    <li key={item.href} className="shrink-0">
                      <Link
                        href={item.href}
                        className={cn(
                          "px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap block",
                          isActive
                            ? "bg-primary-50 text-primary-600"
                            : "text-text-700 hover:bg-surface-50 hover:text-text-900"
                        )}
                        aria-current={isActive ? "page" : undefined}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </nav>
    </header>
  );
};
