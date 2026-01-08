"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useUser } from "@/hooks/use-user";

interface HeaderProps {
  onMenuToggle?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onMenuToggle }) => {
  const router = useRouter();
  const { user, logout } = useUser();

  const handleLoginClick = () => {
    router.push("/login");
  };

  return (
    <header className="h-16 bg-white border-b border-surface-100 flex items-center justify-between px-4 lg:px-6 sticky top-0 z-30">
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
    </header>
  );
};

